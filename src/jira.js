import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";

const MIME_TYPES = {
  ".json": "application/json",
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function authHeader() {
  const { email, apiToken } = config.jira;
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

/** Minimal Jira Cloud REST client. Never logs credentials. */
async function jiraRequest(method, apiPath, { body, formData, query } = {}) {
  const url = new URL(`${config.jira.baseUrl}${apiPath}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  const headers = { Authorization: authHeader(), Accept: "application/json" };
  let payload;
  if (formData) {
    headers["X-Atlassian-Token"] = "no-check";
    payload = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, { method, headers, body: payload });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Jira ${method} ${apiPath} failed: ${response.status} ${response.statusText} ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- ADF helpers

export function textToAdf(text) {
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((block) => ({
      type: "paragraph",
      content: block.split("\n").flatMap((line, index, lines) => {
        const nodes = [{ type: "text", text: line }];
        if (index < lines.length - 1) nodes.push({ type: "hardBreak" });
        return nodes;
      }),
    })),
  };
}

export function stepsToAdf(steps, intro) {
  const content = [];
  if (intro) content.push({ type: "paragraph", content: [{ type: "text", text: intro }] });
  content.push({
    type: "orderedList",
    content: steps.map((step) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: step }] }],
    })),
  });
  return { type: "doc", version: 1, content };
}

/** Flattens an ADF document into plain text. Ordered lists keep their "1." numbering. */
export function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;

  const children = (items, separator = "") => (items ?? []).map(adfToText).join(separator);

  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "orderedList": {
      const start = node.attrs?.order ?? 1;
      return (node.content ?? []).map((item, index) => `${start + index}. ${adfToText(item).trim()}`).join("\n") + "\n";
    }
    case "bulletList":
      return (node.content ?? []).map((item) => `- ${adfToText(item).trim()}`).join("\n") + "\n";
    case "listItem":
      return children(node.content, "\n");
    case "doc":
    case "blockquote":
    case "panel":
      return children(node.content);
    case "paragraph":
    case "heading":
    case "codeBlock":
      return `${children(node.content)}\n`;
    default:
      return children(node.content);
  }
}

/** Extracts the numbered steps from a description. Falls back to one step per non-empty line. */
export function parseSteps(descriptionText) {
  const lines = descriptionText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const numbered = lines.map((line) => line.match(/^\d+[.)]\s+(.*)$/)).filter(Boolean);
  if (numbered.length > 0) return numbered.map((match) => match[1].trim());
  return lines;
}

// ---------------------------------------------------------------- API calls

export async function searchIssues(jql) {
  const issues = [];
  let nextPageToken;
  do {
    const page = await jiraRequest("POST", "/rest/api/3/search/jql", {
      body: {
        jql,
        maxResults: 50,
        fields: ["summary", "description", "status", "labels", "issuetype"],
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    });
    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);
  return issues;
}

export function createIssue({ summary, description, issueType, labels = [] }) {
  return jiraRequest("POST", "/rest/api/3/issue", {
    body: {
      fields: {
        project: { key: config.jira.projectKey },
        summary,
        issuetype: { name: issueType },
        labels,
        ...(description ? { description } : {}),
      },
    },
  });
}

export function getIssue(key) {
  return jiraRequest("GET", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
    query: { fields: "summary,status,labels" },
  });
}

export function addComment(key, text) {
  return jiraRequest("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    body: { body: textToAdf(text) },
  });
}

export function addLabels(key, labels, removeLabels = []) {
  return jiraRequest("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, {
    body: {
      update: {
        labels: [...labels.map((label) => ({ add: label })), ...removeLabels.map((label) => ({ remove: label }))],
      },
    },
  });
}

/** Transitions an issue by transition name or target status name (case-insensitive). */
export async function transitionIssue(key, name) {
  const { transitions } = await jiraRequest("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  const wanted = name.toLowerCase();
  const match = transitions.find((t) => t.name.toLowerCase() === wanted || t.to?.name?.toLowerCase() === wanted);
  if (!match) {
    const available = transitions.map((t) => `${t.name} -> ${t.to?.name}`).join(", ");
    throw new Error(`No transition "${name}" is available on ${key}. Available: ${available || "none"}`);
  }
  await jiraRequest("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    body: { transition: { id: match.id } },
  });
  return match.to?.name ?? match.name;
}

export async function addAttachment(key, filePath) {
  const buffer = await fs.readFile(filePath);
  const filename = path.basename(filePath);
  const type = MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type }), filename);
  return jiraRequest("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, { formData });
}
