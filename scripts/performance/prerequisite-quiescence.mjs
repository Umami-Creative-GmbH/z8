/** Unmeasured warm preparation condition; does not issue any browser or app command. */
import {
  waitForPrimaryContextDrain,
  knownTransferWire,
} from "./primary-context-cleanup.mjs";
export const prerequisiteQuiescencePolicy = "settled-prerequisite-transfers-v1";
export async function awaitPrerequisiteQuiescence({
  transport,
  sample,
  phase,
  timeoutMs,
  clock = {},
}) {
  try {
    const proof = await waitForPrimaryContextDrain(transport, {
      ...clock,
      capMs: timeoutMs,
      policy: prerequisiteQuiescencePolicy,
      scope: "unmeasured-prerequisite-transfers",
    });
    sample.prerequisiteQuiescence.push({
      ...proof,
      phase,
      measurementStarted: false,
    });
  } catch (error) {
    sample.prerequisiteQuiescence.push({
      ...(error.cleanupProof ?? {}),
      policy: prerequisiteQuiescencePolicy,
      scope: "unmeasured-prerequisite-transfers",
      phase,
      measurementStarted: false,
      complete: false,
    });
    throw error;
  }
}
export function prerequisiteQuiescenceComplete(sample, timeoutMs) {
  const phases =
    sample.mode === "first-document"
      ? []
      : [
          "primed-target",
          ...(["repeat-link", "return-visit"].includes(sample.mode)
            ? ["away-navigation"]
            : []),
        ];
  return (
    Array.isArray(sample.prerequisiteQuiescence) &&
    sample.prerequisiteQuiescence.length === phases.length &&
    sample.prerequisiteQuiescence.every(
      (proof, i) =>
        proof.phase === phases[i] &&
        proof.policy === prerequisiteQuiescencePolicy &&
        proof.scope === "unmeasured-prerequisite-transfers" &&
        proof.measurementStarted === false &&
        proof.usableContentClaim === false &&
        proof.complete === true &&
        proof.capped === false &&
        proof.quietMs === 1000 &&
        proof.capMs === timeoutMs &&
        Number.isFinite(proof.elapsedMs) &&
        proof.elapsedMs >= 1000 &&
        proof.elapsedMs < timeoutMs &&
        proof.quietObservedMs >= 1000 &&
        proof.prefetchQuietObservedMs >= 1000 &&
        knownTransferWire(proof) &&
        proof.mandatoryPending === 0 &&
        proof.mandatoryErrors === 0 &&
        proof.observationOverflows === 0 &&
        proof.unknownInheritedRedirects === 0 &&
        proof.groups.prefetch.pending === 0,
    )
  );
}
