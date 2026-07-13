# skillgap — plan & contract

One-line pitch: **Fork this repo, drop in your resume and the roles you want, get a living
skill-gap report that tells you what keeps appearing, what you're missing, and what project
to build to prove it.**

## Why this wins (research summary)

Existing GitHub tools (SKANA, resume-matcher topic, HireLens-type apps) are one-shot
"resume vs one JD" matchers, usually needing a hosted web app. Nobody does:

1. **Aggregation** — compare against MANY target roles + profiles of people already in them,
   and rank skills by how often they recur.
2. **Tracking over time** — dated snapshots, so the gap report is a tracker, not a report.
3. **Actionable output** — one concrete portfolio project per gap, not "learn Kubernetes."
4. **Zero infra** — template repo + GitHub Action. No server, no signup, user's own API key.
   Same distribution mechanics that made developer-roadmap huge: fork-and-fill.

## User flow

1. Click "Use this template" on GitHub (or clone).
2. Fill in:
   - `me/resume.md` — paste resume (markdown, any format)
   - `me/skills.yml` — optional self-declared skills: `- name: Python\n  level: comfortable`
   - `targets/roles/<company>-<role>.md` — one job description per file (paste raw JD)
   - `targets/people/<name>.md` — optional: bio/profile text of someone already in the role
   - `skillgap.yml` — config: goal statement, model (default claude-sonnet-5), sections to include
3. Run `node skillgap.js` locally (reads `ANTHROPIC_API_KEY` from env or `.env`),
   **or** add `ANTHROPIC_API_KEY` as a repo secret and run the GitHub Action
   (manual dispatch + auto on push to `me/` or `targets/`).
4. Output:
   - `reports/YYYY-MM-DD.md` — dated snapshot
   - `GAP.md` — always-current dashboard, committed at repo root (this is the shareable artifact)

## Report contents (the three questions from the original idea)

- **Recurring skills**: table of skills ranked by frequency across all target files, with which
  targets mention each.
- **Gap matrix**: skill × (required-by-count, your-level, gap-severity). Have / Partial / Missing.
- **What am I missing**: top gaps ranked by (frequency × severity).
- **Prove it**: for each top-5 gap, ONE concrete scoped project (weekend-to-2-weeks size)
  that demonstrates it, tailored to skills the user already has.
- **Delta since last run**: closed gaps, new gaps (diff vs previous report in `reports/`).

## Technical constraints (both agents follow these)

- **Stack**: plain Node 20+ (built-in `fetch`), single file `skillgap.js` at repo root.
  ONE dependency allowed: `yaml`. No TypeScript, no build step, no framework.
- **API**: Anthropic Messages API direct via fetch. Model from `skillgap.yml`,
  default `claude-sonnet-5`. Key from `ANTHROPIC_API_KEY` env var, falling back to `.env`
  (parse it manually — 3 lines, no dotenv dep). Never print the key.
- **Prompting**: one structured call — send resume + skills + all target files, ask for JSON
  (skills extraction + gap analysis + projects), then render markdown locally in JS.
  Deterministic rendering, LLM only for analysis.
- **Action**: `.github/workflows/skillgap.yml` — workflow_dispatch + push paths filter on
  `me/**` and `targets/**`; runs the script, commits `GAP.md` + new report with
  `github-actions[bot]` author. Skip gracefully (warn, exit 0) if secret missing.
- `.gitignore`: `.env`, `node_modules`.
- **Examples**: `me/` and `targets/` ship with realistic placeholder content for a fictional
  "junior dev → AI engineer" persona, clearly marked REPLACE ME, so first run works instantly.
- **Self-check**: `test.js` — runs renderer against a fixture JSON, asserts report sections
  exist. No test framework.

## File ownership (parallel agents)

- **Agent A (opus, core)**: `skillgap.js`, `test.js`, `package.json`, `.github/workflows/skillgap.yml`,
  `.gitignore`, `skillgap.yml`, example content in `me/` and `targets/`, fixture for test.
- **Agent B (sonnet, docs)**: `README.md`, `CONTRIBUTING.md`, `docs/` (FAQ, how the analysis
  works, privacy note: "your data stays in your fork; API calls go only to Anthropic").
  README documents exactly the flow above — commands and paths must match this contract.

## Later (deliberately skipped for v1)

GitHub Pages dashboard, PDF resume parsing, LinkedIn scraping, multi-provider LLM support,
badges. Add when people actually fork it.
