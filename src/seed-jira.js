// Creates two sample plain-English test cases in Jira so the rest of the POC has something to run.
// The sample site, username and password come from config/.env (SAMPLE_*).
import { config, requireEnv, JIRA_ENV } from "../config/index.js";
import { createIssue, searchIssues, stepsToAdf } from "./jira.js";

requireEnv([...JIRA_ENV, "JIRA_PROJECT_KEY", "SAMPLE_SITE_URL", "SAMPLE_USERNAME", "SAMPLE_PASSWORD"]);

const { siteUrl, username, password } = config.sample;
const intro = "Plain-English test case executed by the OpenAI computer-use agent. One step per list item.";

const samples = [
  {
    summary: "[AI-TEST] Valid login shows the secure area",
    steps: [
      `Open ${siteUrl}/login in the browser.`,
      `Type the username "${username}" in the Username field and the password "${password}" in the Password field, then click the Login button.`,
      `Verify the page shows the message "You logged into a secure area!".`,
    ],
  },
  {
    summary: "[AI-TEST] Invalid password shows an error",
    steps: [
      `Open ${siteUrl}/login in the browser.`,
      `Type the username "${username}" in the Username field and the password "NotTheRightPassword1" in the Password field, then click the Login button.`,
      `Verify the page shows an error message containing "Your password is invalid!".`,
    ],
  },
];

const existing = await searchIssues(
  `project = "${config.jira.projectKey}" AND labels = "${config.jira.testLabel}" ORDER BY created DESC`,
);
const existingSummaries = new Set(existing.map((issue) => issue.fields.summary));

for (const sample of samples) {
  if (existingSummaries.has(sample.summary)) {
    console.log(`Skipping (already exists): ${sample.summary}`);
    continue;
  }
  const created = await createIssue({
    summary: sample.summary,
    description: stepsToAdf(sample.steps, intro),
    issueType: config.jira.testIssueType,
    labels: [config.jira.testLabel],
  });
  console.log(`Created ${created.key}: ${sample.summary}`);
}
