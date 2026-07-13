# FAQ

### Is my data private?

Yes. skillgap runs in your own fork. Nothing is sent anywhere except a single API call to
Anthropic per run, containing your resume, your declared skills, and the target files you
added under `targets/`. There's no hosted backend, no analytics, no third-party server in
between. If you don't want your resume and target roles visible on GitHub, make your fork
private — the repo's contents are the only thing anyone else could see.

### Do I need an API key?

No — if you already pay for Claude Code, OpenAI Codex CLI, or Gemini CLI, set `runner: claude`,
`codex`, or `gemini` in `skillgap.yml` (or `--runner claude`, or `SKILLGAP_RUNNER=claude`) and
skillgap runs the analysis through that CLI's logged-in session instead of a raw API call —
zero `ANTHROPIC_API_KEY` needed. `runner: api` (the default) still uses the Anthropic API
directly. You can also point `runner` at any shell command containing `{promptfile}` to use a
different agent CLI entirely; skillgap writes the prompt to that file and reads the command's
stdout as the response.

### What does a run cost?

One API call per run: your resume, `me/skills.yml`, and every file under `targets/` go into
a single Messages API request, and the model returns one JSON response. For a typical resume
plus 5-10 target files, that's roughly 3,000-8,000 input tokens and a few hundred output
tokens — a fraction of a cent on `claude-sonnet-5`. The script makes exactly one call; it
doesn't loop per skill or per target file.

### Do I need GitHub Actions?

No. The Action is a convenience for auto-updating `GAP.md` on push. You can run everything
locally with `node skillgap.js`, using `ANTHROPIC_API_KEY` from your shell environment or a
local `.env` file. The Action is optional and only needed if you want reports generated
without running the script yourself.

### How often should I re-run it?

Whenever `me/` or `targets/` change — new resume line, new target role, updated skill level.
The GitHub Action does this automatically on push to those paths. If you're not using the
Action, re-run locally after any meaningful edit; there's no harm in running it often since
each run is one cheap API call.

### The analysis looks wrong. How do I fix it?

The model infers your skill levels from your resume unless you tell it otherwise. Edit
`me/skills.yml` to explicitly set the level for any skill it got wrong (e.g. mark something
`comfortable` that it called `Missing`, or the reverse), then re-run. Self-declared skills in
`skills.yml` take precedence over what the model infers from the resume text.
