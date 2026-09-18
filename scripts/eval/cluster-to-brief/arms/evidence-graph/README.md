# Evidence-graph prototype arm

This arm treats brief writing as evidence selection before prose generation:

1. Read every source article and extract atomic observations with exact
   `articleId:sentence` provenance.
2. Build an event-family similarity graph. Admit a family only when it has
   support from multiple articles and multiple publishers.
3. Use graph dominance/rivalry to reject bags with no unambiguous single event.
4. Within the winning family, build a second fact graph and retain only facts
   corroborated by multiple articles and publishers.
5. Give the writer only this admitted evidence packet. Invalid citations fail
   the run; there is no generated-draft repair step.

Unlike direct summarization, the writer never sees the full noisy cluster.
Unlike critique/revision approaches, filtering happens before any prose exists.

Run from `scripts/eval/cluster-to-brief`:

```bash
CONC=1 node arms/evidence-graph/index.mjs --cluster=36 --resume
node verify.mjs --arm=out/evidence-graph --cluster=36
```

Each successful extraction batch is immediately written to
`out/evidence-graph/cache/c<cluster>/extract-bNN.json` using a temporary file
plus atomic rename. `--resume` validates the cache version, cluster and batch
identity, exact ordered article manifest, observation shape, in-batch article
IDs, and resolvable sentence citations before reusing it. Corrupt or stale
caches fail explicitly; they never trigger a silent model fallback. JSONL call
logs are accounting records only and are never treated as resumable data.

The cache layer has a zero-network self-test:

```bash
node arms/evidence-graph/self-test.mjs
```

The executable hard-refuses heldout fixture IDs 28 and 51. Unlocking heldout
must be an explicit later decision outside this dev-only prototype.
