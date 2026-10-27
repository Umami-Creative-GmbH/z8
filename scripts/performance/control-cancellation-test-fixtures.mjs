/** Synthetic test evidence made through the real public proof interfaces, never used by capture. */
import { classifyControlCancellations, inspectRequiredFlightBody, chromiumSWRRevision, controlCancellationPolicy, teamAnnualModule, teamAnnualWorkers,openTeamAnnualProjection,takeTeamAnnualProjection,closeTeamAnnualProjection,teamAnnualGoldenReceipt } from "./control-cancellation-evidence.mjs";
import {controlRequestIdentity} from "./browser-control-collector.mjs";
import {createProxyHeaderCensus} from "./proxy-header-census.mjs";

import { createHash } from "node:crypto";
import { createTeamTemporaryValueStore, temporaryValueObservation, openOriginalTeamBodyInspection, closeOriginalTeamBodyInspection, originalTeamBodyObservation } from "./team-temporary-value-authority.mjs";

export const testBrowserMetadata = () => ({ policy: structuredClone(controlCancellationPolicy), browserRevision: chromiumSWRRevision,
  compiledCachedNavigations: true, compiledManifestSha256: "d".repeat(64), temporaryValueObservation: structuredClone(temporaryValueObservation), originalTeamSource: null });
export const testTeamAnnualSource=(build,manifestSha256)=>({protocol:"compiled-team-annual-action-v1",compiledBuild:build,compiledManifestSha256:manifestSha256,registrySha256:"a".repeat(64),actionHeaderSha256:createHash("sha256").update("40"+"a".repeat(40)).digest("hex"),moduleSha256:createHash("sha256").update(teamAnnualModule).digest("hex"),workersSha256:createHash("sha256").update(JSON.stringify(teamAnnualWorkers)).digest("hex"),exportName:"getTeamPerformanceData"});
export const testBrowserBinding = (build, metadata = testBrowserMetadata()) => ({ ...metadata, compiledBuild: build, manifestVerified: true, browserVerified: true,teamAnnualAction:testTeamAnnualSource(build,metadata.compiledManifestSha256) });
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

/** Actual empty store construction, never a private value/source capability. */
export function testEmptyTemporaryValues(contextId) {
 const store=createTeamTemporaryValueStore({contextId,reserve:()=>true,release:()=>{}});store.close();
 return {store:store.snapshot(),manualDispatch:null,sourceCuts:null,bodyUses:{protocol:"actual-body-value-observations-v1",contextId,observed:0,records:[]}};
}

export function testTeamAnnualDocument(contextId,origin){
	const originSha256=createHash("sha256").update(origin).digest("hex"),document={contextId,frameId:"frame",loaderId:"loader",executionContextId:1,executionContextUniqueId:"unique",documentRequestId:"doc",documentGeneration:1,originSha256,executionEventOrdinal:1,documentEventOrdinal:1,executionEventOrdinalAfter:1,documentEventOrdinalAfter:1};
	const journal={protocol:"actual-cdp-document-journal-v1",contextId,installed:true,currentGeneration:1,executionEventOrdinal:1,documentEventOrdinal:1,errors:0,overflow:0,closed:false,executionEvents:[{ordinal:1,event:"created",executionContextId:1,uniqueId:"unique",frameId:"frame",isDefault:true}],documents:[{ordinal:1,requestId:"doc",frameId:"frame",loaderId:"loader",originSha256,documentGeneration:contextId+":1"}]};
	return {document,journal};
}

/** Fresh synthetic body inspected through the real scalar and temporary-value APIs. */
export function testTeamAnnualGolden(context,origin="http://localhost:58792",timeoutMs=90000) {
	const hash=value=>createHash("sha256").update(value).digest("hex"),bytes=Buffer.from('0:{"a":{"success":true,"data":{"teams":[{"employeeCount":8}],"organizationTotal":16704}}}\n'),id="a".repeat(32)+".1";
	const census=createProxyHeaderCensus({contextId:context.contextId});census.accepted(id);census.headers(id,{"content-type":"text/x-component"});if(context.principalEpoch.scopeClosed)census.close();context.headerCensus=census.snapshot();
	const document=testTeamAnnualDocument(context.contextId,origin);context.environment.temporaryValueSourceReads ??= {};context.environment.temporaryValueSourceReads.documentJournal={...structuredClone(document.journal),closed:context.principalEpoch.scopeClosed};
	const inspection=openOriginalTeamBodyInspection({bodySha256:hash(bytes),decodedBytes:bytes.length}),cap=openTeamAnnualProjection({bodySha256:hash(bytes),decodedBytes:bytes.length});
	const bodyProof=inspectRequiredFlightBody(bytes,{action:true,cachedNavigations:context.binding.compiledCachedNavigations,temporaryValueInspection:inspection,teamAnnualProjection:cap});
	closeOriginalTeamBodyInspection(inspection);const projection=takeTeamAnnualProjection(cap);closeTeamAnnualProjection(cap);
	const headers={"next-action":"40"+"a".repeat(40),cookie:"session=synthetic","accept":"text/x-component","accept-language":"en","content-type":"text/plain;charset=UTF-8","x-z8-fixture-document-generation":context.contextId+":1"};
	const identity=controlRequestIdentity(context.contextId,origin+"/en/analytics/team-performance","POST",headers),initial={...identity};
	const packet={...identity,id,traceId:"a".repeat(32),responseEvents:1,status:200,action:true,flight:true,responseHeaderSnapshotKnown:true,responseContentType:{headerKnown:true,mime:"text/x-component",charset:"absent"},complete:true,canceled:false,upstreamError:false,annualRequestOrdinal:1,bodyProof,teamAnnualProjection:projection,
		requestBodyFacts:{protocol:"owned-proxy-request-eof-v1",proxyResponseId:id,actualEOF:true,encodedBytes:2,bodySha256:hash("[]")},temporaryValueObservation:originalTeamBodyObservation(inspection),transportBodyReceipt:{protocol:"proxy-natural-eof-decoded-bytes-v1",naturalEOF:true,decodedBytes:bytes.length,bodySha256:hash(bytes)}};
	const browser={...identity,requestId:"selected",proxyResponseId:id,frameId:"frame",loaderId:"loader",type:"Fetch",action:true,status:200,flight:true,responseHeaderSnapshotKnown:true,responseContentType:{headerKnown:true,mime:"text/x-component",charset:"absent"},ambiguousRedirect:false,loadingFinished:true,failed:false,requestHeadersKnown:true,initialHeaderIdentity:initial,extraHeaderIdentity:initial};
	const selection={protocol:"actual-response-object-selection-v1",contextId:context.contextId,proxyResponseId:id,status:200,mainFrame:true,fullUrlSha256:identity.fullUrlSha256,armFullUrlSha256:identity.fullUrlSha256,locale:"en",document,selectedContentType:{mime:"text/x-component",charset:"absent"},requestBodySha256:hash("[]"),encodedBytes:2,requestOrdinalAtArm:0,startedAtMs:1,selectedAtMs:2,fulfilledAtMs:3,deadlineMs:1+timeoutMs};
	return teamAnnualGoldenReceipt({browser,packet,projection,source:context.binding.teamAnnualAction,context,selection,origin});
}
