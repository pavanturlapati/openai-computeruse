import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const formatDuration = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

export function newRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** Saves each step screenshot to disk and returns the run with file paths instead of image data. */
async function saveScreenshots(runDir, tests) {
  const dir = path.join(runDir, "screenshots");
  await fs.mkdir(dir, { recursive: true });
  return Promise.all(
    tests.map(async (test) => ({
      ...test,
      steps: await Promise.all(
        test.steps.map(async ({ screenshot, ...step }) => {
          if (!screenshot) return { ...step, screenshot: null };
          const relative = path.posix.join("screenshots", `${test.key}-step${step.number}.jpg`);
          await fs.writeFile(path.join(runDir, relative), Buffer.from(screenshot.split(",", 2)[1], "base64"));
          return { ...step, screenshot: relative };
        }),
      ),
    })),
  );
}

function summarize(tests) {
  return {
    total: tests.length,
    passed: tests.filter((test) => test.status === "pass").length,
    failed: tests.filter((test) => test.status === "fail").length,
    errored: tests.filter((test) => test.status === "error").length,
  };
}

function renderHtml(report, imageData) {
  const { summary } = report;
  const overall = summary.failed === 0 && summary.errored === 0 ? "pass" : "fail";

  const stepsHtml = (test) =>
    test.steps
      .map((step) => {
        const image = imageData.get(step.screenshot);
        return `
        <li class="step ${step.status}">
          <div class="step-head"><span class="badge ${step.status}">${escapeHtml(step.status)}</span>
            <strong>Step ${step.number}</strong>${step.durationMs ? ` <span class="muted">${formatDuration(step.durationMs)}</span>` : ""}</div>
          <p>${escapeHtml(step.text)}</p>
          ${step.observation ? `<p class="observation">${escapeHtml(step.observation)}</p>` : ""}
          ${step.actions?.length ? `<details><summary>${step.actions.length} browser action(s)</summary><ul>${step.actions
            .map((action) => `<li>${escapeHtml(action.title)} <span class="muted">(${escapeHtml(action.status)})</span></li>`)
            .join("")}</ul></details>` : ""}
          ${image ? `<img alt="Screenshot for step ${step.number}" src="${image}" loading="lazy">` : step.status === "skipped" ? "" : `<p class="muted">No screenshot returned.</p>`}
        </li>`;
      })
      .join("");

  const testsHtml = report.tests
    .map(
      (test) => `
      <section class="test">
        <h2><span class="badge ${test.status}">${escapeHtml(test.status)}</span> ${escapeHtml(test.key)}: ${escapeHtml(test.summary)}</h2>
        <p class="muted"><a href="${escapeHtml(test.url)}">${escapeHtml(test.url)}</a> &middot; ${formatDuration(test.durationMs)}</p>
        <ol>${stepsHtml(test)}</ol>
      </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test execution report ${escapeHtml(report.runId)}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f5f6f8; color: #1d2330; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { margin-bottom: 4px; }
  .muted { color: #6b7385; font-size: 13px; }
  .summary { display: flex; gap: 12px; margin: 16px 0 24px; flex-wrap: wrap; }
  .summary div { background: #fff; border-radius: 8px; padding: 12px 18px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .summary b { display: block; font-size: 22px; }
  .test { background: #fff; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .test h2 { font-size: 18px; margin: 0 0 4px; }
  ol { padding-left: 0; list-style: none; }
  .step { border-top: 1px solid #e6e8ee; padding: 12px 0; }
  .step p { margin: 4px 0; }
  .observation { background: #f0f2f7; border-radius: 6px; padding: 6px 10px; }
  .step img { max-width: 100%; border: 1px solid #d5d9e2; border-radius: 6px; margin-top: 8px; }
  .badge { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #fff; background: #8a91a3; }
  .badge.pass { background: #1f9d55; } .badge.fail, .badge.error { background: #d64545; } .badge.skipped { background: #8a91a3; }
  details { margin: 6px 0; font-size: 13px; }
</style>
</head>
<body><main>
  <h1>Test execution report <span class="badge ${overall}">${overall}</span></h1>
  <p class="muted">Run ${escapeHtml(report.runId)} &middot; model ${escapeHtml(report.model)} &middot; ${formatDuration(report.durationMs)}</p>
  <div class="summary">
    <div><b>${summary.total}</b>tests</div>
    <div><b>${summary.passed}</b>passed</div>
    <div><b>${summary.failed}</b>failed</div>
    <div><b>${summary.errored}</b>errors</div>
  </div>
  ${testsHtml}
</main></body></html>
`;
}

/** Writes report.json, report.html and screenshots/ for a finished run. */
export async function writeReport({ runId, startedAt, tests }) {
  const runDir = path.join(config.outputDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  const savedTests = await saveScreenshots(runDir, tests);
  const report = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    model: config.openai.model,
    jql: config.jira.testJql,
    summary: summarize(savedTests),
    tests: savedTests,
  };

  const imageData = new Map();
  for (const test of savedTests) {
    for (const step of test.steps) {
      if (!step.screenshot) continue;
      const bytes = await fs.readFile(path.join(runDir, step.screenshot));
      imageData.set(step.screenshot, `data:image/jpeg;base64,${bytes.toString("base64")}`);
    }
  }

  const jsonPath = path.join(runDir, "report.json");
  const htmlPath = path.join(runDir, "report.html");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(htmlPath, renderHtml(report, imageData));
  return { runDir, jsonPath, htmlPath, report };
}
