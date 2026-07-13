# skillgap

Fork this repo, drop in your resume and the roles you want, and get a living skill-gap
report: the skills that keep appearing across your targets, the ones you're missing, and
one buildable project per gap.

## Why

A job search generates the same three questions, and answering them by hand across ten
job descriptions doesn't scale:

- **What keeps appearing?** One posting that demands Kubernetes is noise. Seven of ten is
  a signal worth two months of your time. skillgap counts this across your whole `targets/`
  folder, including profiles of people who hold the job today.
- **What am I missing?** skillgap ranks your gaps by how often they appear and how much
  they cost you, so you attack the biggest one first instead of the loudest.
- **What do I build to prove it?** Each top gap comes with a scoped portfolio project,
  sized weekend-to-two-weeks, that reuses skills already on your resume.

One-shot checkers compare your resume against a single job description and stop. skillgap
reads all your targets at once and tracks how your gaps change between runs.

## Example output

A trimmed `GAP.md`:

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
3. Pick how the analysis runs:
   - **API key**: add `ANTHROPIC_API_KEY`, either in a `.env` file for local runs or as
     a repo secret for the GitHub Action.
   - **No API key**: logged into Claude Code, Codex CLI, or Gemini CLI? Set
     `runner: claude` / `codex` / `gemini` in `skillgap.yml` (or pass `--runner claude`)
     and skillgap runs through that subscription instead.
   - Optional: add `github: your-username` to `skillgap.yml` and your public repos count
     as skill evidence alongside your resume.
4. Run `npm install && node skillgap.js` locally (Node 20+), or trigger the **skillgap**
   Action from the Actions tab.
5. Read `GAP.md` at the repo root.

## How tracking works

Each run writes a dated report to `reports/YYYY-MM-DD.md`, stores its raw analysis as
`reports/YYYY-MM-DD.json`, and rewrites `GAP.md` at the repo root. skillgap diffs the new
analysis against the previous run's JSON, so `GAP.md` lists the gaps you closed and the
gaps that appeared since last time. The prompt pins skill names to the previous run's, so
a skill the model renames between runs can't masquerade as progress. Re-run whenever `me/`
or `targets/` change; the GitHub Action does this on push, or run it yourself.

## More

- [FAQ](docs/faq.md): privacy, cost, running without Actions, fixing a bad analysis
- [How it works](docs/how-it-works.md): what skillgap sends to the model and how it builds the report
- [Contributing](CONTRIBUTING.md)

MIT licensed. See [LICENSE](LICENSE).
