# exam.net Anonymisierer

Bookmarklet that pulls essays of one class from several exam.net exams, gives every student a
stable codename ("Grauer Fuchs") across exams, and downloads anonymized Markdown plus a separate
key (CSV). Purpose: longitudinal analysis with AI. No AI in the tool. Plan and verified exam.net
facts: PLAN.md.

## Deployment

GitHub Pages, publish folder `docs/` (Pages only serves `/` or `/docs` from a branch) (public repo; it holds only code, never student data).
Deliberately not Railway/Netlify: no Anthropic API, no queue, no proxy needed (the bookmarklet runs
on exam.net itself, so all requests are same-origin with the teacher's cookies).

## Architecture

- `docs/index.html`: install page. Builds a tiny loader bookmarklet that injects
  `tool.js?t=<now>` from the page's own location, so users always get the current version without
  reinstalling. Also hosts the manual upload mode (`#anon-app`).
- `docs/tool.js`: everything else, one IIFE, vanilla JS, no dependencies. Detects the mode:
  on exam.net → full-screen overlay (Shadow DOM, keyboard events stopped at the host so exam.net
  shortcuts do not fire); on the install page → inline upload UI.
  - exam.net access: `GET /api/groups`, `GET /api/exams/?group=ID`, `GET /print/exams/ID`
    (JSON in the `:students` attribute of `<exam-print-view>`; `answer` = HTML,
    `extra.deviceIdentifier` = device id).
  - Matching: union-find over submissions and key persons. Auto-merge on same e-mail, or same
    normalized name when the two groups never share an exam. Questions for same device + other
    name, similar names (Levenshtein, digits stripped, first name only), same name/device twice in
    one exam. Never merges two different e-mails or two key persons. "No" answers become
    cannot-link pairs.
  - Anonymization: single-pass regex over all name tokens/e-mails of all persons (no chained
    replacement inside inserted codenames); ambiguous tokens → "[Name]". Leak check before download.
    New codenames never contain a word that is also a known name.
  - ZIP write: stored (from ExamNetExport). ZIP read (upload of .docx/.zip): own parser +
    `DecompressionStream("deflate-raw")`.
- `window.__examAnonTest` exposes pure functions for tests only.

## Local testing

`node dev-server.mjs` (port 8892) for the upload mode. For the exam.net mode, inject
`tool.js` on exam.net (e.g. via Claude in Chrome) — the bookmarklet cannot load from localhost on an
https page.
