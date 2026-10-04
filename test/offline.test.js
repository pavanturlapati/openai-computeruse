import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Set before the config module is imported so these win over config/.env.
process.env.ALLOWED_ORIGINS = "https://allowed.example.com,*.wild.example.org";
process.env.OUTPUT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cu-report-"));

const { adfToText, parseSteps, stepsToAdf } = await import("../src/jira.js");
const { parseVerdict } = await import("../src/agent.js");
const { isOriginAllowed, extractCredentials } = await import("../src/approvals.js");
const { writeReport } = await import("../src/report.js");

test("ADF numbered list round-trips into steps", () => {
  const adf = stepsToAdf(["Open the page", 'Type "a" and click Login', "Verify it works"], "Intro text");
  const steps = parseSteps(adfToText(adf));
  assert.deepEqual(steps, ["Open the page", 'Type "a" and click Login', "Verify it works"]);
});

test("parseSteps falls back to non-empty lines", () => {
  assert.deepEqual(parseSteps("Open the page\n\nVerify the title"), ["Open the page", "Verify the title"]);
});

test("parseVerdict reads the JSON verdict from chatty output", () => {
  const verdict = parseVerdict('Done.\n{"status":"PASS","observation":"Saw the message"}');
  assert.deepEqual(verdict, { status: "pass", observation: "Saw the message" });
  assert.equal(parseVerdict("no json here").status, "error");
});

test("origin allowlist supports origins, hostnames and wildcards", () => {
  assert.equal(isOriginAllowed("https://allowed.example.com"), true);
  assert.equal(isOriginAllowed("https://sub.wild.example.org"), true);
  assert.equal(isOriginAllowed("https://evil.example.net"), false);
});

test("credentials are extracted from the step text", () => {
  const step = 'Type the username "tomsmith" in the Username field and the password "Super Secret!1" in the Password field, then click Login.';
  assert.deepEqual(extractCredentials(step), { username: "tomsmith", password: "Super Secret!1" });
  assert.deepEqual(extractCredentials("Open the page"), { username: null, password: null });
});

test("writeReport produces json, html and screenshot files", async () => {
  const pixel = "data:image/jpeg;base64," + Buffer.from("fake-jpeg").toString("base64");
  const { jsonPath, htmlPath, runDir, report } = await writeReport({
    runId: "test-run",
    startedAt: new Date(Date.now() - 1000),
    tests: [
      {
        key: "KAN-1",
        summary: "<b>Login</b>",
        url: "https://example.atlassian.net/browse/KAN-1",
        status: "fail",
        durationMs: 1000,
        steps: [
          { number: 1, text: "Open", status: "pass", observation: "ok", actions: [{ title: "Navigate", status: "completed" }], screenshot: pixel },
          { number: 2, text: "Verify", status: "fail", observation: "missing", actions: [], screenshot: null },
          { number: 3, text: "Never run", status: "skipped", observation: "skipped", actions: [], screenshot: null },
        ],
      },
    ],
  });

  assert.equal(report.summary.failed, 1);
  const saved = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  assert.equal(saved.tests[0].steps[0].screenshot, "screenshots/KAN-1-step1.jpg");
  await fs.access(path.join(runDir, "screenshots", "KAN-1-step1.jpg"));
  const html = await fs.readFile(htmlPath, "utf8");
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(html, /<b>Login<\/b>/); // summary is HTML-escaped
});
