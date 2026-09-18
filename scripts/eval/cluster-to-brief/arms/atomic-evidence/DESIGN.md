# Combined arm design after the atomic-evidence spike

## Revision

### Latest development signal (2026-09-17)

The eight-parent isolation result did not generalize: the 30-parent slate and focused v5 failed.
Atom source selection now belongs to deterministic parent-lineage inheritance, not the syntax-only
model. A lexical coverage guard is a deletion diagnostic, not proof of semantic preservation.
The latest [risk spike](RISK-RESULT.md) favors narrow, explicitly scoped risk questions over free
all-dimension checks. Its questions were hand-written; automatic risk-question planning remains
unverified. The architecture below is still a hypothesis, not an integration-ready design.

The original concept placed evidence verification before coverage planning:

```text
candidate pool -> atomicize everything -> verify everything -> plan coverage
```

The spike falsified that ordering for the current model and evidence shape. Eight selected parent
sentences already required 12 isolated evidence-bundle calls and 100.7 seconds. Scaling that gate to
all 156 `c36` candidates would buy verification for material that the brief never uses.

The revised architecture is:

```text
cluster-shape routing
        ↓
full-coverage raw candidate pool
        ↓
coarse event families + coverage slate (high recall, unverified)
        ↓
atomicize only the selected slate
        ↓
group atoms by identical evidence coordinates
        ↓
evidence gate for each evidence bundle
        ↓
reject unsafe atoms; backfill the same event slot from ranked alternates
        ↓
surface realization from admitted atoms only
        ↓
deterministic assembly
```

This is **plan → verify → backfill**, not generate → repair. Candidates and slates are internal;
nothing is published before the evidence gate.

## Responsibilities

### Shape router

Returns `single_event`, `multi_event`, or `not_writable`. It may partition the search space but may
not choose final facts.

### Candidate discovery

Reads all articles through bounded raw windows. Output is intentionally high recall and may contain
duplicates or unsupported components.

### Coarse planner

Groups candidates into event slots and ranks alternates using article/publisher support. Support is
importance evidence, not a truth gate. A slot contains multiple ranked candidates so verification
failure does not erase coverage.

### Atomicizer

Sees candidate prose and opaque coordinates, not source text. It splits without evidence-aware
repair. Every atom retains parent and source lineage.

### Evidence gate

Sees only atoms sharing the exact same evidence coordinates. It fills nine fixed checks and quotes
unsupported/uncertain claim spans. Code derives the verdict; the model never returns a free verdict.
Unsupported and uncertain atoms are never surfaced.

### Backfill controller

If a slot loses all admitted atoms, it verifies the next ranked candidate for that same slot. It has
a fixed attempt/cost cap. Exhausted slots remain uncovered and are reported; they are not filled by
inventing or weakening facts.

### Surface realization and assembly

The writer may combine admitted atoms only when it does not introduce a new relation. Deterministic
code binds citations, orders blocks, removes exact duplicates, and emits the final contract.

## Required interfaces

```ts
type Candidate = {
  id: string;
  text: string;
  sources: SourceRef[];
  originWindow: number;
};

type EventSlot = {
  id: string;
  supportArticleIds: number[];
  supportSourceIds: string[];
  rankedCandidateIds: string[];
};

type AtomicClaim = {
  id: string;
  parentCandidateId: string;
  text: string;
  sourceIndexes: number[];
};

type EvidenceDecision = {
  atomId: string;
  checks: Record<
    'identity' | 'action' | 'object' | 'number' | 'time' | 'place' | 'causality' | 'modality' | 'attribution',
    'supported' | 'unsupported' | 'uncertain' | 'not_applicable'
  >;
  unsupportedSpans: string[];
  uncertainSpans: string[];
  admittedSources: SourceRef[];
};
```

## Next experiment: E3

Build the planner entirely from the frozen 156-candidate pool. Do not call the atomicizer or gate.
For each of the seven `c36` core checklist events, inspect whether the planner produces a slot with at
least two plausible alternates. The experiment answers one question:

> Can the system preserve `6/7` core coverage before paying for semantic verification?

Only if E3 passes should the system run the lazy atomicize/verify/backfill loop over that slate.
