# NEXT — DEP2: `release.py` must VERIFY the website deployed, not just that the push succeeded

**Ball: worker (seat A) · epoch 1 · DEP2.** File: ONLY `release.py`. One commit by path, predicted **1 file, ~+60 lines**.

## Ground truth (advisor, today's incident)
- Cloudflare Pages project `bspline-generator` builds every push to `main` (GitHub-connected; build command
  `python bspline-frame-builder/deploy_cloudflare.py --build-only`, output `bspline-frame-builder/dist`). From
  2026-07-12 to today every build FAILED (lock-file drift) while `release.py` printed
  `Web app: https://bspline-generator.pages.dev (Cloudflare rebuilds on push)` — a sentence the script cannot know is
  true. Nobody looked at Cloudflare for two months.
- `release.py:166 step_git_push()` pushes; `:336` prints that line. `deploy_cloudflare.py:50-72` shows how this repo
  loads `.env` (dotenv with a manual fallback) and reads `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`.
- The Pages API (read-only, token already has access — used by the advisor today):
  `GET https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/pages/projects/bspline-generator/deployments?per_page=5`
  → `result[]` with `deployment_trigger.metadata.commit_hash`, `latest_stage.name` (`queued|initialize|clone_repo|build|deploy`)
  and `latest_stage.status` (`idle|active|success|failure|canceled`); on failure
  `GET …/deployments/{id}/history/logs` → `result.data[].line`.

## Do
1. Declare the project once: `PAGES_PROJECT = "bspline-generator"` next to `PAGES_URL` (`:42`); load `.env` the same way
   `deploy_cloudflare.py` does (copy that small block; stdlib `urllib` for the HTTP, no new dependency).
2. `step_verify_pages(sha, timeout_s=360)`: poll every 10 s for the deployment whose `commit_hash` starts with `sha`;
   print one line per state change (`queued → build → deploy`); on `deploy success` print `  Web app:    {PAGES_URL}
   DEPLOYED {sha}` and return True; on `failure` print `  Web app:    BUILD FAILED for {sha}` + the last 25 log lines
   (skip the npm usage boilerplate) and return False; on timeout print `UNCONFIRMED after {timeout_s}s — check
   https://dash.cloudflare.com` and return False; if the token/account id is missing print `SKIPPED (no CLOUDFLARE_* in
   .env)` and return None.
3. Call it at the end of `step_git_push()` (after a successful push, with `git rev-parse --short HEAD`) and let its
   result drive the summary line at `:336`: DEPLOYED / BUILD FAILED / UNCONFIRMED / SKIPPED — never again the bare
   "Cloudflare rebuilds on push". A BUILD FAILED result makes `release.py` exit non-zero.
4. Nothing else in the script changes.

## Verify (headless)
- `py_compile release.py`; `python release.py --help`-style flag error still prints the valid flags.
- Dry check of the verifier without pushing: add `--verify-web [sha]` as a flag that runs only `step_verify_pages` for
  the given (or HEAD) sha; run `python release.py --verify-web 2790636` → it must find today's deployment and print
  DEPLOYED (2790636 built at 13:4x). Paste the output.
- `git show --stat HEAD` → 1 file.

## Do NOT
Touch `deploy_cloudflare.py`, the add-in deploy, or `--web`'s staging behaviour (note for the advisor: `--web` still
does `git add -A`, which is the two-seats index trap — leave it, it is the human's ritual; recorded separately).

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "DEP2: step_verify_pages polls the Pages API after push; summary says DEPLOYED/BUILD FAILED/UNCONFIRMED/SKIPPED; --verify-web flag; verified against 2790636 — <sha>, 1 file. Next: FB3b."`
and stop.
