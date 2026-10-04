// Fetches test cases from Jira with the configured JQL and writes them to data/tests.json.
import fs from "node:fs/promises";
import path from "node:path";
import { config, requireEnv, JIRA_ENV } from "../config/index.js";
import { adfToText, parseSteps, searchIssues } from "./jira.js";

requireEnv([...JIRA_ENV, "JIRA_TEST_JQL"]);

const issues = await searchIssues(config.jira.testJql);

const tests = issues
  .map((issue) => {
    const description = adfToText(issue.fields.description).trim();
    return {
      key: issue.key,
      summary: issue.fields.summary,
      url: `${config.jira.baseUrl}/browse/${issue.key}`,
      steps: parseSteps(description).map((text, index) => ({ number: index + 1, text })),
    };
  })
  .filter((test) => {
    if (test.steps.length === 0) console.warn(`Skipping ${test.key}: no steps found in the description.`);
    return test.steps.length > 0;
  });

await fs.mkdir(config.dataDir, { recursive: true });
const file = path.join(config.dataDir, "tests.json");
await fs.writeFile(
  file,
  JSON.stringify({ fetchedAt: new Date().toISOString(), jql: config.jira.testJql, tests }, null, 2),
);

console.log(`Fetched ${tests.length} test(s) -> ${path.relative(config.rootDir, file)}`);
for (const test of tests) console.log(`  ${test.key}: ${test.summary} (${test.steps.length} steps)`);
