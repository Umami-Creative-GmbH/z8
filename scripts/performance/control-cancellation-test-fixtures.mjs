/** Synthetic test evidence made through the real public proof interfaces, never used by capture. */
import { classifyControlCancellations, inspectRequiredFlightBody, chromiumSWRRevision, controlCancellationPolicy } from "./control-cancellation-evidence.mjs";

export const testBrowserMetadata = () => ({ policy: structuredClone(controlCancellationPolicy), browserRevision: chromiumSWRRevision,
  compiledCachedNavigations: true, compiledManifestSha256: "d".repeat(64) });
export const testBrowserBinding = (build, metadata = testBrowserMetadata()) => ({ ...metadata, compiledBuild: build, manifestVerified: true, browserVerified: true });
export function testBrowserEvidence(contextId, controlled = false) {
  const identity = { contextId, method: "POST", requestKind: "action", fullUrlSha256: "a".repeat(64),
    requestHeadersSha256: "b".repeat(64), documentGeneration: "context:1" };
  const bodyProof = inspectRequiredFlightBody(Buffer.from('0:{"a":{"success":true}}\n'), { action: true });
  const input = {
    failures: controlled ? [{ ...identity, requestId: "request", error: "net::ERR_ABORTED", canceled: true, status: 200,
      proxyResponseId: "packet", action: true, bodyReadbackComplete: true, bodyProof }] : [],
    proxy: controlled ? [{ ...identity, id: "packet", status: 200, flight: true, action: true, complete: true,
      canceled: false, upstreamError: false, bodyProof }] : [],
    browserRevision: chromiumSWRRevision,
    coverage: { installed: true, scopeClosed: true, missing: 0, overflow: 0, errors: 0, pendingBodies: 0 },
  };
  return { contextId, measured: classifyControlCancellations(input),
    allPhase: classifyControlCancellations({ ...input, scope: "all-phase-semantic-correlation" }) };
}
