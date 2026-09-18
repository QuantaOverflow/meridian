# Atomic evidence gate

This is the first executable slice of the proposed combined architecture. It replays eight frozen
sentences from the `direct-raw` `c36` result:

- four sentences already judged as hard errors because their citations support only part of the text;
- four supported controls from the same output.

The spike deliberately separates two model responsibilities:

1. **Atomicizer:** sees candidate text and opaque source coordinates, but not source text. It must
   preserve all factual content while splitting independent assertions. It cannot evidence-aware
   repair the candidate.
2. **Evidence gate:** sees the resulting atoms and verbatim source sentences. It must quote exact
   unsupported or uncertain spans from the claim; deterministic code derives the verdict. It cannot
   rewrite an atom. This prevents a free-text rationale from admitting a detail it just said was absent.

Deterministic code joins the two outputs, checks lineage, rejects dangling references, resolves
citations, reports exact-number mismatch, and scores the predeclared parent-level expectations.
`unsupported` and `uncertain` are both rejected.

The evidence gate groups atoms by an identical evidence bundle and runs one bundle per call. A
21-atom all-at-once probe missed known numbers and action strength; parent-level batching then let
one atom borrow another atom's evidence. Evidence-bundle isolation is an architectural boundary,
not a retry heuristic.

```bash
# Requires the local ai-worker at AI_WORKER_URL (default localhost:8787).
node arms/atomic-evidence/probe.mjs

# Re-score cached model outputs without network calls.
node arms/atomic-evidence/probe.mjs --replay

# Zero-network validation of schemas and scoring logic.
node arms/atomic-evidence/probe.test.mjs
```

Outputs are written under `out/atomic-evidence/` and are ignored by git.

This is not yet H1/H2 on all 156 candidates. A pass only authorizes the next experiment: run the
same boundary over the frozen candidate pool and measure whether a planner can recover `c36`
coverage without reintroducing rejected atoms.
