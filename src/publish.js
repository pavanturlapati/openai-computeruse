// Writes a finished run back to Jira: attaches report.json + report.html to the execution
// issue, adds a comment, sets pass/fail labels and optionally transitions the issue.
//   node src/publish.js [output/<runId>]   (defaults to the latest run)
import fs from "node:fs/promises";
import path from "node:path";
import { config, requireEnv, JIRA_ENV } from "../config/index.js";
import { addAttachment, addComment, addLabels, createIssue, getIssue, stepsToAdf, transitionIssue } from "./jira.js";

requireEnv([...JIRA_ENV, "JIRA_PROJECT_KEY"]);

async function resolveRunDir() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const entries = await fs.readdir(config.outputDir, { withFileTypes: true }).catch(() => []);
  const runs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (runs.length === 0) {
    console.error('No runs found in the output folder. Run "npm run run" first.');
    process.exit(1);
  }
  return path.join(config.outputDir, runs.at(-1));
}

const runDir = await resolveRunDir();
const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
const { summary } = report;
const passed = summary.failed === 0 && summary.errored === 0;
const verdict = passed ? "PASSED" : "FAILED";

const lines = report.tests.map((test) => {
  const done = test.steps.filter((step) => step.status === "pass").length;
  return `${test.key}: ${test.status.toUpperCase()} (${done}/${test.steps.length} steps passed) - ${test.summary}`;
});
const headline = `${verdict}: ${summary.passed}/${summary.total} tests passed, ${summary.failed} failed, ${summary.errored} errors.`;

// 1. Execution issue: reuse the configured one or create a new one for this run.
let key = config.jira.executionIssueKey;
if (key) {
  await getIssue(key);
  console.log(`Using execution issue ${key}`);
} else {
  const created = await createIssue({
    summary: `${config.jira.executionSummaryPrefix} ${report.runId} - ${verdict}`,
    description: stepsToAdf(lines, `${headline} Reports are attached to this issue.`),
    issueType: config.jira.executionIssueType,
    labels: [config.jira.executionLabel],
  });
  key = created.key;
  console.log(`Created execution issue ${key}`);
}

// 2. Attachments.
const files = [path.join(runDir, "report.json"), path.join(runDir, "report.html")];
if (config.jira.attachScreenshots) {
  const screenshotDir = path.join(runDir, "screenshots");
  const names = await fs.readdir(screenshotDir).catch(() => []);
  files.push(...names.map((name) => path.join(screenshotDir, name)));
}
for (const file of files) {
  await addAttachment(key, file);
  console.log(`Attached ${path.basename(file)}`);
}

// 3. Comment, pass/fail labels, optional transition. These are best effort once files are attached.
const warn = (what, error) => console.warn(`Warning: ${what} failed: ${error.message}`);

if (config.jira.addComment) {
  const text = [headline, ...lines, "", "Attached: report.json and report.html"].join("\n");
  await addComment(key, text).catch((error) => warn("adding the comment", error));
}

const [addLabel, removeLabel] = passed ? [config.jira.passLabel, config.jira.failLabel] : [config.jira.failLabel, config.jira.passLabel];
await addLabels(key, [addLabel], [removeLabel]).catch((error) => warn("setting labels", error));

const transition = passed ? config.jira.transitionPass : config.jira.transitionFail;
if (transition) {
  await transitionIssue(key, transition)
    .then((status) => console.log(`Transitioned ${key} to "${status}"`))
    .catch((error) => warn("transitioning the issue", error));
}

console.log(`${verdict}: results written to ${config.jira.baseUrl}/browse/${key}`);
