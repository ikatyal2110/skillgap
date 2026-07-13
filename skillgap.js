#!/usr/bin/env node
"use strict";

// skillgap — fork this repo, drop in your resume + target roles, get a living
// skill-gap report. One Anthropic API call for analysis, deterministic markdown
// rendering in JS. See PLAN.md for the contract.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
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
// Model call — Anthropic API by default, or a locally-installed agent CLI
// (Claude Code / Codex / Gemini / any custom command) using the user's
// existing subscription instead of a raw API key.
// ---------------------------------------------------------------------------

function buildPrompt(config, resume, skills, targets, prevSkills, githubDigest, prDigest) {
  const system =
    "You are a career-analysis engine for a skill-gap tracker. You compare one " +
    "person's resume and self-declared skills against multiple target job " +
    "descriptions and profiles of people already in those roles. Respond with a " +
    "SINGLE JSON object and nothing else. Output ONLY the JSON object — no prose before " +
    "or after it, no markdown fences, no commentary.\n\n" +
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

  let user =
    `GOAL: ${config.goal || "(none stated)"}\n\n` +
    `## Resume\n${resume || "(none provided)"}\n\n` +
    `## Self-declared skills\n${skills || "(none provided)"}\n\n` +
    `## Target roles and people\n${targetBlocks || "(none provided)"}`;

  // Pin skill names to the previous run's so the delta stays an exact-match
  // diff — otherwise "Vector databases" one run and "Vector DBs" the next
  // reads as one gap closed plus one new gap.
  if (prevSkills && prevSkills.length) {
    user +=
      "\n\n## Skill names from the previous analysis\n" +
      "Reuse these EXACT names when referring to the same skills, so runs stay " +
      "comparable. Only introduce a new name for a genuinely new skill:\n" +
      prevSkills.map((s) => `- ${s}`).join("\n");
  }

  if (githubDigest) {
    user +=
      "\n\n## GitHub public repos (evidence)\n" +
      "These are the person's own projects, fetched from their public GitHub repos. " +
      "Count them as skill evidence alongside the resume, weighted by recency (recent " +
      "pushes matter more) and substance (a developed project outweighs a stub):\n" +
      githubDigest;
  }

  if (prDigest) {
    user +=
      "\n\n## Merged pull requests to external repos (evidence)\n" +
      "Pull requests this person wrote that maintainers of OTHER projects reviewed and " +
      "merged. Treat these as strong evidence: the code passed external review, and " +
      "sustained contributions to established projects also evidence collaboration and " +
      "code-review fluency:\n" +
      prDigest;
  }

  return { system, user };
}

// GitHub evidence: one unauthenticated (or token-boosted) fetch of a user's
// public repos, reduced to a compact text digest for the prompt. Fetch and
// render are separate so the render side stays testable without network.
async function fetchGithubRepos(username) {
  const headers = { "user-agent": "skillgap" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=100`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

// Merged PRs across ALL repos (theirs or not), via the search API.
async function fetchMergedPRs(username) {
  const headers = { "user-agent": "skillgap" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const q = encodeURIComponent(`author:${username} type:pr is:merged`);
  const res = await fetch(
    `https://api.github.com/search/issues?q=${q}&sort=updated&per_page=100`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub search API error ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

// Pure + deterministic: PRs merged into repos the person does NOT own,
// grouped by repo with count and most-recent merge month. PRs to their own
// repos are excluded — self-merged work is already covered by the repo digest.
function renderPRDigest(items, username) {
  const own = String(username || "").toLowerCase();
  const byRepo = new Map();
  for (const it of items || []) {
    // repository_url looks like https://api.github.com/repos/OWNER/REPO
    const m = String(it.repository_url || "").match(/\/repos\/([^/]+)\/([^/]+)$/);
    if (!m) continue;
    const [, owner, repo] = m;
    if (owner.toLowerCase() === own) continue;
    const key = `${owner}/${repo}`;
    const when = String(it.closed_at || "").slice(0, 7) || "?";
    const cur = byRepo.get(key) || { count: 0, latest: "" };
    cur.count += 1;
    if (when > cur.latest) cur.latest = when;
    byRepo.set(key, cur);
  }
  return [...byRepo.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30)
    .map(([repo, { count, latest }]) => `${repo}: ${count} merged PR${count === 1 ? "" : "s"}, most recent ${latest || "?"}`)
    .join("\n");
}

// Pure + deterministic: skip forks, cap at 50, one line per repo.
function renderGithubDigest(repos) {
  return (repos || [])
    .filter((r) => !r.fork)
    .slice(0, 50)
    .map((r) => {
      const desc = r.description || "(no description)";
      const lang = r.language || "?";
      const topics = (r.topics || []).join(", ") || "-";
      const stars = r.stargazers_count ?? 0;
      const pushed = r.pushed_at ? String(r.pushed_at).slice(0, 7) : "?";
      return `${r.name} — ${desc} | ${lang} | ${topics} | ${stars} stars | pushed ${pushed}`;
    })
    .join("\n");
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

// Validate the parsed analysis before rendering. Returns a list of problems
// (empty = valid); on failure the caller retries once with the problems
// appended to the prompt so the model can correct itself.
const ENUMS = {
  your_level: ["have", "partial", "none"],
  severity: ["low", "medium", "high"],
  status: ["have", "partial", "missing"],
};

function validateAnalysis(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return ["response is not a JSON object"];
  const errs = [];
  for (const key of ["recurring_skills", "gap_matrix", "top_gaps", "projects"]) {
    if (!Array.isArray(a[key])) errs.push(`"${key}" must be an array`);
  }
  if (errs.length) return errs;
  a.recurring_skills.forEach((r, i) => {
    if (typeof r.skill !== "string" || !r.skill) errs.push(`recurring_skills[${i}].skill must be a non-empty string`);
    if (!Array.isArray(r.targets)) errs.push(`recurring_skills[${i}].targets must be an array`);
  });
  a.gap_matrix.forEach((g, i) => {
    if (typeof g.skill !== "string" || !g.skill) errs.push(`gap_matrix[${i}].skill must be a non-empty string`);
    for (const f of ["your_level", "severity", "status"]) {
      if (!ENUMS[f].includes(g[f]))
        errs.push(`gap_matrix[${i}].${f} must be one of ${ENUMS[f].join("|")}, got ${JSON.stringify(g[f])}`);
    }
  });
  a.top_gaps.forEach((t, i) => {
    if (typeof t.skill !== "string" || !t.skill) errs.push(`top_gaps[${i}].skill must be a non-empty string`);
    if (!ENUMS.severity.includes(t.severity))
      errs.push(`top_gaps[${i}].severity must be one of ${ENUMS.severity.join("|")}, got ${JSON.stringify(t.severity)}`);
  });
  a.projects.forEach((p, i) => {
    for (const f of ["gap", "title", "description"]) {
      if (typeof p[f] !== "string" || !p[f]) errs.push(`projects[${i}].${f} must be a non-empty string`);
    }
  });
  return errs;
}

// Named CLI runners: each pipes the full prompt via stdin (never argv) so
// resume/target text can never be interpreted as shell arguments.
const RUNNER_INFO = {
  claude: {
    bin: "claude",
    args: ["-p", "--output-format", "text"],
    install: "the Claude Code CLI installed and logged in — https://claude.com/claude-code",
  },
  codex: {
    bin: "codex",
    args: ["exec"],
    install: "the OpenAI Codex CLI installed and logged in — https://github.com/openai/codex",
  },
  gemini: {
    bin: "gemini",
    args: ["-p"],
    install: "the Gemini CLI installed and logged in — https://github.com/google-gemini/gemini-cli",
  },
};

function runCliRunner(name, prompt) {
  const info = RUNNER_INFO[name];
  const res = spawnSync(info.bin, info.args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Error(`runner '${name}' needs ${info.install}`);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`runner '${name}' exited with code ${res.status}: ${(res.stderr || "").slice(0, 800)}`);
  }
  return res.stdout;
}

// Custom shell command runner. If the command contains "{promptfile}" the
// prompt is written to a temp file and the placeholder is replaced with its
// path; otherwise the prompt is piped via stdin. Never interpolated into the
// command string directly — avoids quoting/injection bugs with resume text.
function runCustomRunner(command, prompt) {
  const hasPromptfile = command.includes("{promptfile}");
  let promptfile = null;
  try {
    let cmd = command;
    let input;
    if (hasPromptfile) {
      promptfile = path.join(os.tmpdir(), `skillgap-prompt-${process.pid}-${Date.now()}.txt`);
      fs.writeFileSync(promptfile, prompt, "utf8");
      cmd = command.split("{promptfile}").join(promptfile);
    } else {
      input = prompt;
    }
    const res = spawnSync(cmd, {
      shell: true,
      input,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
      throw new Error(`custom runner exited with code ${res.status}: ${(res.stderr || "").slice(0, 800)}`);
    }
    return res.stdout;
  } finally {
    if (promptfile) {
      try {
        fs.unlinkSync(promptfile);
      } catch {}
    }
  }
}

// flag > env > yml > default. Kept tiny on purpose.
function resolveRunner(argv, env, config) {
  const i = argv.indexOf("--runner");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  if (env.SKILLGAP_RUNNER) return env.SKILLGAP_RUNNER;
  if (config.runner) return config.runner;
  return "api";
}

async function getModelResponse(runner, apiKey, model, system, user) {
  if (runner === "api") return callAnthropic(apiKey, model, system, user);
  const prompt = `${system}\n\n${user}`;
  if (RUNNER_INFO[runner]) return runCliRunner(runner, prompt);
  return runCustomRunner(runner, prompt);
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
// Delta: diff open gaps against the previous run's stored analysis JSON.
// Each run writes reports/YYYY-MM-DD.json next to the .md, so the diff works
// on data, not on re-parsed markdown. Name matching is exact after
// case/whitespace normalization — the prompt pins skill names to the previous
// run's, which is what keeps exact matching sufficient.
// ---------------------------------------------------------------------------

const normSkill = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

// Map<normalized skill, display name> of gaps not fully covered.
function openGaps(analysis) {
  const m = new Map();
  for (const g of (analysis && analysis.gap_matrix) || []) {
    if (g.status !== "have") m.set(normSkill(g.skill), g.skill);
  }
  return m;
}

function computeDelta(analysis, prevAnalysis, prevName) {
  if (!prevAnalysis) return { previous: null, closed: [], newGaps: [] };
  const prev = openGaps(prevAnalysis);
  const cur = openGaps(analysis);
  const closed = [...prev].filter(([k]) => !cur.has(k)).map(([, name]) => name);
  const newGaps = [...cur].filter(([k]) => !prev.has(k)).map(([, name]) => name);
  return { previous: prevName, closed, newGaps };
}

// Newest previous analysis JSON in reports/ (excludes today's if already written).
function findPreviousAnalysis(reportsDir, todayJson) {
  let files;
  try {
    files = fs.readdirSync(reportsDir);
  } catch {
    return null;
  }
  const dated = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== todayJson)
    .sort();
  if (!dated.length) return null;
  const name = dated[dated.length - 1];
  try {
    return { name, analysis: JSON.parse(fs.readFileSync(path.join(reportsDir, name), "utf8")) };
  } catch {
    return null; // unreadable previous JSON — treat this run as the baseline
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = YAML.parse(readIfExists(path.join(ROOT, "skillgap.yml")) || "") || {};
  const model = config.model || "claude-sonnet-5";
  const runner = resolveRunner(process.argv.slice(2), process.env, config);

  let apiKey = null;
  if (runner === "api") {
    apiKey = loadApiKey();
    if (!apiKey) {
      console.error(
        "Missing ANTHROPIC_API_KEY.\n" +
          "  - Locally: create a .env file with `ANTHROPIC_API_KEY=sk-ant-...`\n" +
          "  - In GitHub Actions: add ANTHROPIC_API_KEY as a repository secret.\n" +
          "  - Or set `runner: claude` / `codex` / `gemini` in skillgap.yml to use an " +
          "existing agent-CLI subscription instead — no API key needed.\n" +
          "Never commit your key — .env is gitignored."
      );
      process.exit(1);
    }
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

  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = path.join(ROOT, "reports");
  const prev = findPreviousAnalysis(reportsDir, `${date}.json`);
  const prevSkills = prev
    ? [
        ...new Set(
          [...(prev.analysis.recurring_skills || []), ...(prev.analysis.gap_matrix || [])]
            .map((x) => x.skill)
            .filter(Boolean)
        ),
      ]
    : null;

  let githubDigest = null;
  let prDigest = null;
  if (config.github) {
    try {
      githubDigest = renderGithubDigest(await fetchGithubRepos(config.github));
    } catch (err) {
      console.warn(`GitHub fetch failed, continuing without repo evidence: ${err.message}`);
    }
    try {
      prDigest = renderPRDigest(await fetchMergedPRs(config.github), config.github);
    } catch (err) {
      console.warn(`GitHub PR search failed, continuing without PR evidence: ${err.message}`);
    }
  }

  const { system, user } = buildPrompt(config, resume, skills, targets, prevSkills, githubDigest, prDigest);

  console.log(`Analyzing ${targets.length} target(s) with ${model} via runner '${runner}'...`);

  // Parse + validate; on any failure retry once with the problems appended
  // so the model can correct itself instead of blindly re-rolling.
  const attempt = (raw) => {
    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      return { errors: [`response was not valid JSON: ${e.message}`] };
    }
    const errors = validateAnalysis(parsed);
    return errors.length ? { errors } : { analysis: parsed };
  };

  let analysis;
  try {
    let res = attempt(await getModelResponse(runner, apiKey, model, system, user));
    if (res.errors) {
      console.warn(`Response failed validation — retrying once. (${res.errors[0]})`);
      const fixup =
        user +
        "\n\nYour previous response was invalid:\n" +
        res.errors.map((e) => `- ${e}`).join("\n") +
        "\nRespond again with ONLY the corrected JSON object.";
      res = attempt(await getModelResponse(runner, apiKey, model, system, fixup));
      if (res.errors) {
        throw new Error(
          "model response failed validation after retry:\n" +
            res.errors.map((e) => `  - ${e}`).join("\n")
        );
      }
    }
    analysis = res.analysis;
  } catch (err) {
    console.error(`Analysis failed: ${err.message}`);
    process.exit(1);
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  const delta = computeDelta(analysis, prev && prev.analysis, prev && prev.name);
  const report = renderReport(analysis, { goal: config.goal, date, delta });

  fs.writeFileSync(path.join(reportsDir, `${date}.md`), report);
  fs.writeFileSync(path.join(reportsDir, `${date}.json`), JSON.stringify(analysis, null, 2) + "\n");
  fs.writeFileSync(path.join(ROOT, "GAP.md"), report);

  console.log(`Wrote reports/${date}.md, reports/${date}.json and GAP.md`);
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

module.exports = {
  renderReport,
  buildPrompt,
  validateAnalysis,
  computeDelta,
  extractJson,
  resolveRunner,
  runCustomRunner,
  renderGithubDigest,
  renderPRDigest,
};
