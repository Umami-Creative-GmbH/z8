/** Opt-in only for the operator's explicit mutation/reset reload commands. */
import {
  waitForPrimaryContextDrain,
  knownTransferWire,
} from "./primary-context-cleanup.mjs";
export const operatorReloadQuiescencePolicy =
  "operator-reload-transfer-quiescence-v1";
export async function beforeOperatorReload({
  transport,
  sample,
  phase,
  stepIndex,
  timeoutMs,
  clock = {},
}) {
  try {
    const proof = await waitForPrimaryContextDrain(transport, {
      ...clock,
      capMs: timeoutMs,
      policy: operatorReloadQuiescencePolicy,
      scope: "operator-forced-reload",
    });
    sample.operatorReloadQuiescence.push({
      ...proof,
      phase,
      stepIndex,
      measurementStarted: phase === "measured-mutation",
    });
  } catch (error) {
    sample.operatorReloadQuiescence.push({
      ...error.cleanupProof,
      policy: operatorReloadQuiescencePolicy,
      scope: "operator-forced-reload",
      phase,
      stepIndex,
      measurementStarted: phase === "measured-mutation",
      complete: false,
    });
    throw error;
  }
}
export function operatorReloadQuiescenceComplete(plan, sample) {
  const route = plan.routes.find((r) => r.name === sample.route);
  const expected =
    sample.mode !== "mutation-refresh"
      ? []
      : [
          ...(route?.mutation?.steps ?? []).flatMap((step, i) =>
            step.reload ? [{ phase: "measured-mutation", stepIndex: i }] : [],
          ),
          ...(route?.mutation?.reset ?? []).flatMap((step, i) =>
            step.reload
              ? [{ phase: "unmeasured-restoration", stepIndex: i }]
              : [],
          ),
        ];
  return (
    Array.isArray(sample.operatorReloadQuiescence) &&
    sample.operatorReloadQuiescence.length === expected.length &&
    sample.operatorReloadQuiescence.every(
      (p, i) =>
        p.phase === expected[i].phase &&
        p.stepIndex === expected[i].stepIndex &&
        p.measurementStarted === (p.phase === "measured-mutation") &&
        p.policy === operatorReloadQuiescencePolicy &&
        p.scope === "operator-forced-reload" &&
        p.usableContentClaim === false &&
        p.complete === true &&
        p.capped === false &&
        p.quietMs === 1000 &&
        p.capMs === plan.timeoutMs &&
        Number.isFinite(p.elapsedMs) &&
        p.elapsedMs >= 1000 &&
        p.elapsedMs < plan.timeoutMs &&
        p.quietObservedMs >= 1000 &&
        p.prefetchQuietObservedMs >= 1000 &&
        knownTransferWire(p) &&
        p.mandatoryPending === 0 &&
        p.mandatoryErrors === 0 &&
        p.observationOverflows === 0 &&
        p.unknownInheritedRedirects === 0 &&
        p.groups.prefetch.pending === 0,
    )
  );
}
