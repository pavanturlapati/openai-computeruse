import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, "config", ".env"), quiet: true });

const env = process.env;
const bool = (value, fallback) =>
  value === undefined || value === "" ? fallback : ["1", "true", "yes"].includes(value.toLowerCase());
const list = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const config = {
  rootDir,
  dataDir: path.resolve(rootDir, env.DATA_DIR || "data"),
  outputDir: path.resolve(rootDir, env.OUTPUT_DIR || "output"),
  openai: {
    model: env.OPENAI_MODEL || "gpt-6.1-sol",
  },
  jira: {
    baseUrl: (env.JIRA_BASE_URL ?? "").replace(/\/+$/, ""),
    email: env.JIRA_EMAIL ?? "",
    apiToken: env.JIRA_API_TOKEN ?? "",
    projectKey: env.JIRA_PROJECT_KEY ?? "",
    testJql: env.JIRA_TEST_JQL ?? "",
    testIssueType: env.JIRA_TEST_ISSUE_TYPE || "Task",
    testLabel: env.JIRA_TEST_LABEL || "ai-test",
    executionIssueKey: env.JIRA_EXECUTION_ISSUE_KEY ?? "",
    executionIssueType: env.JIRA_EXECUTION_ISSUE_TYPE || "Task",
    executionSummaryPrefix: env.JIRA_EXECUTION_SUMMARY_PREFIX || "AI test execution",
    executionLabel: env.JIRA_EXECUTION_LABEL || "ai-test-execution",
    passLabel: env.JIRA_PASS_LABEL || "ai-test-passed",
    failLabel: env.JIRA_FAIL_LABEL || "ai-test-failed",
    transitionPass: env.JIRA_TRANSITION_PASS ?? "",
    transitionFail: env.JIRA_TRANSITION_FAIL ?? "",
    addComment: bool(env.JIRA_ADD_COMMENT, true),
    attachScreenshots: bool(env.JIRA_ATTACH_SCREENSHOTS, false),
  },
  sample: {
    siteUrl: (env.SAMPLE_SITE_URL ?? "").replace(/\/+$/, ""),
    username: env.SAMPLE_USERNAME ?? "",
    password: env.SAMPLE_PASSWORD ?? "",
  },
  run: {
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    originApprovalMode: (env.ORIGIN_APPROVAL_MODE || "allowlist").toLowerCase(),
    stepTimeoutMs: Number(env.STEP_TIMEOUT_MS) || 180000,
    stopOnFail: bool(env.STOP_ON_FAIL, true),
  },
};

/** Exits with a clear message when required settings are missing. Never prints values. */
export function requireEnv(names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`Missing required settings in config/.env: ${missing.join(", ")}`);
    console.error("Copy config/.env.example to config/.env and fill them in.");
    process.exit(1);
  }
}

export const JIRA_ENV = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
