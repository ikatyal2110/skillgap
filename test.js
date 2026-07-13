"use strict";

// Self-check of the deterministic markdown renderer against a fixture.
// No framework — plain asserts. Run: node test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  renderReport,
  buildPrompt,
  validateAnalysis,
  computeDelta,
  extractJson,
  resolveRunner,
  runCustomRunner,
  renderGithubDigest,
} = require("./skillgap.js");

const analysis = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "sample-analysis.json"), "utf8")
);

// --- renderReport produces every section --------------------------------
const report = renderReport(analysis, {
  goal: "Become an AI engineer",
  date: "2026-07-12",
  delta: null,
});

for (const section of [
  "# Skill-gap report — 2026-07-12",
  "**Goal:** Become an AI engineer",
  "## Recurring skills",
  "## Gap matrix",
  "## What am I missing",
  "## Prove it",
  "## Delta since last run",
]) {
  assert(report.includes(section), `missing section: ${section}`);
}

// Content from the fixture actually renders.
assert(report.includes("PyTorch"), "expected a recurring skill in output");
assert(report.includes("Fine-tune a small LLM"), "expected a project title in output");
assert(
  report.includes("baseline"),
  "expected baseline note when there is no previous report"
);

// --- validateAnalysis: fixture is valid, broken responses are caught -----
assert.deepStrictEqual(validateAnalysis(analysis), [], "fixture should validate clean");
assert(validateAnalysis(null).length, "null should fail validation");
assert(validateAnalysis({}).length, "missing arrays should fail validation");
const broken = JSON.parse(JSON.stringify(analysis));
broken.gap_matrix[0].severity = "critical"; // not in the enum
delete broken.projects[0].description;
const brokenErrs = validateAnalysis(broken);
assert(
  brokenErrs.some((e) => e.includes("gap_matrix[0].severity")),
  "off-enum severity should be reported"
);
assert(
  brokenErrs.some((e) => e.includes("projects[0].description")),
  "missing project description should be reported"
);

// --- computeDelta diffs previous analysis JSON, not markdown -------------
// Previous run: PyTorch was missing (open), and there was an "Old skill" gap.
const prev = {
  gap_matrix: [
    { skill: "PyTorch", required_by_count: 3, your_level: "none", severity: "high", status: "missing" },
    { skill: "Old skill", required_by_count: 1, your_level: "none", severity: "low", status: "missing" },
    { skill: "Python", required_by_count: 3, your_level: "have", severity: "low", status: "have" },
  ],
};

const delta = computeDelta(analysis, prev, "2026-07-01.json");
assert.strictEqual(delta.previous, "2026-07-01.json");
// "Old skill" is gone from the current matrix → it counts as closed.
assert(delta.closed.includes("Old skill"), "Old skill should be a closed gap");
// PyTorch is still open in both, so it is neither closed nor new.
assert(!delta.closed.includes("PyTorch"), "PyTorch is still open, not closed");
assert(!delta.newGaps.includes("PyTorch"), "PyTorch existed before, not new");
// "LLM fine-tuning" and "Distributed training" are open now but weren't before → new.
assert(delta.newGaps.includes("LLM fine-tuning"), "LLM fine-tuning should be a new gap");
assert(delta.newGaps.includes("Distributed training"), "Distributed training should be a new gap");

// Case/whitespace drift in skill names must not read as closed+new.
const caseDrift = computeDelta(
  { gap_matrix: [{ skill: "vector  databases", your_level: "none", severity: "high", status: "missing" }] },
  { gap_matrix: [{ skill: "Vector Databases", your_level: "none", severity: "high", status: "missing" }] },
  "2026-07-01.json"
);
assert.deepStrictEqual(caseDrift.closed, [], "case drift should not close a gap");
assert.deepStrictEqual(caseDrift.newGaps, [], "case drift should not open a gap");

// --- buildPrompt pins previous skill names into the prompt ---------------
const pinned = buildPrompt({ goal: "g" }, "resume", "skills", [{ name: "roles/x", text: "jd" }], [
  "Vector databases",
  "PyTorch",
]);
assert(pinned.user.includes("Reuse these EXACT names"), "prompt should pin previous names");
assert(pinned.user.includes("- Vector databases"), "prompt should list previous skill names");
const unpinned = buildPrompt({ goal: "g" }, "resume", "skills", [{ name: "roles/x", text: "jd" }], null);
assert(!unpinned.user.includes("Reuse these EXACT names"), "no pinning block without previous run");

// --- renderGithubDigest: pure, offline, fixture repos --------------------
const repoFixture = [
  {
    name: "rag-notes",
    description: "RAG service over my markdown notes",
    language: "Python",
    topics: ["rag", "embeddings"],
    stargazers_count: 12,
    pushed_at: "2026-06-15T10:00:00Z",
    fork: false,
  },
  {
    name: "forked-repo",
    description: "Should be skipped",
    language: "JavaScript",
    topics: [],
    stargazers_count: 999,
    pushed_at: "2026-07-01T10:00:00Z",
    fork: true,
  },
  {
    name: "bare-repo",
    description: null,
    language: null,
    topics: [],
    stargazers_count: 0,
    pushed_at: "2025-01-02T10:00:00Z",
    fork: false,
  },
];

const digest = renderGithubDigest(repoFixture);
assert(digest.includes("rag-notes"), "non-fork repo should render");
assert(!digest.includes("forked-repo"), "forked repo should be skipped");
assert(digest.includes("RAG service over my markdown notes"), "description should render");
assert(digest.includes("Python"), "language should render");
assert(digest.includes("rag, embeddings"), "topics should render");
assert(digest.includes("12 stars"), "stars should render");
assert(digest.includes("2026-06"), "last pushed year-month should render");
assert(digest.includes("bare-repo"), "repo with nulls should still render");
assert(digest.includes("(no description)"), "missing description should get a placeholder");

assert.strictEqual(renderGithubDigest([]), "", "empty repo list should render empty string");
assert.strictEqual(renderGithubDigest(undefined), "", "undefined repo list should render empty string");

const manyRepos = Array.from({ length: 60 }, (_, i) => ({
  name: `repo-${i}`,
  description: "d",
  language: "Go",
  topics: [],
  stargazers_count: 0,
  pushed_at: "2026-01-01T00:00:00Z",
  fork: false,
}));
const cappedDigest = renderGithubDigest(manyRepos);
assert.strictEqual(cappedDigest.split("\n").length, 50, "digest should cap at 50 repos");
assert(cappedDigest.includes("repo-49"), "cap should keep the first 50 repos in input order");
assert(!cappedDigest.includes("repo-50"), "cap should drop repos beyond 50");

// --- buildPrompt: GitHub evidence section is opt-in -----------------------
const withGithub = buildPrompt(
  { goal: "g" },
  "resume",
  "skills",
  [{ name: "roles/x", text: "jd" }],
  null,
  "rag-notes — a project | Python | rag | 12 stars | pushed 2026-06"
);
assert(
  withGithub.user.includes("## GitHub public repos (evidence)"),
  "prompt should include the GitHub evidence section when a digest is passed"
);
assert(withGithub.user.includes("rag-notes"), "prompt should include the digest content");

const withoutGithub = buildPrompt({ goal: "g" }, "resume", "skills", [{ name: "roles/x", text: "jd" }], null, null);
assert(
  !withoutGithub.user.includes("## GitHub public repos (evidence)"),
  "prompt should omit the GitHub evidence section when no digest is passed"
);
const withEmptyGithub = buildPrompt({ goal: "g" }, "resume", "skills", [{ name: "roles/x", text: "jd" }], null, "");
assert(
  !withEmptyGithub.user.includes("## GitHub public repos (evidence)"),
  "prompt should omit the GitHub evidence section for an empty digest"
);

// --- resolveRunner precedence: flag > env > yml > default "api" ----------
assert.strictEqual(
  resolveRunner(["--runner", "claude"], { SKILLGAP_RUNNER: "codex" }, { runner: "gemini" }),
  "claude",
  "--runner flag should beat env var and yml"
);
assert.strictEqual(
  resolveRunner([], { SKILLGAP_RUNNER: "codex" }, { runner: "gemini" }),
  "codex",
  "env var should beat yml when no flag given"
);
assert.strictEqual(
  resolveRunner([], {}, { runner: "gemini" }),
  "gemini",
  "yml runner should beat the default"
);
assert.strictEqual(resolveRunner([], {}, {}), "api", "default runner should be api");
assert.strictEqual(
  resolveRunner(["--runner"], {}, { runner: "gemini" }),
  "gemini",
  "a dangling --runner flag with no value should fall through to yml"
);

// --- custom runner: {promptfile} substitution, offline end-to-end --------
// A throwaway Node script stands in for a real agent CLI: it reads the
// promptfile skillgap wrote, confirms the prompt reached it, then echoes
// the fixture JSON back on stdout — proving the {promptfile} path and the
// shared extractJson parsing path both work without touching any real
// claude/codex/gemini binary.
const fixturePath = path.join(__dirname, "fixtures", "sample-analysis.json");
const echoScriptPath = path.join(os.tmpdir(), `skillgap-test-echo-${process.pid}.js`);
fs.writeFileSync(
  echoScriptPath,
  [
    "const fs = require('fs');",
    "const prompt = fs.readFileSync(process.argv[2], 'utf8');",
    "if (!prompt.includes('SENTINEL-PROMPT-TEXT')) {",
    "  process.stderr.write('promptfile missing expected content');",
    "  process.exit(1);",
    "}",
    "process.stdout.write(fs.readFileSync(process.argv[3], 'utf8'));",
  ].join("\n")
);

try {
  const customCmd = [process.execPath, echoScriptPath, "{promptfile}", fixturePath]
    .map((s) => JSON.stringify(s))
    .join(" ");
  const rawOut = runCustomRunner(customCmd, "resume text ... SENTINEL-PROMPT-TEXT ... target text");
  const roundTripped = extractJson(rawOut);
  assert.deepStrictEqual(roundTripped, analysis, "custom runner output should round-trip via extractJson");
} finally {
  fs.unlinkSync(echoScriptPath);
}

console.log("All tests passed.");
