# Atomic evidence gate spike

**Status: eight-parent probe passed; 30-parent expansion and focused v5 failed on 2026-09-17. Not validated for integration.**

## Question

Can a syntax-only atomic decomposition followed by an evidence-entailment gate separate the
supported and unsupported parts of the four known `direct-raw` hard errors without rejecting
already-supported controls?

This is a replay spike over the frozen `c36` output. It does not generate new candidates, select a
new brief, modify production code, or read heldout clusters.

## Invariants

- Every admitted atom must resolve to the original source sentences carried by its parent candidate.
- Atomicization may split wording but may not delete, repair, weaken, or add factual content.
- The evidence gate judges complete support, including actor, action, object, number, time, place,
  causality, modality, and attribution.
- `uncertain` is not admitted.
- Cross-article support is not a truth gate. It belongs to the later coverage-planning experiment.
- The frozen slow verdict is evaluation metadata only; neither model prompt receives it.

## Success criteria

On four known hard-error sentences and four frozen supported controls:

1. Every hard-error parent has at least one rejected atom; none may have all atoms admitted.
2. At least two of the four mixed parents retain a supported atom. A parent may be rejected whole:
   the later planner has 156 candidates and should prefer a better duplicate rather than force repair.
3. Every control parent has at least one admitted atom and no rejected atom.
4. Every output source reference resolves. Exact number overlap remains a diagnostic, not a gate:
   lexical matching cannot represent valid entailments such as `2.77%` supporting `more than 2%`.

Passing this probe is necessary but not sufficient to build the combined arm. It only validates the
H1/H2 boundary on known failures.

## Result

- Four mixed parents: all rejected at least one unsafe atom; three retained safe atoms; the fourth
  was safely rejected whole.
- Four supported controls: zero rejected atoms.
- Nine isolated contrast cases covering attribution, named identity, action strength, and origin:
  all passed.
- Execution cost for the eight-parent probe: 12 evidence-bundle calls, 9,290 input tokens, 2,197
  output tokens, 100.7 seconds of summed wall time.

The execution unit is a set of atoms with the exact same evidence coordinates. Whole-batch,
two-parent, and one-parent gates all produced cross-item leakage or false accepts. Therefore the
combined architecture must verify a planned shortlist lazily; verifying the full 156-candidate pool
would be operationally wasteful.

## Kill criteria

- Atomicization silently repairs or drops unsupported wording instead of representing it in an atom.
- The gate admits all atoms from any known hard-error parent.
- The gate rejects any atom from more than one supported control.
- Output cannot preserve deterministic lineage from atom to candidate to original sentence.

## This spike will not retry known falsified routes

- No multi-agent debate or majority vote.
- No evidence-free self-correction.
- No post-generation repair of a finished brief.
- No use of citation resolvability as semantic faithfulness.
- No progressively compressed summary passed as a substitute for original evidence.
