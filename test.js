"use strict";

// Self-check of the deterministic markdown renderer against a fixture.
// No framework — plain asserts. Run: node test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { renderReport, parseGapTable, computeDelta } = require("./skillgap.js");

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

// --- parseGapTable round-trips the rendered gap matrix -------------------
const parsed = parseGapTable(report);
assert.strictEqual(parsed.get("PyTorch"), "partial", "PyTorch status should parse as partial");
assert.strictEqual(parsed.get("Python"), "have", "Python status should parse as have");
assert.strictEqual(parsed.get("LLM fine-tuning"), "missing", "LLM fine-tuning should parse as missing");
assert.strictEqual(parsed.size, 5, "expected 5 rows parsed from gap matrix");

// --- computeDelta finds closed and new gaps -----------------------------
// Previous run: PyTorch was missing (open), and there was an "Old skill" gap.
const prev = renderReport(
  {
    gap_matrix: [
      { skill: "PyTorch", required_by_count: 3, your_level: "none", severity: "high", status: "missing" },
      { skill: "Old skill", required_by_count: 1, your_level: "none", severity: "low", status: "missing" },
      { skill: "Python", required_by_count: 3, your_level: "have", severity: "low", status: "have" },
    ],
  },
  { goal: "", date: "2026-07-01", delta: null }
);

const delta = computeDelta(analysis, prev, "2026-07-01.md");
assert.strictEqual(delta.previous, "2026-07-01.md");
// "Old skill" is gone from the current matrix → it counts as closed.
assert(delta.closed.includes("Old skill"), "Old skill should be a closed gap");
// PyTorch is still open in both, so it is neither closed nor new.
assert(!delta.closed.includes("PyTorch"), "PyTorch is still open, not closed");
assert(!delta.newGaps.includes("PyTorch"), "PyTorch existed before, not new");
// "LLM fine-tuning" and "Distributed training" are open now but weren't before → new.
assert(delta.newGaps.includes("LLM fine-tuning"), "LLM fine-tuning should be a new gap");
assert(delta.newGaps.includes("Distributed training"), "Distributed training should be a new gap");

console.log("All tests passed.");
