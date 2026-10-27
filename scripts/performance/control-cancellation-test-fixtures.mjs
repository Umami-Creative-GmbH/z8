/** Synthetic test evidence made through the real public proof interfaces, never used by capture. */
import { classifyControlCancellations, inspectRequiredFlightBody, chromiumSWRRevision, controlCancellationPolicy } from "./control-cancellation-evidence.mjs";

import { createHash } from "node:crypto";
import { temporaryValueObservation, openOriginalTeamBodyInspection, closeOriginalTeamBodyInspection, originalTeamBodyObservation } from "./team-temporary-value-authority.mjs";

export const testBrowserMetadata = () => ({ policy: structuredClone(controlCancellationPolicy), browserRevision: chromiumSWRRevision,
  compiledCachedNavigations: true, compiledManifestSha256: "d".repeat(64), temporaryValueObservation: structuredClone(temporaryValueObservation), originalTeamSource: null });
export const testBrowserBinding = (build, metadata = testBrowserMetadata()) => ({ ...metadata, compiledBuild: build, manifestVerified: true, browserVerified: true });
export function testBrowserEvidence(contextId, controlled = false) {
  const identity = { contextId, method: "POST", requestKind: "action", fullUrlSha256: "a".repeat(64),
    requestHeadersSha256: "b".repeat(64), documentGeneration: "context:1" };
  const bytes = Buffer.from('0:{"a":{"success":true}}\n');
  const temporaryValueInspection = openOriginalTeamBodyInspection({ bodySha256: createHash("sha256").update(bytes).digest("hex"), decodedBytes: bytes.length });
  const bodyProof = inspectRequiredFlightBody(bytes, { action: true, temporaryValueInspection });
  closeOriginalTeamBodyInspection(temporaryValueInspection);
  const temporaryObservation = originalTeamBodyObservation(temporaryValueInspection);
  const input = {
    failures: controlled ? [{ ...identity, requestId: "request", error: "net::ERR_ABORTED", canceled: true, status: 200,
      proxyResponseId: "packet", action: true, bodyReadbackComplete: true, temporaryValueObservation: temporaryObservation, bodyProof }] : [],
    proxy: controlled ? [{ ...identity, id: "packet", status: 200, flight: true, action: true, complete: true,
      canceled: false, upstreamError: false, temporaryValueObservation: temporaryObservation, bodyProof }] : [],
    browserRevision: chromiumSWRRevision,
    coverage: { installed: true, scopeClosed: true, missing: 0, overflow: 0, errors: 0, pendingBodies: 0 },
  };
  return { contextId, protocolErrors: { protocol: "positive-flight-error-observations-v1", contextId, installed: true, scopeClosed: true, observed: 0, overflow: 0, records: [] }, measured: classifyControlCancellations(input),
    allPhase: classifyControlCancellations({ ...input, scope: "all-phase-semantic-correlation" }) };
}
