# skillgap

Fork this repo, drop in your resume and the roles you want, get a living skill-gap report that
tells you what keeps appearing, what you're missing, and what project to build to prove it.

## Why

Job hunting with a resume and a stack of job descriptions usually turns into the same three
questions, answered by hand, over and over:

- **What keeps appearing?** Which skills show up across the roles you're targeting and the
  people already doing them, not just one job post.
- **What am I missing?** Where your resume falls short, ranked by how often it matters, not
  by which gap is loudest.
- **What do I build to prove it?** A concrete project, not "learn Kubernetes."

Most gap-finder tools compare one resume against one job description and stop there. skillgap
compares your resume against every role and every profile you throw at it, tracks how the gaps
move over time, and hands you a dated report instead of a one-off verdict.

## Example output

`GAP.md` looks roughly like this (trimmed):

```markdown
## Recurring skills

| Skill              | Mentioned in | Frequency |
|---------------------|--------------|-----------|
| Python              | 5/6 targets  | 83%       |
| Prompt engineering  | 4/6 targets  | 67%       |
| Vector databases     | 3/6 targets  | 50%       |

## Top gap: Vector databases

- **Required by**: 3 of 6 target roles, including anthropic-ai-engineer.md
- **Your level**: Missing
- **Severity**: High — appears in every senior posting, absent from your resume

### Prove it
Build a small RAG service over your own notes: chunk and embed ~200 markdown files,
store them in a local vector DB (pgvector or Chroma), and serve retrieval-augmented
answers through a CLI. Weekend-to-one-week scope, uses the Python and API skills you
already have.
```

## Quick start

1. Click **Use this template** on GitHub (or clone the repo).
2. Fill in your data:
   - `me/resume.md` — paste your resume, any markdown format
   - `me/skills.yml` — optional self-declared skills and levels
   - `targets/roles/<company>-<role>.md` — one job description per file
   - `targets/people/<name>.md` — optional profiles of people already in the role
3. Add an API key OR use a subscription you already pay for:
   - **API key**: add `ANTHROPIC_API_KEY` — as a `.env` file for local runs, or as a repo
     secret for the GitHub Action.
   - **No API key**: if you're logged into Claude Code, Codex CLI, or Gemini CLI, set
     `runner: claude` / `codex` / `gemini` in `skillgap.yml` (or pass `--runner claude` /
     `SKILLGAP_RUNNER=claude`) and skillgap runs through that CLI instead.
4. Run `npm install && node skillgap.js` locally (Node 20+), or trigger the **skillgap**
   Action from the Actions tab.
5. Read `GAP.md` at the repo root.

## How tracking works

Every run writes a dated snapshot to `reports/YYYY-MM-DD.md` and rewrites `GAP.md` at the repo
root as the always-current dashboard. Each new report diffs itself against the most recent one
in `reports/`, so `GAP.md` shows a delta section: gaps you closed, gaps that are new. Re-run
whenever `me/` or `targets/` change — the Action does this automatically on push, or run it
yourself locally.

## More

- [FAQ](docs/faq.md) — privacy, cost, running without Actions, fixing a bad analysis
- [How it works](docs/how-it-works.md) — what gets sent to the model and how the report is built
- [Contributing](CONTRIBUTING.md)

MIT licensed. See [LICENSE](LICENSE).
