# openai-computeruse

POC: plain-English test cases live in Jira, an OpenAI computer-use agent executes them in a hosted
browser (one step at a time, one screenshot per step), and the results are written back to Jira.

```
Jira JQL -> data/tests.json -> OpenAI hosted browser -> output/<run>/report.json + report.html -> Jira execution issue
```

## Setup

```
npm install
copy config\.env.example config\.env     # then fill in the blanks
```

All settings, including URLs, credentials, JQL and the allowed browser origins, live in `config/.env`
(gitignored). Nothing is hard-coded. `config/.env.example` documents every setting.

Required secrets: `OPENAI_API_KEY`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
([create a Jira API token](https://id.atlassian.com/manage-profile/security/api-tokens)).

## Run

| Command | What it does |
| --- | --- |
| `npm run seed` | Creates two sample tests in Jira (skips ones that already exist). |
| `npm run fetch` | Runs `JIRA_TEST_JQL` and writes `data/tests.json`. |
| `npm run run` | Executes the tests. Use `npm run run -- --only KAN-1` to run a subset. |
| `npm run publish` | Attaches the latest report to the execution issue, comments, labels, transitions. |
| `npm run all` | `fetch`, `run`, `publish`. |

## Test case format

The Jira description is a numbered list; each item is one step:

```
1. Open https://the-internet.herokuapp.com/login in the browser.
2. Type the username "tomsmith" ... then click the Login button.
3. Verify the page shows the message "You logged into a secure area!".
```

Steps starting with Verify / Check / Assert / Expect only observe the page. A test passes when every
step passes. By default the first non-passing step stops the test and the rest are marked `skipped`
(`STOP_ON_FAIL=false` to keep going).

## Output

`output/<runId>/` contains `report.json`, `report.html` (self-contained, screenshots embedded) and
`screenshots/<KEY>-step<N>.jpg`. `report.json` references the screenshot files instead of embedding them.

## Example output

`examples/sample-run/` holds a real run of the two sample tests (both passed): `tests.json` (as fetched from Jira),
`report.json`, `report.html` and the screenshots. The Jira site name and OpenAI session IDs were removed. Open
`report.html` in a browser to see the report.

## Writing results to Jira

Standard Jira issues have no Pass/Fail field, so `publish` records the outcome as:

- the execution issue summary (`... - PASSED` / `... - FAILED`) and a comment per run,
- the labels `JIRA_PASS_LABEL` / `JIRA_FAIL_LABEL`,
- optionally a workflow transition: set `JIRA_TRANSITION_PASS` / `JIRA_TRANSITION_FAIL` to a transition or
  status name that exists in your workflow (for example `Done`). A missing transition only logs a warning.

Leave `JIRA_EXECUTION_ISSUE_KEY` empty to create a new execution issue per run, or set it to reuse one.

## Notes and limits

- The browser is hosted by OpenAI, so only publicly reachable sites can be tested (not `localhost`).
- Every new origin needs approval. In `allowlist` mode only `ALLOWED_ORIGINS` are approved and all
  others are denied; use `ORIGIN_APPROVAL_MODE=prompt` to be asked in the terminal. Origin approval does
  not guard individual actions, so only point this at sites where that is acceptable.
- The agent sometimes asks for a sign-in (`browser_authentication`) instead of typing credentials itself. The POC
  answers it with the username and password quoted in the current step, but only when the sign-in origin is in
  `ALLOWED_ORIGINS`; otherwise it cancels. The values are never logged. Credentials live in the Jira test text, so
  only use public demo credentials this way.
- Results are model-driven and can vary between runs. The steps' verdicts are the agent's judgement.
- Sessions are deleted after a clean run. If a step times out or the stream drops, the session is kept and its
  ID is logged so you can inspect it.
- The Agents API is in beta (`OpenAI-Beta: agents=v1`); model name and API shape may change.
