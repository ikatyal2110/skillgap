# Contributing

skillgap is meant to stay small enough to read in one sitting. Before adding something, check
whether it actually needs to live here.

## Keep it minimal

- One file, `skillgap.js`, does the work. Don't split it into modules for the sake of
  structure — split only when a single file genuinely stops being readable.
- One dependency, `yaml`. A PR that adds a second dependency needs a very good reason; if the
  standard library or a few lines can do it, that's the expected answer.
- No build step, no TypeScript, no framework. If your change needs one, it's probably out of
  scope for this repo.

## Good first contributions

- **More example personas** — the shipped `me/` and `targets/` content covers a "junior dev →
  AI engineer" persona. Additional example sets (different fields, seniority levels) make the
  template useful to more people on first fork.
- **A better prompt** — the extraction/gap/project prompt in `skillgap.js` is a first pass.
  Improvements to accuracy, especially on severity ranking and project scoping, are welcome.
- **A GitHub Pages dashboard** — listed as a "Later" item in `PLAN.md`: render `reports/` and
  `GAP.md` as a small static site via Pages instead of just the raw markdown. Good scoped
  project for someone who wants a bigger contribution.

Other things intentionally deferred for now (see `PLAN.md`): PDF resume parsing, LinkedIn
scraping, multi-provider LLM support, badges. Open an issue before building one of these —
they're skipped on purpose, not by oversight.

## Before opening a PR

Run `node test.js`. It's a plain assertion script, no framework — it should still pass after
your change.
