# direct-raw

This arm avoids extraction summaries. It renders every source sentence as
`[articleId:sentence]`, covers every article with character-budgeted overlapping windows, and asks
the same direct writer to produce evidence-bound prose candidates. One final call may only select
candidate ids and group them into event blocks; deterministic assembly copies candidate prose and
citations byte-for-byte.

```bash
node arms/direct-raw/direct-raw.test.mjs
node arms/direct-raw/direct-raw.mjs --plan --cluster=36
node arms/direct-raw/direct-raw.mjs --cluster=36
DIRECT_RAW_CONCURRENCY=1 node arms/direct-raw/direct-raw.mjs --cluster=36 --resume
node verify.mjs --arm=out/direct-raw --cluster=36
node arms/direct-raw/direct-raw.mjs              # dev only
node verify.mjs --arm=out/direct-raw             # dev only
```

Defaults: 30,000 characters/window, one-article overlap, two concurrent window calls. Override
with `DIRECT_RAW_WINDOW_CHARS`, `DIRECT_RAW_OVERLAP_ARTICLES`, and
`DIRECT_RAW_CONCURRENCY`. Calls and timing are recorded under `out/direct-raw/`.

Each successful window is validated and atomically persisted as
`out/direct-raw/c<cluster>-windows/w<n>.json` before the run proceeds. `--resume` reuses only these
per-window files; it checks the cluster/window identity, exact article-id coverage, deterministic
candidate ids, and that every citation resolves inside that window. A malformed or stale cache is
an explicit failure rather than a silent regeneration. After all windows are present, the final
selector still receives evidence-backed candidates and may output candidate IDs only.
