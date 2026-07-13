---
description: Search the web for job postings matching a query and add them to targets/roles/
---

Find real, current job postings matching this query: $ARGUMENTS

If the query is empty, ask for: role/title keywords, seniority, and location or remote
preference. Read `skillgap.yml`'s `goal` for extra context on what the user is aiming for.

Then:

1. Search the web for matching postings. Prefer pages that show the full description
   without a login: company career pages, greenhouse.io / lever.co / ashbyhq.com boards,
   amazon.jobs and similar. Skip LinkedIn and other login-walled listings — if a great
   match is walled, give the user the link and ask them to paste the text instead.
2. For each posting the user wants (confirm the list before writing — aim for 3 to 6),
   fetch the page and extract the complete posting: title, company, location,
   responsibilities, qualifications (required and preferred), team/product context.
   Copy the posting's real text. Do not summarize it, do not invent requirements,
   and drop only boilerplate (benefits blurbs, EEO statements).
3. Write each one to `targets/roles/<company>-<short-role>.md` in this format:

   ```markdown
   # <Role title>, <Company>
   <location> — added <YYYY-MM-DD> — <source URL>

   <the full posting text, lightly formatted with ## headings>
   ```

4. Show the user the list of files written, then offer to run the analysis:
   `node skillgap.js` (or with their configured runner).

Rules: never fabricate a posting or requirement; if a fetch fails, say so and move on;
do not modify anything outside `targets/roles/`.
