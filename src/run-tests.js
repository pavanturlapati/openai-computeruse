// Executes the tests in data/tests.json with the OpenAI computer-use agent and writes
// output/<runId>/report.json, report.html and step screenshots.
//   node src/run-tests.js [path/to/tests.json] [--only KAN-1,KAN-2]
import fs from "node:fs/promises";
import path from "node:path";
import { config, requireEnv } from "../config/index.js";
import { createClient, runTest } from "./agent.js";
import { newRunId, writeReport } from "./report.js";

requireEnv(["OPENAI_API_KEY"]);

const args = process.argv.slice(2);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1]?.split(",").map((key) => key.trim().toUpperCase())) : null;
const fileArg = args.find((arg, index) => !arg.startsWith("--") && index !== onlyIndex + 1);
const testsFile = fileArg ? path.resolve(fileArg) : path.join(config.dataDir, "tests.json");

let data;
try {
  data = JSON.parse(await fs.readFile(testsFile, "utf8"));
} catch (error) {
  console.error(`Could not read ${testsFile}: ${error.message}\nRun "npm run fetch" first.`);
  process.exit(1);
}

const tests = data.tests.filter((test) => !only || only.has(test.key.toUpperCase()));
if (tests.length === 0) {
  console.error("No tests to run.");
  process.exit(1);
}

const client = createClient();
const startedAt = new Date();
const runId = newRunId(startedAt);
const results = [];

console.log(`Run ${runId}: ${tests.length} test(s), model ${config.openai.model}`);
for (const test of tests) {
  console.log(`\n${test.key}: ${test.summary}`);
  try {
    results.push(await runTest(client, test));
  } catch (error) {
    console.error(`  [${test.key}] could not run: ${error.message}`);
    results.push({
      key: test.key,
      summary: test.summary,
      url: test.url,
      status: "error",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      steps: test.steps.map((step) => ({
        number: step.number,
        text: step.text,
        status: "error",
        observation: error.message,
        actions: [],
        screenshot: null,
      })),
    });
  }
}

const { runDir, report } = await writeReport({ runId, startedAt, tests: results });
const { summary } = report;
console.log(`\nDone: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.errored} errors`);
console.log(`Report: ${path.relative(config.rootDir, runDir)}${path.sep}report.html`);
