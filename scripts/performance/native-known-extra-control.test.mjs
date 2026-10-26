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
  const proxy=createProxyControlCollector({contextId:ctx.contextId,compiledCachedNavigations:true,compiledBinding:ctx.binding});
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
