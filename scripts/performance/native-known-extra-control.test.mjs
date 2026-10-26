import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {classifyControlCancellations,cleanBrowserFailureEvidence,inspectRequiredFlightBody,controlCancellationPolicy,chromiumSWRRevision} from "./control-cancellation-evidence.mjs";
import {controlRequestIdentity,controlResponseMetadata,createPrincipalEpochObserver,createProxyControlCollector,createBrowserControlCollector,controlResponseHeader} from "./browser-control-collector.mjs";
import {setImmediate as tick} from "node:timers/promises";
import {createProxyHeaderCensus} from "./proxy-header-census.mjs";
import {primaryProtocolIdentity} from "./protocol-fingerprints.mjs";
import {cleanBrowserContextEvidence} from "./clean-evidence.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const protocol=await primaryProtocolIdentity();

// Entirely synthetic observations, produced through the real parser/identity/census APIs.
// This fixture never reads private capture data and makes no runtime claim.
function fixture({applicationIds=[1,2],originalApplicationId=1,currentApplicationId=2,mixedTraces=false}={}) {
  const contextId="synthetic-context",origin="http://localhost:1234",url=origin+"/en?_rsc=synthetic",build="b".repeat(40);
  const files=["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"].map(file=>({file,bytes:12,sha256:sha(file),gitBlob:"d".repeat(40)}));
  const binding={policy:controlCancellationPolicy,browserRevision:chromiumSWRRevision,compiledBuild:build,compiledManifestSha256:"c".repeat(64),compiledCachedNavigations:true,manifestVerified:true,browserVerified:true,
    nativePublicSources:{protocol:"qualified-serving-worker-sources-v1",compiledBuild:build,compiledManifestSha256:"c".repeat(64),files}};
  const initial={rsc:"1","next-router-prefetch":"1","next-router-segment-prefetch":"/page","next-router-state-tree":"synthetic-tree","accept-language":"en","x-z8-fixture-document-generation":contextId+":4"};
  const wire={...initial,accept:"*/*","accept-encoding":"gzip",cookie:"session=synthetic"};
  const response={"content-type":"text/x-component","x-nextjs-postponed":"2","x-nextjs-deployment-id":build,vary:"RSC, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Router-State-Tree, Accept-Encoding","cache-control":"s-maxage=100, stale-while-revalidate=200"};
  const identity=headers=>controlRequestIdentity(contextId,url,"GET",headers);
  const bytes=Buffer.from('0:{"t":{"t":{"s":"","c":"$Q2"}},"a":"$@5","u":"$@6"}\n2:[["children",{"s":"page","d":{"r":["$","span",null,{"children":"known"}],"p":"$@3","v":null,"s":"$4"}}]]\n3:"$undefined"\n4:X\n4:60\n4:C\n5:null\n6:false\n');
  const proof=headers=>inspectRequiredFlightBody(bytes,{requestKind:"segment-prefetch",segmentBinding:{method:"GET",status:200,flight:true,rsc:true,prefetch:true,postponed:true,requestHeadersSha256:identity(headers).requestHeadersSha256,
    requestKeySha256:sha("/page"),responseDeploymentSha256:sha(build),compiledBuild:build,compiledManifestSha256:binding.compiledManifestSha256,manifestVerified:true}});
  const requestId=id=>(mixedTraces && id%2===0?"b":"a").repeat(32)+"."+id;
  const originalId=requestId(originalApplicationId),currentId=requestId(currentApplicationId);
  const originalHeaders={...wire,"x-z8-fixture-document-generation":contextId+":1"};
  const packet=(id,headers)=>({...identity(headers),...controlResponseMetadata(response,200),id,traceId:id.split(".")[0],complete:true,canceled:false,upstreamError:false,
    bodyProof:proof(headers),transportBodyReceipt:{protocol:"proxy-natural-eof-decoded-bytes-v1",naturalEOF:true,decodedBytes:bytes.length,bodySha256:sha(bytes)}});
  const original=packet(originalId,originalHeaders),current=packet(currentId,wire);
  const cached={...identity(initial),...controlResponseMetadata(response,200),requestId:"cached",loaderId:"loader",type:"Fetch",startedAt:1,finishedAt:2,loadingFinished:true,fromDiskCache:true,fromServiceWorker:false,
    initialHeaderIdentity:identity(initial),proxyResponseId:originalId,bodyReadbackComplete:true,bodyProof:proof(initial),
    bodyReadbackReceipt:{available:true,base64Encoded:false,utf16CodeUnitLength:bytes.length,observedDataLengthAtReadback:bytes.length,decodedBytes:bytes.length,bodySha256:sha(bytes),responseContentType:{headerKnown:true,mime:"text/x-component",charset:"absent"}}};
  const failure={...identity(wire),...controlResponseMetadata(response,200),requestId:"native",loaderId:"loader",type:"Other",initiator:"other",initiatorStackKnownAbsent:true,priority:"VeryLow",startedAt:3,
    requestHeadersKnown:true,initialHeaderIdentity:identity(initial),extraHeaderIdentity:identity(wire),proxyResponseId:currentId,error:"net::ERR_ABORTED",canceled:true};
  const principal=createPrincipalEpochObserver(contextId,{origin});
  const cookies=[{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}];principal.start(cookies);principal.end(cookies);
  const census=createProxyHeaderCensus({contextId});for(const appId of applicationIds){const id=requestId(appId);census.accepted(id);census.headers(id,response);}census.close();
  const publicSources={protocol:"serving-public-worker-source-metadata-v1",servingRootKnown:true,files:files.map(({gitBlob,...row})=>({...row,known:true,reason:null}))};
  const worker={present:true,known:true,ownedScript:true,state:"activated",scriptUrlSha256:sha(origin+"/sw.js")},absent={present:false,known:true};
  const nativeContext={protocol:"qualified-known-extra-native-context-v1",contextId,originSha256:sha(origin),workerScriptSha256:sha(origin+"/sw.js"),rootScopeSha256:sha(origin+"/"),binding,protocolSources:protocol,operatorFile:"run-baseline.mjs",principalEpoch:principal.snapshot(),headerCensus:census.snapshot(),
    headerLifetime:{protocol:"owned-context-upstream-header-lifetime-v1",contextId,installation:{protocol:"owned-context-upstream-header-lifetime-v1",proxyInstanceId:"f".repeat(32),originSha256:sha(origin),allowedOriginSha256:[sha(origin)],acceptedRequestsAtInstall:0},closure:{serverClosed:true,acceptedRequests:applicationIds.length,upstreamRequests:applicationIds.length,closedUpstreams:applicationIds.length,pendingUpstreams:0}},
    protocolErrors:{protocol:"positive-flight-error-observations-v1",contextId,installed:true,scopeClosed:true,observed:0,overflow:0,records:[]},
    environment:{protocol:"native-cache-environment-metadata-v1",contextId,servingPublicSources:publicSources,
      nativeLaunchMetadata:{protocol:"owned-native-launch-metadata-v1",processKnown:true,fixturePolicy:"isolated-profile-no-prediction-v1",argumentsKnown:true,argumentsSha256:"5".repeat(64),recordedArgumentsSha256:"5".repeat(64),argumentsMatchRecorded:true,argumentKeys:["--disable-extensions","--headless","--disable-features"],profileArgumentCount:1,profileArgumentSha256:"6".repeat(64),recordedProfileDirectorySha256:"6".repeat(64),profileArgumentMatchesRecorded:true,executable:{known:true,bytes:12,sha256:"7".repeat(64),reason:null},observerSources:["browser-control-collector.mjs","fixture-browser.mjs"].map(file=>({file,known:true,bytes:12,sha256:protocol[file],reason:null}))},
      workerTargets:{protocol:"owned-context-worker-target-metadata-v1",contextId,contextJoinKnown:true,contextIdentitySha256:sha("owned-browser-context"),installed:true,scopeClosed:true,errors:0,overflow:0,events:[{targetOrdinal:1,event:"created",type:"page",urlKnown:true,urlSha256:sha("about:blank"),originMatches:false,ownedWorkerScript:null},{targetOrdinal:2,event:"created",type:"service_worker",urlKnown:true,urlSha256:sha(origin+"/sw.js"),originMatches:true,ownedWorkerScript:true}]},
      endRead:{protocol:"native-environment-end-readonly-v1",timedOut:false,pendingOperations:0,readErrors:0,publicSourceRecheck:publicSources,
        controller:{available:true,secureContext:true,originMatches:true,controllerIdentityStable:true,controllerBefore:worker,controllerAfter:worker,registrationCount:1,registrationOverflow:0,registrations:[{scopeKnown:true,scopeSha256:sha(origin+"/"),ownedRootScope:true,active:worker,waiting:absent,installing:absent}]}}}};
  return {input:{failures:[failure],responses:[cached],proxy:[original,current],nativeContext,browserRevision:chromiumSWRRevision,coverage:{installed:true,scopeClosed:true,missing:0,overflow:0,errors:0,pendingBodies:0}},bytes,io:{origin,url,initial,wire,response,originalHeaders,originalId,currentId,principal}};
}

test("known-Extra Native control requires a complete source/principal/variant/ancestor/exact-byte certificate",()=>{
  const {input}=fixture();
  const result=classifyControlCancellations(input);
  assert.equal(result.provenControls,1,JSON.stringify(result.records));
  assert.equal(result.unknownFailures,0);
  assert.equal(result.records[0].reason,"qualified-cached-flight-native-revalidation");
  assert.equal(cleanBrowserFailureEvidence(JSON.parse(JSON.stringify(result)),1),true);
});

test("Native census chronology uses context application IDs independently of lexical trace serialization",()=>{
  const applicationIds=Array.from({length:12},(_,i)=>i+1);
  for(const mixedTraces of [false,true]){
    const {input}=fixture({applicationIds,originalApplicationId:2,currentApplicationId:11,mixedTraces});
    const result=classifyControlCancellations(input);
    assert.equal(result.provenControls,1,JSON.stringify(result.records));
    assert.equal(cleanBrowserFailureEvidence(JSON.parse(JSON.stringify(result)),1),true);
    const reverse=fixture({applicationIds,originalApplicationId:11,currentApplicationId:2,mixedTraces}).input;
    assert.equal(classifyControlCancellations(reverse).provenControls,0,"a later origin cannot precede the current wire");
  }
  const gap=fixture({applicationIds:[1,2,4],originalApplicationId:1,currentApplicationId:2}).input;
  assert.equal(classifyControlCancellations(gap).provenControls,0,"context census must retain numeric continuity");
  const {input,io}=fixture({applicationIds,mixedTraces:true,originalApplicationId:2,currentApplicationId:11});
  const census=createProxyHeaderCensus({contextId:input.nativeContext.contextId});
  for(let id=1;id<=12;id++){
    const number=id===12?11:id;
    const requestId=(id%2===0?"b":"a").repeat(32)+"."+number;
    census.accepted(requestId);census.headers(requestId,io.response);
  }
  census.close();input.nativeContext.headerCensus=census.snapshot();
  assert.equal(classifyControlCancellations(input).provenControls,0,"different traces cannot duplicate a context application ID");
});

test("Native proof cannot use NoExtra, missing source authority, body mismatches or an incomplete current wire",()=>{
  for(const mutate of [i=>delete i.nativeContext,i=>delete i.nativeContext.binding.nativePublicSources,i=>i.failures[0].requestHeadersKnown=false,
    i=>i.responses.push(structuredClone(i.responses[0])),i=>i.proxy.push(structuredClone(i.proxy[0])),i=>i.responses[0].bodyReadbackReceipt.bodySha256="0".repeat(64),
    i=>i.proxy[0].responseHeaderSnapshotKnown=false,i=>i.proxy[1].responseHeaderSnapshotKnown=false,
    i=>i.responses[0].responseHeaderSnapshotKnown=false,i=>i.responses[0].initialSegmentResponse={...i.responses[0],responseHeaderSnapshotKnown:false},
    i=>i.proxy[1].complete=false,i=>i.proxy[1].canceled=true,i=>i.nativeContext.headerCensus.closed=false,i=>i.nativeContext.principalEpoch.after.sha256="0".repeat(64)]){
    const {input}=fixture();mutate(input);const result=classifyControlCancellations(input);assert.equal(result.provenControls,0);assert.equal(result.unknownFailures,1);
  }
});

test("Native serialized controls require external runtime and frozen protocol authority at finalization",()=>{
  const {input}=fixture();
  const measured=classifyControlCancellations(input),allPhase=classifyControlCancellations({...input,scope:"all-phase-semantic-correlation"});
  const evidence={contextId:input.nativeContext.contextId,protocolErrors:input.nativeContext.protocolErrors,measured,allPhase};
  const authority={runtime:{build:input.nativeContext.binding.compiledBuild,browserControl:input.nativeContext.binding},protocolSources:protocol,origin:"http://localhost:1234"};
  assert.equal(cleanBrowserContextEvidence(evidence.contextId,evidence,1),false);
  assert.equal(cleanBrowserContextEvidence(evidence.contextId,JSON.parse(JSON.stringify(evidence)),1,authority),true);
  const wrongProtocol={...authority,protocolSources:{...protocol,"browser-control-collector.mjs":"0".repeat(64)}};
  assert.equal(cleanBrowserContextEvidence(evidence.contextId,evidence,1,wrongProtocol),false);
  assert.equal(cleanBrowserContextEvidence(evidence.contextId,evidence,1,{...authority,origin:"http://localhost:9999"}),false);
  const wrongRuntime=structuredClone(authority);wrongRuntime.runtime.browserControl.nativePublicSources.files[0].sha256="0".repeat(64);
  assert.equal(cleanBrowserContextEvidence(evidence.contextId,evidence,1,wrongRuntime),false);
  for(const mutate of [p=>p.cachedCandidates=2,p=>p.originCandidates=0,p=>p.nativeContextSha256="0".repeat(64),p=>p.origin.bodyProof.segmentBinding.derivedRequestKeySha256="0".repeat(64),p=>delete p.failure.extraHeaderIdentity]){
    const bad=JSON.parse(JSON.stringify(measured));mutate(bad.records[0].proof);assert.equal(cleanBrowserFailureEvidence(bad,1),false);
  }
  const historical=structuredClone(measured);historical.protocol="positively-proven-protocol-controls-v1";historical.policy.version=1;
  assert.equal(cleanBrowserFailureEvidence(historical,1),false,"old policy evidence cannot acquire the new Native exemption");
});

test("Native source, principal, Vary and producer premises are mandatory rather than an Other/prefetch allowlist",()=>{
  const cases=[
    i=>i.failures[0].type="Fetch",i=>i.failures[0].initiator="script",i=>i.failures[0].priority="Low",i=>i.failures[0].purposeHeaderPresent=true,
    i=>delete i.failures[0].proxyResponseId,i=>i.failures[0].requestOriginSha256="0".repeat(64),
    i=>i.responses[0].finishedAt=4,i=>i.responses[0].loaderId="old",i=>i.responses[0].initialHeaderIdentity.headerFieldSha256["next-url"]="0".repeat(64),
    i=>i.proxy[0].headerFieldSha256.cookie="0".repeat(64),i=>i.proxy[1].headerFieldSha256["accept-encoding"]="0".repeat(64),
    i=>i.proxy[1].vary.star=true,i=>i.proxy[0].vary.known=false,
    i=>i.responses[0].staleWhileRevalidateSeconds=null,
    i=>i.nativeContext.binding.browserVerified=false,i=>i.nativeContext.environment.servingPublicSources.files[0].sha256="0".repeat(64),
    i=>i.nativeContext.environment.endRead.publicSourceRecheck={...i.nativeContext.environment.endRead.publicSourceRecheck,servingRootKnown:false},
    i=>i.nativeContext.environment.nativeLaunchMetadata.observerSources[0].sha256="0".repeat(64),
    i=>i.nativeContext.environment.nativeLaunchMetadata.recordedArgumentsSha256="0".repeat(64),i=>i.nativeContext.environment.nativeLaunchMetadata.profileArgumentCount=2,
    i=>i.nativeContext.environment.workerTargets.contextJoinKnown=false,i=>i.nativeContext.environment.endRead.controller.controllerAfter.ownedScript=false,
    i=>i.nativeContext.environment.endRead.controller.registrations[0].waiting={present:true,known:true},
    i=>i.nativeContext.principalEpoch.before.cookieAttributes.singleOwnedRootHttpOnlyCookie=false,i=>i.nativeContext.principalEpoch.unknownResponseHeaders=1,
    i=>i.nativeContext.headerLifetime.closure.acceptedRequests=3,i=>delete i.nativeContext.headerLifetime.installation.proxyInstanceId,
    i=>i.nativeContext.headerCensus.requests.pop(),i=>i.nativeContext.protocolErrors.observed=1,
    i=>i.responses[0].bodyReadbackReceipt.observedDataLengthAtReadback=null,i=>i.responses[0].bodyReadbackReceipt.utf16CodeUnitLength++,
  ];
  for(let index=0;index<cases.length;index++){
    const {input}=fixture();cases[index](input);const result=classifyControlCancellations(input);
    assert.equal(result.provenControls,0,String(index));assert.equal(result.unknownFailures,1,String(index));
  }
});

test("genuine browser/HTTP/protocol failures are never relabeled as Native controls",()=>{
  for(const mutate of [i=>i.failures[0].error="net::ERR_CONNECTION_RESET",i=>i.proxy[1].status=500,i=>i.proxy[1].observedProtocolError={serverErrors:1,explicitActionFailure:false},i=>i.proxy[1].observedProtocolError={serverErrors:0,explicitActionFailure:true}]){
    const {input}=fixture();mutate(input);const result=classifyControlCancellations(input);assert.equal(result.realFailures,1);assert.equal(result.provenControls,0);
  }
  const {input}=fixture();input.proxy[0].bodyProof.serverErrors=1;
  assert.equal(classifyControlCancellations(input).provenControls,0,"a bad required ancestor is never borrowed");
});

test("actual collector APIs carry CORE authority and exact-byte joins after transport closure",async()=>{
  const {input,bytes,io}=fixture(),ctx=input.nativeContext;
  const proxy=createProxyControlCollector({contextId:ctx.contextId,compiledCachedNavigations:true,compiledBinding:ctx.binding});
  proxy.installed(ctx.headerLifetime.installation);
  const collector=createBrowserControlCollector({contextId:ctx.contextId,origin:io.origin,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledBinding:ctx.binding,
    protocolSources:protocol,operatorFile:"run-baseline.mjs",principalEpoch:io.principal,environmentObservation:()=>ctx.environment,proxyObservation:proxy.snapshot,
    readBody:async id=>{if(id!=="cached")throw Error("Synthetic native response body unavailable");return{body:bytes.toString(),base64Encoded:false};}});
  collector.installed();
  const request=(id,type,timestamp)=>({requestId:id,loaderId:"loader",timestamp,type,initiator:{type:type==="Fetch"?"script":"other"},request:{url:io.url,method:"GET",headers:io.initial,initialPriority:"VeryLow"}});
  proxy.request(io.originalId,{url:io.url,method:"GET",headers:io.originalHeaders,traceId:"a".repeat(32)});proxy.response(io.originalId,{status:200,headers:io.response});proxy.bytes(io.originalId,bytes);proxy.end(io.originalId);
  collector.request(request("cached","Fetch",1));collector.response({requestId:"cached",response:{status:200,headers:{...io.response,[controlResponseHeader]:io.originalId},fromDiskCache:true,fromServiceWorker:false}});
  collector.data({requestId:"cached",dataLength:bytes.length});collector.finished({requestId:"cached",timestamp:2});await tick();await tick();
  collector.beginMeasurement();
  proxy.request(io.currentId,{url:io.url,method:"GET",headers:io.wire,traceId:"a".repeat(32)});proxy.response(io.currentId,{status:200,headers:io.response});proxy.bytes(io.currentId,bytes);proxy.end(io.currentId);
  collector.request(request("native","Other",3));collector.requestExtra({requestId:"native",headers:io.wire});collector.responseExtra({requestId:"native",statusCode:200,headers:{...io.response,[controlResponseHeader]:io.currentId}});
  collector.recordMeasuredFailure("native");collector.failed({requestId:"native",errorText:"net::ERR_ABORTED",canceled:true});collector.endMeasurement();collector.endScope();
  await tick();await tick();proxy.transportClosed(ctx.headerLifetime.closure);
  const result=collector.snapshot();
  assert.equal(result.measured.provenControls,1,JSON.stringify(result.diagnostics.failures));
  assert.equal(result.measured.unknownFailures,0);
  assert.equal(cleanBrowserContextEvidence(ctx.contextId,JSON.parse(JSON.stringify(result)),1,{runtime:{build:ctx.binding.compiledBuild,browserControl:ctx.binding},protocolSources:protocol,origin:io.origin}),true);
});
