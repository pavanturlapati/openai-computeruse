import readline from "node:readline/promises";
import { config } from "../config/index.js";

function hostOf(value) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

export function isOriginAllowed(origin) {
  const host = hostOf(origin);
  return config.run.allowedOrigins.some((entry) => {
    if (entry.startsWith("*.")) return host.endsWith(entry.slice(1).toLowerCase());
    return hostOf(entry) === host;
  });
}

async function promptDecision(origin, reason) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\nOrigin access requested: ${origin}${reason ? `\n  ${reason}` : ""}`);
    while (true) {
      const answer = (await rl.question("Allow this origin? [approve/deny/cancel, default deny] ")).trim().toLowerCase() || "deny";
      if (["approve", "deny", "cancel"].includes(answer)) return answer;
    }
  } finally {
    rl.close();
  }
}

function send(client, sessionId, requestId, response, options) {
  return client.beta.agents.sessions.events.create(
    sessionId,
    {
      events: [
        {
          type: "agent.session.input.computer_use_approval_request_result",
          request_id: requestId,
          response,
        },
      ],
    },
    options,
  );
}

/**
 * Pulls the username and password a test step states, e.g.
 *   Type the username "tomsmith" ... and the password "secret" ...
 * Returns null for a value that is not present.
 */
export function extractCredentials(stepText = "") {
  const quoted = (word) => stepText.match(new RegExp(`${word}\\b[^"“”'\\n]*["“']([^"”']+)["”']`, "i"))?.[1] ?? null;
  return { username: quoted("user(?:name)?"), password: quoted("password") };
}

const isPasswordField = (field) => field.type === "password" || /pass/i.test(`${field.label} ${field.id}`);
const isUsernameField = (field) => /user|e-?mail|login|name/i.test(`${field.label} ${field.id}`);

/** Maps the credentials from the step onto the requested sign-in fields. Null when it cannot fill them all. */
function fillFields(fields, credentials) {
  const values = [];
  for (const field of fields) {
    const value = isPasswordField(field) ? credentials.password : isUsernameField(field) ? credentials.username : null;
    if (value) values.push({ field_id: field.id, value });
    else if (field.required) return null;
  }
  return values;
}

/**
 * Builds the sign-in answer for a browser_authentication request, or null to cancel.
 * Only submits to an allowed credential origin, and only values written in the current step.
 */
function buildAuthenticationResponse(request, stepText, log) {
  const fieldSummary = request.fields.map((field) => `${field.label} (${field.type})`).join(", ") || "none";
  log(`sign-in requested for ${request.credential_origin ?? "unknown origin"}; fields: ${fieldSummary}`);

  if (!request.credential_origin || !isOriginAllowed(request.credential_origin)) {
    log("sign-in origin is missing or not in ALLOWED_ORIGINS -> cancelled");
    return null;
  }

  const credentials = extractCredentials(stepText);
  const response = { type: "browser_authentication", action: "submit", fields: [] };

  if (request.options.length > 0) {
    const byId = new Map(request.fields.map((field) => [field.id, field]));
    const candidates = request.options
      .map((option) => ({ option, values: fillFields(option.field_ids.map((id) => byId.get(id)).filter(Boolean), credentials) }))
      .filter((candidate) => candidate.values !== null)
      .sort((a, b) => b.values.length - a.values.length);
    if (candidates.length === 0) {
      log("no sign-in method can be filled from the step text -> cancelled");
      return null;
    }
    response.selected_option = candidates[0].option.id;
    response.fields = candidates[0].values;
    return response;
  }

  const values = fillFields(request.fields, credentials);
  if (values === null || (request.fields.length > 0 && values.length === 0)) {
    log("the step text does not contain the requested credentials -> cancelled");
    return null;
  }
  response.fields = values;
  return response;
}

/**
 * Answers one pending computer_use_approval_request.
 * - browser_origin_access: approved only for allowed origins (or interactively in prompt mode).
 * - browser_authentication: submitted with the credentials written in the current step when the
 *   credential origin is allowed, otherwise cancelled. Values are never logged.
 */
export async function respondToApproval(client, sessionId, approval, log, context = {}) {
  const request = approval.request;

  if (request.type === "browser_origin_access") {
    let decision;
    if (config.run.originApprovalMode === "prompt") {
      decision = await promptDecision(request.origin, request.reason);
    } else {
      decision = isOriginAllowed(request.origin) ? "approve" : "deny";
    }
    log(`origin ${request.origin} -> ${decision}`);
    await send(client, sessionId, approval.request_id, { type: "browser_origin_access", decision });
    return;
  }

  if (request.type === "browser_authentication") {
    const response = buildAuthenticationResponse(request, context.stepText, log) ?? { type: "browser_authentication", action: "cancel" };
    log(`sign-in -> ${response.action}`);
    await send(client, sessionId, approval.request_id, response, { maxRetries: 0 });
    return;
  }

  throw new Error(`Unsupported computer-use approval: ${request.type}`);
}
