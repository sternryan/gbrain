# FORK-AGENTS.md

Agent rules for the `sternryan/gbrain` fork. Imported from the end of `CLAUDE.md` by one
`@FORK-AGENTS.md` line. `CLAUDE.md` and `AGENTS.md` stay upstream's files, byte-for-byte, so
upstream merges stay clean. Put fork-specific rules here, never in those two files.
If the import line is missing after a sync, run `bash scripts/fork-check-agents-import.sh`.

## What this fork is

- `origin` = `sternryan/gbrain` (PUBLIC), `upstream` = `garrytan/gbrain`.
- The deployed branch is `fork/main`: upstream plus a small set of fork commits (search
  ranking, gateway-aware model resolution, test guards). Rebase/merge it on upstream; never
  re-pin a topic branch.
- The production host runs gbrain as a `bun` global pinned to `github:sternryan/gbrain#<sha>`
  of `fork/main`. There is no git checkout on that host: an upgrade is a reinstall, and any
  hand edit under its `node_modules/` is erased by one.
- Reinstall trap: swapping the ref of an already-pinned package fails with a dependency loop.
  Run `bun remove -g gbrain` FIRST, then `bun add -g`. Running services keep the old code until
  restarted; stop timers and services before the swap, restart one service at a time, smallest
  brain first.
- The public repo rule applies: work goes on a single-task branch; nothing lands on `master` or
  `fork/main` without the owner's review. Run the public-leak scan before pushing a branch.
  No hostnames-with-IPs, tokens, personal names or brain contents in anything committed.

## Where the tests run

- The laptop cannot run the full unit suite (`scripts/run-unit-parallel.sh` drops to 1 shard
  on a busy machine, roughly 30 hours). The pre-commit hook runs that same suite.
- Use the `anvil` node: `~/gbrain-test/gbrain`, `bash scripts/run-unit-parallel.sh --shards 8
  --max-concurrency 3` (about 7 minutes). Detach long runs with `nohup ... < /dev/null &`.
- Before any work: `git fetch origin && git merge-base HEAD origin/fork/main`. If empty, you are on
  a stale lineage; branch from `origin/fork/main`.
- Cheap checks that do run anywhere: `bash scripts/check-key-files-current-state.sh`,
  `bash scripts/fork-check-agents-import.sh`.

## Environment every gbrain call needs

Every `gbrain` invocation in a script needs the brain's env (database URL via `GBRAIN_HOME`
config) sourced, not just the importing calls. A bare call fails with `No database URL`. Wrap
each call in the same env subshell.

## Shared-core rules

- Use a git worktree per task; never `git stash` in a shared checkout.
- Ship through the owner's push gate (tests + independent grade), not a bare `git push`.
- `fork/main` tracks upstream: keep fork changes small and rebasable.

## Surviving upstream syncs

Run after every upstream merge/rebase, before pushing:

    bash scripts/fork-check-agents-import.sh

It re-appends the `@FORK-AGENTS.md` line to `CLAUDE.md` if the sync dropped it, then runs
`scripts/check-key-files-current-state.sh` (the CLAUDE.md size cap). Exit 0 = healthy,
1 = size cap broken, 2 = `FORK-AGENTS.md` missing. If it modified `CLAUDE.md`, commit that
one-line change.
