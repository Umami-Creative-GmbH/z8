/** Off the measured critical path; never changes readiness or resource snapshots. */
import {
  proxyWireProtocol,
  proxyWireByteUnits,
} from "./proxy-wire-observer.mjs";
export const nativeCleanupPolicy = "post-snapshot-finite-prefetch-quiet-v1";
export const knownTransferWire = (state) =>
  state?.protocol === proxyWireProtocol &&
  state.byteUnits === proxyWireByteUnits &&
  [
    "javascript",
    "document",
    "rsc",
    "otherFinite",
    "prefetch",
    "longLived",
  ].every((name) => {
    const group = state.groups?.[name];
    return (
      group &&
      [
        "requests",
        "completed",
        "pending",
        "errors",
        "completedBytes",
        "observedBodyBytes",
        "inheritedRequests",
        "inheritedCompletedBytes",
      ].every((key) => Number.isSafeInteger(group[key]) && group[key] >= 0) &&
      group.requests === group.completed + group.pending
    );
  });
export function primaryCleanupComplete(proof) {
  return (
    knownTransferWire(proof) &&
    proof?.policy === nativeCleanupPolicy &&
    proof.scope === "post-snapshot-context-cleanup" &&
    proof.usableContentClaim === false &&
    proof.complete === true &&
    proof.capped === false &&
    proof.quietMs === 1000 &&
    proof.capMs === 10000 &&
    Number.isFinite(proof.elapsedMs) &&
    proof.elapsedMs >= 1000 &&
    proof.elapsedMs < 10000 &&
    Number.isFinite(proof.quietObservedMs) &&
    proof.quietObservedMs >= 1000 &&
    Number.isFinite(proof.prefetchQuietObservedMs) &&
    proof.prefetchQuietObservedMs >= 1000 &&
    proof.mandatoryPending === 0 &&
    proof.mandatoryErrors === 0 &&
    proof.observationOverflows === 0 &&
    proof.unknownInheritedRedirects === 0 &&
    proof.groups?.prefetch?.pending === 0
  );
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** Same finite + explicit-prefetch drain ordering as the clock cleanup operator. */
export async function waitForPrimaryContextDrain(
  transport,
  {
    now = () => performance.now(),
    sleep = pause,
    capMs = 10000,
    policy = nativeCleanupPolicy,
    scope = "post-snapshot-context-cleanup",
  } = {},
) {
  if (!Number.isFinite(capMs) || capMs < 1000)
    throw Error("Finite transfer quiet needs a bounded cap.");
  const started = now();
  transport.wire.ready(started);
  let prefetchActivity = started,
    previousPrefetch;
  for (;;) {
    const at = now(),
      state = transport.wire.state(at),
      prefetch = state.groups?.prefetch;
    const fingerprint = JSON.stringify(prefetch);
    if (fingerprint !== previousPrefetch) {
      previousPrefetch = fingerprint;
      prefetchActivity = at;
    }
    const proof = {
      ...state,
      policy,
      scope,
      usableContentClaim: false,
      quietMs: 1000,
      capMs,
      elapsedMs: at - started,
      prefetchQuietObservedMs: at - prefetchActivity,
    };
    const fail = (message, capped = false) => {
      const error = Error(message);
      error.cleanupProof = {
        ...proof,
        complete: false,
        censored: true,
        capped,
      };
      throw error;
    };
    if (at - started >= capMs)
      fail("Primary finite HTTP cleanup exceeded its cap.", true);
    if (
      state.mandatoryPending === 0 &&
      prefetch?.pending === 0 &&
      state.quietObservedMs >= 1000 &&
      proof.prefetchQuietObservedMs >= 1000
    ) {
      if (
        !knownTransferWire(state) ||
        typeof state.complete !== "boolean" ||
        typeof state.capped !== "boolean" ||
        state.mandatoryErrors !== 0 ||
        state.observationOverflows !== 0 ||
        state.unknownInheritedRedirects !== 0
      )
        fail(
          "Primary finite HTTP cleanup retained errors or unknown observation.",
        );
      return {
        ...proof,
        wireWindowComplete: state.complete,
        wireWindowCapped: state.capped,
        complete: true,
        censored: false,
        capped: false,
      };
    }
    await sleep(25);
  }
}
export async function closePrimaryContext({ context, transport, sample, beforeClose }) {
  const deadlineMs = performance.now() + 10000;
  if (transport) {
    try {
      sample.nativeCleanup = await waitForPrimaryContextDrain(transport);
    } catch (error) {
      sample.nativeCleanup = error.cleanupProof ?? {
        policy: nativeCleanupPolicy,
        scope: "post-snapshot-context-cleanup",
        usableContentClaim: false,
        complete: false,
        censored: true,
      };
      if (sample.failed)
        (sample.secondaryFailures ??= []).push({
          failureStage: "native-cleanup",
          failureKind: "observation-incomplete",
        });
      else {
        sample.failed = true;
        sample.failureStage = "native-cleanup";
        sample.failureKind = "observation-incomplete";
      }
    }
  }
  if (beforeClose) {
    try { await beforeClose({ deadlineMs }); } finally { await context?.close(); }
  } else await context?.close();
}
