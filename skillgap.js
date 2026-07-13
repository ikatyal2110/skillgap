#!/usr/bin/env node
"use strict";

// skillgap — fork this repo, drop in your resume + target roles, get a living
// skill-gap report. One Anthropic API call for analysis, deterministic markdown
// rendering in JS. See PLAN.md for the contract.

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readDir(dir) {
  // Returns [{ name, text }] for every file under dir (one level of subdirs).
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      for (const sub of readDir(full)) out.push(sub);
    } else if (e.isFile()) {
      out.push({ name: path.relative(ROOT, full), text: fs.readFileSync(full, "utf8") });
    }
  }
  return out;
}

// API key: env var first, then a manual parse of .env (no dotenv dependency).
function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  const env = readIfExists(path.join(ROOT, ".env"));
  if (env) {
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Anthropic call
// ---------------------------------------------------------------------------

function buildPrompt(config, resume, skills, targets) {
  const system =
    "You are a career-analysis engine for a skill-gap tracker. You compare one " +
    "person's resume and self-declared skills against multiple target job " +
    "descriptions and profiles of people already in those roles. Respond with a " +
    "SINGLE JSON object and nothing else — no prose, no markdown fences.\n\n" +
    "The JSON must have exactly these top-level keys:\n" +
    '- "recurring_skills": array of { "skill": string, "frequency": integer (how many ' +
    'target files mention it), "targets": array of target names that mention it }, ' +
    "ranked by frequency descending.\n" +
    '- "gap_matrix": array of { "skill": string, "required_by_count": integer, ' +
    '"your_level": "have"|"partial"|"none", "severity": "low"|"medium"|"high", ' +
    '"status": "have"|"partial"|"missing" }. Status reflects the person\'s coverage of ' +
    "that skill.\n" +
    '- "top_gaps": array of { "skill": string, "rank": integer (1 = biggest gap), ' +
    '"frequency": integer, "severity": "low"|"medium"|"high", "why": string (one ' +
    "sentence) }, ranked by frequency x severity, longest 5.\n" +
    '- "projects": array of one entry PER top-5 gap: { "gap": string (the skill), ' +
    '"title": string, "description": string (2-3 sentences, a concrete portfolio ' +
    'project, weekend-to-2-weeks in size), "builds_on": array of skills the person ' +
    "already has that it leverages }.\n\n" +
    "Attribute recurring skills to the exact target names given. Be specific and " +
    "concrete; never output 'learn X' — output a buildable project.";

  const targetBlocks = targets
    .map((t) => `### Target: ${t.name}\n${t.text}`)
    .join("\n\n");

  const user =
    `GOAL: ${config.goal || "(none stated)"}\n\n` +
    `## Resume\n${resume || "(none provided)"}\n\n` +
    `## Self-declared skills\n${skills || "(none provided)"}\n\n` +
    `## Target roles and people\n${targetBlocks || "(none provided)"}`;

  return { system, user };
}

async function callAnthropic(apiKey, model, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {}
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 800)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block || !block.text) throw new Error("No text content in API response.");
  return block.text;
}

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return JSON.parse(t);
}

// ---------------------------------------------------------------------------
// Rendering (deterministic — the LLM only does analysis)
// ---------------------------------------------------------------------------

function mdEscape(s) {
  return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderReport(analysis, opts) {
  const { goal, date, delta } = opts;
  const a = analysis || {};
  const L = [];

  L.push(`# Skill-gap report — ${date}`);
  L.push("");
  L.push(`**Goal:** ${goal || "_(set one in skillgap.yml)_"}`);
  L.push("");

  L.push("## Recurring skills");
  L.push("");
  L.push("| Skill | Frequency | Mentioned by |");
  L.push("| --- | --- | --- |");
  for (const r of a.recurring_skills || []) {
    L.push(`| ${mdEscape(r.skill)} | ${r.frequency ?? ""} | ${mdEscape((r.targets || []).join(", "))} |`);
  }
  L.push("");

  L.push("## Gap matrix");
  L.push("");
  L.push("| Skill | Required by | Your level | Severity | Status |");
  L.push("| --- | --- | --- | --- | --- |");
  for (const g of a.gap_matrix || []) {
    L.push(
      `| ${mdEscape(g.skill)} | ${g.required_by_count ?? ""} | ${mdEscape(g.your_level)} | ${mdEscape(g.severity)} | ${mdEscape(g.status)} |`
    );
  }
  L.push("");

  L.push("## What am I missing");
  L.push("");
  L.push("Top gaps ranked by frequency x severity.");
  L.push("");
  L.push("| Rank | Skill | Frequency | Severity | Why it matters |");
  L.push("| --- | --- | --- | --- | --- |");
  for (const t of a.top_gaps || []) {
    L.push(
      `| ${t.rank ?? ""} | ${mdEscape(t.skill)} | ${t.frequency ?? ""} | ${mdEscape(t.severity)} | ${mdEscape(t.why)} |`
    );
  }
  L.push("");

  L.push("## Prove it");
  L.push("");
  L.push("One scoped portfolio project per top gap.");
  L.push("");
  for (const p of a.projects || []) {
    L.push(`### ${mdEscape(p.title)} — closes: ${mdEscape(p.gap)}`);
    L.push("");
    L.push(String(p.description || "").trim());
    const builds = (p.builds_on || []).filter(Boolean);
    if (builds.length) {
      L.push("");
      L.push(`_Builds on:_ ${mdEscape(builds.join(", "))}`);
    }
    L.push("");
  }

  L.push("## Delta since last run");
  L.push("");
  if (!delta || delta.previous == null) {
    L.push("_No previous report to compare against — this is the baseline._");
  } else {
    L.push(`Compared against \`${delta.previous}\`.`);
    L.push("");
    L.push(`**Closed gaps (${delta.closed.length}):** ` + (delta.closed.length ? delta.closed.map(mdEscape).join(", ") : "_none_"));
    L.push("");
    L.push(`**New gaps (${delta.newGaps.length}):** ` + (delta.newGaps.length ? delta.newGaps.map(mdEscape).join(", ") : "_none_"));
  }
  L.push("");

  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Delta: parse the gap table out of a previous report and diff open gaps
// ---------------------------------------------------------------------------

// Returns a Map<skill, status> parsed from the "## Gap matrix" table.
function parseGapTable(markdown) {
  const map = new Map();
  if (!markdown) return map;
  const lines = markdown.split("\n");
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+Gap matrix\s*$/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^##\s+/.test(line)) break; // next section
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    if (cells[0] === "Skill" || /^-+$/.test(cells[0])) continue; // header / separator
    const skill = cells[0].replace(/\\\|/g, "|");
    const status = cells[4].toLowerCase();
    if (skill) map.set(skill, status);
  }
  return map;
}

function openGaps(gapMap) {
  const s = new Set();
  for (const [skill, status] of gapMap) if (status !== "have") s.add(skill);
  return s;
}

function computeDelta(analysis, prevMarkdown, prevName) {
  if (!prevMarkdown) return { previous: null, closed: [], newGaps: [] };
  const prevOpen = openGaps(parseGapTable(prevMarkdown));
  const curOpen = openGaps(
    parseGapTable(renderReport(analysis, { goal: "", date: "x", delta: null }))
  );
  const closed = [...prevOpen].filter((s) => !curOpen.has(s));
  const newGaps = [...curOpen].filter((s) => !prevOpen.has(s));
  return { previous: prevName, closed, newGaps };
}

// Newest previous report in reports/ (excludes today's if already written).
function findPreviousReport(reportsDir, todayName) {
  let files;
  try {
    files = fs.readdirSync(reportsDir);
  } catch {
    return null;
  }
  const dated = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f !== todayName)
    .sort();
  if (!dated.length) return null;
  const name = dated[dated.length - 1];
  return { name, text: fs.readFileSync(path.join(reportsDir, name), "utf8") };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = YAML.parse(readIfExists(path.join(ROOT, "skillgap.yml")) || "") || {};
  const model = config.model || "claude-sonnet-5";

  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error(
      "Missing ANTHROPIC_API_KEY.\n" +
        "  - Locally: create a .env file with `ANTHROPIC_API_KEY=sk-ant-...`\n" +
        "  - In GitHub Actions: add ANTHROPIC_API_KEY as a repository secret.\n" +
        "Never commit your key — .env is gitignored."
    );
    process.exit(1);
  }

  const resume = readIfExists(path.join(ROOT, "me", "resume.md"));
  const skills = readIfExists(path.join(ROOT, "me", "skills.yml"));
  const targets = readDir(path.join(ROOT, "targets")).map((t) => ({
    name: t.name.replace(/^targets\//, "").replace(/\.md$/, ""),
    text: t.text,
  }));

  if (!targets.length) {
    console.error("No target files found under targets/. Add at least one job description.");
    process.exit(1);
  }

  const { system, user } = buildPrompt(config, resume, skills, targets);

  console.log(`Analyzing ${targets.length} target(s) with ${model}...`);
  let analysis;
  try {
    const raw = await callAnthropic(apiKey, model, system, user);
    try {
      analysis = extractJson(raw);
    } catch {
      // Retry once on a malformed JSON response.
      console.warn("First response was not valid JSON — retrying once...");
      const retry = await callAnthropic(apiKey, model, system, user);
      analysis = extractJson(retry);
    }
  } catch (err) {
    console.error(`Analysis failed: ${err.message}`);
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = path.join(ROOT, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const todayName = `${date}.md`;
  const prev = findPreviousReport(reportsDir, todayName);
  const delta = computeDelta(analysis, prev && prev.text, prev && prev.name);

  const report = renderReport(analysis, { goal: config.goal, date, delta });

  fs.writeFileSync(path.join(reportsDir, todayName), report);
  fs.writeFileSync(path.join(ROOT, "GAP.md"), report);

  console.log(`Wrote reports/${todayName} and GAP.md`);
  if (delta.previous) {
    console.log(`Delta vs ${delta.previous}: ${delta.closed.length} closed, ${delta.newGaps.length} new.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
}

module.exports = { renderReport, parseGapTable, computeDelta, extractJson };
