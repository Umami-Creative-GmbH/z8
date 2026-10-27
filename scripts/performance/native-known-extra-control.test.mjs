import {testEmptyTemporaryValues,testTeamAnnualSource} from "./control-cancellation-test-fixtures.mjs";
import { temporaryValueObservation } from "./team-temporary-value-authority.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {classifyControlCancellations,cleanBrowserFailureEvidence,inspectRequiredFlightBody,controlCancellationPolicy,chromiumSWRRevision} from "./control-cancellation-evidence.mjs";
import {controlRequestIdentity,controlResponseMetadata,createPrincipalEpochObserver,createProxyControlCollector,createBrowserControlCollector,controlResponseHeader,renderedPathSourceFacts,compiledRoutingSourceFacts} from "./browser-control-collector.mjs";
import {setImmediate as tick} from "node:timers/promises";
import {createProxyHeaderCensus} from "./proxy-header-census.mjs";
import {primaryProtocolIdentity} from "./protocol-fingerprints.mjs";
import {cleanBrowserContextEvidence} from "./clean-evidence.mjs";
import {projectCachedCdpText} from "./cdp-cached-text-projection.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const protocol=await primaryProtocolIdentity();

test("Native controls bind only the independently qualified current Chromium revision",()=>{
  assert.equal(chromiumSWRRevision,"d0c02bfad08ec92a6ffcf989e53cd995e6381a4c");
  const {input}=fixture();input.browserRevision="1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775";
  assert.equal(classifyControlCancellations(input).provenControls,0,"historical revision is not an alternative accepted pin");
});

// Entirely synthetic observations, produced through the real parser/identity/census APIs.
// This fixture never reads private capture data and makes no runtime claim.
function fixture({applicationIds=[1,2],originalApplicationId=1,currentApplicationId=2,mixedTraces=false}={}) {
  const contextId="synthetic-context",origin="http://localhost:1234",url=origin+"/en?_rsc=synthetic",build="b".repeat(40);
  const files=["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"].map(file=>({file,bytes:12,sha256:sha(file),gitBlob:"d".repeat(40)}));
  const binding={policy:controlCancellationPolicy,temporaryValueObservation:structuredClone(temporaryValueObservation),originalTeamSource:null,browserRevision:chromiumSWRRevision,compiledBuild:build,compiledManifestSha256:"c".repeat(64),compiledCachedNavigations:true,manifestVerified:true,browserVerified:true,
    teamAnnualAction:testTeamAnnualSource(build,"c".repeat(64)),nativePublicSources:{protocol:"qualified-serving-worker-sources-v1",compiledBuild:build,compiledManifestSha256:"c".repeat(64),files}};
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
  const failure={...identity(wire),...controlResponseMetadata(response,200),requestId:"native",failedEventOrdinal:9,loaderId:"loader",type:"Other",initiator:"other",initiatorStackKnownAbsent:true,priority:"VeryLow",startedAt:3,
    requestHeadersKnown:true,initialHeaderIdentity:identity(initial),extraHeaderIdentity:identity(wire),proxyResponseId:currentId,error:"net::ERR_ABORTED",canceled:true};
  const principal=createPrincipalEpochObserver(contextId,{origin});
  const cookies=[{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}];principal.start(cookies);principal.end(cookies);
  const census=createProxyHeaderCensus({contextId});for(const appId of applicationIds){const id=requestId(appId);census.accepted(id);census.headers(id,response);}census.close();
  const publicSources={protocol:"serving-public-worker-source-metadata-v1",servingRootKnown:true,files:files.map(({gitBlob,...row})=>({...row,known:true,reason:null}))};
  const worker={present:true,known:true,ownedScript:true,state:"activated",scriptUrlSha256:sha(origin+"/sw.js")},absent={present:false,known:true};
  const nativeContext={protocol:"qualified-known-extra-native-context-v1",contextId,originSha256:sha(origin),workerScriptSha256:sha(origin+"/sw.js"),rootScopeSha256:sha(origin+"/"),binding,protocolSources:protocol,operatorFile:"run-baseline.mjs",principalEpoch:principal.snapshot(),headerCensus:census.snapshot(),
    headerLifetime:{protocol:"owned-context-upstream-header-lifetime-v1",contextId,installation:{protocol:"owned-context-upstream-header-lifetime-v1",proxyInstanceId:"f".repeat(32),originSha256:sha(origin),allowedOriginSha256:[sha(origin)],acceptedRequestsAtInstall:0},closure:{serverClosed:true,acceptedRequests:applicationIds.length,upstreamRequests:applicationIds.length,closedUpstreams:applicationIds.length,pendingUpstreams:0}},
    protocolErrors:{protocol:"positive-flight-error-observations-v1",contextId,installed:true,scopeClosed:true,observed:0,overflow:0,records:[]},
    environment:{protocol:"native-cache-environment-metadata-v1",contextId,temporaryValues:testEmptyTemporaryValues(contextId),servingPublicSources:publicSources,
      nativeLaunchMetadata:{protocol:"owned-native-launch-metadata-v1",processKnown:true,fixturePolicy:"isolated-profile-no-prediction-v1",argumentsKnown:true,argumentsSha256:"5".repeat(64),recordedArgumentsSha256:"5".repeat(64),argumentsMatchRecorded:true,argumentKeys:["--disable-extensions","--headless","--disable-features"],profileArgumentCount:1,profileArgumentSha256:"6".repeat(64),recordedProfileDirectorySha256:"6".repeat(64),profileArgumentMatchesRecorded:true,executable:{known:true,bytes:12,sha256:"7".repeat(64),reason:null},observerSources:["browser-control-collector.mjs","fixture-browser.mjs"].map(file=>({file,known:true,bytes:12,sha256:protocol[file],reason:null}))},
      workerTargets:{protocol:"owned-context-worker-target-metadata-v1",contextId,contextJoinKnown:true,contextIdentitySha256:sha("owned-browser-context"),installed:true,scopeClosed:true,errors:0,overflow:0,events:[{targetOrdinal:1,event:"created",type:"page",urlKnown:true,urlSha256:sha("about:blank"),originMatches:false,ownedWorkerScript:null},{targetOrdinal:2,event:"created",type:"service_worker",urlKnown:true,urlSha256:sha(origin+"/sw.js"),originMatches:true,ownedWorkerScript:true}]},
      endRead:{protocol:"native-environment-end-readonly-v1",timedOut:false,pendingOperations:0,readErrors:0,publicSourceRecheck:publicSources,
        controller:{available:true,secureContext:true,originMatches:true,controllerIdentityStable:true,controllerBefore:worker,controllerAfter:worker,registrationCount:1,registrationOverflow:0,registrations:[{scopeKnown:true,scopeSha256:sha(origin+"/"),ownedRootScope:true,active:worker,waiting:absent,installing:absent}]}}}};
  return {input:{failures:[failure],responses:[cached],proxy:[original,current],nativeContext,browserRevision:chromiumSWRRevision,coverage:{installed:true,scopeClosed:true,missing:0,overflow:0,errors:0,pendingBodies:0}},bytes,io:{origin,url,initial,wire,response,originalHeaders,originalId,currentId,principal}};
}

function projectionFixture(){
  const result=fixture(),{input}=result;
  const original=Buffer.from(result.bytes.toString("utf8").replace("known","é"));
  const readback=original.toString("latin1"),readbackBytes=Buffer.from(readback);
  for(const packet of input.proxy){
    packet.bodyProof=inspectRequiredFlightBody(original,{requestKind:"segment-prefetch",segmentBinding:packet.bodyProof.segmentBinding});
    packet.transportBodyReceipt={protocol:"proxy-natural-eof-decoded-bytes-v1",naturalEOF:true,decodedBytes:original.length,bodySha256:sha(original),cdpTextProjection:{available:true,...projectCachedCdpText(original)}};
  }
  const cached=input.responses[0];cached.ambiguousRedirect=false;cached.failed=false;
  cached.bodyProof={complete:false,reason:"unsupported-record"};
  cached.bodyReadbackReceipt={...cached.bodyReadbackReceipt,decodedBytes:readbackBytes.length,bodySha256:sha(readbackBytes),utf16CodeUnitLength:readback.length,observedDataLengthAtReadback:original.length,terminal:"finished",
    effectiveCdpResponse:{protocol:"cdp-effective-response-decoder-metadata-v1",provenance:"Network.responseReceived",mimeKnown:true,mime:"text/x-component",charsetKnown:true,charset:"empty"}};
  cached.browserDataLedger={protocol:"cached-browser-data-ledger-v1",requestObserved:true,responseEvents:1,finishedEvents:1,failedEvents:0,dataEvents:1,dataAfterTerminal:0,dataBeforeResponse:0,responseAfterTerminal:0,terminalBeforeResponse:0,invalidData:false,observedDataLength:original.length};
  return {...result,original,readbackBytes};
}

function routeTreeFixture(){
  const result=fixture(),{input,io}=result;
  for(const source of [io.initial,io.wire,io.originalHeaders])source["next-router-segment-prefetch"]="/_tree";
  const identity=source=>controlRequestIdentity(input.nativeContext.contextId,io.url,"GET",source);
  const bytes=Buffer.from('0:{"t":{"t":{"s":"","c":"$Q2"}}}\n2:[["children",{"s":"__PAGE__"}],["modal",{"s":"__PAGE__"}]]\n');
  const binding=input.proxy[0].bodyProof.segmentBinding;
  const proof=source=>inspectRequiredFlightBody(bytes,{requestKind:"route-tree",routeTreeBinding:{...binding,requestHeadersSha256:identity(source).requestHeadersSha256,requestKeySha256:sha("/_tree")}});
  for(const [packet,source] of [[input.proxy[0],io.originalHeaders],[input.proxy[1],io.wire]]){
    Object.assign(packet,identity(source));packet.bodyProof=proof(source);
    packet.transportBodyReceipt={protocol:"proxy-natural-eof-decoded-bytes-v1",naturalEOF:true,decodedBytes:bytes.length,bodySha256:sha(bytes)};
  }
  const cached=input.responses[0];Object.assign(cached,identity(io.initial));cached.initialHeaderIdentity=identity(io.initial);cached.bodyProof=proof(io.initial);
  cached.bodyReadbackReceipt={...cached.bodyReadbackReceipt,decodedBytes:bytes.length,bodySha256:sha(bytes),utf16CodeUnitLength:bytes.length,observedDataLengthAtReadback:bytes.length};
  Object.assign(input.failures[0],identity(io.wire));input.failures[0].initialHeaderIdentity=identity(io.initial);input.failures[0].extraHeaderIdentity=identity(io.wire);
  return {...result,bytes};
}

function routeNullFixture({pathname="/en",bodyText}={}){
  const setup=routeTreeFixture(),{input,io}=setup,compiled=input.nativeContext.binding;
  io.url=io.origin+pathname+"?_rsc=synthetic";
  const identity=source=>controlRequestIdentity(input.nativeContext.contextId,io.url,"GET",source);
  Object.assign(input.failures[0],identity(io.wire));input.failures[0].initialHeaderIdentity=identity(io.initial);input.failures[0].extraHeaderIdentity=identity(io.wire);
  const bytes=Buffer.from(bodyText ?? '0:{"t":{"t":{"s":"","c":"$Q2"}}}\n2:[["children",{"s":{"n":"locale","t":"d","k":null,"s":[]},"c":"$Q3"}]]\n3:[["children",{"s":"__PAGE__"}]]\n');
  for(const row of [...input.proxy,input.responses[0]]){
    Object.assign(row,identity(row.id===io.originalId?io.originalHeaders:row.id?io.wire:io.initial));if(!row.id)row.initialHeaderIdentity=identity(io.initial);
    const facts=renderedPathSourceFacts({response:{url:io.url,status:200,headers:io.response},compiledRouting:compiledRoutingSourceFacts({basePath:"",output:"standalone"},compiled.compiledManifestSha256),origin:io.origin,collectScalars:true,responseOrdinal:1,observerSourceSha256:protocol["browser-control-collector.mjs"]});
    if(row.id){facts.url.provenance="owned-proxy-request-url-no-follow";facts.rendered.pathnameSource="owned-proxy-request-url-no-follow";facts.rendered.searchSource="owned-proxy-request-url-no-follow";if(facts.scalarKeys){const {scalarKeys,...source}=facts;scalarKeys.sourceSha256=sha(JSON.stringify(source));}}
    row.pathSourceFacts=facts;
    row.bodyProof=inspectRequiredFlightBody(bytes,{requestKind:"route-tree",routeTreeBinding:{...row.bodyProof.routeTreeBinding,pathSourceFacts:facts,requestUrlSha256:row.fullUrlSha256,requestOriginSha256:row.requestOriginSha256,ambiguousRedirect:false}});
    if(row.id)row.transportBodyReceipt={protocol:"proxy-natural-eof-decoded-bytes-v1",naturalEOF:true,decodedBytes:bytes.length,bodySha256:sha(bytes)};
    else{row.bodyReadbackReceipt={...row.bodyReadbackReceipt,decodedBytes:bytes.length,bodySha256:sha(bytes),utf16CodeUnitLength:bytes.length,observedDataLengthAtReadback:bytes.length};row.ambiguousRedirect=false;row.failed=false;row.browserDataLedger={protocol:"cached-browser-data-ledger-v1",requestObserved:true,responseEvents:1,finishedEvents:1,failedEvents:0,dataEvents:1,dataAfterTerminal:0,dataBeforeResponse:0,responseAfterTerminal:0,terminalBeforeResponse:0,invalidData:false,observedDataLength:bytes.length};}
  }
  return {...setup,bytes};
}

test("ordinary d/null route readiness uses source-bound canonical scalar facts and a complete branch-index walk",()=>{
  const {input}=routeNullFixture(),result=classifyControlCancellations(input);
  assert.equal(result.provenControls,1,JSON.stringify(result.records));
  const readiness=result.records[0].proof.origin.bodyProof.routeReadiness;
  assert.equal(readiness.nullNodes,1);assert.equal(readiness.metadataPages,1);assert.equal(readiness.nodes[1].partIndex,0);
  assert.equal(cleanBrowserFailureEvidence(JSON.parse(JSON.stringify(result)),1),true);
  assert.equal(JSON.stringify(result).includes('"locale"'),false);
});

test("nullable route inspection cannot downgrade missing readiness to the concrete route contract",()=>{
  const valid=classifyControlCancellations(routeNullFixture().input);
  assert.equal(valid.provenControls,1);
  for(const key of ["origin","packet","cached"]){
    assert.ok(valid.records[0].proof[key],key);
    for(const mutate of [p=>p.routeReadiness=null,p=>delete p.routeReadiness,p=>delete p.routeNullNodes,p=>p.routeNullNodes=0,p=>p.routeNullNodes=-1,p=>p.routeNullNodes="1",p=>p.routeNullNodes=null,p=>p.routeNullNodes=2,
      p=>{p.routeReadiness=null;p.routeNullNodes=0;}]){
      const bad=structuredClone(valid);mutate(bad.records[0].proof[key].bodyProof);
      assert.equal(cleanBrowserFailureEvidence(bad,1),false,key);
    }
  }
  for(const mutate of [p=>p.routeReadiness=null,p=>delete p.routeReadiness,p=>delete p.routeNullNodes,p=>p.routeNullNodes=0,p=>p.routeNullNodes=-1,p=>p.routeNullNodes="1",p=>p.routeNullNodes=null,p=>p.routeNullNodes=2,
    p=>{p.routeReadiness=null;p.routeNullNodes=0;}]){
    const {input}=routeNullFixture();
    for(const row of [...input.proxy,input.responses[0]]){mutate(row.bodyProof);row.pathSourceFacts=null;}
    assert.equal(classifyControlCancellations(input).provenControls,0);
  }
  const concrete=classifyControlCancellations(routeTreeFixture().input);
  assert.equal(concrete.provenControls,1);
  assert.equal(concrete.records[0].proof.origin.bodyProof.routeNullNodes,0);
  const missing=structuredClone(concrete);delete missing.records[0].proof.origin.bodyProof.routeNullNodes;
  assert.equal(cleanBrowserFailureEvidence(missing,1),false);
});

test("nullable route walk uses each branch position and cannot borrow page, alias or encoder readiness",()=>{
  const dynamic={n:"PRIVATE_NAME",t:"d",k:null,s:[]},page={s:"__PAGE__"};
  const body=tree=>'0:'+JSON.stringify({t:{t:tree}})+'\n';
  const node=(s,child)=>({s,c:"$Q"+child});
  const examples=[
    {pathname:"/en",bodyText:body(node("",1))+'1:[["children",'+JSON.stringify(node("(group)",2))+']]\n2:[["children",'+JSON.stringify(node(dynamic,3))+']]\n3:[["children",'+JSON.stringify(page)+']]\n',index:0},
    {pathname:"/fixed/en",bodyText:body(node("",1))+'1:[["children",'+JSON.stringify(node("fixed",2))+']]\n2:[["children",'+JSON.stringify(node(dynamic,3))+']]\n3:[["children",'+JSON.stringify(page)+']]\n',index:1},
    {pathname:"/fixed/en",bodyText:body(node("",1))+'1:[["children",'+JSON.stringify(node({...dynamic,k:"fixed"},2))+']]\n2:[["children",'+JSON.stringify(node(dynamic,3))+']]\n3:[["children",'+JSON.stringify(page)+']]\n',index:1},
  ];
  for(const example of examples){const {input}=routeNullFixture(example),result=classifyControlCancellations(input);assert.equal(result.provenControls,1,JSON.stringify(input.proxy[0].bodyProof));
    const walk=result.records[0].proof.origin.bodyProof.routeReadiness;assert.equal(walk.nodes.find(row=>row.kind==="dynamic-null-d").partIndex,example.index);assert.equal(cleanBrowserFailureEvidence(JSON.parse(JSON.stringify(result)),1),true);}
  const alias=body(node("",1))+'1:[["children",'+JSON.stringify(node("fixed",2))+'],["modal",{"s":"$4","c":"$Q3"}]]\n2:[["children",{"s":"$4","c":"$Q5"}]]\n3:[["children",'+JSON.stringify(page)+']]\n5:[["children",'+JSON.stringify(page)+']]\n4:'+JSON.stringify(dynamic)+'\n';
  assert.equal(classifyControlCancellations(routeNullFixture({pathname:"/one/two",bodyText:alias}).input).provenControls,1);
  assert.equal(classifyControlCancellations(routeNullFixture({pathname:"/one",bodyText:alias}).input).provenControls,0,"an early alias/page cannot hide a missing later branch part");
  for(const changed of ["/","/%E0%A4%A"]){assert.equal(classifyControlCancellations(routeNullFixture({pathname:changed}).input).provenControls,0);}
  for(const bodyText of [alias.replace('"modal"','"💥"'),alias.replace('"PRIVATE_NAME"','"💥"'),alias.replace('"t":"d"','"t":"di(.)"'),alias.replace('"fixed"','"(..)fixed"')])assert.equal(classifyControlCancellations(routeNullFixture({pathname:"/one/two",bodyText}).input).provenControls,0);
});

test("nullable route source and serialized walk premises are mandatory, not copied resolution booleans",()=>{
  const cases=[row=>delete row.pathSourceFacts.scalarKeys,row=>row.pathSourceFacts.url.sha256="0".repeat(64),row=>row.pathSourceFacts.observerSourceSha256="0".repeat(64),
    row=>row.pathSourceFacts.rewrite.path.present=true,row=>row.pathSourceFacts.compiledRouting.basePathEmpty=false,row=>row.pathSourceFacts.compiledRouting.output="export",row=>row.pathSourceFacts.rendered.searchBytes=1,
    row=>row.pathSourceFacts.scalarKeys.parts[0].canonicalizationKnown=false,row=>row.pathSourceFacts.scalarKeys.parts[0].scalarSha256="0".repeat(64),row=>row.pathSourceFacts.compiledRouting.compiledManifestSha256="0".repeat(64)];
  for(const mutate of cases){const {input}=routeNullFixture();mutate(input.proxy[0]);assert.equal(classifyControlCancellations(input).provenControls,0);}
  const {input}=routeNullFixture(),result=classifyControlCancellations(input);
  for(const mutate of [r=>r.nodes[1].partIndex=1,r=>r.nodes[1].nextIndex=0,r=>r.nodes[2].parentOrdinal=1,r=>r.nodes[1].scalar.sha256="0".repeat(64),r=>r.nullNodes=2]){
    const bad=JSON.parse(JSON.stringify(result)),readiness=bad.records[0].proof.origin.bodyProof.routeReadiness;mutate(readiness);readiness.walkSha256=sha(JSON.stringify(readiness.nodes));
    assert.equal(cleanBrowserFailureEvidence(bad,1),false);
  }
});

test("dedicated route-tree Native control binds the fixed request and fully buffered branching structure",()=>{
  const {input}=routeTreeFixture(),result=classifyControlCancellations(input);
  assert.equal(result.provenControls,1,JSON.stringify({records:result.records,bodies:input.proxy.map(row=>row.bodyProof)}));
  assert.equal(result.records[0].proof.origin.bodyProof.requiredStage,"route-tree-structure");
  assert.equal(result.records[0].proof.origin.bodyProof.metadataPages,2);
  assert.equal(cleanBrowserFailureEvidence(JSON.parse(JSON.stringify(result)),1),true);
  for(const mutate of [i=>i.failures[0].requestHeadersKnown=false,i=>i.proxy[1].canceled=true,i=>i.proxy[0].complete=false,
    i=>i.proxy[0].bodyProof.routeTreeBinding.requestKeySha256=sha("/_head"),i=>i.proxy[1].bodyProof.routeTreeBinding.compiledBuild="a".repeat(40),
    i=>i.responses[0].bodyProof.metadataPages=0,i=>i.responses[0].bodyProof.routeTreeBinding.responseDeploymentSha256="0".repeat(64),
    i=>i.responses[0].bodyReadbackReceipt.bodySha256="0".repeat(64),i=>i.proxy[0].bodyProof.serverErrors=1]){
    const bad=routeTreeFixture().input;mutate(bad);assert.equal(classifyControlCancellations(bad).provenControls,0);
  }
});

test("Native forward-image equality keeps original Flight proof distinct from unknown CDP text parsing",()=>{
  const {input,original}=projectionFixture(),result=classifyControlCancellations(input);
  assert.equal(result.provenControls,1,JSON.stringify(result.records));
  assert.equal(result.records[0].proof.byteCorrespondence.kind,"windows-1252-forward-image");
  assert.equal(result.records[0].proof.cached.bodyProof.complete,false);
  assert.equal(result.records[0].proof.origin.bodyProof.complete,true);
  assert.equal(result.records[0].proof.byteCorrespondence.originalBytes,original.length);
  assert.equal(cleanBrowserFailureEvidence(JSON.parse(JSON.stringify(result)),1),true);
  const tampered=JSON.parse(JSON.stringify(result));tampered.records[0].proof.byteCorrespondence.kind="exact";
  assert.equal(cleanBrowserFailureEvidence(tampered,1),false);
});

test("Native forward-image proof rejects missing decoder, final data, original protocol or byte correspondence premises",()=>{
  const cases=[
    i=>delete i.responses[0].browserDataLedger,i=>i.responses[0].browserDataLedger.invalidData=true,
    i=>i.responses[0].browserDataLedger.dataAfterTerminal=1,i=>i.responses[0].browserDataLedger.finishedEvents=2,
    i=>i.responses[0].browserDataLedger.dataBeforeResponse=1,i=>i.responses[0].browserDataLedger.responseAfterTerminal=1,i=>i.responses[0].browserDataLedger.terminalBeforeResponse=1,
    i=>i.responses[0].browserDataLedger.failedEvents=1,i=>i.responses[0].browserDataLedger.responseEvents=2,
    i=>i.responses[0].browserDataLedger.observedDataLength++,i=>i.responses[0].browserDataLedger.requestObserved=false,
    i=>i.responses[0].failed=true,i=>i.responses[0].ambiguousRedirect=true,
    i=>i.responses[0].bodyReadbackReceipt.observedDataLengthAtReadback++,i=>i.responses[0].bodyReadbackReceipt.terminal="failed",
    i=>i.responses[0].bodyReadbackReceipt.base64Encoded=true,i=>i.responses[0].bodyReadbackReceipt.utf16CodeUnitLength++,
    i=>delete i.responses[0].bodyReadbackReceipt.effectiveCdpResponse,i=>i.responses[0].bodyReadbackReceipt.effectiveCdpResponse.charset="utf-8",
    i=>i.responses[0].responseContentType.charset="utf-8",i=>i.responses[0].responseContentType.mime="other",i=>i.responses[0].bodyReadbackReceipt.responseContentType.headerKnown=false,
    i=>i.responses[0].bodyReadbackReceipt.effectiveCdpResponse.charsetKnown=false,i=>i.responses[0].bodyReadbackReceipt.effectiveCdpResponse.mime="other",
    i=>i.proxy[0].transportBodyReceipt.cdpTextProjection.sourceRevision="0".repeat(40),i=>i.proxy[0].transportBodyReceipt.cdpTextProjection.mappingSha256="0".repeat(64),
    i=>i.proxy[0].transportBodyReceipt.cdpTextProjection.outputCodeUnits++,i=>i.proxy[1].transportBodyReceipt.cdpTextProjection.utf8Sha256="0".repeat(64),
    i=>i.proxy[0].bodyProof.complete=false,i=>i.proxy[0].bodyProof.serverErrors=1,i=>i.responses[0].observedProtocolError={serverErrors:1,explicitActionFailure:false},
    i=>i.responses[0].bodyProof.bodySha256="0".repeat(64),i=>i.responses[0].bodyProof.decodedBytes=1,
    i=>i.responses[0].bodyProof={complete:false,explicitActionFailure:true},i=>i.responses[0].initialSegmentResponse={...i.responses[0],responseHeaderSnapshotKnown:false},
  ];
  for(let index=0;index<cases.length;index++){
    const {input}=projectionFixture();cases[index](input);
    assert.equal(classifyControlCancellations(input).provenControls,0,String(index));
  }
});

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
    i=>i.responses[0].initialSegmentResponse={...i.responses[0],status:500},i=>i.responses[0].requestHeaderSnapshotKnown=false,
    i=>i.failures[0].extraHeaderIdentity.purposeHeaderPresent=true,i=>i.failures[0].extraHeaderIdentity.secPurposeHeaderPresent=true,
    i=>i.proxy[1].complete=false,i=>i.proxy[1].canceled=true,i=>i.nativeContext.headerCensus.closed=false,i=>i.nativeContext.principalEpoch.after.sha256="0".repeat(64)]){
    const {input}=fixture();mutate(input);const result=classifyControlCancellations(input);assert.equal(result.provenControls,0);assert.equal(result.unknownFailures,1);
  }
  for(const source of ["initialHeaderIdentity","extraHeaderIdentity"]){
    for(const [field,value] of [["rsc",false],["prefetch",false],["action",true],["purposeHeaderPresent",true],["secPurposeHeaderPresent",true]]){
      const {input}=fixture();input.failures[0][source][field]=value;
      assert.equal(classifyControlCancellations(input).provenControls,0,source+":"+field);
    }
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
 for(const mode of ["exact","projection","route-tree"]){
  const setup=mode==="exact"?fixture():mode==="projection"?projectionFixture():routeTreeFixture(),{input,io}=setup,bytes=setup.original ?? setup.bytes,ctx=input.nativeContext;
  const proxy=createProxyControlCollector({contextId:ctx.contextId,origin:io.origin,compiledCachedNavigations:true,compiledBinding:ctx.binding});
  proxy.installed(ctx.headerLifetime.installation);
  const collector=createBrowserControlCollector({contextId:ctx.contextId,origin:io.origin,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledBinding:ctx.binding,
    protocolSources:protocol,operatorFile:"run-baseline.mjs",principalEpoch:io.principal,environmentObservation:()=>ctx.environment,proxyObservation:proxy.snapshot,
    readBody:async id=>{if(id!=="cached")throw Error("Synthetic native response body unavailable");return{body:mode==="projection"?bytes.toString("latin1"):bytes.toString(),base64Encoded:false};}});
  collector.installed();
  const request=(id,type,timestamp)=>({requestId:id,loaderId:"loader",timestamp,type,initiator:{type:type==="Fetch"?"script":"other"},request:{url:io.url,method:"GET",headers:io.initial,initialPriority:"VeryLow"}});
  proxy.request(io.originalId,{url:io.url,method:"GET",headers:io.originalHeaders,traceId:"a".repeat(32)});proxy.response(io.originalId,{status:200,headers:io.response});proxy.bytes(io.originalId,bytes);proxy.end(io.originalId);
  collector.request(request("cached","Fetch",1));collector.response({requestId:"cached",response:{status:200,headers:{...io.response,[controlResponseHeader]:io.originalId},fromDiskCache:true,fromServiceWorker:false,mimeType:"text/x-component",charset:""}});
  collector.data({requestId:"cached",dataLength:bytes.length});collector.finished({requestId:"cached",timestamp:2});await tick();await tick();
  collector.beginMeasurement();
  proxy.request(io.currentId,{url:io.url,method:"GET",headers:io.wire,traceId:"a".repeat(32)});proxy.response(io.currentId,{status:200,headers:io.response});proxy.bytes(io.currentId,bytes);proxy.end(io.currentId);
  collector.request(request("native","Other",3));collector.requestExtra({requestId:"native",headers:io.wire});collector.responseExtra({requestId:"native",statusCode:200,headers:{...io.response,[controlResponseHeader]:io.currentId}});
  collector.recordMeasuredFailure("native");collector.failed({requestId:"native",errorText:"net::ERR_ABORTED",canceled:true});collector.endMeasurement();collector.endScope();
  await tick();await tick();proxy.transportClosed(ctx.headerLifetime.closure);
  const result=collector.snapshot();
  assert.equal(result.measured.provenControls,1,JSON.stringify(result.diagnostics.failures));
  assert.equal(result.measured.unknownFailures,0);
  assert.equal(result.measured.records[0].proof.byteCorrespondence.kind,mode==="projection"?"windows-1252-forward-image":"exact");
  assert.equal(cleanBrowserContextEvidence(ctx.contextId,JSON.parse(JSON.stringify(result)),1,{runtime:{build:ctx.binding.compiledBuild,browserControl:ctx.binding},protocolSources:protocol,origin:io.origin}),true);
  if(mode==="projection"){
    collector.data({requestId:"cached",dataLength:0});const after=collector.snapshot();
    assert.equal(after.measured.provenControls,0,"later actual data invalidates the formerly complete correspondence");
    assert.equal(after.measured.rawFailedRequests,1);
    assert.equal(after.bodyReceipts.find(row=>row.requestId==="cached").bodyReadbackReceipt.observedDataLengthAtReadback,bytes.length);
  }
 }
});

async function openPrefixFixture(){
 const api=await import("./control-cancellation-evidence.mjs");
 const censusApi=await import("./proxy-header-census.mjs");
 const {input,io}=fixture();
 const final=classifyControlCancellations(input);assert.equal(final.provenControls,1);
 const closedContext=structuredClone(input.nativeContext),context=input.nativeContext;
 context.operatorFile="mixed-load-probe.mjs";context.protocolSources={...context.protocolSources,"mixed-load-probe.mjs":sha("synthetic-mixed-source")};
 context.protocolErrors.scopeClosed=false;context.environment.workerTargets.scopeClosed=false;
 const principal=createPrincipalEpochObserver(context.contextId,{origin:io.origin}),cookies=[{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}];principal.start(cookies);context.principalEpoch=principal.snapshot();
 context.environment.endRead=null;context.headerLifetime.closure=null;
 const census=createProxyHeaderCensus({contextId:context.contextId}),life=censusApi.createProxyHeaderLifecycle({proxyInstanceId:"f".repeat(32),originSha256:context.originSha256,allowedOriginSha256:[context.originSha256]});
 for(let n=1;n<=2;n++){const rid="a".repeat(32)+"."+n;census.accepted(rid);life.accepted(rid,context.originSha256);life.upstreamCreated(rid);life.headersReceived(rid);census.headers(rid,io.response);life.headersForwarded(rid);life.upstreamClosed(rid);}
 context.headerCensus=census.snapshot();context.headerPrefix=censusApi.proxyHeaderPrefix(census.snapshot(),life.snapshot());
 context.documentJournal={protocol:"actual-cdp-document-journal-v1",contextId:context.contextId,installed:true,currentGeneration:4,executionEventOrdinal:1,documentEventOrdinal:1,errors:0,overflow:0,closed:false,executionEvents:[{ordinal:1,event:"created",executionContextId:1,uniqueId:"actual-context-unique",frameId:"frame",isDefault:true}],documents:[{ordinal:1,requestId:"document",frameId:"frame",loaderId:"loader",originSha256:context.originSha256,documentGeneration:context.contextId+":4"}]};
 input.coverage.scopeClosed=false;input.browserEventOrdinal=12;
 const begin=api.mixedNativeProgressInput(input);principal.progressStarted(1);const principalRead=principal.progressFinished(1,cookies);context.principalEpoch=principal.snapshot();
 const ack={...closedContext.environment.endRead,protocol:"native-environment-progress-readonly-v1",contextId:context.contextId,checkpointOrdinal:1,principalRead,principalReadOperation:principal.progressOperation(1),startedAtMs:100,finishedAtMs:101,elapsedMs:1,deadlineMs:110,deadlineBudgetMs:10,
 document:{protocol:"actual-cdp-document-acknowledgment-v1",contextId:context.contextId,frameId:"frame",loaderId:"loader",executionContextUniqueId:"actual-context-unique",executionContextId:1,documentRequestId:"document",documentGeneration:4,actualDocumentIdentityStable:true,originSha256:context.originSha256,executionEventOrdinalBefore:1,executionEventOrdinalAfter:1,documentEventOrdinalBefore:1,documentEventOrdinalAfter:1}};
 ack.document.sourceJournal=structuredClone(context.documentJournal);
 const end=api.mixedNativeProgressInput(input);
 return {api,censusApi,input,io,closedContext,context,begin,end,ack,life};
}

test("acknowledged Native prefixes recompute the natural-EOF core but never satisfy final closed evidence",async()=>{
 const {api,input,closedContext,context,begin,end,ack}=await openPrefixFixture();
 const receipt=api.createMixedNativePrefix({checkpointOrdinal:1,begin,end,acknowledgment:ack,headerPrefix:context.headerPrefix,returnedAtMs:101});
 assert.equal(api.validateMixedNativePrefix(JSON.parse(JSON.stringify(receipt))),true);
 assert.equal(classifyControlCancellations(input).provenControls,0,"open authority never passes final Native proof");
 assert.equal(cleanBrowserFailureEvidence(receipt,1),false);
 for(const mutate of [r=>delete r.acknowledgment.principalReadOperation,r=>r.acknowledgment.principalReadOperation.acknowledgmentOrdinal=2,r=>r.end.failures.push({...r.end.failures[0],requestId:"new-failure"}),r=>r.end.proxy[1].complete=false,r=>r.end.proxy[1].canceled=true,r=>r.end.proxy[1].bodyProof.serverErrors=1,r=>r.acknowledgment.principalRead.sha256="0".repeat(64),r=>r.acknowledgment.controller.controllerIdentityStable=false,r=>r.acknowledgment.document.executionEventOrdinalAfter++,r=>r.acknowledgment.document.actualDocumentIdentityStable=false,r=>r.acknowledgment.document.contextId="foreign",r=>r.acknowledgment.readErrors=1,r=>r.acknowledgment.pendingOperations=1,r=>r.acknowledgment.publicSourceRecheck.files[0].sha256="0".repeat(64),r=>r.end.protocolSources={},r=>r.end.nativeContext.protocolErrors.observed=1,r=>r.headerPrefix.census.counts.setCookieLines=1,r=>r.end.nativeContext.environment.workerTargets.events.push({type:"shared_worker"})]){
  const bad=structuredClone(receipt);mutate(bad);const {prefixSha256,...facts}=bad;bad.prefixSha256=sha(JSON.stringify(facts));assert.equal(api.validateMixedNativePrefix(bad),false);
 }
 assert.equal(classifyControlCancellations({...input,nativeContext:closedContext,coverage:{...input.coverage,scopeClosed:true}}).provenControls,1,"the unchanged final authority still admits the synthetic closed positive");
});

test("progress cookie reads carry bounded read-only ownership without closing the principal epoch",()=>{
 const observer=createPrincipalEpochObserver("ctx",{origin:"http://localhost:1234"});
 const cookies=[{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}];observer.start(cookies);
 observer.progressStarted(1);observer.progressStarted(2);
 const own=observer.progressFinished(1,cookies),cut=observer.snapshot();
 assert.equal(own.known,true);assert.equal(cut.scopeClosed,false);assert.equal(cut.after.known,false);
 assert.equal(cut.pendingReads,1);assert.deepEqual(cut.progressReads.pending,[{acknowledgmentOrdinal:2,kind:"read-only-context-cookies-v1"}]);
 assert.equal(cut.progressReads.started-cut.progressReads.finished,1);
 observer.progressFailed(2);assert.equal(observer.snapshot().readErrors,1);assert.equal(observer.snapshot().pendingReads,0);
 observer.progressStarted(1);assert.equal(observer.snapshot().observationErrors,1,"an acknowledgment cannot reuse another read's ownership");
 observer.end(cookies);assert.equal(observer.snapshot().scopeClosed,true);
});

test("mixed progress acknowledgments stop on genuine or incomplete work before metadata and seal exact return IDs",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs");
 const {api,begin,end,ack,life}=await openPrefixFixture();
 const application=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 let current=structuredClone(begin),reads=0;
 const acquire=async({checkpointOrdinal,deadlineMs})=>{reads++;current.nativeContext.principalEpoch=structuredClone(end.nativeContext.principalEpoch);const startedAtMs=performance.now(),finishedAtMs=startedAtMs+0.01;return {...structuredClone(ack),checkpointOrdinal,startedAtMs,finishedAtMs,elapsedMs:finishedAtMs-startedAtMs,deadlineMs,deadlineBudgetMs:deadlineMs-startedAtMs};};
 const observer=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application,acknowledge:acquire});
 const token=await observer.check();assert.equal(observer.confirm(token),true);assert.equal(reads,1);
 life.close();const finalInputs={failureIds:["native"],nativeFailureIds:["native"],browserEventOrdinal:12,failureOccurrences:api.mixedFailureOccurrenceCensus({contextId:begin.nativeContext.contextId,scopeClosed:true,browserEventOrdinal:12,records:[{requestId:"native",eventOrdinal:9,failedEvents:1}]}),headerLifecycle:life.snapshot(),documentJournal:{...structuredClone(ack.document.sourceJournal),closed:true}};
 const finalContext=structuredClone(current.nativeContext);finalContext.principalEpoch.scopeClosed=true;finalContext.environment.workerTargets.scopeClosed=true;
 assert.equal(api.validateMixedProgressObservations(observer.snapshot(),finalContext,finalInputs),true);
 for(const edit of [v=>delete v.checks,v=>v.checks.pop(),v=>v.contextId="another-context",v=>v.checks[0].prefixSha256=null,v=>v.prefixes.pop(),v=>v.checks[0].returned.headerEventOrdinal=999,v=>v.authoritySha256="0".repeat(64)]){const bad=structuredClone(observer.snapshot());edit(bad);assert.equal(api.validateMixedProgressObservations(bad,finalContext,finalInputs),false); }
 const ownPending=structuredClone(observer.snapshot().prefixes[0]);
 const parallel=createPrincipalEpochObserver(begin.nativeContext.contextId,{origin:"http://localhost:1234"}),cookies=[{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}];parallel.start(cookies);parallel.progressStarted(2);ownPending.begin.nativeContext.principalEpoch=parallel.snapshot();parallel.progressStarted(1);ownPending.acknowledgment.principalRead=parallel.progressFinished(1,cookies);ownPending.acknowledgment.principalReadOperation=parallel.progressOperation(1);ownPending.end.nativeContext.principalEpoch=parallel.snapshot();
 const rehash=p=>{const {prefixSha256,...facts}=p;p.prefixSha256=sha(JSON.stringify(facts));};rehash(ownPending);assert.equal(api.validateMixedNativePrefix(ownPending),true,"other explicitly owned read-only cookie reads need no mutex");
 for(const edit of [p=>p.end.nativeContext.principalEpoch.progressReads.pending[0].acknowledgmentOrdinal=1,p=>delete p.end.nativeContext.principalEpoch.progressReads,p=>p.end.nativeContext.principalEpoch.progressReads.pending[0].kind="unknown",p=>p.acknowledgment.pendingOperations=1]){const bad=structuredClone(ownPending);edit(bad);rehash(bad);assert.equal(api.validateMixedNativePrefix(bad),false);}
 current=structuredClone(begin);const race=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application,acknowledge:acquire});const beforeNewFailure=await race.check();current.failures.push({...current.failures[0],requestId:"new-id"});assert.throws(()=>race.confirm(beforeNewFailure),/New mixed/);assert.equal(race.snapshot().failed,1);
 for(const edit of [v=>v.proxy[1].complete=false,v=>v.proxy[1].canceled=true,v=>v.failures[0].error="net::ERR_FAILED",v=>v.proxy[1].bodyProof.serverErrors=1]){
  const v=structuredClone(begin);edit(v);let calls=0;const o=createMixedProgressAcknowledgments({input:()=>v,application,acknowledge:async()=>{calls++;return ack;}});await assert.rejects(o.check());assert.equal(calls,0);
 }
 let calls=0;const unknown=createMixedProgressAcknowledgments({input:()=>begin,application:()=>({...application(),unknown:1}),acknowledge:async()=>{calls++;return ack;}});await assert.rejects(unknown.check());assert.equal(calls,0);
 const changed=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application,acknowledge:async args=>{current.failures.push({...current.failures[0],requestId:"late-id"});return acquire(args);}});
 current=structuredClone(begin);await assert.rejects(changed.check());assert.equal(changed.snapshot().failed,1);
});

test("live mixed guard tokens cannot be copied or borrowed even for zero-failure fast guards",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{begin}=await openPrefixFixture();
 const input=structuredClone(begin);input.failures=[];input.responses=[];input.proxy=[];
 const application=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 const one=createMixedProgressAcknowledgments({input:()=>input,application,acknowledge:()=>assert.fail("no Native candidate may read metadata")});
 const token=await one.check();assert.throws(()=>one.confirm({...token}),/acknowledgment/);
 const other=createMixedProgressAcknowledgments({input:()=>input,application,acknowledge:()=>assert.fail("fast guard")});
 const own=await other.check();assert.throws(()=>other.confirm(token),/acknowledgment/);assert.equal(other.snapshot().failed,1);assert.equal(own.contextId,input.nativeContext.contextId);
});

test("acknowledged document fields must join their observed Runtime/Document source records",async()=>{
 const {api,begin,end,ack,context}=await openPrefixFixture();
 const receipt=api.createMixedNativePrefix({checkpointOrdinal:1,begin,end,acknowledgment:ack,headerPrefix:context.headerPrefix,returnedAtMs:101});
 const bad=structuredClone(receipt);bad.acknowledgment.document.loaderId="another-loader";const {prefixSha256,...facts}=bad;bad.prefixSha256=sha(JSON.stringify(facts));assert.equal(api.validateMixedNativePrefix(bad),false);
});

test("return cuts reject invalid worker and document authority observed while another context is awaiting",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs");
 for(const mutate of [v=>v.nativeContext.environment.workerTargets.events.push({type:"service_worker",event:"created",targetOrdinal:3,urlKnown:true,urlSha256:"f".repeat(64),ownedWorkerScript:false,originMatches:false}),v=>v.nativeContext.environment.workerTargets.errors++,v=>v.nativeContext.environment.workerTargets.scopeClosed=true,v=>v.nativeContext.documentJournal.currentGeneration++,v=>v.nativeContext.documentJournal.documents[0].loaderId="new-loader",v=>v.nativeContext.documentJournal.executionEvents[0].uniqueId="another-context",v=>v.nativeContext.environment.servingPublicSources.files[0].sha256="0".repeat(64),v=>v.nativeContext.principalEpoch.progressReads.records[0].snapshotSha256="0".repeat(64)]){
  const {begin,end,ack}=await openPrefixFixture();let current=structuredClone(begin);
  const app=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
  const observer=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application:app,acknowledge:async({checkpointOrdinal,deadlineMs})=>{current.nativeContext.principalEpoch=structuredClone(end.nativeContext.principalEpoch);const startedAtMs=performance.now(),finishedAtMs=startedAtMs+0.01;return {...structuredClone(ack),checkpointOrdinal,startedAtMs,finishedAtMs,elapsedMs:finishedAtMs-startedAtMs,deadlineMs,deadlineBudgetMs:deadlineMs-startedAtMs};}});
  const token=await observer.check();mutate(current);assert.throws(()=>observer.confirm(token));assert.equal(observer.snapshot().failed,1);
 }
});

test("final failure occurrences reject erased same-cut Native guards but preserve genuinely later closed controls",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{api,begin,end,ack,life}=await openPrefixFixture();
 const current=structuredClone(begin);current.failures=[];
 const app=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 const observer=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application:app,acknowledge:()=>assert.fail("fast guard must not read")});const token=await observer.check();observer.confirm(token);life.close();
 const context=structuredClone(end.nativeContext);context.principalEpoch.scopeClosed=true;context.environment.workerTargets.scopeClosed=true;
 const makeCensus=(eventOrdinal,last)=>{const facts={protocol:"actual-browser-failed-occurrence-census-v1",contextId:context.contextId,scopeClosed:true,browserEventOrdinal:last,records:[{requestId:"native",eventOrdinal,failedEvents:1}]};return {...facts,censusSha256:sha(JSON.stringify(facts))};};
 const inputs={failureIds:["native"],nativeFailureIds:["native"],browserEventOrdinal:12,headerLifecycle:life.snapshot(),documentJournal:{...structuredClone(ack.document.sourceJournal),closed:true},failureOccurrences:makeCensus(9,12)};
 assert.equal(api.validateMixedProgressObservations(observer.snapshot(),context,inputs),false,"Same-cut failure absence cannot be explained as a later arrival.");
 inputs.browserEventOrdinal=13;inputs.failureOccurrences=makeCensus(13,13);
 assert.equal(api.validateMixedProgressObservations(observer.snapshot(),context,inputs),true,"A genuinely later failure still depends on the independent final closed validator.");
});

async function replayFixtureAfterReturn(){
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{api,begin,end,ack,life,io}=await openPrefixFixture();let current=structuredClone(begin);
 const app=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 const observer=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application:app,acknowledge:async({checkpointOrdinal,deadlineMs})=>{current.nativeContext.principalEpoch=structuredClone(end.nativeContext.principalEpoch);const at=performance.now();return {...structuredClone(ack),checkpointOrdinal,startedAtMs:at,finishedAtMs:at,elapsedMs:0,deadlineMs,deadlineBudgetMs:deadlineMs-at};}});
 const token=await observer.check();observer.confirm(token);
 // These are explicitly later source facts, so all monotone vector dimensions have room for an invalid moved cut.
 const third="a".repeat(32)+".3";life.accepted(third,begin.nativeContext.originSha256);life.upstreamCreated(third);life.headersReceived(third);life.headersForwarded(third);life.upstreamClosed(third);life.close();
 const context=structuredClone(current.nativeContext);context.principalEpoch.scopeClosed=true;context.environment.workerTargets.scopeClosed=true;context.environment.workerTargets.events.push({...context.environment.workerTargets.events[0],event:"changed"});
 const history=context.principalEpoch.progressReads;history.started=2;history.finished=2;history.records.push({...history.records[0],acknowledgmentOrdinal:2,startedOrdinal:2,finishedOrdinal:2});
 const inputs={failureIds:["native"],nativeFailureIds:["native"],browserEventOrdinal:13,headerLifecycle:life.snapshot(),documentJournal:{...structuredClone(ack.document.sourceJournal),closed:true},failureOccurrences:api.mixedFailureOccurrenceCensus({contextId:context.contextId,scopeClosed:true,browserEventOrdinal:13,records:[{requestId:"native",eventOrdinal:9,failedEvents:1}]})};
 const ledger=observer.snapshot();assert.equal(api.validateMixedProgressObservations(ledger,context,inputs),true);
 return {api,ledger,context,inputs};
}

test("a Native returned vector is exactly its sealed end across every component",async()=>{
 const {api,ledger,context,inputs}=await replayFixtureAfterReturn();
 for(const edit of [v=>v.browserEventOrdinal=13,v=>v.headerEventOrdinal++,v=>v.workerEventCount++,v=>v.principalProgressStarted++,v=>v.principalProgressFinished=0,v=>v.failureIds=[]]){
  const moved=structuredClone(ledger);edit(moved.checks[0].returned);moved.retainedBytes=Buffer.byteLength(JSON.stringify(moved.checks))+moved.prefixes.reduce((n,p)=>n+Buffer.byteLength(JSON.stringify(p)),0);
  assert.equal(api.validateMixedProgressObservations(moved,context,inputs),false,"A final-valid later cut is not the actual sealed return cut.");
 }
});

test("every retained prefix failure row agrees with the CORE loadingFailed occurrence",async()=>{
 const {api,ledger,context,inputs}=await replayFixtureAfterReturn();
 const forged=structuredClone(ledger),prefix=forged.prefixes[0];
 prefix.begin.failures[0].failedEventOrdinal=8;prefix.end.failures[0].failedEventOrdinal=8;
 const {prefixSha256,...facts}=prefix;prefix.prefixSha256=sha(JSON.stringify(facts));forged.checks[0].prefixSha256=prefix.prefixSha256;forged.retainedBytes=Buffer.byteLength(JSON.stringify(forged.checks))+forged.prefixes.reduce((n,p)=>n+Buffer.byteLength(JSON.stringify(p)),0);
 assert.equal(api.validateMixedNativePrefix(prefix),true,"The isolated row chronology is internally plausible before the independent census join.");
 assert.equal(api.validateMixedProgressObservations(forged,context,inputs),false,"Same-context same-ID records cannot disagree with the observed callback census.");
});

test("mixed first-failure diagnostics retain the exact pending-EOF cut without changing its rejection",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{begin}=await openPrefixFixture();
 const current=structuredClone(begin);current.coverage.pendingBodies=1;delete current.proxy[1].bodyProof;
 let inputs=0,apps=0,reads=0;const app=()=>{apps++;return {failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0};};
 const observer=createMixedProgressAcknowledgments({input:()=>{inputs++;return current;},application:app,acknowledge:()=>{reads++;assert.fail("pending current proof cannot acknowledge");}});
 await assert.rejects(observer.check(),{message:"Mixed browser observation lacks request-local evidence."});
 const snapshot=observer.snapshot();assert.equal(snapshot.failed,1);assert.equal(snapshot.guardChecks,0);assert.deepEqual([inputs,apps,reads],[1,1,0]);
 assert.equal(snapshot.firstFailure.stage,"check-live");assert.equal(snapshot.firstFailure.subreason,"candidate");
 assert.equal(snapshot.firstFailure.cut.coverage.pendingBodies,1);assert.equal(snapshot.firstFailure.cut.latestFailure.requestIdSha256,sha("native"));
 assert.equal(snapshot.firstFailure.cut.matchingPacket.count,1);assert.equal(snapshot.firstFailure.cut.matchingPacket.bodyProofKnown,false);assert.equal(snapshot.firstFailure.cut.matchingPacket.bodyProofComplete,null);
 assert.equal(snapshot.firstFailure.predicates.journalsKnown,true);assert.equal(snapshot.firstFailure.predicates.candidateKnown,false);
 assert.ok(snapshot.retainedBytes>=32768);assert.doesNotMatch(JSON.stringify(snapshot.firstFailure),/synthetic|http:|session|net::|PRIVATE/);
 const first=structuredClone(snapshot.firstFailure);current.coverage.pendingBodies=0;current.browserEventOrdinal++;
 await assert.rejects(observer.check(),{message:"Mixed required application observation is not clean."});assert.deepEqual(observer.snapshot().firstFailure,first);
 assert.deepEqual([inputs,apps,reads],[1,1,0],"sticky failure still short-circuits before the old callbacks");
});

test("mixed first-failure diagnostics distinguish confirm, acknowledgment, token and journal stops",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs");
 const app=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 {
  const {begin}=await openPrefixFixture(),current=structuredClone(begin);current.failures=[];let reads=0;
  const observer=createMixedProgressAcknowledgments({input:()=>current,application:app,acknowledge:()=>{reads++;assert.fail("fast");}}),token=await observer.check();
  current.failures=structuredClone(begin.failures);current.coverage.pendingBodies=1;delete current.proxy[1].bodyProof;
  assert.throws(()=>observer.confirm(token),{message:"Mixed browser observation lacks request-local evidence."});assert.equal(reads,0);
  assert.equal(observer.snapshot().firstFailure.stage,"confirm-live");assert.equal(observer.snapshot().firstFailure.cut.coverage.pendingBodies,1);
 }
 {
  const {begin}=await openPrefixFixture(),order=[];
  const observer=createMixedProgressAcknowledgments({input:()=>{order.push("input");return begin;},application:()=>{order.push("application");return app();},acknowledge:async args=>{order.push("acknowledge");return {...args,checkpointOrdinal:args.checkpointOrdinal+1};}});
  await assert.rejects(observer.check(),{message:"Mixed acknowledgment used another read or deadline."});
  assert.deepEqual(order,["application","input","acknowledge"]);assert.equal(observer.snapshot().firstFailure.stage,"ack-identity");
 }
 for(const mode of ["token","journal"]){
  const {begin}=await openPrefixFixture(),current=structuredClone(begin);current.failures=[];
  const observer=createMixedProgressAcknowledgments({input:()=>structuredClone(current),application:app,acknowledge:()=>assert.fail("fast")}),token=await observer.check();
  if(mode==="journal"){const journal=current.nativeContext.documentJournal;journal.executionEventOrdinal=2;journal.executionEvents.push({ordinal:2,event:"created",executionContextId:2,uniqueId:"utility-context",frameId:"frame",isDefault:false});}
  assert.throws(()=>observer.confirm(mode==="token"?{...token}:token));
  assert.equal(observer.snapshot().firstFailure.stage,mode==="token"?"confirm-token":"confirm-journals");
 }
});

test("mixed first-failure diagnostics preserve successful schema and genuine thrown errors without extra getter reads",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{begin}=await openPrefixFixture(),current=structuredClone(begin);current.failures=[];
 const app=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 const success=createMixedProgressAcknowledgments({input:()=>current,application:app,acknowledge:()=>assert.fail("fast")}),token=await success.check();assert.equal(success.confirm(token),true);
 const snapshot=success.snapshot();assert.deepEqual(Object.keys(snapshot).sort(),["protocol","candidateRepresentationProtocol","contextId","authoritySha256","guardChecks","attempted","failed","overflow","retainedBytes","checks","prefixes"].sort());
 assert.equal(snapshot.retainedBytes,Buffer.byteLength(JSON.stringify(snapshot.checks)));assert.equal(snapshot.failed,0);
 const sentinel=Error("PRIVATE_OBSERVER_ERROR");let getterCalls=0,inputs=0;
 const application=app();Object.defineProperty(application,"unknown",{enumerable:true,get(){getterCalls++;throw sentinel;}});
 const failure=createMixedProgressAcknowledgments({input:()=>{inputs++;return current;},application:()=>application,acknowledge:()=>assert.fail("no read")});
 await assert.rejects(failure.check(),error=>error===sentinel);assert.equal(getterCalls,1);assert.equal(inputs,0);
 const diagnostic=failure.snapshot().firstFailure;assert.equal(diagnostic.stage,"check-live");assert.equal(diagnostic.cut,null);assert.equal(diagnostic.application.unknown,null);assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_OBSERVER_ERROR/);
});

test("mixed first-failure diagnostic privacy and fixed retention cover the maximum bounded event projection",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{begin}=await openPrefixFixture(),current=structuredClone(begin);
 const privateId="PRIVATE_EVENT_ID_"+"x".repeat(180);current.browserEventOrdinal=10000;
 current.failures=Array.from({length:10000},(_,i)=>({requestId:privateId+i,proxyResponseId:"PRIVATE_PROXY",failedEventOrdinal:i+1,failedEvents:Number.MAX_SAFE_INTEGER,status:Number.MAX_SAFE_INTEGER,failed:true,loadingFinished:false,canceled:true,error:"PRIVATE_REASON".repeat(300),bodyProof:{complete:false,reason:"PRIVATE_BODY_REASON".repeat(200)}}));
 current.proxy=[{id:"PRIVATE_PROXY",complete:false,canceled:false,upstreamError:false,responseEvents:Number.MAX_SAFE_INTEGER,bodyProof:{complete:false,reason:"PRIVATE_PACKET_REASON".repeat(190)}}];current.coverage.pendingBodies=Number.MAX_SAFE_INTEGER;
 const observer=createMixedProgressAcknowledgments({input:()=>current,application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:()=>assert.fail("invalid current proof")});
 await assert.rejects(observer.check());const snapshot=observer.snapshot(),diagnostic=snapshot.firstFailure;
 assert.equal(diagnostic.cut.failureCount,10000);assert.equal(diagnostic.cut.latestFailure.failedEventOrdinal,10000);assert.equal(diagnostic.cut.latestFailure.requestIdSha256,sha(privateId+9999));
 assert.equal(diagnostic.cut.matchingPacket.count,1);assert.equal(diagnostic.cut.matchingPacket.bodyProofComplete,false);assert.ok(Buffer.byteLength(JSON.stringify(diagnostic))*8+2048<=32768);assert.equal(snapshot.retainedBytes,32768+2);assert.equal(snapshot.overflow,0);
 assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_|http:|cookie|payload/);
 diagnostic.cut.coverage.pendingBodies=0;assert.equal(observer.snapshot().firstFailure.cut.coverage.pendingBodies,Number.MAX_SAFE_INTEGER,"snapshot edits cannot alter the retained first failure");
});

test("mixed first-failure diagnostics reset the per-live input and predicates after acknowledgment",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{begin}=await openPrefixFixture();
 let unknown=0,inputs=0,applications=0,reads=0;
 const observer=createMixedProgressAcknowledgments({input:()=>{inputs++;return structuredClone(begin);},application:()=>{applications++;return {failures:0,serverErrors:0,unknown,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0};},acknowledge:async args=>{reads++;unknown=1;return args;}});
 await assert.rejects(observer.check(),{message:"Mixed required application observation is not clean."});
 const snapshot=observer.snapshot(),diagnostic=snapshot.firstFailure;
 assert.deepEqual([inputs,applications,reads],[1,2,1]);assert.equal(snapshot.failed,1);
 assert.equal(diagnostic.stage,"check-after-ack-live");assert.equal(diagnostic.subreason,"application");assert.equal(diagnostic.cut,null);assert.equal(diagnostic.cutStage,null);
 assert.equal(diagnostic.application.unknown,1);assert.equal(diagnostic.predicates.applicationKnown,false);assert.equal(diagnostic.candidate,null);
 for(const key of ["candidateKnown","authorityKnown","journalsKnown","protocolObservedZero","protocolOverflowZero","authorityMatches","returnJournalsKnown"])assert.equal(diagnostic.predicates[key],null,key);
});

test("mixed first-failure diagnostics reject revoked arrays before introspection and never relabel the first stop",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),revoked=Proxy.revocable([],{});revoked.revoke();let inputs=0;
 const observer=createMixedProgressAcknowledgments({input:()=>{inputs++;return {failures:revoked.proxy,proxy:[],coverage:{},nativeContext:{}};},application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:()=>assert.fail("not reached")});
 await assert.rejects(observer.check(),{message:"Mixed browser observation lacks request-local evidence."});const first=observer.snapshot();
 assert.equal(first.failed,1);assert.equal(first.overflow,0);assert.equal(first.firstFailure.stage,"check-live");assert.equal(first.firstFailure.cutStage,"check-live");assert.equal(first.firstFailure.cut.failureCount,null);
 await assert.rejects(observer.check(),{message:"Mixed required application observation is not clean."});const second=observer.snapshot();assert.equal(inputs,1);assert.equal(second.failed,2);assert.equal(second.overflow,0);assert.deepEqual(second.firstFailure,first.firstFailure);
});

test("mixed candidate rejection diagnostics identify the earlier strict match failure rather than the newest row",async()=>{
 const {createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),{begin}=await openPrefixFixture(),current=structuredClone(begin);
 const earlier={...structuredClone(current.failures[0]),requestId:"PRIVATE_EARLIER",failedEventOrdinal:9,fullUrlSha256:"f".repeat(64)},latest={...structuredClone(current.failures[0]),requestId:"PRIVATE_LATEST",failedEventOrdinal:10};current.failures=[earlier,latest];
 const observer=createMixedProgressAcknowledgments({input:()=>current,application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:()=>assert.fail("must stop on the first strict join")});
 await assert.rejects(observer.check(),{message:"Mixed browser observation lacks request-local evidence."});
 const diagnostic=observer.snapshot().firstFailure;assert.equal(diagnostic.cut.latestFailure.requestIdSha256,sha("PRIVATE_LATEST"));
 assert.equal(diagnostic.candidate.site,"proxy-cardinality");assert.equal(diagnostic.candidate.failureIndex,0);assert.equal(diagnostic.candidate.failureIdSha256,sha("PRIVATE_EARLIER"));assert.equal(diagnostic.candidate.strictMatchCount,0);
 assert.equal(diagnostic.candidate.ordinaryOutcome,"unknown");assert.equal(diagnostic.candidate.firstMatchedProofKnown,null);assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_/);
 assert.ok(Buffer.byteLength(JSON.stringify(diagnostic))*8+2048<=32768);
});

test("mixed candidate rejection hooks cover every existing null exit with unchanged defaults and safe failures",async()=>{
 const {api,begin}=await openPrefixFixture();
 const cases=[
  ["input-prelude",()=>undefined],
  ["failure-census",()=>{const x=structuredClone(begin);x.failures[0].failedEventOrdinal=0;return x;}],
  ["real-failure",()=>{const x=structuredClone(begin);x.failures[0].error="net::ERR_FAILED";return x;}],
  ["failure-flags",()=>{const x=structuredClone(begin);x.failures[0].error="PRIVATE_UNKNOWN_ERROR";return x;}],
  ["proxy-cardinality",()=>{const x=structuredClone(begin);x.proxy[1].requestHeadersSha256="f".repeat(64);return x;}],
  ["native-core",()=>{const x=structuredClone(begin);x.proxy[1].complete=false;return x;}],
  ["exception",()=>{const x=Proxy.revocable({},{});x.revoke();return x.proxy;}],
 ];
 for(const [site,make]of cases){
  assert.equal(api.mixedNativePrefixCandidates(make()),null);const observations=[];
  assert.equal(api.mixedNativePrefixCandidates(make(),row=>observations.push(row)),null);assert.equal(observations.length,1,site);assert.equal(observations[0].site,site);
  assert.doesNotMatch(JSON.stringify(observations),/PRIVATE_|http:|session|net::/);
  assert.equal(api.mixedNativePrefixCandidates(make(),()=>{throw Error("PRIVATE_HOOK");}),null);
 }
 const positive=api.mixedNativePrefixCandidates(structuredClone(begin));let calls=0;
 assert.deepEqual(api.mixedNativePrefixCandidates(structuredClone(begin),()=>{calls++;throw Error("not called");}),positive);assert.equal(calls,0);
 const hook=Proxy.revocable(()=>assert.fail("Proxy hook may not execute"),{});hook.revoke();assert.equal(api.mixedNativePrefixCandidates(undefined,hook.proxy),null);
 const invalid=cases[4][1]();assert.equal(api.mixedNativePrefixCandidates(invalid,()=>{invalid.failures=[];}),null,"a hook cannot turn the decided rejection into success");
});

test("mixed candidate rejection hooks reuse the same classification and strict filter without new getter reads",async()=>{
 const {api,begin}=await openPrefixFixture();
 function run(observe){const input=structuredClone(begin);input.proxy[1].complete=false;let errorReads=0;const value=input.failures[0].error;Object.defineProperty(input.failures[0],"error",{enumerable:true,get(){errorReads++;return value;}});let row=null;
  const result=api.mixedNativePrefixCandidates(input,observe?value=>{row=value;}:undefined);assert.equal(result,null);return{errorReads,row};}
 const plain=run(false),observed=run(true);assert.equal(observed.errorReads,plain.errorReads);assert.equal(plain.errorReads,0);assert.equal(observed.row.site,"input-prelude");assert.equal(observed.row.strictMatchCount,null);assert.equal(observed.row.firstMatchedProxyIdSha256,null);
});

test("mixed candidate representation accepts compressible logical input over4MiB and rejects cyclic input",async()=>{
 const {api,begin}=await openPrefixFixture(),oversized=structuredClone(begin);oversized.proxy[1].padding="PRIVATE_SERIALIZED_"+"x".repeat(4*1024*1024);
 const encodedBytes=Buffer.byteLength(JSON.stringify(oversized)),oversize=[];assert.ok(encodedBytes>4*1024*1024);
 assert.ok(api.mixedNativePrefixCandidates(oversized,row=>oversize.push(row)));assert.equal(oversize.length,0);
 const cyclic=structuredClone(begin);cyclic.proxy[1].cycle=cyclic;const cycle=[];assert.equal(api.mixedNativePrefixCandidates(cyclic,row=>cycle.push(row)),null);
 assert.deepEqual(cycle[0].serialization,{protocol:"mixed-progress-technical-gzip-v1",serialized:null,logicalBytes:null,encodedBytes:null,withinLimit:null,outcome:"representation-rejected"});
 assert.doesNotMatch(JSON.stringify([oversize,cycle]),/PRIVATE_|padding|cycle|http:|session/);
});

test("mixed candidate serialization facts remain unknown before the original digest and preserve default success",async()=>{
 const {api,begin}=await openPrefixFixture(),early=[];assert.equal(api.mixedNativePrefixCandidates(undefined,row=>early.push(row)),null);assert.equal(early[0].serialization,null);
 const input=structuredClone(begin);input.failures[0].failedEventOrdinal=0;const expectedBytes=Buffer.byteLength(JSON.stringify(input)),rows=[];
 assert.equal(api.mixedNativePrefixCandidates(input,row=>{rows.push(row);throw Error("PRIVATE_OBSERVER");}),null);assert.equal(rows.length,1);assert.equal(rows[0].site,"failure-census");
 assert.equal(rows[0].serialization.protocol,"mixed-progress-technical-gzip-v1");assert.equal(rows[0].serialization.logicalBytes,expectedBytes);assert.equal(rows[0].serialization.serialized,true);assert.equal(rows[0].serialization.withinLimit,true);assert.equal(rows[0].serialization.outcome,"complete");assert.ok(Number.isSafeInteger(rows[0].serialization.encodedBytes)&&rows[0].serialization.encodedBytes>=48&&rows[0].serialization.encodedBytes<=4194304);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_OBSERVER/);
 assert.deepEqual(api.mixedNativePrefixCandidates(structuredClone(begin)),api.mixedNativePrefixCandidates(structuredClone(begin),()=>assert.fail("positive candidate has no rejection hook")));
});

test("source-bound digest serialization diagnostics report once and preserve encoding, hashing and callback failures",async()=>{
 const {readFile}=await import("node:fs/promises"),{types}=await import("node:util"),source=await readFile(new URL("./control-cancellation-evidence.mjs",import.meta.url),"utf8");
 const start=source.indexOf("const nativeContextDigest ="),end=source.indexOf("\n};",start)+4;assert.ok(start>0&&end>start);const definition=source.slice(start,end);
 for(const mode of ["success","stringify","encode","hash"]){
  const calls={stringify:0,encode:0,hash:0},observed=[],value={technical:true};
  const encode={from:text=>{calls.encode++;if(mode==="encode")throw Error("PRIVATE_ENCODE");return Buffer.from(text);}},json={stringify:input=>{calls.stringify++;if(mode==="stringify")throw Error("PRIVATE_STRINGIFY");return JSON.stringify(input);}},bodyHash=bytes=>{calls.hash++;if(mode==="hash")throw Error("PRIVATE_HASH");return sha(bytes);};
  // Execute the actual private source, with only its IO-free primitives replaced for genuine fault injection.
  const digest=Function("Buffer","JSON","controlCancellationPolicy","bodySha256","utilTypes",definition+";return nativeContextDigest;")(encode,json,controlCancellationPolicy,bodyHash,types);
  const result=digest(value,row=>{observed.push(row);throw Error("PRIVATE_CALLBACK");});
  assert.equal(observed.length,1,mode);assert.equal(calls.stringify,1);assert.equal(calls.encode,mode==="stringify"?0:1);assert.equal(calls.hash,["stringify","encode"].includes(mode)?0:1);
  assert.equal(result,mode==="success"?sha(Buffer.from(JSON.stringify(value))):null);
  assert.equal(observed[0].outcome,mode==="success"?"complete":mode+"-error");assert.equal(observed[0].serialized,mode!=="stringify");
  assert.equal(observed[0].encodedBytes,["stringify","encode"].includes(mode)?null:Buffer.byteLength(JSON.stringify(value)));assert.equal(observed[0].withinLimit,["stringify","encode"].includes(mode)?null:true);
  assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_|technical/);
 }
});

test("owned fast guards transfer journal facts and release unconsumed and failed tokens on close",async()=>{
 const {createMixedProgressAcknowledgments,createProxyControlCollector}=await import("./browser-control-collector.mjs"),{createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),{begin}=await openPrefixFixture();
 for(const mode of ["confirmed","unconsumed","changed-principal"]){
  const current=structuredClone(begin);current.failures=[];const contextId=current.nativeContext.contextId,proxy=createProxyControlCollector({contextId});proxy.installed();
  const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
  const observer=createMixedProgressAcknowledgments({technicalOwner:owner,input:()=>owner.capture(()=>current),application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:()=>assert.fail("ordinary fast guard does not read metadata")});
  const token=await observer.check();assert.equal(owner.stats().liveCuts,0,"whole begin cut is no longer retained by an ordinary token");
  if(mode==="confirmed")assert.equal(observer.confirm(token),true);
  if(mode==="changed-principal"){current.nativeContext.principalEpoch.observedSetCookieResponses=1;assert.throws(()=>observer.confirm(token));}
  observer.close();const snapshot=observer.snapshot();assert.equal(snapshot.candidateRepresentationProtocol,"mixed-progress-technical-gzip-v1");assert.equal(snapshot.failed===0,mode==="confirmed");assert.ok(owner.stats().retainedBytes>0,"closed evidence remains charged until consumed");
  observer.releaseSnapshot();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);assert.equal(proxy.reserveTemporaryObservation(33554432),true);proxy.releaseTemporaryObservation(33554432);assert.equal(proxy.reserveTemporaryRecords(10000),true);proxy.releaseTemporaryRecords(10000);assert.throws(()=>observer.confirm(token));
 }
});

test("closing an owned pending acknowledgment fails once and late completion cannot revive cut leases",async()=>{
 const {createMixedProgressAcknowledgments,createProxyControlCollector}=await import("./browser-control-collector.mjs"),{createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),{begin,ack}=await openPrefixFixture(),contextId=begin.nativeContext.contextId;
 const proxy=createProxyControlCollector({contextId});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let finish,reads=0,args;
 const observer=createMixedProgressAcknowledgments({technicalOwner:owner,input:()=>owner.capture(()=>begin),application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:value=>{reads++;args=value;return new Promise(resolve=>{finish=resolve;});}});
 const pending=observer.check();assert.equal(reads,1);observer.close();assert.equal(owner.stats().liveCuts,0);finish({...ack,...args});await assert.rejects(pending,/closed/);assert.equal(observer.snapshot().failed,1);observer.releaseSnapshot();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
});

test("owned Native prefix seals its full begin and end and releases only after closed snapshot consumption",async()=>{
 const {createMixedProgressAcknowledgments,createProxyControlCollector}=await import("./browser-control-collector.mjs"),{createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),{api,begin,end,ack}=await openPrefixFixture();
 const contextId=begin.nativeContext.contextId,proxy=createProxyControlCollector({contextId});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let current=begin,reads=0;
 const observer=createMixedProgressAcknowledgments({technicalOwner:owner,input:()=>owner.capture(()=>current),application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:async({checkpointOrdinal,deadlineMs})=>{reads++;current=end;const startedAtMs=performance.now(),finishedAtMs=startedAtMs+0.01;return {...structuredClone(ack),checkpointOrdinal,startedAtMs,finishedAtMs,elapsedMs:finishedAtMs-startedAtMs,deadlineMs,deadlineBudgetMs:deadlineMs-startedAtMs};}});
 const token=await observer.check();assert.equal(reads,1);assert.equal(owner.stats().liveCuts,0);assert.equal(observer.confirm(token),true);observer.close();const snapshot=observer.snapshot();assert.equal(snapshot.failed,0);assert.equal(snapshot.prefixes.length,1);assert.equal(api.validateMixedNativePrefix(snapshot.prefixes[0]),true);assert.deepEqual(snapshot.prefixes[0].begin,begin);assert.deepEqual(snapshot.prefixes[0].end,end);assert.ok(owner.stats().retainedBytes>0);observer.releaseSnapshot();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
});

test("closed pending guard forgets full cut and candidate child references before the ACK resolves",async()=>{
 const {setFlagsFromString}=await import("node:v8"),{runInNewContext}=await import("node:vm"),{setImmediate:tick}=await import("node:timers/promises");setFlagsFromString("--expose_gc");const collect=runInNewContext("gc");
 const {createMixedProgressAcknowledgments,createProxyControlCollector}=await import("./browser-control-collector.mjs"),{createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),{begin,ack}=await openPrefixFixture(),contextId=begin.nativeContext.contextId;
 const proxy=createProxyControlCollector({contextId});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let rootReference,childReference,finish,args;
 const observer=createMixedProgressAcknowledgments({technicalOwner:owner,input:()=>{const cut=owner.capture(()=>begin);rootReference=new WeakRef(cut);childReference=new WeakRef(cut.proxy[1].headerFieldSha256);return cut;},application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:value=>{args=value;return new Promise(resolve=>{finish=resolve;});}});
 const pending=observer.check();observer.close();let forgotten=false;
 for(let i=0;i<12;i++){await tick();collect();await tick();if(rootReference.deref()===undefined&&childReference.deref()===undefined){forgotten=true;break;}}
 assert.equal(forgotten,true,"neither full begin nor candidate child data may remain in the suspended check");finish({...ack,...args});await assert.rejects(pending,/closed/);observer.releaseSnapshot();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
});
