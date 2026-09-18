# Structure router arm

This arm separates **structure recognition** from **writing**.

1. Batches of 18 articles emit article-level event signatures
   (`storylineKey`, `episodeKey`, actors, action, and place). Every successful
   batch is atomically cached; `--resume` reuses exact, complete caches.
2. Local e5 embeddings join equivalent storyline keys across batches with a
   deterministic similarity graph. The router accepts the largest component
   only when it covers at least 45% of the cluster and leads the runner-up by
   at least 15 points. Otherwise it returns `not_a_single_event`.
3. The writer re-reads original, sentence-numbered source text for a bounded,
   episode-stratified sample of the accepted storyline. It never writes from
   the signatures. Its JSON is validated, not repaired.

The routing rules and prompts are cluster-agnostic. No fixture IDs, expected
impurity lists, or fixture labels are read by the arm.

```bash
node scripts/eval/cluster-to-brief/arms/structure-router/run.mjs --cluster=36
node scripts/eval/cluster-to-brief/arms/structure-router/run.mjs --cluster=36 --resume
node scripts/eval/cluster-to-brief/arms/structure-router/run.mjs --split=dev
node scripts/eval/cluster-to-brief/arms/structure-router/run.mjs --self-test
```

Outputs go only to `scripts/eval/cluster-to-brief/out/structure-router/`.
Model-call accounting and saved structure decisions are in the same directory.
