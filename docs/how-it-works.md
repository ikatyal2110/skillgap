# How it works

skillgap does exactly one thing with the model: turn your resume and your target files into
structured JSON. Everything after that — tables, rankings, diffs — is plain JavaScript.

## Runners

`skillgap.js` doesn't hardcode the Anthropic API — it has a `runner` setting (`skillgap.yml`,
`--runner` flag, or `SKILLGAP_RUNNER` env var; flag > env > yml > default). `api` (default)
calls the Anthropic Messages API directly with `ANTHROPIC_API_KEY`. `claude`, `codex`, and
`gemini` instead pipe the exact same prompt via stdin to the Claude Code, Codex, or Gemini
CLI and read its stdout back — no API key, just your existing CLI login. A custom command
string containing `{promptfile}` works too: skillgap writes the prompt to a temp file,
substitutes the path, and runs the command. Every runner's raw output goes through the same
fence-stripping + `JSON.parse` + one-retry logic below, so the rest of the pipeline doesn't
care which one produced the text.

## What gets sent

One request to the Anthropic Messages API (or an equivalent one to your chosen agent CLI),
containing:

- `me/resume.md` — your resume text
- `me/skills.yml` — your self-declared skills and levels, if you filled it in
- every file under `targets/roles/` — job descriptions
- every file under `targets/people/` — profiles of people already in the role
- the goal statement from `skillgap.yml`
- if `github: your-username` is set in `skillgap.yml`, a digest of your public repos
  (name, description, language, topics, stars, last pushed month), forks excluded, capped
  at 50, fetched from the GitHub API and treated as skill evidence alongside the resume

That's it. No chunking, no embeddings, no retrieval — the whole context fits in one call, so
it's sent as one call.

The GitHub fetch degrades gracefully: no `github` key means the feature is entirely absent
from the prompt, and a failed fetch (rate limit, GitHub outage, bad username) prints one
warning and continues the analysis without the digest. A GitHub problem never fails a run.

## What comes back

The model is asked to return JSON with three parts:

- **skills** — the normalized skill list extracted from all inputs, with per-skill frequency
  (how many target files mention it) and your level (Have / Partial / Missing), reconciled
  against anything you set explicitly in `me/skills.yml`.
- **gaps** — the same skills ranked by `frequency × severity`, i.e. skills that show up a lot
  and that you don't have beat skills that show up once and you're missing.
- **projects** — for the top 5 gaps, one scoped project each (weekend-to-two-weeks), described
  in terms of the skills you already have plus the one you're closing.

The response is schema-validated before anything renders: required fields must exist and
enum fields (`your_level`, `severity`, `status`) must be in range. An invalid response is
retried once with the exact validation errors appended to the prompt, so the model corrects
itself rather than re-rolling blind.

## How the delta stays honest across runs

Each run writes the raw analysis JSON to `reports/YYYY-MM-DD.json` next to the markdown
report, and the delta is computed by diffing the current JSON against the previous one —
no re-parsing of rendered markdown. To stop the model renaming skills between runs
("Vector databases" one month, "Vector DBs" the next, which would falsely read as one gap
closed and one opened), the prompt includes the previous run's skill names with an
instruction to reuse them exactly. Matching is then a plain set diff after case and
whitespace normalization.

## Why rendering is deterministic

The model returns data, not markdown. `skillgap.js` renders that JSON into `GAP.md` and
`reports/YYYY-MM-DD.md` with plain string templates — same JSON in, same markdown out, every
time. This keeps formatting stable across runs (so diffs in `reports/` are meaningful) and
means a bad table or broken heading is a rendering bug you can fix in the script, not a
prompt you have to fight with.

## Why one call

Per-skill or per-target follow-up calls would multiply cost and introduce inconsistency
between skills scored by separate calls (different context each time). A single call sees
every target at once, so frequency counts and severity rankings are computed with the full
picture, and the cost stays predictable — one call in, one report out.
