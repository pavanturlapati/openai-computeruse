// Generates a clearly labelled SAMPLE report from data/tests.json without calling OpenAI,
// so `npm run publish` (the Jira write-back) can be tested before an OpenAI key is available.
// The first test is reported as passed and the rest as failed. All observations are fake.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { newRunId, writeReport } from "./report.js";

// 1x1 JPEG placeholder instead of a real browser screenshot.
const PLACEHOLDER = `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=`;

const data = JSON.parse(await fs.readFile(path.join(config.dataDir, "tests.json"), "utf8"));
const startedAt = new Date();

const tests = data.tests.map((test, index) => {
  const shouldPass = index === 0;
  const steps = test.steps.map((step, stepIndex) => {
    const isLast = stepIndex === test.steps.length - 1;
    const failed = !shouldPass && isLast;
    return {
      number: step.number,
      text: step.text,
      status: failed ? "fail" : "pass",
      observation: failed ? "SAMPLE DATA: simulated failure, nothing was executed." : "SAMPLE DATA: simulated pass, nothing was executed.",
      startedAt: startedAt.toISOString(),
      durationMs: 1000 + stepIndex * 500,
      actions: [{ title: "Simulated browser action", status: "completed" }],
      screenshot: PLACEHOLDER,
    };
  });
  return {
    key: test.key,
    summary: test.summary,
    url: test.url,
    status: shouldPass ? "pass" : "fail",
    startedAt: startedAt.toISOString(),
    durationMs: steps.reduce((total, step) => total + step.durationMs, 0),
    sessionId: "sample",
    steps,
  };
});

const { runDir } = await writeReport({ runId: `sample-${newRunId(startedAt)}`, startedAt, tests });
console.log(`Sample report written to ${path.relative(config.rootDir, runDir)}`);
