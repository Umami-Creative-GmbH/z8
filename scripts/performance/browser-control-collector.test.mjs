import {testBrowserBinding,testBrowserMetadata,testEmptyTemporaryValues,testTeamAnnualDocument} from "./control-cancellation-test-fixtures.mjs";
import { temporaryValueObservation } from "./team-temporary-value-authority.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { createProxyHeaderCensus } from "./proxy-header-census.mjs";
import { cleanBrowserContextEvidence } from "./clean-evidence.mjs";
import { setImmediate as tick } from "node:timers/promises";
import {
	chromiumSWRRevision,
	cleanBrowserFailureEvidence,
	teamAnnualWorkers,teamAnnualModule,
	validateTeamAnnualGoldenReceipt,
} from "./control-cancellation-evidence.mjs";
async function writeAnnualRegistry(manifestPath) {
	await mkdir(join(dirname(manifestPath),"server"),{recursive:true});
	await writeFile(join(dirname(manifestPath),"server/server-reference-manifest.json"),JSON.stringify({node:{["40"+"a".repeat(40)]:{filename:teamAnnualModule,exportedName:"getTeamPerformanceData",workers:Object.fromEntries(teamAnnualWorkers.map(key=>[key,{moduleId:1,async:true}]))}},edge:{}}));
}
import {
	controlRequestIdentity,
	controlResponseMetadata,
	createPrincipalEpochObserver,
	capturePrincipalBoundary,
	cachedOriginWireEvidence,
	readNativePublicSources,
	captureNativeLaunchMetadata,
	createNativeWorkerObserver,
	captureNativeEndMetadata,
	readBrowserControlBinding,
	compiledRoutingSourceFacts,
	compiledRoutingForBinding,
	renderedPathSourceFacts,
	verifyBrowserControlBrowser,
	createTeamAnnualResponseSelection,
	annualTeamActionAuthority,
	createBrowserControlCollector,
	createProxyControlCollector,
	installBrowserControlCollector,
	controlDocumentHeader,
	controlResponseHeader,
} from "./browser-control-collector.mjs";
import { controlCancellationPolicy } from "./control-cancellation-evidence.mjs";
import { validateProxyHeaderCensus } from "./proxy-header-census.mjs";
import { projectCachedCdpText } from "./cdp-cached-text-projection.mjs";
import { primaryProtocolIdentity, companionProtocolIdentity, budgetProtocolIdentity,mixedProtocolIdentity } from "./protocol-fingerprints.mjs";
import { mixedProtocolFiles } from "./mixed-clock-budgets.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";

const origin = "http://localhost:1234",
	url = `${origin}/en?_rsc=PRIVATE_QUERY`,
	contextId = "fixture-context";
const headers = {
	RSC: "1",
	"next-router-prefetch": "1",
	"Accept-Language": "en",
	[controlDocumentHeader]: `${contextId}:2`,
};
const responseHeaders = {
	"content-type": "text/x-component",
	"cache-control": "s-maxage=100, stale-while-revalidate=200",
};

async function installedCacheAssociationFixture() {
	const source=await requestShapeTestBinding();
	const environmentBinding=await verifyBrowserControlBrowser({target:()=>({createCDPSession:async()=>({send:async()=>({revision:"@"+chromiumSWRRevision}),detach:async()=>{}})})},source.binding);
	const session=new EventEmitter(),page=Object.assign(new EventEmitter(),{createCDPSession:async()=>session,goto:async()=>null,reload:async()=>null,goBack:async()=>null,mainFrame:()=>null});
	session.send=async()=>({});session.detach=async()=>{};
	let proxy;
	const transport={setControlCancellationObserver(value){proxy=value;value.installed();return()=>0;}};
	const observer=await installBrowserControlCollector({page,context:{cookies:async()=>[]},transport,origin,headers:{},contextId,browserRevision:chromiumSWRRevision,environmentBinding});
	const application=createActionResultObserver(),traceId="d".repeat(32),target=origin+"/_next/static/chunks/fresh-cache-association.js",bytes=Buffer.from("globalThis.__syntheticCacheAssociation = true;");
	const headers={"content-type":"application/javascript","cache-control":"public, max-age=60"};
	let ordinal=0;
	const request=(requestId,change={})=>session.emit("Network.requestWillBeSent",{requestId,loaderId:"fresh-loader",frameId:"fresh-frame",type:"Script",timestamp:++ordinal,request:{url:change.url??target,method:change.method??"GET",headers:{}}});
	const response=(requestId,forwarded,cache)=>session.emit("Network.responseReceived",{requestId,type:"Script",response:{status:200,headers:forwarded,mimeType:"application/javascript",charset:"",...cache}});
	const finish=requestId=>{session.emit("Network.dataReceived",{requestId,dataLength:bytes.length});session.emit("Network.loadingFinished",{requestId,timestamp:++ordinal,encodedDataLength:bytes.length});};
	async function network(requestId){
		const applicationId=application.request({traceId,method:"GET",headers:{},applicationOrigin:true,compiledAsset:true});assert.ok(Number.isSafeInteger(applicationId)&&applicationId>0);
		const id=traceId+"."+applicationId;proxy.request(id,{traceId,url:target,method:"GET",headers:{}});proxy.response(id,{status:200,headers});application.response(applicationId,{status:200,mimeType:"application/javascript",encoding:"identity"});
		const forwarded={...headers,[controlResponseHeader]:id};request(requestId);response(requestId,forwarded,{fromDiskCache:false,fromServiceWorker:false});
		proxy.bytes(id,bytes);application.bytes(applicationId,bytes);application.end(applicationId);proxy.end(id);finish(requestId);await tick();return{id,forwarded};
	}
	async function replay(requestId,forwarded,{cache={},served=false,missingRow=false,change={}}={}){
		if(missingRow)session.emit("Network.requestServedFromCache",{requestId});
		request(requestId,change);
		if(served)session.emit("Network.requestServedFromCache",{requestId});
		response(requestId,forwarded,cache);finish(requestId);await tick();
	}
	return{observer,proxy,network,replay,target,async close(){try{await observer.close({deadlineMs:performance.now()+1000});}finally{const directory=await realpath(source.directory),prefix=join(await realpath(tmpdir()),"z8-request-shape-");assert.ok(directory.startsWith(prefix));await rm(directory,{recursive:true,force:true});}}};
}

for(const scenario of [
	{name:"fresh network control",network:true,healthy:true},
	{name:"observed disk plus service worker",cache:{fromDiskCache:true,fromServiceWorker:true},healthy:true},
	{name:"actual same-occurrence served-from-cache event",cache:{fromDiskCache:false,fromServiceWorker:false},served:true,healthy:true},
	{name:"unknown native event",cache:{fromDiskCache:false,fromServiceWorker:false},healthy:false},
	{name:"native event before an existing row",cache:{fromDiskCache:false},missingRow:true,healthy:false},
	{name:"forged memory response flag",cache:{fromMemoryCache:true},healthy:false},
	{name:"service worker alone",cache:{fromServiceWorker:true},healthy:false},
	{name:"native event with URL mismatch",cache:{fromDiskCache:false},served:true,change:{url:origin+"/other.js"},healthy:false},
	{name:"native event with method mismatch",cache:{fromDiskCache:false},served:true,change:{method:"POST"},healthy:false},
]) test(`installed cached response association: ${scenario.name}`,async()=>{
	const f=await installedCacheAssociationFixture();
	try{
		const original=await f.network("network-original"),before=structuredClone(f.proxy.snapshot().rows);
		f.observer.beginMeasurement();
		if(scenario.network){const next=await f.network("network-next");assert.notEqual(next.id,original.id);}
		else{await f.replay("new-browser-occurrence",original.forwarded,scenario);assert.deepEqual(f.proxy.snapshot().rows,before,"a cache event cannot replace or finish the canonical upstream packet");}
		const errors=f.proxy.snapshot().errors;
		assert.equal(errors===0,scenario.healthy,`actual installed event facade recorded ${errors} proxy association errors`);
		assert.equal(f.observer.snapshot().allPhase.coverage.errors===0,scenario.healthy);
	}finally{await f.close();}
});

test("cache event metadata is included in the same owned cut bytes without becoming another typed record",async()=>{
	const {createMixedTechnicalOwner,parseMixedTechnicalReplayJSON}=await import("./mixed-technical-gzip.mjs");
	const proxy=createProxyControlCollector({contextId,origin});proxy.installed();
	const collector=createBrowserControlCollector({contextId,origin,browserRevision:chromiumSWRRevision,proxyObservation:()=>proxy.snapshot(),readBody:async()=>({body,base64Encoded:false})});collector.installed();collector.beginMeasurement();
	const id="a".repeat(32)+".1";proxy.request(id,{url,method:"GET",headers,traceId:"a".repeat(32)});proxy.response(id,{status:200,headers:responseHeaders});proxy.bytes(id,Buffer.from(body));proxy.end(id);
	collector.request(event("owned-cache-event",1));collector.requestExtra({requestId:"owned-cache-event",headers});
	collector.requestServedFromCache({requestId:"owned-cache-event"});collector.requestServedFromCache({requestId:"owned-cache-event"});
	collector.response({requestId:"owned-cache-event",response:{status:200,headers:{...responseHeaders,[controlResponseHeader]:id},fromDiskCache:false,fromServiceWorker:false}});collector.responseExtra({requestId:"owned-cache-event",statusCode:200,headers:{...responseHeaders,[controlResponseHeader]:id}});
	collector.failed({requestId:"owned-cache-event",errorText:"net::ERR_ABORTED",canceled:true,timestamp:2});await tick();await tick();
	const document=testTeamAnnualDocument(contextId,origin).journal;
	const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
	try{
		const cut=collector.progressInput({owner,documentJournal:()=>document});assert.equal(cut.failures[0].cacheEventObserved,true);
		const records=owner.stats().retainedRecords;
		const packed=owner.encode(cut),expanded=gunzipSync(packed.bytes.subarray(48),{maxOutputLength:8388608,rejectGarbageAfterEnd:true});
		assert.equal(JSON.parse(expanded).failures[0].cacheEventObserved,true);assert.equal(packed.stats.logicalBytes,expanded.length);
		const without=structuredClone(cut);delete without.failures[0].cacheEventObserved;
		assert.equal(expanded.length-Buffer.byteLength(JSON.stringify(without)),Buffer.byteLength('"cacheEventObserved":true,'),"the copied optional scalar contributes its full serialized bytes before encoding");
		const comparison=owner.replay(parseMixedTechnicalReplayJSON(Buffer.from(JSON.stringify(without))));
		assert.equal(owner.stats().retainedRecords-records,records,"the same complete fresh journals have identical typed-record counts with or without the scalar");owner.releaseCut(comparison);
		assert.ok(owner.stats().retainedBytes>=expanded.length);packed.release();owner.releaseCut(cut);
		assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
	}finally{owner.close();proxy.closeTeamValues();}
});

test("proxy header census survives semantic scope end and closes only with actual transport lifetime facts",()=>{
	const proxy=createProxyControlCollector({contextId});proxy.installed();
	const collector=createBrowserControlCollector({contextId,origin,proxyObservation:proxy.snapshot});collector.installed();
	const id=n=>"a".repeat(32)+"."+n;
	for(const n of [1,2,3]) proxy.request(id(n),{url:n===2?"http://localhost:4321/worker":url,method:"GET",headers:{},traceId:"a".repeat(32)});
	proxy.response(id(1),{status:200,headers:{"content-type":"text/plain"}});
	proxy.cancel(id(3));
	collector.endScope();
	let proof=proxy.snapshot().headerCensus;
	assert.equal(validateProxyHeaderCensus(proof,{contextId}),true);
	assert.equal(proof.closed,false);
	assert.equal(proof.counts.pending,2,"downstream cancel does not prove an upstream no-header terminal");
	proxy.response(id(2),{status:200,headers:{"set-cookie":["__PRIVATE_COOKIE_SECRET_1475__"],"content-type":"text/plain"}});
	proxy.upstreamClosedBeforeHeaders(id(3),{upstreamClosed:true,headersReceived:false});
	proxy.transportClosed({serverClosed:true,acceptedRequests:3,upstreamRequests:3,closedUpstreams:3,pendingUpstreams:0});
	proof=proxy.snapshot().headerCensus;
	assert.equal(validateProxyHeaderCensus(proof,{contextId}),true);
	assert.equal(proof.closed,true);assert.equal(proof.counts.pending,0);assert.equal(proof.counts.setCookieResponses,1);
	assert.equal(proof.counts.terminalBeforeHeaders,1);
	assert.equal(collector.snapshot().proxyHeaderCensus.closed,true,"browser semantic closure does not close the transport census early");
	assert.doesNotMatch(JSON.stringify(proxy.snapshot()),/__PRIVATE_COOKIE_SECRET_1475__/);
	proxy.response(id(3),{status:200,headers:{}});
	assert.equal(proxy.snapshot().headerCensus.counts.late,1,"late header facts remain sticky after closure");
});

test("every protocol source closure binds the newly wired proxy header census",async()=>{
	const maps=await Promise.all([primaryProtocolIdentity(),companionProtocolIdentity(),budgetProtocolIdentity(),mixedProtocolIdentity()]);
 assert.deepEqual(maps.map(map=>Object.keys(map).length),[22,28,30,19]);
 const codec=await readFile(new URL("./mixed-technical-gzip.mjs",import.meta.url));for(const map of maps)assert.equal(map["mixed-technical-gzip.mjs"],createHash("sha256").update(codec).digest("hex"));
	for(const map of maps) assert.match(map["proxy-header-census.mjs"],/^[a-f0-9]{64}$/);
	assert.equal(mixedProtocolFiles.filter(name=>name==="proxy-header-census.mjs").length,1);
	for(const map of maps) assert.match(map["cdp-cached-text-projection.mjs"],/^[a-f0-9]{64}$/);
	assert.equal(mixedProtocolFiles.filter(name=>name==="cdp-cached-text-projection.mjs").length,1);
});

test("incomplete transport closure never fabricates a closed census or removes pending header facts",()=>{
	const proxy=createProxyControlCollector({contextId});proxy.installed();
	const id="a".repeat(32)+".1";
	proxy.request(id,{url,method:"GET",headers:{},traceId:"a".repeat(32)});
	proxy.cancel(id);
	proxy.transportClosed({serverClosed:true,acceptedRequests:1,upstreamRequests:1,closedUpstreams:0,pendingUpstreams:1});
	const snapshot=proxy.snapshot();
	assert.equal(snapshot.headerCensus.closed,false);
	assert.equal(snapshot.headerCensus.counts.pending,1);
	assert.equal(snapshot.headerCensus.counts.errors,1);
	assert.equal(validateProxyHeaderCensus(snapshot.headerCensus,{contextId}),true,"well-formed adverse facts are not eligibility");
});

test("text readback metadata keeps actual UTF16 length and an independent finished CDP dataLength sum",async()=>{
	const body='0:{"a":"€"}\n';
	const collector=createBrowserControlCollector({contextId,origin,readBody:async()=>({body,base64Encoded:false})});collector.installed();
	collector.request({...event("encoded",1),request:{url,method:"POST",headers:{"next-action":"technical-action"}}});
	collector.response({requestId:"encoded",response:{status:200,headers:responseHeaders,fromDiskCache:true}});
	collector.data({requestId:"encoded",dataLength:7});collector.data({requestId:"encoded",dataLength:10});
	collector.finished({requestId:"encoded",timestamp:2});collector.endScope();await tick();await tick();
	const receipt=collector.snapshot().bodyReceipts[0].bodyReadbackReceipt;
	assert.equal(receipt.utf16CodeUnitLength,body.length);
	assert.equal(receipt.observedDataLengthAtReadback,17);
	assert.notEqual(receipt.observedDataLengthAtReadback,receipt.decodedBytes);
});
const body = '#0:{"b":"PRIVATE_BUILD","t":{"t":{"s":""}}}\n';
const event = (requestId, timestamp, type = "Fetch") => ({
	requestId,
	timestamp,
	loaderId: "current-loader",
	type,
	initiator: { type: type === "Other" ? "other" : "script" },
	request: { url, method: "GET", headers, initialPriority: "VeryLow" },
});

test("response encoding diagnostics retain only actual allowlisted MIME/charset facts",()=>{
	for(const [value,charset] of [["text/x-component","absent"],["text/x-component; charset=utf-8","utf-8"],['text/x-component; charset="ISO-8859-1"',"iso-8859-1"],["text/x-component; charset=private-value","other"],["text/x-component; charset=utf-8; charset=latin1","ambiguous"]]){
		const facts=controlResponseMetadata({"content-type":value},200).responseContentType;
		assert.deepEqual(facts,{headerKnown:true,mime:"text/x-component",charset});
		assert.doesNotMatch(JSON.stringify(facts),/private-value/);
	}
	assert.deepEqual(controlResponseMetadata({},200).responseContentType,{headerKnown:false,mime:null,charset:"absent"});
});

test("runtime-shell contract is selected only from the actual header3 without a segment subtype", () => {
	const runtime = controlRequestIdentity(contextId, url, "GET", { RSC: "1", "next-router-prefetch": "3" });
	assert.equal(runtime.requestKind, "runtime-shell");
	assert.equal(controlRequestIdentity(contextId, url, "GET", { RSC: "1", "next-router-prefetch": "2" }).requestKind, "navigation");
	assert.equal(controlRequestIdentity(contextId, url, "GET", { RSC: "1", "next-router-prefetch": "3", "next-router-segment-prefetch": "/_tree" }).requestKind, "route-tree");
});

test("request identity retains semantic NextUrl, encoding and principal dimensions without raw values", () => {
	const base = { ...headers, "next-url": "/PRIVATE_PATH", "accept-encoding": "gzip", Cookie: "PRIVATE_COOKIE", Authorization: "PRIVATE_AUTH" };
	const original = controlRequestIdentity(contextId, url, "GET", base);
	for (const field of ["next-url", "accept-encoding", "Cookie", "Authorization"]) {
		const changed = controlRequestIdentity(contextId, url, "GET", { ...base, [field]: "PRIVATE_CHANGED" });
		assert.notEqual(original.requestHeadersSha256, changed.requestHeadersSha256, field);
		assert.notEqual(original.withoutTechnicalDocumentSha256, changed.withoutTechnicalDocumentSha256, field);
	}
	assert.doesNotMatch(JSON.stringify(original), /PRIVATE_PATH|PRIVATE_COOKIE|PRIVATE_AUTH/);
});

test("response Vary is bounded technical knowledge, not a generic cache exemption", () => {
	const known = controlResponseMetadata({ Vary: "RSC, Next-Router-Prefetch, Next-URL, Accept-Encoding" }, 200).vary;
	assert.deepEqual(known, { known: true, fields: ["accept-encoding", "next-router-prefetch", "next-url", "rsc"], star: false, unknownFields: 0 });
	assert.equal(controlResponseMetadata({}, 200).vary.known, true);
	for (const value of ["*", "PRIVATE_UNKNOWN_HEADER", "rsc," + "x".repeat(1024)]) {
		const metadata = controlResponseMetadata({ Vary: value }, 200);
		assert.equal(metadata.vary.known, false);
		assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE_UNKNOWN_HEADER|xxx/);
	}
	assert.equal(controlResponseMetadata(undefined, 200).vary.known, false);
});

test("principal metadata records actual boundary cookie equality while retaining SetCookie uncertainty", () => {
	const cookie = { name: "session", domain: "localhost", path: "/", value: "PRIVATE_COOKIE", expires: 10 };
	const observer = createPrincipalEpochObserver(contextId);
	observer.start([cookie]);
	observer.response("response", { "Set-Cookie": "session=PRIVATE_COOKIE; Max-Age=30" });
	observer.response("response", { "set-cookie": "session=PRIVATE_COOKIE; Max-Age=30" });
	observer.end([{ ...cookie, expires: 50 }]);
	const proof = observer.snapshot();
	assert.equal(proof.matchesAtBoundaries, true);
	assert.equal(proof.before.cookieCount, 1);
	assert.equal(proof.observedSetCookieResponses, 1);
	assert.equal(proof.scopeClosed, true);
	assert.equal(proof.stablePrincipalClaim, false, "Boundary equality alone does not prove no intermediate change.");
	assert.doesNotMatch(JSON.stringify(proof), /PRIVATE_COOKIE|session=|Max-Age/);
	const changed = createPrincipalEpochObserver(contextId);
	changed.start([cookie]); changed.end([{ ...cookie, value: "PRIVATE_CHANGED" }]);
	assert.equal(changed.snapshot().matchesAtBoundaries, false);
});

test("missing, malformed or partitioned cookie snapshots stay explicitly unknown", () => {
	for (const cookies of [undefined, [{ name: "session" }], [{ name: "session", domain: "localhost", path: "/", value: "PRIVATE", partitionKey: {} }]]) {
		const observer = createPrincipalEpochObserver(contextId);
		observer.start(cookies); observer.end([]);
		assert.equal(observer.snapshot().before.known, false);
		assert.equal(observer.snapshot().matchesAtBoundaries, null);
	}
	const observer = createPrincipalEpochObserver(contextId);
	observer.start([]); observer.readFailure("end");
	assert.equal(observer.snapshot().after.known, false);
	assert.equal(observer.snapshot().readErrors, 1);
	assert.equal(observer.snapshot().matchesAtBoundaries, null);
});

test("cookie capture delegates actual context reads once and cannot renew an expired cleanup deadline", async () => {
	let calls = 0;
	const context = { async cookies() { calls++; return [{ name: "session", domain: "localhost", path: "/", value: "PRIVATE" }]; } };
	const observer = createPrincipalEpochObserver(contextId);
	await capturePrincipalBoundary({ context, observer, stage: "start", deadlineMs: performance.now() + 1000 });
	await capturePrincipalBoundary({ context, observer, stage: "end", deadlineMs: performance.now() - 1 });
	assert.equal(calls, 1);
	assert.equal(observer.snapshot().before.known, true);
	assert.equal(observer.snapshot().after.known, false);
	assert.equal(observer.snapshot().matchesAtBoundaries, null);
	assert.equal(observer.snapshot().pendingReads, 0);
});

test("single owned HttpOnly root cookie facts bind an actual wire hash without retaining its value", () => {
	const cookie = { name: "session", domain: "localhost", path: "/", value: "PRIVATE_COOKIE", httpOnly: true };
	const observer = createPrincipalEpochObserver(contextId, { origin });
	observer.start([cookie]); observer.end([{ ...cookie, expires: 50 }]);
	const attributes = observer.snapshot().before.cookieAttributes;
	assert.equal(attributes.httpOnlyKnown, true);
	assert.equal(attributes.allHttpOnly, true);
	assert.equal(attributes.singleOwnedRootHttpOnlyCookie, true);
	assert.equal(attributes.singleCookieHeaderSha256, createHash("sha256").update("session=PRIVATE_COOKIE").digest("hex"));
	for (const [options, changed] of [[{}, cookie], [{ origin }, { ...cookie, httpOnly: undefined }]]) {
		const unknown = createPrincipalEpochObserver(contextId, options); unknown.start([changed]);
		assert.equal(unknown.snapshot().before.cookieAttributes.singleOwnedRootHttpOnlyCookie, null);
		assert.equal(unknown.snapshot().before.cookieAttributes.singleCookieHeaderSha256, null);
	}
	for (const changed of [{ ...cookie, httpOnly: false }, { ...cookie, path: "/other" }, { ...cookie, domain: "other.localhost" }]) {
		const other = createPrincipalEpochObserver(contextId, { origin }); other.start([changed]);
		assert.equal(other.snapshot().before.cookieAttributes.singleOwnedRootHttpOnlyCookie, false);
		assert.equal(other.snapshot().before.cookieAttributes.singleCookieHeaderSha256, null);
	}
	assert.doesNotMatch(JSON.stringify(observer.snapshot()), /PRIVATE_COOKIE|session=/);
});

test("cached origin evidence joins an exact response ID plus context method and full query identity", () => {
	const identity = controlRequestIdentity(contextId, url, "GET", { ...headers, Cookie: "PRIVATE_COOKIE" });
	assert.equal(identity.requestHeaderSnapshotKnown, true);
	assert.equal(controlRequestIdentity(contextId, url, "GET", undefined).requestHeaderSnapshotKnown, false);
	assert.equal(controlRequestIdentity(contextId, url, "GET", { RSC: 1 }).requestHeaderSnapshotKnown, false);
	const cached = { ...identity, proxyResponseId: "wire-origin" };
	const packet = { ...identity, id: "wire-origin", complete: true, canceled: false, upstreamError: false,
		transportBodyReceipt: { protocol: "proxy-natural-eof-decoded-bytes-v1", naturalEOF: true, decodedBytes: 20, bodySha256: "a".repeat(64) },
		vary: controlResponseMetadata({ vary: "RSC, Accept-Encoding" }, 200).vary, PRIVATE_BODY: "PRIVATE_VALUE" };
	const proof = cachedOriginWireEvidence(cached, [packet]);
	assert.equal(proof.responseIdMatches, 1);
	assert.equal(proof.exactRequestMatches, 1);
	assert.equal(proof.selected[0].transportBodyReceipt.bodySha256, "a".repeat(64));
	assert.equal(cachedOriginWireEvidence(cached, [{ ...packet, fullUrlSha256: "b".repeat(64) }]).exactRequestMatches, 0);
	assert.equal(cachedOriginWireEvidence(cached, [{ ...packet, contextId: "other" }]).exactRequestMatches, 0);
	assert.equal(cachedOriginWireEvidence(cached, [{ ...packet, method: "POST" }]).exactRequestMatches, 0);
	assert.equal(cachedOriginWireEvidence(cached, [packet, packet]).responseIdMatches, 2);
	const missing = cachedOriginWireEvidence(cached, [{ ...identity, id: "wire-origin" }]).selected[0];
	assert.equal(missing.complete, null);
	assert.equal(missing.canceled, null);
	assert.equal(missing.upstreamError, null);
	assert.equal(cachedOriginWireEvidence(cached, Array(9).fill(packet)).selectedTruncated, true);
	assert.equal(cachedOriginWireEvidence(cached, Array(9).fill(packet)).selected.length, 8);
	assert.doesNotMatch(JSON.stringify(proof), /PRIVATE_COOKIE|PRIVATE_VALUE|PRIVATE_BODY/);
});

test("native environment metadata hashes serving public files and keeps missing sources unknown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "z8-native-public-"));
	try {
		await mkdir(join(dir,".next")); await mkdir(join(dir,"public/lib"), {recursive:true});
		const files=["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"];
		for (const file of files) await writeFile(join(dir,"public",file), "SYNTHETIC_SOURCE");
		const manifestPath=join(dir,".next/required-server-files.json");
		const first=await readNativePublicSources(manifestPath);
		assert.equal(first.files.length,4);
		assert.ok(first.files.every(row=>row.known&&row.bytes===16&&row.sha256===createHash("sha256").update("SYNTHETIC_SOURCE").digest("hex")));
		await rm(join(dir,"public/sw.js"));
		const missing=await readNativePublicSources(manifestPath);
		assert.equal(missing.files[0].known,false);
		assert.equal(missing.files[0].sha256,null);
		await writeFile(join(dir,"public/sw.js"),Buffer.alloc(controlCancellationPolicy.encodedLimit+1));
		assert.equal((await readNativePublicSources(manifestPath)).files[0].known,false);
		assert.equal((await readNativePublicSources(join(dir,"wrong.json"))).servingRootKnown,false);
		assert.doesNotMatch(JSON.stringify(missing), /SYNTHETIC_SOURCE|z8-native-public-/);
	} finally { await rm(dir,{recursive:true,force:true}); }
});

test("native launch metadata hashes the actual executable and preserves missing process knowledge", async () => {
	const dir=await mkdtemp(join(tmpdir(),"z8-native-launch-"));
	try {
		const executable=join(dir,"synthetic.exe"); await writeFile(executable,"SYNTHETIC_EXECUTABLE");
		const browser={process:()=>({spawnfile:executable,spawnargs:[executable,"--disable-extensions","--net-log-capture-mode=Default","--net-log-max-size-mb=8","--log-net-log=PRIVATE_NATIVE_LOG","--user-data-dir=PRIVATE_PROFILE","--remote-debugging-port=0"]}),
			fixtureLaunchPolicy:{policy:"isolated-profile-no-prediction-v1",arguments:["--disable-extensions","--net-log-capture-mode=Default","--net-log-max-size-mb=8"],profileDirectorySha256:createHash("sha256").update("PRIVATE_PROFILE").digest("hex")}};
		const metadata=await captureNativeLaunchMetadata(browser);
		assert.equal(metadata.processKnown,true); assert.equal(metadata.argumentsMatchRecorded,true);
		assert.equal(metadata.profileArgumentMatchesRecorded,true);
		assert.equal(metadata.executable.sha256,createHash("sha256").update("SYNTHETIC_EXECUTABLE").digest("hex"));
		assert.equal((await captureNativeLaunchMetadata({})).processKnown,false);
		assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE_PROFILE|PRIVATE_NATIVE_LOG|synthetic.exe|SYNTHETIC_EXECUTABLE/);
		for (const flag of ["--net-log-capture-mode=IncludeSensitive", "--net-log-max-size-mb=16"]) {
			const altered = {...browser,process:()=>({...browser.process(),spawnargs:browser.process().spawnargs.map(arg=>arg.startsWith(flag.split("=")[0]+"=")?flag:arg)})};
			assert.equal((await captureNativeLaunchMetadata(altered)).argumentsMatchRecorded,false);
		}
	} finally { await rm(dir,{recursive:true,force:true}); }
});

test("native worker metadata follows only actual owned-context target events and closes listeners", () => {
	const browser=new EventEmitter(); const context={id:"PRIVATE_CONTEXT",browser:()=>browser};
	const page={type:()=>"page",url:()=>"about:blank",browserContext:()=>context};
	const worker={type:()=>"service_worker",url:()=>`${origin}/sw.js`,browserContext:()=>context};
	const foreign={type:()=>"service_worker",url:()=>"https://private.invalid/worker.js",browserContext:()=>({})};
	browser.targets=()=>[page,foreign];
	const observer=createNativeWorkerObserver({browser,context,contextId,origin});
	browser.emit("targetcreated",worker); browser.emit("targetchanged",worker); browser.emit("targetdestroyed",worker);
	observer.close();
	const evidence=observer.snapshot();
	assert.equal(evidence.contextJoinKnown,true);assert.equal(evidence.scopeClosed,true);
	assert.equal(evidence.events.length,4);assert.equal(evidence.errors,0);
	assert.equal(evidence.events[1].ownedWorkerScript,true);
	assert.equal(evidence.events[3].event,"destroyed");
	assert.equal(browser.listenerCount("targetcreated"),0);
	const capped=createNativeWorkerObserver({browser,context,contextId,origin});
	for(let index=0;index<260;index++)browser.emit("targetchanged",worker);
	assert.equal(capped.snapshot().events.length,256);assert.ok(capped.snapshot().overflow>0);capped.close();
	assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE_CONTEXT|private.invalid|\/sw.js/);
	const broken=createNativeWorkerObserver({browser:{},context,contextId,origin});
	assert.ok(broken.snapshot().errors>0); broken.close();
});

test("native end metadata reads controller registrations and public bytes within the caller deadline", async () => {
	const dir=await mkdtemp(join(tmpdir(),"z8-native-end-"));
	try {
		await mkdir(join(dir,".next"));await mkdir(join(dir,"public/lib"),{recursive:true});
		for(const file of ["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"])await writeFile(join(dir,"public",file),"SYNTHETIC");
		const build="c".repeat(40),bytes=Buffer.from(JSON.stringify({config:{deploymentId:build,experimental:{cachedNavigations:true}}})),manifestPath=join(dir,".next/required-server-files.json");await writeFile(manifestPath,bytes);
		await writeAnnualRegistry(manifestPath);
		const binding=await readBrowserControlBinding({manifestPath,plan:{runtime:{build,browserControl:{policy:controlCancellationPolicy,temporaryValueObservation:structuredClone(temporaryValueObservation),originalTeamSource:null,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:createHash("sha256").update(bytes).digest("hex")}}}});
		let queries=0;const worker={scriptURL:`${origin}/sw.js`,state:"activated"};
		const page={evaluate:async fn=>runInNewContext(`(${fn.toString()})()`,{navigator:{serviceWorker:{controller:worker,getRegistrations:async()=>{queries++;return[{scope:`${origin}/`,active:worker,waiting:null,installing:null}];},get ready(){throw Error("Must not await ready");}}},location:{origin},isSecureContext:true})};
		const result=await captureNativeEndMetadata({page,binding,origin,deadlineMs:performance.now()+10000});
		assert.equal(queries,1);assert.equal(result.timedOut,false);assert.equal(result.pendingOperations,0);
		assert.equal(result.controller.originMatches,true);assert.equal(result.controller.controllerAfter.ownedScript,true);
		assert.equal(result.controller.registrations[0].ownedRootScope,true);
		assert.equal(result.publicSourceRecheck.files[0].sha256,binding.servingPublicSources.files[0].sha256);
		assert.equal(result.publicSourcesMatch,true);
		await writeFile(join(dir,"public/sw.js"),"CHANGED_SYNTHETIC");
		assert.equal((await captureNativeEndMetadata({page,binding,origin,deadlineMs:performance.now()+10000})).publicSourcesMatch,false);
		const expired=await captureNativeEndMetadata({page:{evaluate:()=>{throw Error("No late evaluation");}},binding,origin,deadlineMs:performance.now()-1});
		assert.equal(expired.timedOut,true);assert.equal(expired.pendingOperations,0);assert.equal(expired.controller,null);
		assert.doesNotMatch(JSON.stringify(result),/\/sw.js|z8-native-end-/);
		const hung=await captureNativeEndMetadata({page:{evaluate:()=>new Promise(()=>{})},binding,origin,deadlineMs:performance.now()+10});
		assert.equal(hung.timedOut,true);assert.ok(hung.pendingOperations>0);assert.equal(hung.controller,null);
	} finally {await rm(dir,{recursive:true,force:true});}
});

test("normal admission binds the actual manifest before IO and actual browser revision without a mode default", async () => {
	const dir = await mkdtemp(join(tmpdir(), "z8-browser-admission-"));
	try {
		const manifestPath = join(dir, "required-server-files.json"), build = "c".repeat(40);
		const bytes = Buffer.from(JSON.stringify({ config: { deploymentId: build, basePath:"",output:"standalone",experimental: { cachedNavigations: true } } }));
		await writeFile(manifestPath, bytes);
		await writeAnnualRegistry(manifestPath);
		const browserControl = { policy: controlCancellationPolicy, temporaryValueObservation:structuredClone(temporaryValueObservation),originalTeamSource:null, browserRevision: chromiumSWRRevision,
			compiledCachedNavigations: true, compiledManifestSha256: createHash("sha256").update(bytes).digest("hex") };
		const plan = { runtime: { build, browserControl } };
		const binding = await readBrowserControlBinding({ plan, manifestPath });
		assert.equal(binding.manifestVerified, true);
		assert.deepEqual(compiledRoutingForBinding(binding),compiledRoutingSourceFacts({basePath:"",output:"standalone"},browserControl.compiledManifestSha256));
		assert.equal(Object.hasOwn(binding,"compiledRoutingSourceFacts"),false,"phase manifest facts must not enter common browser-control metadata");
		let detach = 0;
		const browser = { target: () => ({ createCDPSession: async () => ({
			send: async (method) => { assert.equal(method, "Browser.getVersion"); return { revision: `@${chromiumSWRRevision}` }; },
			detach: async () => { detach++; },
		}) }) };
		const verified=await verifyBrowserControlBrowser(browser,binding);
		assert.equal(verified.browserVerified,true);
		assert.equal(annualTeamActionAuthority(binding),null);
		assert.deepEqual(annualTeamActionAuthority(verified),binding.teamAnnualAction);
		assert.equal(annualTeamActionAuthority({...verified}),null);
		assert.equal(detach, 1);
		for (const change of [
			{ ...plan, runtime: { ...plan.runtime, build: "d".repeat(40) } },
			{ ...plan, runtime: { ...plan.runtime, browserControl: { ...browserControl, compiledCachedNavigations: false } } },
			{ ...plan, runtime: { ...plan.runtime, browserControl: undefined } },
		]) await assert.rejects(readBrowserControlBinding({ plan: change, manifestPath }));
		await writeFile(manifestPath, JSON.stringify({ config: { deploymentId: build, experimental: {} } }));
		await assert.rejects(readBrowserControlBinding({ plan, manifestPath }));
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("browser and no-follow proxy retain independent routing source digests while raw values are discarded",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"z8-routing-source-"));
	try{
	const manifestPath=join(dir,"required-server-files.json"),build="b".repeat(40),bytes=Buffer.from(JSON.stringify({config:{deploymentId:build,basePath:"",output:"standalone",experimental:{cachedNavigations:true}}}));
	await writeFile(manifestPath,bytes);
	await writeAnnualRegistry(manifestPath);
	const compiledBinding=await readBrowserControlBinding({manifestPath,plan:{runtime:{build,browserControl:{policy:controlCancellationPolicy,temporaryValueObservation:structuredClone(temporaryValueObservation),originalTeamSource:null,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:createHash("sha256").update(bytes).digest("hex")}}}});
	const actualUrl=origin+"/en/PRIVATE_PATH?_rsc=PRIVATE_MARKER&a=PRIVATE_QUERY+b&a=c&2=z";
	const routeHeaders={...headers,"next-router-segment-prefetch":"/_tree"},protocolSources=await primaryProtocolIdentity();
	const expectedSearch="?2=z&a=PRIVATE_QUERY%20b&a=c",hash=value=>createHash("sha256").update(value).digest("hex");
	const collector=createBrowserControlCollector({contextId,origin,compiledBinding,protocolSources,readBody:async()=>({body,base64Encoded:false})});collector.installed();
	collector.request({requestId:"1",loaderId:"loader",type:"Fetch",timestamp:1,request:{url:actualUrl,method:"GET",headers:routeHeaders}});
	collector.response({requestId:"1",response:{url:actualUrl,status:200,headers:responseHeaders,fromDiskCache:true,mimeType:"text/x-component",charset:""}});collector.finished({requestId:"1",timestamp:2});await tick();
	const facts=collector.snapshot().bodyReceipts[0].pathSourceFacts;
	assert.equal(facts.rendered.known,true);assert.equal(facts.rendered.pathnameSha256,hash("/en/PRIVATE_PATH"));assert.equal(facts.rendered.searchSha256,hash(expectedSearch));
	assert.equal(facts.rendered.partsCount,2);assert.equal(facts.url.provenance,"Network.responseReceived.url");
	assert.equal(facts.scalarKeys.known,true);assert.equal(facts.scalarKeys.parts[1].scalarSha256,hash("PRIVATE_PATH"));
	const proxy=createProxyControlCollector({contextId,origin,compiledBinding,protocolSources});proxy.installed();
	proxy.request("1",{url:actualUrl,method:"GET",headers:routeHeaders,traceId:"a".repeat(32)});proxy.response("1",{status:200,headers:responseHeaders});
	const forwarded=proxy.snapshot().rows[0].pathSourceFacts;
	assert.equal(forwarded.rendered.pathnameSha256,facts.rendered.pathnameSha256);assert.equal(forwarded.url.provenance,"owned-proxy-request-url-no-follow");
	assert.equal(forwarded.url.originMatches,true);
	assert.equal(forwarded.scalarKeys.parts[1].scalarSha256,facts.scalarKeys.parts[1].scalarSha256);
	assert.doesNotMatch(JSON.stringify({facts,forwarded}),/PRIVATE_PATH|PRIVATE_QUERY|PRIVATE_MARKER/);
	}finally{assert.equal(dir.startsWith(join(tmpdir(),"z8-routing-source-")),true);await rm(dir,{recursive:true,force:true});}
});

test("routing metadata honors own rewrite presence and retains unknown malformed source facts",()=>{
	const compiledRouting=compiledRoutingSourceFacts({basePath:"",output:"standalone"},"c".repeat(64)),hash=value=>createHash("sha256").update(value).digest("hex");
	const response={url:origin+"/en/original?_rsc=private&x=one+two",headers:{"X-Nextjs-Rewritten-Path":"/rewritten/value","X-Nextjs-Rewritten-Query":"q=a+b&q=c&2=z"}};
	const facts=renderedPathSourceFacts({response,compiledRouting,origin});
	assert.equal(facts.rendered.pathnameSource,"rewrite-header");assert.equal(facts.rendered.pathnameSha256,hash("/rewritten/value"));assert.equal(facts.rendered.searchSha256,hash("?2=z&q=a%20b&q=c"));
	const emptyQuery=renderedPathSourceFacts({response:{...response,headers:{"x-nextjs-rewritten-query":""}},compiledRouting,origin});
	assert.equal(emptyQuery.rewrite.query.present,true);assert.equal(emptyQuery.rendered.searchSha256,hash(""));assert.equal(emptyQuery.rendered.searchSource,"rewrite-header");
	assert.equal(renderedPathSourceFacts({response:{...response,headers:{"x-nextjs-rewritten-path":""}},compiledRouting,origin}).rendered.known,false,"present empty path does not select URL fallback");
	let reads=0;const getter=Object.defineProperty({},"x-nextjs-rewritten-path",{get(){reads++;return "/private";}});
	for(const headers of [undefined,Object.create({"x-nextjs-rewritten-path":"/private"}),getter,{"X-Nextjs-Rewritten-Path":"/one","x-nextjs-rewritten-path":"/two"},{"x-nextjs-rewritten-query":"x".repeat(2049)}]){
		assert.equal(renderedPathSourceFacts({response:{...response,headers},compiledRouting,origin}).rendered.known,false);
	}
	assert.equal(reads,0);
	const getterURL=Object.defineProperty({headers:{}},"url",{get(){reads++;return response.url;}});
	assert.equal(renderedPathSourceFacts({response:getterURL,compiledRouting,origin}).url.known,false);assert.equal(reads,0);
	const getterConfig=Object.defineProperty({},"basePath",{get(){reads++;return "";}});
	assert.equal(compiledRoutingSourceFacts(getterConfig,"c".repeat(64)).basePathOwnKnown,false);assert.equal(reads,0);
	for(const config of [{},{basePath:"/app"},{basePath:"",output:"export"}])assert.equal(renderedPathSourceFacts({response:{url:response.url,headers:{}},compiledRouting:compiledRoutingSourceFacts(config,"c".repeat(64)),origin}).rendered.known,false);
	const inherited=Object.assign(Object.create({url:response.url}),{headers:{}});assert.equal(renderedPathSourceFacts({response:inherited,compiledRouting,origin}).url.known,false);
});

test("Native pre-IO public binding uses reviewed expected files rather than qualifying the current directory",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"z8-native-authority-"));
	try{
		await mkdir(join(dir,".next"));await mkdir(join(dir,"public/lib"),{recursive:true});
		const files=["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"];
		for(const file of files)await writeFile(join(dir,"public",file),"reviewed-synthetic");
		const build="b".repeat(40),manifest=Buffer.from(JSON.stringify({config:{deploymentId:build,experimental:{cachedNavigations:true}}}));
		const manifestPath=join(dir,".next/required-server-files.json");await writeFile(manifestPath,manifest);
		const manifestSha=createHash("sha256").update(manifest).digest("hex");
		const nativePublicSources={protocol:"qualified-serving-worker-sources-v1",compiledBuild:build,compiledManifestSha256:manifestSha,
			files:files.map(file=>({file,bytes:18,sha256:createHash("sha256").update("reviewed-synthetic").digest("hex"),gitBlob:"d".repeat(40)}))};
		const plan={runtime:{build,browserControl:{policy:controlCancellationPolicy,temporaryValueObservation:structuredClone(temporaryValueObservation),originalTeamSource:null,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:manifestSha,nativePublicSources}}};
		await writeAnnualRegistry(manifestPath);
		assert.deepEqual((await readBrowserControlBinding({plan,manifestPath})).nativePublicSources,nativePublicSources);
		await writeFile(join(dir,"public/sw.js"),"changed-synthetic");
		await assert.rejects(readBrowserControlBinding({plan,manifestPath}),/independently qualified/);
		const wrong=structuredClone(plan);wrong.runtime.browserControl.nativePublicSources.compiledBuild="a".repeat(40);
		await assert.rejects(readBrowserControlBinding({plan:wrong,manifestPath}));
	}finally{await rm(dir,{recursive:true,force:true});}
});

test("header provenance isolates only the technical document token and preserves semantic header differences", () => {
	const initial = controlRequestIdentity(contextId, url, "GET", headers);
	const nextDocument = controlRequestIdentity(contextId, url, "GET", {
		...headers,
		[controlDocumentHeader]: "context:2",
	});
	assert.notEqual(
		initial.requestHeadersSha256,
		nextDocument.requestHeadersSha256,
	);
	assert.equal(
		initial.withoutTechnicalDocumentSha256,
		nextDocument.withoutTechnicalDocumentSha256,
	);
	assert.notEqual(
		initial.headerFieldSha256[controlDocumentHeader],
		nextDocument.headerFieldSha256[controlDocumentHeader],
	);
	const changedSemantic = controlRequestIdentity(contextId, url, "GET", {
		...headers,
		"next-router-state-tree": "PRIVATE_ROUTER_STATE",
	});
	assert.notEqual(
		initial.withoutTechnicalDocumentSha256,
		changedSemantic.withoutTechnicalDocumentSha256,
	);
	assert.doesNotMatch(JSON.stringify(changedSemantic), /PRIVATE_ROUTER_STATE/);
});

test("missing event families remain blocking and optional header-event absence is separately recorded", async () => {
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		readBody: async () => {
			throw Error("PRIVATE_BODY_ERROR");
		},
		proxyObservation: () => ({
			installed: true,
			rows: [],
			errors: 0,
			overflow: 0,
			pendingBodies: 0,
		}),
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("unknown", 1, "Other"));
	collector.request(event("unknown", 2));
	collector.response({ requestId: "missing-response", response: {} });
	collector.responseExtra({ requestId: "missing-extra" });
	collector.data({ requestId: "missing-data" });
	collector.finished({ requestId: "missing-finish" });
	collector.failed({ requestId: "missing-failure" });
	collector.recordMeasuredFailure("unknown");
	collector.failed({
		requestId: "unknown",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endMeasurement();
	collector.endScope();
	await tick();
	await tick();
	const result = collector.snapshot();
	assert.equal(result.measured.complete, false);
	assert.equal(result.measured.rawFailedRequests, 1);
	assert.equal(result.measured.unknownFailures, 1);
	assert.equal(result.measured.coverage.missing, 6);
	assert.equal(result.measured.coverage.optionalRequestExtraInfoAbsent, 1);
	assert.deepEqual(result.diagnostics.missingFamilies, {
		duplicateRequest: 1,
		responseBeforeRequest: 1,
		responseExtraBeforeRequest: 1,
		dataBeforeRequest: 1,
		finishedBeforeRequest: 1,
		failedBeforeRequest: 1,
		failedRequestHeadersUnknown: 1,
		measuredFailureNotObserved: 0,
	});
	const row = result.diagnostics.failures[0];
	assert.equal(row.type, "Other");
	assert.equal(row.method, "GET");
	assert.equal(row.requestHeadersKnown, false);
	assert.equal(row.bodyProofReason, "cdp-body-unavailable");
	assert.equal(row.proxyCandidates.sameUrlMethod, 0);
	assert.doesNotMatch(
		JSON.stringify(result),
		/PRIVATE_|localhost|Accept-Language/,
	);
	assert.ok(
		Object.values(row.initialHeaderIdentity.headerFieldSha256).every(
			(value) => value === null || /^[a-f0-9]{64}$/.test(value),
		),
	);
});

test("measured cancellation without positive request identity remains unknown despite complete event observation", async () => {
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		readBody: async () => {
			throw Error("unavailable");
		},
		proxyObservation: () => ({
			installed: true,
			rows: [],
			errors: 0,
			overflow: 0,
			pendingBodies: 0,
		}),
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("required-unknown", 1, "Other"));
	collector.recordMeasuredFailure("required-unknown");
	collector.failed({
		requestId: "required-unknown",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endMeasurement();
	collector.endScope();
	await tick();
	await tick();
	const result = collector.snapshot();
	assert.equal(result.measured.coverage.missing, 0);
	assert.equal(result.measured.coverage.optionalRequestExtraInfoAbsent, 1);
	assert.equal(result.measured.unknownFailures, 1);
	assert.equal(result.measured.provenControls, 0);
	assert.equal(cleanBrowserFailureEvidence(result.measured, 1), false);
});

test("mixed context-work raw failures use actual post-start request IDs without changing default operator membership", () => {
	for (const captureContextFailures of [false, true]) {
		const collector = createBrowserControlCollector({ contextId, origin, captureContextFailures,
			proxyObservation: () => ({ installed: true, rows: [], errors: 0, overflow: 0, pendingBodies: 0 }) });
		collector.installed(); collector.request(event("inherited", 0)); collector.beginMeasurement();
		collector.request(event("measured", 1));
		collector.failed({ requestId: "inherited", errorText: "net::ERR_ABORTED", canceled: true });
		collector.failed({ requestId: "measured", errorText: "net::ERR_ABORTED", canceled: true });
		collector.endMeasurement(); collector.request(event("later", 2));
		collector.failed({ requestId: "later", errorText: "net::ERR_ABORTED", canceled: true }); collector.endScope();
		assert.equal(collector.snapshot().rawMeasuredFailedRequests, captureContextFailures ? 1 : 0);
		assert.equal(collector.snapshot().measured.rawFailedRequests, captureContextFailures ? 1 : 0);
	}
});

test("early response ExtraInfo joins its exact later request while orphan and conflicting metadata stay blocking", async () => {
	const make = () =>
		createBrowserControlCollector({
			contextId,
            compiledBinding:testBrowserBinding("b".repeat(40)),environmentObservation:()=>({temporaryValues:testEmptyTemporaryValues(contextId)}),
			origin,
			readBody: async () => {
				throw Error("unavailable");
			},
			proxyObservation: () => ({
				installed: true,
				rows: [],
				errors: 0,
				overflow: 0,
				pendingBodies: 0,
			}),
		});
	for (const mode of ["joined", "orphan", "conflict"]) {
		const collector = make();
		collector.installed();
		collector.beginMeasurement();
		const extra = {
			requestId: "same-id",
			statusCode: 200,
			headers: responseHeaders,
		};
		collector.responseExtra(extra);
		if (mode === "conflict")
			collector.responseExtra({ ...extra, statusCode: 500 });
		if (mode !== "orphan") collector.request(event("same-id", 1));
		collector.endMeasurement();
		collector.endScope();
		await tick();
		const result = collector.snapshot();
		assert.equal(result.measured.coverage.missing, mode === "orphan" ? 1 : 0);
		assert.equal(result.measured.coverage.errors, mode === "conflict" ? 1 : 0);
		assert.equal(
			result.diagnostics.earlyResponseExtra.joined,
			mode === "orphan" ? 0 : 1,
		);
		assert.equal(
			result.diagnostics.earlyResponseExtra.orphan,
			mode === "orphan" ? 1 : 0,
		);
		assert.equal(
			cleanBrowserFailureEvidence(result.measured, 0),
			mode === "joined",
		);
	}
});

test("actual cache and proxy events retain unknowns without publishing payload or header values", async () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	const collector = createBrowserControlCollector({
		contextId,
        compiledBinding:testBrowserBinding("b".repeat(40)),environmentObservation:()=>({temporaryValues:testEmptyTemporaryValues(contextId)}),
		origin,
		browserRevision: chromiumSWRRevision,
		proxyObservation: proxy.snapshot,
		readBody: async (id) => {
			if (id !== "cached") throw Error("PRIVATE_CDP_ERROR");
			return { body, base64Encoded: false };
		},
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("cached", 1));
	collector.requestExtra({ requestId: "cached", headers });
	collector.response({
		requestId: "cached",
		response: {
			status: 200,
			headers: responseHeaders,
			fromDiskCache: true,
			fromServiceWorker: false,
		},
	});
	collector.finished({ requestId: "cached", timestamp: 2 });
	const id = `${"a".repeat(32)}.2`;
	proxy.request(id, { url, method: "GET", headers, traceId: "a".repeat(32) });
	proxy.response(id, { status: 200, headers: responseHeaders });
	proxy.bytes(id, Buffer.from("unread"));
	proxy.cancel(id);
	collector.request(event("background", 3, "Other"));
	collector.requestExtra({ requestId: "background", headers });
	collector.responseExtra({
		requestId: "background",
		statusCode: 200,
		headers: { ...responseHeaders, [controlResponseHeader]: id },
	});
	collector.recordMeasuredFailure("background");
	collector.failed({
		requestId: "background",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endMeasurement();
	// An unrelated all-phase failure without optional ExtraInfo is retained outside raw membership.
	const outside = event("outside-measured", 4, "Other");
	outside.request.url = `${origin}/outside-measured`;
	collector.request(outside);
	collector.failed({
		requestId: "outside-measured",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endScope();
	await tick();
	await tick();
	const proof = collector.snapshot();
	assert.equal(proof.measured.complete, true);
	assert.equal(proof.measured.rawFailedRequests, 1);
	assert.equal(proof.measured.provenControls, 0);
	assert.equal(proof.measured.unknownFailures, 1);
	assert.equal(cleanBrowserFailureEvidence(proof.measured, 1), false);
	assert.equal(proof.allPhase.rawFailedRequests, 2);
	assert.equal(proof.allPhase.unknownFailures, 2);
	assert.equal(proof.allPhase.complete, true);
	assert.equal(
		proof.diagnostics.missingFamilies.failedRequestHeadersUnknown,
		1,
	);
	assert.equal(
		proof.bodyReceipts.find((row) => row.requestId === "background").bodyProof
			.complete,
		false,
	);
	assert.doesNotMatch(
		JSON.stringify([proof, proxy.snapshot()]),
		/PRIVATE_|unread|content-type|Accept-Language/,
	);
});

test("scope end excludes later browser teardown failures from the measured raw window", async () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		proxyObservation: proxy.snapshot,
		readBody() {
			throw Error("unavailable");
		},
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("late", 1));
	collector.requestExtra({ requestId: "late", headers });
	collector.endMeasurement();
	collector.failed({
		requestId: "late",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endScope();
	await tick();
	assert.equal(collector.snapshot().measured.rawFailedRequests, 0);
	assert.equal(collector.snapshot().allPhase.rawFailedRequests, 1);
	assert.equal(collector.snapshot().allPhase.unknownFailures, 1);
	assert.equal(collector.snapshot().allPhase.coverage.errors, 0);
});

test("proxy EOF does not hold forwarding for decoding and genuine upstream errors cannot become controls", async () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	proxy.request("1", { url, method: "GET", headers, traceId: "a".repeat(32) });
	proxy.response("1", { status: 200, headers: responseHeaders });
	proxy.bytes("1", Buffer.from(body));
	proxy.end("1");
	assert.equal(proxy.snapshot().pendingBodies, 1);
	assert.equal(proxy.snapshot().rows[0].bodyProof, undefined);
	await tick();
	assert.equal(proxy.snapshot().pendingBodies, 0);
	assert.equal(proxy.snapshot().rows[0].bodyProof.complete, true);
	proxy.failure("1");
	assert.equal(proxy.snapshot().rows[0].upstreamError, true);
});

test("proxy natural EOF retains bounded forward text projection metadata without changing protocol claims", async()=>{
	for(const original of [Buffer.from(body),Buffer.from([0x80,0x81,0x91,0xa0])]){
		const proxy=createProxyControlCollector({contextId});proxy.installed();
		proxy.request("1",{url,method:"GET",headers,traceId:"a".repeat(32)});
		proxy.response("1",{status:200,headers:{...responseHeaders,"content-encoding":"gzip"}});
		proxy.bytes("1",gzipSync(original));proxy.end("1");
		assert.equal(proxy.snapshot().rows[0].transportBodyReceipt,undefined,"no synchronous forwarding delay");
		await tick();const row=proxy.snapshot().rows[0];
		assert.deepEqual(row.transportBodyReceipt.cdpTextProjection,{available:true,...projectCachedCdpText(original)});
		assert.equal(row.transportBodyReceipt.decodedBytes,original.length);
		assert.equal(row.transportBodyReceipt.bodySha256,createHash("sha256").update(original).digest("hex"));
		assert.equal(proxy.snapshot().pendingBodies,0);
		assert.equal(Object.hasOwn(row.transportBodyReceipt.cdpTextProjection,"body"),false);
	}
	const proxy=createProxyControlCollector({contextId});proxy.installed();
	proxy.request("1",{url,method:"GET",headers,traceId:"a".repeat(32)});
	proxy.response("1",{status:200,headers:responseHeaders});proxy.bytes("1",Buffer.from([0xef,0xbb,0xbf,...Buffer.from(body)]));proxy.end("1");
	await tick();const row=proxy.snapshot().rows[0];
	assert.deepEqual(row.transportBodyReceipt.cdpTextProjection,{available:false,reason:"unsupported-bom-prefix"});
	assert.equal(row.transportBodyReceipt.naturalEOF,true,"unsupported math does not erase observed EOF");
	assert.equal(row.bodyProof.complete,false,"metadata does not invent a supported protocol body");
	proxy.request("2",{url,method:"GET",headers,traceId:"a".repeat(32)});proxy.response("2",{status:200,headers:responseHeaders});proxy.bytes("2",Buffer.from(body));proxy.cancel("2");
	assert.equal(proxy.snapshot().rows[1].transportBodyReceipt,undefined,"no projection or EOF claim for canceled upstream bodies");
});

test("CDP effective response MIME and charset remain distinct from the HTTP Content-Type header",async()=>{
	for(const [actual,expected] of [
		[{}, {mimeKnown:false,mime:null,charsetKnown:false,charset:null}],
		[{mimeType:"text/x-component",charset:""},{mimeKnown:true,mime:"text/x-component",charsetKnown:true,charset:"empty"}],
		[{mimeType:"text/x-component",charset:"UTF-8"},{mimeKnown:true,mime:"text/x-component",charsetKnown:true,charset:"utf-8"}],
		[{mimeType:"application/PRIVATE",charset:"PRIVATE"},{mimeKnown:true,mime:"other",charsetKnown:true,charset:"other"}],
	]){
		const collector=createBrowserControlCollector({contextId,origin,readBody:async()=>({body,base64Encoded:false})});collector.installed();
		collector.request({requestId:"1",loaderId:"loader",type:"Fetch",timestamp:1,request:{url,method:"GET",headers}});
		collector.response({requestId:"1",response:{status:200,headers:responseHeaders,fromDiskCache:true,...actual}});
		collector.data({requestId:"1",dataLength:Buffer.byteLength(body)});
		collector.finished({requestId:"1",timestamp:2});await tick();
		const receipt=collector.snapshot().bodyReceipts[0].bodyReadbackReceipt;
		assert.deepEqual(receipt.effectiveCdpResponse,{protocol:"cdp-effective-response-decoder-metadata-v1",provenance:"Network.responseReceived",...expected});
		assert.equal(receipt.responseContentType.charset,"absent","the raw header does not acquire the CDP fallback charset");
		assert.equal(JSON.stringify(receipt).includes("PRIVATE"),false);
	}
});

test("effective CDP decoder metadata requires bounded own data properties without invoking getters",async()=>{
	let reads=0;
	const inherited=Object.create({mimeType:"text/x-component",charset:""});
	const accessors=Object.defineProperties({},{mimeType:{get(){reads++;return "text/x-component";}},charset:{get(){reads++;return "";}}});
	for(const response of [inherited,accessors,{}, {mimeType:undefined,charset:undefined}, {mimeType:"x".repeat(129),charset:"x".repeat(65)}]){
		response.status=200;response.headers=responseHeaders;response.fromDiskCache=true;
		const collector=createBrowserControlCollector({contextId,origin,readBody:async()=>({body,base64Encoded:false})});collector.installed();
		collector.request({requestId:"1",loaderId:"loader",type:"Fetch",timestamp:1,request:{url,method:"GET",headers}});
		collector.response({requestId:"1",response});collector.finished({requestId:"1",timestamp:2});await tick();
		assert.deepEqual(collector.snapshot().bodyReceipts[0].bodyReadbackReceipt.effectiveCdpResponse,
			{protocol:"cdp-effective-response-decoder-metadata-v1",provenance:"Network.responseReceived",mimeKnown:false,mime:null,charsetKnown:false,charset:null});
	}
	assert.equal(reads,0);
});

test("cached final data ledger retains late, invalid and contradictory events after readback",async()=>{
	for(const mode of ["late","invalid","duplicate-finish","failed","second-response"]){
		const collector=createBrowserControlCollector({contextId,origin,readBody:async()=>({body,base64Encoded:false})});collector.installed();
		const response={status:200,headers:responseHeaders,fromDiskCache:true,mimeType:"text/x-component",charset:""};
		collector.request({requestId:"1",loaderId:"loader",type:"Fetch",timestamp:1,request:{url,method:"GET",headers}});
		collector.response({requestId:"1",response});collector.data({requestId:"1",dataLength:Buffer.byteLength(body)});collector.finished({requestId:"1",timestamp:2});await tick();
		const initial=collector.snapshot().bodyReceipts[0];
		assert.equal(initial.browserDataLedger.observedDataLength,Buffer.byteLength(body));
		if(mode==="late") collector.data({requestId:"1",dataLength:0});
		if(mode==="invalid") collector.data({requestId:"1",dataLength:-1});
		if(mode==="duplicate-finish") collector.finished({requestId:"1",timestamp:3});
		if(mode==="failed") collector.failed({requestId:"1",errorText:"net::ERR_ABORTED",canceled:true});
		if(mode==="second-response") collector.response({requestId:"1",response});
		const after=collector.snapshot().bodyReceipts[0];
		assert.equal(after.bodyReadbackReceipt.observedDataLengthAtReadback,initial.bodyReadbackReceipt.observedDataLengthAtReadback,"the old readback count is preserved, not silently repaired");
		if(mode==="late") assert.equal(after.browserDataLedger.dataAfterTerminal,1);
		if(mode==="invalid") assert.equal(after.browserDataLedger.invalidData,true);
		if(mode==="duplicate-finish") assert.equal(after.browserDataLedger.finishedEvents,2);
		if(mode==="failed") assert.equal(after.browserDataLedger.failedEvents,1);
		if(mode==="second-response") assert.equal(after.browserDataLedger.responseEvents,2);
		if(mode==="second-response") assert.equal(after.browserDataLedger.responseAfterTerminal,1);
	}
});

test("cached data ledger records response and terminal ordering independently of event totals",async()=>{
	for(const terminalFirst of [false,true]){
		const collector=createBrowserControlCollector({contextId,origin,readBody:async()=>({body,base64Encoded:false})});collector.installed();
		collector.request({requestId:"1",loaderId:"loader",type:"Fetch",timestamp:1,request:{url,method:"GET",headers}});
		collector.data({requestId:"1",dataLength:Buffer.byteLength(body)});
		if(terminalFirst) collector.finished({requestId:"1",timestamp:2});
		collector.response({requestId:"1",response:{status:200,headers:responseHeaders,fromDiskCache:true,mimeType:"text/x-component",charset:""}});
		if(terminalFirst) collector.failed({requestId:"1",errorText:"net::ERR_ABORTED",canceled:true});
		else collector.finished({requestId:"1",timestamp:2});
		await tick();const ledger=collector.snapshot().bodyReceipts[0].browserDataLedger;
		assert.equal(ledger.dataBeforeResponse,1);assert.equal(ledger.responseEvents,1);assert.equal(ledger.finishedEvents,1);
		assert.equal(ledger.responseAfterTerminal,terminalFirst?1:0);assert.equal(ledger.terminalBeforeResponse,terminalFirst?1:0);
	}
});

test("failure diagnostics retain actual bounded CDP error and canceled provenance without raw text",()=>{
	for(const [errorText,canceled,expected] of [
		["net::ERR_ABORTED",false,{errorKnown:true,errorEnum:"net::ERR_ABORTED",canceledKnown:true,canceled:false}],
		["PRIVATE_RAW_FAILURE",true,{errorKnown:false,errorEnum:"other",canceledKnown:true,canceled:true}],
		[undefined,undefined,{errorKnown:false,errorEnum:"unknown",canceledKnown:false,canceled:null}],
	]){
		const collector=createBrowserControlCollector({contextId,origin});collector.installed();
		collector.request({requestId:"1",loaderId:"loader",type:"Stylesheet",timestamp:1,request:{url,method:"GET",headers}});
		collector.failed({requestId:"1",errorText,canceled});
		assert.deepEqual(collector.snapshot().diagnostics.failures[0].failureEvent,{known:true,events:1,...expected});
		assert.equal(JSON.stringify(collector.snapshot()).includes("PRIVATE_RAW_FAILURE"),false);
	}
});

test("positive action errors retain only header and returned-string digests while staying strict",async()=>{
	const actionId="PRIVATE_ACTION_ID",message="PRIVATE_RETURNED_ERROR",id="a".repeat(32)+".1",hash=value=>createHash("sha256").update(value).digest("hex");
	const proxy=createProxyControlCollector({contextId});proxy.installed();
	proxy.request(id,{url,method:"POST",headers:{...headers,"next-action":actionId},traceId:"a".repeat(32)});
	proxy.response(id,{status:200,headers:responseHeaders});proxy.bytes(id,Buffer.from('0:'+JSON.stringify({a:{success:false,error:message}})+'\n'));proxy.end(id);await tick();
	const collector=createBrowserControlCollector({contextId,origin,proxyObservation:proxy.snapshot});collector.installed();collector.endScope();
	const result=collector.snapshot(),record=result.protocolErrors.records[0];
	assert.equal(result.protocolErrors.observed,1);assert.equal(record.explicitActionFailure,true);
	assert.equal(record.requestKind,"action");assert.equal(record.actionKnown,true);assert.equal(record.action,true);
	assert.deepEqual(record.nextActionHeader,{known:true,sha256:hash(actionId),provenance:"owned-proxy-request"});
	assert.deepEqual(record.returnedError,{known:true,utf8Bytes:Buffer.byteLength(message),sha256:hash(message)});
	assert.equal(cleanBrowserContextEvidence(contextId,result,0),false);
	assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ACTION_ID|PRIVATE_RETURNED_ERROR/);
});

test("installation preserves navigation arguments/results/errors and adds only declared identity metadata", async () => {
	let cookieReads = 0;
	const session = new EventEmitter(),
		calls = [],
		error = Error("original-error");
	session.send = async (method, args) => {
		calls.push([method, args]);
		return {};
	};
	session.detach = async () => calls.push(["detach"]);
	const args = [url, { waitUntil: "domcontentloaded" }];
	const page = Object.assign(new EventEmitter(),{ createCDPSession: async () => session });
	const goto = function (...actual) {
		assert.equal(this, page);
		assert.deepEqual(actual, args);
		return Promise.resolve("original-result");
	};
	page.goto = goto;
	page.reload = () => Promise.reject(error);
	page.goBack = async () => null;
	const transport = {
		setControlCancellationObserver(observer) {
			observer.installed();
			return () => 0;
		},
	};
	const f=await requestShapeTestBinding(),environmentBinding=await verifyBrowserControlBrowser({target:()=>({createCDPSession:async()=>({send:async()=>({revision:'@'+chromiumSWRRevision}),detach:async()=>{}})})},f.binding);
	const observer = await installBrowserControlCollector({
		page,
		context: { async cookies() { cookieReads++; return [{ name: "session", domain: "localhost", path: "/", value: "PRIVATE_COOKIE" }]; } },
		transport,
		origin,
		headers: { "Accept-Language": "en" },
		contextId,
		browserRevision: chromiumSWRRevision,
		environmentBinding,
	});
	assert.equal(await page.goto(...args), "original-result");
	await assert.rejects(page.reload(), (value) => value === error);
	assert.equal(
		calls.filter(([method]) => method === "Network.setExtraHTTPHeaders").length,
		2,
	);
	assert.equal(calls.find(([method])=>method==="Network.setExtraHTTPHeaders")[1].headers["Accept-Language"], "en");
	await observer.close({ deadlineMs: performance.now() + 1000 });
	assert.equal(page.goto, goto);
	assert.equal(cookieReads, 2);
	assert.equal(observer.snapshot().principalEpoch.matchesAtBoundaries, true);
	assert.equal(observer.snapshot().principalEpoch.stablePrincipalClaim, false);
	await rm(f.directory,{recursive:true,force:true});
});

test("the actual compiled unmarked fallback is passed identically to browser and proxy readers", async () => {
	for (const compiledCachedNavigations of [undefined, false]) {
		const proxy = createProxyControlCollector({
			contextId,
			compiledCachedNavigations,
		});
		proxy.installed();
		const unmarked = '0:{"t":{"t":{"s":""}}}\n';
		const collector = createBrowserControlCollector({
			contextId,
			origin,
			compiledCachedNavigations,
			proxyObservation: proxy.snapshot,
			readBody: async () => ({ body: unmarked, base64Encoded: false }),
		});
		collector.installed();
		collector.beginMeasurement();
		proxy.request("1", {
			url,
			method: "GET",
			headers,
			traceId: "a".repeat(32),
		});
		proxy.response("1", { status: 200, headers: responseHeaders });
		proxy.bytes("1", Buffer.from(unmarked));
		proxy.end("1");
		collector.request(event("1", 1));
		collector.requestExtra({ requestId: "1", headers });
		collector.response({
			requestId: "1",
			response: { status: 200, headers: responseHeaders, fromDiskCache: true },
		});
		collector.finished({ requestId: "1", timestamp: 2 });
		collector.endMeasurement();
		collector.endScope();
		await tick();
		await tick();
		const browser = collector.snapshot().bodyReceipts[0].bodyProof;
		const forwarded = proxy.snapshot().rows[0].bodyProof;
		assert.equal(browser.complete, compiledCachedNavigations === false);
		assert.deepEqual(browser, forwarded);
	}
});

test("segment readers receive actual request/response facts and the verified compiled deployment binding", async()=>{
	const compiledBinding=testBrowserBinding("b".repeat(40),{...testBrowserMetadata(),compiledManifestSha256:"c".repeat(64)});
	const staged='0:{"t":{"t":{"s":"","d":{"r":null,"p":"$@3","v":null,"s":"$4"}}},"a":"$@5","u":"$@6"}\n3:"$undefined"\n4:X\n4:60\n4:C\n5:null\n6:false\n';
	const requestHeaders={...headers,"next-router-segment-prefetch":"/_index"};
	const segmentHeaders={...responseHeaders,"x-nextjs-postponed":"2","x-nextjs-deployment-id":compiledBinding.compiledBuild};
	for(const missing of [null,"compiledBinding","x-nextjs-postponed","x-nextjs-deployment-id","RSC","next-router-prefetch","next-router-segment-prefetch"]){
		const actualRequest={...requestHeaders},actualResponse={...segmentHeaders};
		delete actualRequest[missing]; delete actualResponse[missing];
		const options={contextId,origin,compiledCachedNavigations:true,compiledBinding:missing==="compiledBinding"?undefined:compiledBinding};
		const proxy=createProxyControlCollector(options); proxy.installed();
		const collector=createBrowserControlCollector({...options,origin,proxyObservation:proxy.snapshot,
			readBody:async()=>({body:staged,base64Encoded:false})}); collector.installed();
		proxy.request("1",{url,method:"GET",headers:actualRequest,traceId:"a".repeat(32)});
		proxy.response("1",{status:200,headers:actualResponse});proxy.bytes("1",Buffer.from(staged));proxy.end("1");
		collector.request({...event("1",1),request:{...event("1",1).request,headers:actualRequest}});
		collector.response({requestId:"1",response:{status:200,headers:actualResponse,fromDiskCache:true}});
		collector.finished({requestId:"1",timestamp:2});collector.endScope();await tick();await tick();
		const receipt=collector.snapshot().bodyReceipts[0];
		const browser=receipt.bodyProof, forwarded=proxy.snapshot().rows[0].bodyProof;
		assert.equal(receipt.bodyReadbackReceipt.base64Encoded,false);
		assert.deepEqual(receipt.bodyReadbackReceipt.responseContentType,{headerKnown:true,mime:"text/x-component",charset:"absent"});
		assert.deepEqual(browser,forwarded,missing);
		assert.equal(browser.complete,missing===null,missing);
		if(missing===null){
			assert.equal(browser.segmentBinding.expectedDeploymentSha256,createHash("sha256").update(compiledBinding.compiledBuild).digest("hex"));
			assert.equal(browser.segmentBinding.requestKeySha256,controlRequestIdentity(contextId,url,"GET",actualRequest).headerFieldSha256["next-router-segment-prefetch"]);
		}
	}
});

test("measured selection uses the actual raw listener ID list rather than all-phase callback timing", () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		proxyObservation: proxy.snapshot,
		readBody: async () => ({ body: "", base64Encoded: false }),
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("inherited", 1));
	collector.failed({
		requestId: "inherited",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.recordMeasuredFailure("not-yet-observed");
	collector.endMeasurement();
	collector.endScope();
	const proof = collector.snapshot();
	assert.equal(proof.measured.rawFailedRequests, 1);
	assert.equal(proof.measured.records[0].requestId, "not-yet-observed");
	assert.equal(proof.measured.unknownFailures, 1);
	assert.equal(proof.measured.complete, false);
	assert.equal(proof.allPhase.rawFailedRequests, 1);
});

test("passive stream bytes survive canceled getBody and prove only exact naturally completed proxy protocol", async () => {
	for (const mode of ["exact", "gap", "different-proxy-body", "late-ack", "unsupported-flight"]) {
		const actionHeaders = { ...headers, "next-action": "b".repeat(40) };
		const bytes = Buffer.from(
			mode === "unsupported-flight" ? '0:{"a":PRIVATE_INVALID}\n' : '0:{"a":"$@1","q":"","i":false}\n1:{"result":true}\n',
		);
		const prefix = bytes.subarray(0, 13),
			tail = bytes.subarray(13);
		const proxy = createProxyControlCollector({ contextId });
		proxy.installed();
		let acknowledge;
		const collector = createBrowserControlCollector({
			contextId,
			origin,
			browserRevision: chromiumSWRRevision,
			proxyObservation: proxy.snapshot,
			readBody: async () => {
				throw Error("NoData");
			},
			readStream: () =>
				new Promise((resolve) => {
					acknowledge = resolve;
				}),
		});
		collector.installed();
		collector.beginMeasurement();
		const request = event("post", 1);
		request.request.method = "POST";
		request.request.headers = actionHeaders;
		const id = `${"a".repeat(32)}.4`;
		proxy.request(id, {
			url,
			method: "POST",
			headers: actionHeaders,
			traceId: "a".repeat(32),
		});
		proxy.response(id, { status: 200, headers: responseHeaders });
		proxy.bytes(
			id,
			mode === "different-proxy-body"
				? Buffer.from(bytes.toString().replace("true", "false"))
				: bytes,
		);
		proxy.end(id);
		collector.request(request);
		collector.requestExtra({ requestId: "post", headers: actionHeaders });
		collector.response({
			requestId: "post",
			response: {
				status: 200,
				headers: { ...responseHeaders, [controlResponseHeader]: id },
			},
		});
		collector.data({ requestId: "post", dataLength: prefix.length });
		await Promise.resolve();
		collector.data({
			requestId: "post",
			dataLength: tail.length,
			data: tail.toString("base64"),
		});
		collector.recordMeasuredFailure("post");
		collector.failed({
			requestId: "post",
			errorText: "net::ERR_ABORTED",
			canceled: true,
		});
		acknowledge({
			bufferedData: mode === "gap" ? "" : prefix.toString("base64"),
		});
		collector.endMeasurement();
		if (mode !== "late-ack") await tick();
		collector.endScope();
		await tick();
		await tick();
		const proof = collector.snapshot();
		assert.equal(proof.measured.rawFailedRequests, 1);
		assert.equal(proof.measured.provenControls, mode === "exact" ? 1 : 0);
		assert.equal(proof.measured.unknownFailures, mode === "exact" ? 0 : 1);
		assert.equal(proof.bodyReceipts[0].bodyReadbackComplete, false);
		if (["exact", "unsupported-flight"].includes(mode)) {
			const stream = proof.bodyReceipts[0].streamReceipt;
			assert.equal(stream.byteCoverageExact, true);
			assert.equal(stream.capturedBodySha256, createHash("sha256").update(bytes).digest("hex"));
			assert.equal(proxy.snapshot().rows[0].transportBodyReceipt.bodySha256, stream.capturedBodySha256);
			assert.equal(proxy.snapshot().rows[0].transportBodyReceipt.naturalEOF, true);
			if (mode === "unsupported-flight") assert.equal(proof.bodyReceipts[0].bodyProof.reason, "invalid-record");
		}
		assert.equal(
			proof.bodyReceipts[0].streamReceipt.terminal,
			mode === "late-ack" ? "scope-ended" : "failed",
		);
	}
});

test("positive protocol errors survive independent UNKNOWN reads in either completion order", async () => {
	for (const order of ["stream-first", "readback-first"])
		for (const kind of ["server-error", "action-failure", "unknown-only"]) {
			const bytes = Buffer.from(kind === "server-error" ? '0:E{"digest":"PRIVATE_CANARY"}\n' :
				kind === "action-failure" ? '0:{"a":{"success":false,"error":"PRIVATE_CANARY"}}\n' : '0:{"t":INVALID_STREAM}\n');
			let acknowledge, resolveRead;
			const collector = createBrowserControlCollector({ contextId, origin,compiledBinding:testBrowserBinding("b".repeat(40)),environmentObservation:()=>({temporaryValues:testEmptyTemporaryValues(contextId)}), browserRevision: chromiumSWRRevision, compiledCachedNavigations: false,
				proxyObservation: () => ({ rows: [], installed: true, errors: 0, overflow: 0, pendingBodies: 0 }),
				readBody: () => new Promise((resolve) => { resolveRead = resolve; }),
				readStream: () => new Promise((resolve) => { acknowledge = resolve; }) });
			collector.installed();
			const request = event("optional", 1);
			if (kind === "action-failure") { request.request.method = "POST"; request.request.headers = { ...headers, "next-action": "b".repeat(40) }; }
			collector.request(request);
			collector.requestExtra({ requestId: "optional", headers: request.request.headers });
			collector.response({ requestId: "optional", response: { status: 200, headers: responseHeaders } });
			collector.data({ requestId: "optional", dataLength: bytes.length });
			collector.failed({ requestId: "optional", errorText: "net::ERR_ABORTED", canceled: true });
			await tick();
			const unknownRead = { body: '0:{"t":INVALID_READBACK}\n', base64Encoded: false };
			if (order === "stream-first") { acknowledge({ bufferedData: bytes.toString("base64") }); await tick(); resolveRead(unknownRead); }
			else { resolveRead(unknownRead); await tick(); acknowledge({ bufferedData: bytes.toString("base64") }); }
			await tick();
			collector.beginMeasurement(); collector.endMeasurement(); collector.endScope();
			const proof = collector.snapshot();
			assert.equal(proof.measured.rawFailedRequests, 0);
			assert.equal(proof.allPhase.coverage.pendingBodies, 0);
			assert.equal(proof.protocolErrors.observed, kind === "unknown-only" ? 0 : 1, order + kind);
			assert.equal(proof.allPhase.realFailures, kind === "unknown-only" ? 0 : 1, order + kind);
			assert.equal(cleanBrowserContextEvidence(contextId, proof, 0), kind === "unknown-only", order + kind);
			if (kind !== "unknown-only") {
				assert.equal(proof.protocolErrors.records[0].capture, "passive-stream");
				assert.equal(proof.protocolErrors.records[0].bodySha256, createHash("sha256").update(bytes).digest("hex"));
			}
			assert.doesNotMatch(JSON.stringify(proof), /PRIVATE_CANARY/);
		}
});

test("mixed document acknowledgments use the actual unique CDP context and bracket document/loader/generation",async()=>{
 const api=await import("./browser-control-collector.mjs");
 const session=new EventEmitter();const calls=[];let changed=false,generation=4;
 const frame=()=>({frameTree:{frame:{id:"frame",loaderId:changed?"new-loader":"loader",url:"http://localhost:1234/en"}}});
 const worker={scriptURL:"http://localhost:1234/sw.js",state:"activated"};
 session.send=async(method,args)=>{calls.push({method,args});if(method==="Runtime.enable")session.emit("Runtime.executionContextCreated",{context:{id:1,uniqueId:"actual-unique",auxData:{isDefault:true,frameId:"frame"}}});if(method==="Page.getFrameTree")return frame();if(method==="Runtime.evaluate")return {result:{value:{available:true,secureContext:true,origin:"http://localhost:1234",documentIdentityStable:true,controllerIdentityStable:true,controllerBefore:worker,controllerAfter:worker,registrationCount:1,registrationOverflow:0,registrations:[{scope:"http://localhost:1234/",active:worker,waiting:null,installing:null}]}}};return {};};
 const principal=createPrincipalEpochObserver("ctx",{origin:"http://localhost:1234"});const cookies=[{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}];principal.start(cookies);
 const tracker=await api.createMixedDocumentAcknowledgment({session,contextId:"ctx",origin:"http://localhost:1234",generation:()=>generation});
 session.emit("Network.requestWillBeSent",{requestId:"doc",type:"Document",frameId:"frame",loaderId:"loader",request:{url:"http://localhost:1234/en",headers:{"x-z8-fixture-document-generation":"ctx:4"}}});
 const read=()=>tracker.read({checkpointOrdinal:1,deadlineMs:performance.now()+100,principalEpoch:principal,readCookies:async()=>cookies,readSources:async()=>({technical:true})});
 const good=await read();assert.equal(good.readErrors,0);assert.equal(good.pendingOperations,0);assert.equal(good.document.executionContextUniqueId,"actual-unique");assert.equal(good.document.documentGeneration,4);assert.equal(good.controller.controllerIdentityStable,true);
 assert.equal(calls.find(c=>c.method==="Runtime.evaluate").args.uniqueContextId,"actual-unique");assert.equal(principal.snapshot().scopeClosed,false);
 // Missing/changed actual ownership cannot fall back to another context or to timestamps.
 generation=5;const bad=await tracker.read({checkpointOrdinal:2,deadlineMs:performance.now()+100,principalEpoch:principal,readCookies:async()=>cookies,readSources:async()=>({})});assert.equal(bad.document,null);assert.equal(bad.readErrors,1);
 tracker.close();
});

test("mixed document acknowledgments retain pending/read-error facts across timeout and navigation",async()=>{
 const api=await import("./browser-control-collector.mjs");const session=new EventEmitter();let resolveCookie;
 session.send=async(method)=>{if(method==="Runtime.enable")session.emit("Runtime.executionContextCreated",{context:{id:1,uniqueId:"unique",auxData:{isDefault:true,frameId:"frame"}}});if(method==="Page.getFrameTree")return {frameTree:{frame:{id:"frame",loaderId:"loader",url:"http://localhost:1234/en"}}};if(method==="Runtime.evaluate"){session.emit("Runtime.executionContextDestroyed",{executionContextId:1});return {result:{value:{available:false}}};}return {};};
 const tracker=await api.createMixedDocumentAcknowledgment({session,contextId:"ctx",origin:"http://localhost:1234",generation:()=>1});
 session.emit("Network.requestWillBeSent",{requestId:"doc",type:"Document",frameId:"frame",loaderId:"loader",request:{url:"http://localhost:1234/en",headers:{"x-z8-fixture-document-generation":"ctx:1"}}});
 const principal=createPrincipalEpochObserver("ctx",{origin:"http://localhost:1234"});principal.start([]);
 const ack=await tracker.read({checkpointOrdinal:1,deadlineMs:performance.now()+10,principalEpoch:principal,readCookies:()=>new Promise(resolve=>{resolveCookie=resolve;}),readSources:async()=>({})});
 assert.equal(ack.timedOut,true);assert.equal(ack.pendingOperations,1);assert.equal(ack.readErrors,1);assert.equal(ack.document,null);assert.equal(principal.snapshot().pendingReads,1);
 resolveCookie([]);await tick();assert.equal(ack.pendingOperations,1,"late completion does not rewrite a sealed failed receipt");assert.equal(principal.snapshot().pendingReads,0);tracker.close();
});

test("mixed failure occurrence CORE uses actual callback ordinals and retains duplicate/error evidence",async()=>{
 const collector=createBrowserControlCollector({contextId,origin,captureContextFailures:true,compiledCachedNavigations:false,readBody:async()=>({body,base64Encoded:false}),proxyObservation:()=>({rows:[],installed:true,errors:0,overflow:0,pendingBodies:0})});
 collector.installed();collector.beginMeasurement();collector.request(event("failed",1));collector.requestExtra({requestId:"failed",headers});collector.response({requestId:"failed",response:{status:200,headers:responseHeaders}});collector.data({requestId:"failed",dataLength:Buffer.byteLength(body)});collector.failed({requestId:"failed",errorText:"net::ERR_ABORTED",canceled:true});collector.endMeasurement();collector.endScope();await tick();
 const proof=collector.snapshot();assert.deepEqual(proof.browserFailureOccurrences.records,[{requestId:"failed",eventOrdinal:5,failedEvents:1}]);assert.equal(proof.browserFailureOccurrences.browserEventOrdinal,5);assert.equal(proof.browserFailureOccurrences.scopeClosed,true);assert.equal(proof.rawMeasuredFailedRequests,1);assert.equal(proof.measured.unknownFailures,1,"Technical occurrence facts do not make the unread/unmatched response a control.");
 collector.failed({requestId:"failed",errorText:"net::ERR_ABORTED",canceled:true});const duplicate=collector.snapshot();assert.equal(duplicate.browserFailureOccurrences.records[0].eventOrdinal,5);assert.equal(duplicate.browserFailureOccurrences.records[0].failedEvents,2);assert.equal(duplicate.browserEventOrdinal,6);assert.ok(duplicate.measured.coverage.errors>0);
});


async function requestShapeTestBinding() {
 const directory=await mkdtemp(join(tmpdir(),"z8-request-shape-")),manifestPath=join(directory,"required-server-files.json"),build="c".repeat(40),actionId="40"+"a".repeat(40);
 const registry=Buffer.from(JSON.stringify({node:{[actionId]:{filename:teamAnnualModule,exportedName:"getTeamPerformanceData",workers:Object.fromEntries(teamAnnualWorkers.map(key=>[key,{moduleId:1,async:true}]))}},edge:{}}));
 const manifest=Buffer.from(JSON.stringify({config:{deploymentId:build,experimental:{cachedNavigations:true}}}));
 await mkdir(join(directory,"server"));await writeFile(manifestPath,manifest);await writeFile(join(directory,"server/server-reference-manifest.json"),registry);
 const diagnostic={protocol:"request-shape-diagnostic-v1",compiledBuild:build,compiledManifestSha256:segmentHash(manifest),actionRegistrySha256:segmentHash(registry),actionHeaderSha256:segmentHash(actionId),actionName:"getTeamPerformanceData"};
 const plan={runtime:{build,browserControl:{policy:controlCancellationPolicy,temporaryValueObservation:structuredClone(temporaryValueObservation),originalTeamSource:null,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:segmentHash(manifest),requestShapeDiagnostic:diagnostic}}};
 const binding=await readBrowserControlBinding({plan,manifestPath});return {directory,manifestPath,plan,binding,actionId};
}
const segmentHash=value=>createHash("sha256").update(value).digest("hex");
const requestShapeHeaders=actionId=>({"next-action":actionId,"content-type":"text/plain;charset=UTF-8"});
const requestShapeBytes=()=>Buffer.from(JSON.stringify([{start:"$D2025-01-01T00:00:00.000Z",end:"$D2025-12-31T23:59:59.999Z",startDate:"2025-01-01",endDate:"2025-12-31",timezone:"PRIVATE_ZONE"}]));

test("request-shape diagnostic verifies actual registry before capture and rejects copied or mismatched authority",async()=>{
 const f=await requestShapeTestBinding();try{
  const proxy=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});proxy.installed();
  assert.equal(proxy.request("a".repeat(32)+".1",{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)}),true);
  assert.throws(()=>createProxyControlCollector({contextId,origin,compiledBinding:{...f.binding}}),/request.shape/i);
  for(const field of ["compiledBuild","compiledManifestSha256","actionRegistrySha256","actionHeaderSha256","actionName"]){
   const plan=structuredClone(f.plan);plan.runtime.browserControl.requestShapeDiagnostic[field]="wrong";
   await assert.rejects(readBrowserControlBinding({plan,manifestPath:f.manifestPath}),/request.shape/i);
  }
  await writeFile(join(f.directory,"server/server-reference-manifest.json"),JSON.stringify({node:{[f.actionId]:{filename:teamAnnualModule,exportedName:"getTeamPerformanceData",workers:Object.fromEntries(teamAnnualWorkers.map(key=>[key,{moduleId:1,async:true}]))}},edge:{},changed:true}));
  await assert.rejects(readBrowserControlBinding({plan:f.plan,manifestPath:f.manifestPath}),/request.shape/i);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("request-shape diagnostic reports real request EOF and fixed shape facts without values or admission",async()=>{
 const f=await requestShapeTestBinding();try{
  const proxy=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});proxy.installed();const id="a".repeat(32)+".1",bytes=requestShapeBytes();
  assert.equal(proxy.request(id,{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)}),true);
  proxy.requestBodyBytes(id,bytes.subarray(0,7));proxy.requestBodyBytes(id,bytes.subarray(7));
  assert.equal(proxy.snapshot().requestShapeDiagnostics.pendingRequests,1);
  proxy.response(id,{status:200,headers:responseHeaders});proxy.end(id);await tick();
  assert.equal(proxy.snapshot().requestShapeDiagnostics.rows[0].requestEOF,false,"upstream response EOF is not incoming request EOF");
  proxy.requestBodyEnd(id);assert.equal(proxy.snapshot().requestShapeDiagnostics.pendingParses,1);await tick();
  const diagnostic=proxy.snapshot().requestShapeDiagnostics,row=diagnostic.rows[0];
  assert.equal(row.requestEOF,true);assert.equal(row.encodedBytes,bytes.length);assert.equal(row.bodySha256,segmentHash(bytes));
  assert.equal(row.shape.jsonParsed,true);assert.equal(row.shape.rootKind,"array");assert.equal(row.shape.argumentCount,1);
  assert.equal(row.shape.fields.start.type,"date-string");assert.equal(row.shape.fields.start.canonicalDate,true);
  assert.equal(row.shape.unknownKeys,0);assert.equal(row.shape.duplicateKeyStatus,"not-inspected");assert.equal(row.shape.known,false);
  assert.equal(diagnostic.pendingRequests,0);assert.equal(diagnostic.pendingParses,0);assert.equal(diagnostic.acceptanceClaim,"none");
  assert.doesNotMatch(JSON.stringify(diagnostic),/2025-01|PRIVATE_ZONE|\$D|40aaaaaaaa/);
  const plain=createProxyControlCollector({contextId,origin});plain.installed();plain.request(id,{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)});
  assert.equal(Object.hasOwn(plain.snapshot(),"requestShapeDiagnostics"),false);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("request-shape diagnostic keeps incomplete, late, unsupported and bounded observations explicit",async()=>{
 const f=await requestShapeTestBinding();try{
  const make=()=>{const p=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});p.installed();return p;},id="a".repeat(32)+".1";
  const start=(p,headers=requestShapeHeaders(f.actionId))=>p.request(id,{url,method:"POST",headers,traceId:"a".repeat(32)});
  const aborted=make();start(aborted);aborted.requestBodyBytes(id,Buffer.from("["));aborted.requestBodyFailure(id,"aborted");
  assert.equal(aborted.snapshot().requestShapeDiagnostics.rows[0].requestEOF,false);assert.equal(aborted.snapshot().requestShapeDiagnostics.rows[0].bodySha256,null);
  const late=make();start(late);late.requestBodyBytes(id,requestShapeBytes());late.requestBodyEnd(id);await tick();late.requestBodyBytes(id,Buffer.from(" "));late.requestBodyEnd(id);
  assert.ok(late.snapshot().requestShapeDiagnostics.errors>=2);
  const oversized=make();start(oversized);oversized.requestBodyBytes(id,Buffer.alloc(16385,65));oversized.requestBodyEnd(id);await tick();
  assert.ok(oversized.snapshot().requestShapeDiagnostics.overflow>0);assert.equal(oversized.snapshot().requestShapeDiagnostics.rows[0].bodySha256,null);
  for(const [body,reason]of [["[[[]]]","shape-depth-limit"],["["+"0,".repeat(40)+"0]","shape-work-limit"],["[}","invalid-json"]]){
   const p=make();start(p);p.requestBodyBytes(id,Buffer.from(body));p.requestBodyEnd(id);await tick();assert.equal(p.snapshot().requestShapeDiagnostics.rows[0].shape.reason,reason);
  }
  const unknown=make();unknown.requestBodyEnd(id);assert.equal(unknown.snapshot().requestShapeDiagnostics.errors,1);
  const unselected=make();assert.equal(unselected.request(id,{url,method:"POST",headers:requestShapeHeaders("wrong"),traceId:"a".repeat(32)}),undefined);assert.equal(unselected.snapshot().requestShapeDiagnostics.selected,0);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("request-shape diagnostic shares the proxy response reservation ceiling and never supplies a second pool",async()=>{
 const f=await requestShapeTestBinding();try{
  const proxy=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});proxy.installed();
  for(let n=1;n<=8;n++){const id="a".repeat(32)+"."+n;proxy.request(id,{url,method:"GET",headers,traceId:"a".repeat(32)});proxy.response(id,{status:200,headers:responseHeaders});proxy.bytes(id,Buffer.alloc(controlCancellationPolicy.encodedLimit));}
  const id="a".repeat(32)+".9";proxy.request(id,{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)});
  const diagnostic=proxy.snapshot().requestShapeDiagnostics;
  assert.ok(diagnostic.overflow>0);assert.equal(diagnostic.unretainedSelections,1);assert.equal(diagnostic.rows.length,0);
  assert.equal(diagnostic.pendingRequests,null,"Lost request identity cannot manufacture a known zero pending count.");
 }finally{await rm(f.directory,{recursive:true,force:true});}
});


test("request-shape diagnostic preparse limits, encoding and closure never turn unavailable facts into completeness",async()=>{
 const f=await requestShapeTestBinding();try{
  const id="a".repeat(32)+".1",make=()=>{const p=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});p.installed();return p;};
  const start=(p,h=requestShapeHeaders(f.actionId))=>p.request(id,{url,method:"POST",headers:h,traceId:"a".repeat(32)});
  const exact=make();start(exact);const bytes=Buffer.from('["'+"X".repeat(16380)+'"]');assert.equal(bytes.length,16384);exact.requestBodyBytes(id,bytes);exact.requestBodyEnd(id);await tick();
  assert.equal(exact.snapshot().requestShapeDiagnostics.rows[0].bodySha256,segmentHash(bytes));assert.equal(exact.snapshot().requestShapeDiagnostics.overflow,0);assert.equal(exact.snapshot().requestShapeDiagnostics.rows[0].shape.known,false);
  for(const body of ['[{"PRIVATE_KEY":"PRIVATE_VALUE"}]','[{"start":"$Dinvalid","start":"$D2025-01-01T00:00:00.000Z"}]']){
   const p=make();start(p);p.requestBodyBytes(id,Buffer.from(body));p.requestBodyEnd(id);await tick();const row=p.snapshot().requestShapeDiagnostics.rows[0];
   assert.equal(row.shape.known,false);assert.equal(row.shape.duplicateKeyStatus,"not-inspected");assert.doesNotMatch(JSON.stringify(row),/PRIVATE_KEY|PRIVATE_VALUE|2025-01/);
  }
  const encoding=make();start(encoding,{...requestShapeHeaders(f.actionId),"content-type":"multipart/form-data; boundary=PRIVATE"});encoding.requestBodyBytes(id,Buffer.from("PRIVATE_BODY"));encoding.requestBodyEnd(id);await tick();
  assert.equal(encoding.snapshot().requestShapeDiagnostics.rows[0].shape.reason,"unsupported-request-encoding");assert.doesNotMatch(JSON.stringify(encoding.snapshot().requestShapeDiagnostics),/PRIVATE/);
  const pending=make();start(pending);pending.transportClosed({serverClosed:false,acceptedRequests:1,upstreamRequests:1,closedUpstreams:0,pendingUpstreams:1});
  assert.equal(pending.snapshot().requestShapeDiagnostics.closed,false);assert.equal(pending.snapshot().requestShapeDiagnostics.pendingRequests,1);
  const closed=make();start(closed);closed.transportClosed({serverClosed:true,acceptedRequests:1,upstreamRequests:1,closedUpstreams:1,pendingUpstreams:0});
  const row=closed.snapshot().requestShapeDiagnostics.rows[0];assert.equal(row.requestEOF,false);assert.equal(row.bodySha256,null);assert.equal(row.terminal,"transport-closed-without-request-end");assert.equal(closed.snapshot().requestShapeDiagnostics.complete,false);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("request-shape diagnostic reserves parse work before allocation while other proxy bodies remain retained",async()=>{
 const f=await requestShapeTestBinding();try{
  const p=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});p.installed();const chunk=Buffer.alloc(controlCancellationPolicy.encodedLimit),bytes=requestShapeBytes();
  for(let n=1;n<=8;n++){const id="a".repeat(32)+"."+n;p.request(id,{url,method:"GET",headers,traceId:"a".repeat(32)});p.response(id,{status:200,headers:responseHeaders});p.bytes(id,n===8?chunk.subarray(0,chunk.length-2048-16384-1):chunk);}
  const id="a".repeat(32)+".9";assert.equal(p.request(id,{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)}),true);p.requestBodyBytes(id,bytes);p.requestBodyEnd(id);await tick();
  const diagnostic=p.snapshot().requestShapeDiagnostics,row=diagnostic.rows[0];assert.equal(row.requestEOF,true);assert.equal(row.bodySha256,null);assert.equal(row.shape.reason,"request-parse-reservation");assert.ok(diagnostic.overflow>0);assert.equal(diagnostic.pendingParses,0);assert.ok(diagnostic.sharedProxyRetainedBytes<=controlCancellationPolicy.retainedLimit);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});


test("request-shape diagnostic assembles split UTF-8 without normalizing invalid encoding or BOM",async()=>{
 const f=await requestShapeTestBinding();try{
  const id="a".repeat(32)+".1",run=async bytes=>{const p=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});p.installed();p.request(id,{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)});for(let n=0;n<bytes.length;n++)p.requestBodyBytes(id,bytes.subarray(n,n+1));p.requestBodyEnd(id);await tick();return p.snapshot().requestShapeDiagnostics.rows[0];};
  const bytes=Buffer.from('[{"timezone":"PRIVATE_é_ZONE"}]');const row=await run(bytes);assert.equal(row.bodySha256,segmentHash(bytes));assert.equal(row.shape.jsonParsed,true);assert.equal(row.shape.fields.timezone.type,"string");assert.doesNotMatch(JSON.stringify(row),/PRIVATE|é/);
  const invalid=await run(Buffer.from([91,34,255,34,93]));assert.equal(invalid.shape.reason,"invalid-utf8");
  const bom=await run(Buffer.concat([Buffer.from([239,187,191]),requestShapeBytes()]));assert.equal(bom.shape.reason,"invalid-json");
 }finally{await rm(f.directory,{recursive:true,force:true});}
});


test("request-shape diagnostic bounds empty byte-event bookkeeping without retaining chunk objects",async()=>{
 const f=await requestShapeTestBinding();try{
  const p=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});p.installed();const id="a".repeat(32)+".1";
  p.request(id,{url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)});
  for(let n=0;n<=controlCancellationPolicy.recordLimit;n++)p.requestBodyBytes(id,Buffer.alloc(0));p.requestBodyEnd(id);await tick();
  const diagnostic=p.snapshot().requestShapeDiagnostics;assert.ok(diagnostic.overflow>0);assert.equal(diagnostic.rows[0].encodedBytes,0);assert.equal(diagnostic.rows[0].bodySha256,null);assert.equal(diagnostic.sharedProxyRetainedBytes,2048);assert.equal(diagnostic.pendingParses,0);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});


test("request-shape registry parse failures expose only a fixed safe error",async()=>{
 const f=await requestShapeTestBinding();try{
  const sentinel="CONFIDENTIAL_REGISTRY_SENTINEL",bytes=Buffer.from('{"private":"'+sentinel+'",BROKEN}');
  await writeFile(join(f.directory,"server/server-reference-manifest.json"),bytes);const plan=structuredClone(f.plan);plan.runtime.browserControl.requestShapeDiagnostic.actionRegistrySha256=segmentHash(bytes);
  await assert.rejects(readBrowserControlBinding({plan,manifestPath:f.manifestPath}),error=>{
   assert.equal(error.name,"Error");assert.equal(error.message==="Compiled annual team action source is unavailable or differs.",true,"The mandatory registry read rejects malformed JSON before request-shape admission, using a fixed message.");assert.equal(error.cause===undefined,true);
   assert.equal([error.name,error.message,error.stack,String(error)].join("\n").includes(sentinel),false,"Registry errors must not expose source bytes.");return true;
  });
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("request-shape rejected duplicate target records uncertainty without rewriting or reallocating the first row",async()=>{
 const f=await requestShapeTestBinding();try{
  const p=createProxyControlCollector({contextId,origin,compiledBinding:f.binding});p.installed();const id="a".repeat(32)+".1",bytes=requestShapeBytes(),input={url,method:"POST",headers:requestShapeHeaders(f.actionId),traceId:"a".repeat(32)};
  assert.equal(p.request(id,input),true);p.requestBodyBytes(id,bytes.subarray(0,5));const before=p.snapshot().requestShapeDiagnostics;
  assert.equal(p.request(id,input),undefined);const duplicate=p.snapshot().requestShapeDiagnostics;
  assert.deepEqual(duplicate.rows,before.rows);assert.equal(duplicate.sharedProxyRetainedBytes,before.sharedProxyRetainedBytes);
  assert.equal(duplicate.selected,2);assert.equal(duplicate.unretainedSelections,1);assert.equal(duplicate.errors,1);assert.equal(duplicate.pendingRequests,null);
  p.requestBodyBytes(id,bytes.subarray(5));p.requestBodyEnd(id);await tick();
  const completed=p.snapshot().requestShapeDiagnostics;assert.equal(completed.rows.length,1);assert.equal(completed.rows[0].requestEOF,true);assert.equal(completed.rows[0].bodySha256,segmentHash(bytes));assert.equal(completed.unretainedSelections,1);assert.equal(completed.pendingRequests,null);assert.equal(completed.sharedProxyRetainedBytes,2048);
  p.requestBodyFailure(id,"close");p.transportClosed({serverClosed:true,acceptedRequests:1,upstreamRequests:1,closedUpstreams:1,pendingUpstreams:0});
  const closed=p.snapshot().requestShapeDiagnostics;assert.equal(closed.unretainedSelections,1);assert.equal(closed.pendingRequests,null);assert.equal(closed.complete,false);assert.equal(closed.sharedProxyRetainedBytes,2048);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test("source scheduler retains actual events during a pending read without backfilling the old request cut", async () => {
 const {createTeamSourceReadScheduler}=await import("./browser-control-collector.mjs");
 const makeToken=id=>({contextId:"source",documentRequestId:id,frameId:"frame",loaderId:"loader",executionContextUniqueId:"context",documentGeneration:1,executionEventOrdinal:1,documentEventOrdinal:1});let token=null,releaseFirst,reads=0,retained=0;const accepted=[],deadlines=[];
 const scheduler=createTeamSourceReadScheduler({ready:()=>token,reserve:bytes=>{retained+=bytes;return true;},release:bytes=>{retained-=bytes;},
  async read(actual,deadline){reads++;deadlines.push(deadline);if(reads===1)await new Promise(resolve=>{releaseFirst=resolve;});return {record:{checkpointOrdinal:reads,issuedCut:{event:actual.documentRequestId}},cut:actual,failed:false};},accept:cut=>{accepted.push(cut.documentRequestId);return true;}});
 assert.equal(scheduler.event(),false);await tick();assert.equal(reads,0);
 token=makeToken("document-one-default");assert.equal(scheduler.event(),true);await tick();assert.equal(reads,1);
 token=makeToken("document-two-default");assert.equal(scheduler.event(),true);assert.equal(scheduler.snapshot().pending,2);releaseFirst();
 await tick();await tick();assert.equal(reads,2);assert.deepEqual(accepted,["document-two-default"]);assert.equal(scheduler.snapshot().records[0].issuedCut,null);assert.equal(scheduler.snapshot().unavailable,1);assert.equal(scheduler.snapshot().errors,0);
 assert.ok(deadlines.every(value=>Number.isFinite(value)));assert.ok(deadlines[1]>=deadlines[0]);assert.equal(scheduler.snapshot().pending,0);assert.ok(retained>0);
 scheduler.close();assert.equal(scheduler.snapshot().scopeClosed,true);
});
test("source scheduler keeps stable read failures and unfinished close explicit", async () => {
 const {createTeamSourceReadScheduler}=await import("./browser-control-collector.mjs");let resolveRead;
 const scheduler=createTeamSourceReadScheduler({ready:()=>({contextId:"source",documentRequestId:"known-default",frameId:"frame",loaderId:"loader",executionContextUniqueId:"context",documentGeneration:1,executionEventOrdinal:1,documentEventOrdinal:1}),reserve:()=>true,release:()=>{},read:()=>new Promise(resolve=>{resolveRead=resolve;}),accept:()=>{throw Error("must not accept");}});
 scheduler.event();await tick();scheduler.close();assert.equal(scheduler.snapshot().pending,1);assert.equal(scheduler.snapshot().errors,1);
 resolveRead({record:{issuedCut:null},cut:null,failed:true});await tick();assert.equal(scheduler.snapshot().pending,0);assert.equal(scheduler.snapshot().errors,2);assert.equal(scheduler.snapshot().scopeClosed,true);
});
test("source readiness requires the actual new default context rather than the previous document's context", async () => {
 const {createMixedDocumentAcknowledgment}=await import("./browser-control-collector.mjs");const session=new EventEmitter();session.send=async()=>({});let generation=0,events=0;
 const observer=await createMixedDocumentAcknowledgment({session,contextId:"ready-context",origin,generation:()=>generation,onSourceEvent:()=>{events++;}});
 session.emit("Runtime.executionContextCreated",{context:{id:1,uniqueId:"blank-context",auxData:{frameId:"main-frame",isDefault:true}}});assert.equal(observer.sourceReady(),null);
 generation=1;session.emit("Network.requestWillBeSent",{type:"Document",requestId:"doc-one",frameId:"main-frame",loaderId:"loader-one",request:{url:origin+"/en",method:"GET",headers:{[controlDocumentHeader]:"ready-context:1"}}});
 assert.equal(observer.sourceReady(),null);
 session.emit("Runtime.executionContextDestroyed",{executionContextId:1});session.emit("Runtime.executionContextCreated",{context:{id:2,uniqueId:"actual-context",auxData:{frameId:"main-frame",isDefault:true}}});
 assert.equal(observer.sourceReady().executionContextUniqueId,"actual-context");assert.equal(observer.sourceReady().documentRequestId,"doc-one");assert.ok(events>=2);observer.close();
});

test("source subset guards run before source snapshots while default mixed history retains its actual full bounds",async()=>{
 const session=new EventEmitter();session.send=async()=>({});let generation=0;
 const {createMixedDocumentAcknowledgment}=await import("./browser-control-collector.mjs");
 const observer=await createMixedDocumentAcknowledgment({session,contextId:"bounded-source",origin,generation:()=>generation});
 for(let index=1;index<=129;index++){generation=index;session.emit("Network.requestWillBeSent",{type:"Document",requestId:"doc-"+index,frameId:"frame",loaderId:"loader-"+index,request:{url:origin+"/en",method:"GET",headers:{[controlDocumentHeader]:"bounded-source:"+index}}});}
 session.emit("Runtime.executionContextCreated",{context:{id:1,uniqueId:"context",auxData:{frameId:"frame",isDefault:true}}});
 assert.equal(observer.sourceReady(),null);assert.equal(observer.sourceSnapshot(),null);assert.equal(observer.snapshot().documents.length,129);assert.equal(observer.snapshot().overflow,0);observer.close();
});

async function sourceSupersessionFixture({sourceMode=true,scheduleEvents=false,onFrame,onEvaluate,onCookies,onSources}={}) {
 const {createMixedDocumentAcknowledgment,createTeamSourceReadScheduler}=await import('./browser-control-collector.mjs');
 const session=new EventEmitter(),cookies=[{name:'session',value:'synthetic',domain:'localhost',path:'/',httpOnly:true}];
 const worker={scriptURL:origin+'/sw.js',state:'activated'};
 let tracker,scheduler,evaluations=0,frames=0,sourceEvents=0;
 const nondefault=()=>session.emit('Runtime.executionContextCreated',{context:{id:4,uniqueId:'nondefault-4',auxData:{isDefault:false,frameId:'frame'}}});
 session.send=async(method)=>{
  if(method==='Page.getFrameTree'){frames++;await onFrame?.({nondefault,session,frames});return {frameTree:{frame:{id:'frame',loaderId:'loader',url:origin+'/en'}}};}
  if(method==='Runtime.evaluate'){
   evaluations++;const replacement=await onEvaluate?.({nondefault,session,evaluations});if(replacement && typeof replacement==='object')return replacement;
   return {result:{value:{available:true,secureContext:true,origin,documentIdentityStable:true,controllerIdentityStable:true,controllerBefore:worker,controllerAfter:worker,registrationCount:1,registrationOverflow:0,registrations:[{scope:origin+'/',active:worker,waiting:null,installing:null}]}}};
  }
  return {};
 };
 tracker=await createMixedDocumentAcknowledgment({session,contextId:'source',origin,generation:()=>1,onSourceEvent:()=>{sourceEvents++;if(scheduleEvents)scheduler?.event();}});
 session.emit('Runtime.executionContextCreated',{context:{id:2,uniqueId:'initial-nondefault-2',auxData:{isDefault:false,frameId:'frame'}}});
 session.emit('Runtime.executionContextCreated',{context:{id:1,uniqueId:'initial-default-1',auxData:{isDefault:true,frameId:'frame'}}});
 session.emit('Runtime.executionContextsCleared');session.emit('Runtime.executionContextsCleared');
 session.emit('Network.requestWillBeSent',{type:'Document',requestId:'document',frameId:'frame',loaderId:'loader',request:{url:origin+'/en',method:'GET',headers:{[controlDocumentHeader]:'source:1'}}});
 session.emit('Runtime.executionContextCreated',{context:{id:3,uniqueId:'default-3',auxData:{isDefault:true,frameId:'frame'}}});
 const principal=createPrincipalEpochObserver('source',{origin});principal.start(cookies);let ordinal=0;
 const read=async(token,deadlineMs)=>tracker.read({checkpointOrdinal:++ordinal,deadlineMs,principalEpoch:principal,
  ...(sourceMode?{sourceSubsetLimit:128,sourceEvent:token}:{}),readCookies:async()=>{await onCookies?.({nondefault,session});return cookies;},readSources:async()=>{await onSources?.({nondefault,session});return {technical:true};}});
 const accepted=[];
 scheduler=createTeamSourceReadScheduler({ready:()=>tracker.sourceReady(),reserve:()=>true,release:()=>{},
  read:async(token,deadline)=>{const ack=await read(token,deadline);return {record:{acknowledgment:ack,issuedCut:ack.document},cut:ack.document,failed:ack.timedOut!==false||ack.pendingOperations!==0||ack.readErrors!==0};},accept:cut=>{accepted.push(cut);return true;}});
 return {session,tracker,scheduler,read,accepted,nondefault,sourceEvents:()=>sourceEvents,evaluations:()=>evaluations,close(){scheduler.close();tracker.close();}};
}

test('source ACK supersession queues the actual nondefault event and never backfills the old cut',async()=>{
 const f=await sourceSupersessionFixture({scheduleEvents:true,onEvaluate:({nondefault,evaluations})=>{if(evaluations===1)nondefault();}});
 try{
  f.scheduler.event();for(let n=0;n<5;n++)await tick();
  const journal=f.scheduler.snapshot();assert.equal(journal.errors,0);assert.equal(journal.pending,0);assert.equal(journal.unavailable,1);
  assert.equal(journal.records.length,2);assert.equal(journal.records[0].acknowledgment.sourceSuperseded,true);
  assert.equal(journal.records[0].acknowledgment.readErrors,0);assert.equal(journal.records[0].issuedCut,null);
  assert.equal(journal.records[0].sourceEvent.executionEventOrdinal,5);
  assert.equal(journal.records[1].sourceEvent.executionEventOrdinal,6);assert.equal(journal.records[1].acknowledgment.sourceSuperseded,false);
  assert.equal(f.accepted.length,1);assert.equal(f.accepted[0].executionEventOrdinalBefore,6);
  assert.equal(journal.records[0].observerDeadlineMs,journal.records[0].eventObservedAtMs+10000);
  assert.equal(journal.records[1].observerDeadlineMs,journal.records[1].eventObservedAtMs+10000);
  assert.equal(f.scheduler.event(),false,'the same actual event cannot renew its deadline or start another read');
  assert.deepEqual(f.scheduler.snapshot().records,journal.records);
 }finally{f.close();}
});

test('source ACK real faults stay sticky despite the same actual context supersession',async()=>{
 for(const kind of ['cdp','malformed-envelope','malformed-value','cookie','source','frame']){
  let f;
  const options={onEvaluate:({nondefault})=>{nondefault();if(kind==='cdp')throw Error('PRIVATE_CDP_SENTINEL');if(kind==='malformed-envelope')return {exceptionDetails:{text:'PRIVATE_CDP_SENTINEL'}};if(kind==='malformed-value')return {result:{value:{documentIdentityStable:true}}};if(kind==='frame')f.session.send=async()=>{throw Error('PRIVATE_FRAME_SENTINEL');};}};
  if(kind==='cookie')options.onCookies=()=>{throw Error('PRIVATE_COOKIE_SENTINEL');};
  if(kind==='source')options.onSources=()=>{throw Error('PRIVATE_SOURCE_SENTINEL');};
  f=await sourceSupersessionFixture(options);
  try{
   const ack=await f.read(f.tracker.sourceReady(),performance.now()+1000);
   assert.ok(ack.readErrors>0,kind);assert.equal(ack.document,null,kind);assert.equal(ack.pendingOperations,0,kind);
   if(['cookie','source'].includes(kind))assert.equal(ack.sourceSuperseded,true,kind);
   else assert.equal(ack.sourceSuperseded,false,kind);
   assert.doesNotMatch(JSON.stringify(ack),/PRIVATE_/);
  }finally{f.close();}
 }
});

test('default mixed ACK retains its existing error on a nondefault context change',async()=>{
 const f=await sourceSupersessionFixture({sourceMode:false,onEvaluate:({nondefault})=>nondefault()});
 try{const ack=await f.read(f.tracker.sourceReady(),performance.now()+1000);assert.equal(ack.readErrors,1);assert.equal(ack.document,null);assert.equal(Object.hasOwn(ack,'sourceSuperseded'),false);}finally{f.close();}
});

test('source observer notifies every actual context journal invalidation and retains missing readiness',async()=>{
 const f=await sourceSupersessionFixture();
 try{
  const initial=f.sourceEvents();f.nondefault();assert.equal(f.sourceEvents(),initial+1);
  f.session.emit('Runtime.executionContextDestroyed',{executionContextId:4});assert.equal(f.sourceEvents(),initial+2);
  f.session.emit('Runtime.executionContextsCleared');assert.equal(f.sourceEvents(),initial+3);assert.equal(f.tracker.sourceReady(),null);
  for(let n=0;n<3;n++)await tick();assert.equal(f.accepted.length,0);assert.equal(f.scheduler.snapshot().errors,0);
 }finally{f.close();}
});

test('source ACK seals supersession after other readonly operations without renewing the original deadline',async()=>{
 let finishCookies,startedCookies;
 const started=new Promise(resolve=>{startedCookies=resolve;});
 const f=await sourceSupersessionFixture({onCookies:()=>{startedCookies();return new Promise(resolve=>{finishCookies=resolve;});}});
 try{
  const deadline=performance.now()+1000,reading=f.read(f.tracker.sourceReady(),deadline);await started;await tick();
  f.nondefault();finishCookies();const ack=await reading;
  assert.equal(ack.sourceSuperseded,true);assert.equal(ack.sourceReadStage,'after-return-frame');assert.equal(ack.readErrors,0);assert.equal(ack.document,null);assert.equal(ack.controller,null);assert.equal(ack.deadlineMs,deadline);
 }finally{f.close();}
});

test('source ACK supersession never waives a timed-out pending operation',async()=>{
 let finishCookies;
 const f=await sourceSupersessionFixture({onEvaluate:({nondefault})=>nondefault(),onCookies:()=>new Promise(resolve=>{finishCookies=resolve;})});
 try{
  const ack=await f.read(f.tracker.sourceReady(),performance.now()+20);
  assert.equal(ack.sourceSuperseded,true);assert.equal(ack.timedOut,true);assert.equal(ack.pendingOperations,1);assert.equal(ack.document,null);
  finishCookies();await tick();assert.equal(ack.pendingOperations,1,'late completion cannot rewrite the failed receipt');
 }finally{f.close();}
});

test('source scheduler retains genuine coincident read failures even when the successor event is readable',async()=>{
 const f=await sourceSupersessionFixture({scheduleEvents:true,onEvaluate:({nondefault,evaluations})=>{if(evaluations===1){nondefault();throw Error('PRIVATE_RPC_SENTINEL');}}});
 try{
  f.scheduler.event();for(let n=0;n<5;n++)await tick();const journal=f.scheduler.snapshot();
  assert.equal(journal.records.length,2);assert.equal(journal.unavailable,1);assert.equal(journal.errors,1);
  assert.equal(journal.records[0].acknowledgment.readErrors,1);assert.equal(journal.records[0].acknowledgment.sourceSuperseded,false);assert.equal(journal.records[0].issuedCut,null);
  assert.equal(journal.records[1].acknowledgment.readErrors,0);assert.equal(journal.pending,0);assert.doesNotMatch(JSON.stringify(journal),/PRIVATE_/);
 }finally{f.close();}
});

test('source ACK never turns malformed journals or subset loss into structural supersession',async()=>{
 for(const kind of ['invalid-context','subset']){
  const f=await sourceSupersessionFixture({onEvaluate:({nondefault,session})=>{
   nondefault();
   if(kind==='invalid-context')session.emit('Runtime.executionContextCreated',{context:{id:5,uniqueId:'bad-context',auxData:{frameId:'frame'}}});
   else for(let n=5;n<130;n++)session.emit('Runtime.executionContextCreated',{context:{id:n,uniqueId:'nondefault-'+n,auxData:{frameId:'frame',isDefault:false}}});
  }});
  try{const ack=await f.read(f.tracker.sourceReady(),performance.now()+1000);assert.equal(ack.readErrors,1,kind);assert.equal(ack.sourceSuperseded,false,kind);assert.equal(ack.document,null,kind);}finally{f.close();}
 }
});

test('source ACK checks actual revisions after each successful frame IO boundary',async()=>{
 for(const frameOrdinal of [1,2,3]){
  const f=await sourceSupersessionFixture({onFrame:({nondefault,frames})=>{if(frames===frameOrdinal)nondefault();}});
  try{const ack=await f.read(f.tracker.sourceReady(),performance.now()+1000);assert.equal(ack.sourceSuperseded,true,String(frameOrdinal));assert.equal(ack.readErrors,0);assert.equal(ack.document,null);assert.equal(ack.sourceReadStage,['after-first-frame','after-document-read','after-return-frame'][frameOrdinal-1]);}finally{f.close();}
 }
});

test('annual response selection owns the exact response object and preserves the original deadline',async()=>{
	let reserved=0,released=0;const frame={},source=testBrowserBinding('c'.repeat(40)).teamAnnualAction;
	const observer=createTeamAnnualResponseSelection({contextId,origin,source,reserve:n=>{reserved+=n;return true;},release:n=>{released+=n;},requestCount:()=>0,packetFor:()=>null,browserFor:()=>null,contextFor:()=>null,mainFrame:()=>frame});
	const arm=observer.arm({path:'/en/analytics/team-performance',timeoutMs:15});
	assert.equal(observer.arm({path:'/en/analytics/team-performance',timeoutMs:15}),null,'a second arm cannot renew the deadline');
	await assert.rejects(observer.read({...arm},{}),/Annual team/);
	await assert.rejects(observer.read(arm,{}),/Annual team/);
	assert.ok(reserved>0);observer.close();assert.ok(released>0);
	await assert.rejects(observer.read(arm,{}),/Annual team/);
});

test('annual response selection rejects malformed copied and foreign response metadata without private leakage',async()=>{
	const source=testBrowserBinding('c'.repeat(40)).teamAnnualAction,frame={};let pool=0;
	for(const mutate of [v=>({...v}),v=>({...v,status:()=>500}),v=>({...v,headers:()=>({'x-z8-fixture-response-id':'PRIVATE_SECRET'})}),v=>({...v,request:()=>{throw Error('PRIVATE_SENTINEL');}})]){
		const beforePool=pool;
		const observer=createTeamAnnualResponseSelection({contextId,origin,source,reserve:n=>{pool+=n;return true;},release:n=>{pool-=n;},requestCount:()=>0,packetFor:()=>null,browserFor:()=>null,contextFor:()=>null,mainFrame:()=>frame});
		const arm=observer.arm({path:'/en/analytics/team-performance',timeoutMs:20});
		const request={url:()=>origin+'/en/analytics/team-performance',method:()=>"POST",headers:()=>({'next-action':'PRIVATE_ACTION'}),postData:()=>"PRIVATE_BODY",frame:()=>frame,redirectChain:()=>[]};
		const response={url:request.url,status:()=>200,request:()=>request,headers:()=>({'x-z8-fixture-response-id':'a'.repeat(32)+'.1'})};
		observer.response(mutate(response));
		await assert.rejects(observer.read(arm,{...response}),error=>!String(error).includes('PRIVATE_'));
		assert.doesNotMatch(JSON.stringify(observer.snapshot()),/PRIVATE_|BODY|ACTION/);observer.close();assert.equal(pool,beforePool+16384);
	}
});

async function annualProxyFixture({failed=false,readFailure=false,bodyText='0:{"a":{"success":true,"data":{"teams":[{"employeeCount":8}],"organizationTotal":16704}}}\n'}={}) {
	const hash=value=>createHash('sha256').update(value).digest('hex'),actionId='40'+'a'.repeat(40),frame={},requestBody='[]',target=origin+'/en/analytics/team-performance',id='a'.repeat(32)+'.1';
	const binding=testBrowserBinding('c'.repeat(40));binding.teamAnnualAction.actionHeaderSha256=hash(actionId);
	const principal=createPrincipalEpochObserver(contextId,{origin});principal.start([{name:'session',value:'PRIVATE_COOKIE',domain:'localhost',path:'/',httpOnly:true}]);
	const document=testTeamAnnualDocument(contextId,origin);
	let collector;const proxy=createProxyControlCollector({contextId,origin,compiledBinding:binding,compiledCachedNavigations:true,annualSource:binding.teamAnnualAction,mainFrame:()=>frame,annualContext:()=>collector.annualContext(),annualDocument:()=>structuredClone(document),annualDocumentReady:()=>true});proxy.installed();
	collector=createBrowserControlCollector({contextId,origin,compiledBinding:binding,compiledCachedNavigations:true,principalEpoch:principal,proxyObservation:()=>proxy.snapshot(),temporaryInspectionFor:proxy.temporaryInspectionFor,temporaryRequestObserved:proxy.observeTeamBrowserRequest,environmentObservation:()=>({temporaryValueSourceReads:{documentJournal:structuredClone(document.journal)}}),readBody:async()=>{if(readFailure)throw Error('PRIVATE_READ_ERROR');return {body:bodyText,base64Encoded:false};}});collector.installed();collector.beginMeasurement();
	const handle=proxy.armAnnualTeam({path:'/en/analytics/team-performance',timeoutMs:1000});
	const actualHeaders={'next-action':actionId,'content-type':'text/plain;charset=UTF-8',accept:'text/x-component','accept-language':'en',cookie:'session=PRIVATE_COOKIE','x-z8-fixture-document-generation':contextId+':1'};
	proxy.request(id,{url:target,method:'POST',headers:actualHeaders,traceId:'a'.repeat(32)});proxy.requestBodyBytes(id,Buffer.from(requestBody));proxy.requestBodyEnd(id);
	collector.request({requestId:'selected',loaderId:'loader',frameId:'frame',type:'Fetch',timestamp:1,request:{url:target,method:'POST',headers:actualHeaders}});collector.requestExtra({requestId:'selected',headers:actualHeaders});
	proxy.response(id,{status:200,headers:{'content-type':'text/x-component'}});
	collector.response({requestId:'selected',response:{status:200,headers:{'content-type':'text/x-component','x-z8-fixture-response-id':id}}});
	const request={url:()=>target,method:()=>"POST",headers:()=>actualHeaders,postData:()=>requestBody,frame:()=>frame,redirectChain:()=>[]};
	const response={url:()=>target,status:()=>200,request:()=>request,headers:()=>({'x-z8-fixture-response-id':id,'content-type':'text/x-component'})};proxy.observeAnnualResponse(response);
	proxy.bytes(id,Buffer.from(bodyText));proxy.end(id);collector.data({requestId:'selected',dataLength:Buffer.byteLength(bodyText)});
	if(failed)collector.failed({requestId:'selected',errorText:'net::ERR_ABORTED',canceled:true});else collector.finished({requestId:'selected',timestamp:2});
	await tick();await tick();return {proxy,collector,handle,response,binding,principal,id};
}

test('annual response selection uses the exact natural EOF projection for successful and proven canceled replies',async()=>{
	for(const failed of [false,true]){
		const f=await annualProxyFixture({failed});
		try {const result=await f.proxy.readAnnualTeam(f.handle,f.response);assert.equal(result.projection.employees,8);assert.equal(result.projection.hours,16704);assert.equal(result.bodySource,'owned-proxy-natural-eof');assert.equal(result.browser.failed,failed);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_COOKIE|employeeCount|organizationTotal/);await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response));
			assert.throws(()=>{result.packet.headerFieldSha256.cookie='changed';},TypeError);assert.throws(()=>{result.selection.mainFrame=false;},TypeError);assert.throws(()=>{result.packet.bodyProof.complete=false;},TypeError);
			assert.equal(f.proxy.snapshot().rows[0].bodyProof.complete,true,'returned receipts cannot mutate live rows');f.proxy.closeTeamValues();const final=f.proxy.annualTeamSnapshot();assert.equal(final.retainedBytes,1048576,'only the detached CORE remains charged after private maps are forgotten');assert.equal(final.pending,0);assert.equal(final.consumed,true);await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response));}
		finally{f.proxy.closeTeamValues();}
	}
});

test('annual CORE replay rejects missing changed and foreign response request body source or principal facts',async()=>{
	const f=await annualProxyFixture();try {
		const result=await f.proxy.readAnnualTeam(f.handle,f.response),context=f.collector.annualContext();assert.equal(validateTeamAnnualGoldenReceipt(result,context,origin),true);
		const get=structuredClone(result);get.browser.method='GET';get.packet.method='GET';assert.equal(get.browser.loadingFinished,true);assert.equal(validateTeamAnnualGoldenReceipt(get,context),false,'header-derived action plus method equality cannot replace actual POST');
		for(const mutate of [r=>{const value=segmentHash(origin+'/en/not-team');r.browser.fullUrlSha256=value;r.packet.fullUrlSha256=value;r.selection.fullUrlSha256=value;},r=>{const value=segmentHash(origin+'/de/analytics/team-performance');r.browser.fullUrlSha256=value;r.packet.fullUrlSha256=value;r.selection.fullUrlSha256=value;},r=>{r.browser.responseHeaderSnapshotKnown=false;r.packet.responseHeaderSnapshotKnown=false;},r=>{r.browser.responseContentType={headerKnown:true,mime:'text/html',charset:'absent'};r.packet.responseContentType={headerKnown:true,mime:'text/html',charset:'absent'};},r=>{r.browser.documentGeneration='foreign:9';r.packet.documentGeneration='foreign:9';},r=>r.browser.initialHeaderIdentity.documentGeneration='foreign:9',r=>r.browser.extraHeaderIdentity.documentGeneration='foreign:9',r=>r.browser.frameId='foreign',r=>r.browser.loaderId='foreign',r=>{r.projection.projectionSteps=100001;r.packet.teamAnnualProjection.projectionSteps=100001;}]){const changed=structuredClone(result);mutate(changed);assert.equal(validateTeamAnnualGoldenReceipt(changed,context,origin),false);}
		for(const mutate of [r=>delete r.packet.teamAnnualProjection,r=>r.source.compiledBuild='d'.repeat(40),r=>r.source.workersSha256='d'.repeat(64),r=>r.selection.contextId='foreign',r=>r.selection.proxyResponseId='b'.repeat(32)+'.2',r=>r.selection.requestBodySha256='d'.repeat(64),r=>r.selection.mainFrame=false,r=>r.selection.fulfilledAtMs=r.selection.deadlineMs+1,r=>r.packet.requestBodyFacts.actualEOF=false,r=>r.packet.bodyProof.complete=false,r=>r.packet.bodyProof.serverErrors=1,r=>r.packet.bodyProof.temporaryValues=null,r=>r.browser.requestHeadersKnown=false,r=>r.browser.proxyResponseId='b'.repeat(32)+'.2',r=>r.browser.initialHeaderIdentity.headerFieldSha256.cookie='d'.repeat(64)]){
			const changed=structuredClone(result);mutate(changed);assert.equal(validateTeamAnnualGoldenReceipt(changed,context,origin),false);
		}
		for(const mutate of [c=>c.principalEpoch.pendingReads=1,c=>c.principalEpoch.observedSetCookieResponses=1,c=>c.principalEpoch.before.known=false,c=>c.headerCensus=createProxyHeaderCensus({contextId}).snapshot(),c=>{c.principalEpoch.scopeClosed=true;c.headerCensus.closed=true;c.principalEpoch.after={known:true,sha256:'b'.repeat(64)};c.principalEpoch.matchesAtBoundaries=true;}]){const changed=structuredClone(context);mutate(changed);assert.equal(validateTeamAnnualGoldenReceipt(result,changed,origin),false);}
	}finally{f.proxy.closeTeamValues();}
});

test('annual selection never replaces unread required browser proof or invalid full Flight with golden fields',async()=>{
	for(const options of [{failed:true,readFailure:true},{bodyText:'0:{"a":{"success":true,"data":{"teams":"$7","organizationTotal":16704}}}\n'},{bodyText:'0:I{"a":{"success":true,"data":{"teams":[{"employeeCount":8}],"organizationTotal":16704}}}\n'},{bodyText:'0:{"a":{"success":true,"data":{"teams":[{"employeeCount":8}],"organizationTotal":16704}}}\n1:E{"digest":"PRIVATE"}\n'}]){
		const f=await annualProxyFixture(options);try{await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response),error=>!String(error).includes('PRIVATE'));assert.equal(f.proxy.annualTeamSnapshot().receipt,null);}finally{f.proxy.closeTeamValues();}
	}
	let attempted=0;const observer=createTeamAnnualResponseSelection({contextId,origin,source:testBrowserBinding('c'.repeat(40)).teamAnnualAction,reserve:()=>{attempted++;return false;},release:()=>{throw Error('No unowned release');}});assert.equal(observer.arm({path:'/en/analytics/team-performance',timeoutMs:1000}),null);assert.equal(attempted,1);assert.equal(observer.snapshot().overflow,1);observer.close();
});

test('annual action admission independently binds each phase registry and rejects unknown duplicate or wrong worker sources',async()=>{
	const f=await requestShapeTestBinding();try{
		const path=join(f.directory,'server/server-reference-manifest.json'),plan=structuredClone(f.plan);delete plan.runtime.browserControl.requestShapeDiagnostic;plan.phase='release';
		const worker=Object.fromEntries(teamAnnualWorkers.map(key=>[key,{moduleId:1,async:true}])),entry={filename:teamAnnualModule,exportedName:'getTeamPerformanceData',workers:worker},other='40'+'b'.repeat(40);
		await writeFile(path,JSON.stringify({node:{[other]:entry},edge:{}}));const after=await readBrowserControlBinding({plan,manifestPath:f.manifestPath});assert.notEqual(after.teamAnnualAction.actionHeaderSha256,f.binding.teamAnnualAction.actionHeaderSha256);assert.notEqual(after.teamAnnualAction.registrySha256,f.binding.teamAnnualAction.registrySha256);
		for(const registry of [{node:{}},{node:{[other]:entry,[f.actionId]:entry}},{node:{[other]:{...entry,filename:'other'}}},{node:{[other]:{...entry,exportedName:'other'}}},{node:{[other]:{...entry,workers:{}}}}]){await writeFile(path,JSON.stringify(registry));await assert.rejects(readBrowserControlBinding({plan,manifestPath:f.manifestPath}),/Compiled annual team action source/);}
		await rm(path);await assert.rejects(readBrowserControlBinding({plan,manifestPath:f.manifestPath}),/Compiled annual team action source/);
	}finally{await rm(f.directory,{recursive:true,force:true});}
});

test('annual response pending close and original deadline retain no private response or handle reservations',async()=>{
	for(const mode of ['close','deadline']){
		let pool=0;const frame={},source=testBrowserBinding('c'.repeat(40)).teamAnnualAction,id='a'.repeat(32)+'.1',target=origin+'/en/analytics/team-performance';
		const observer=createTeamAnnualResponseSelection({contextId,origin,source,reserve:n=>{pool+=n;return true;},release:n=>{pool-=n;},requestCount:()=>0,packetFor:()=>null,browserFor:()=>null,contextFor:()=>null,mainFrame:()=>frame,documentForSelection:()=>testTeamAnnualDocument(contextId,origin),documentReady:()=>true});
		const arm=observer.arm({path:'/en/analytics/team-performance',timeoutMs:20}),request={url:()=>target,method:()=>"POST",headers:()=>({'next-action':'40'+'a'.repeat(40)}),postData:()=>"[]",frame:()=>frame,redirectChain:()=>[]},response={url:()=>target,status:()=>200,request:()=>request,headers:()=>({'x-z8-fixture-response-id':id,'content-type':'text/x-component'})};
		observer.response(response);const pending=observer.read(arm,response);assert.equal(observer.snapshot().pending,1);
		if(mode==='close')observer.close();
		await assert.rejects(pending,/Annual team/);observer.close();assert.equal(observer.snapshot().pending,0);assert.equal(observer.snapshot().errors,1);assert.equal(pool,16384);
		assert.equal(observer.snapshot().diagnostic.firstFailureSite,mode);assert.equal(observer.snapshot().retainedBytes,16384);await assert.rejects(observer.read(arm,response),'retaining real keys after close cannot reuse forgotten private observations');
	}
});

test('annual selection captures only actual existing document and execution facts without new IO',async()=>{
	const f=await sourceSupersessionFixture();try{
		const before=f.tracker.selectedDocument();assert.equal(before.document.executionContextId,3);assert.equal(before.document.executionEventOrdinalAfter,5);assert.equal(before.document.documentGeneration,1);assert.equal(f.evaluations(),0);
		f.nondefault();const after=f.tracker.selectedDocument();assert.equal(after.document.executionContextId,3);assert.equal(after.document.executionEventOrdinalAfter,6);assert.equal(after.journal.executionEvents.at(-1).executionContextId,4);assert.equal(f.evaluations(),0);
		after.document.frameId='foreign';after.journal.executionEvents.length=0;assert.equal(f.tracker.selectedDocument().document.frameId,'frame');assert.equal(f.tracker.selectedDocument().journal.executionEvents.length,6);
	}finally{f.close();}
});

test('annual diagnostic distinguishes passive failure from read rejection and keeps its first failure after close',async()=>{
	let pool=0;const source=testBrowserBinding('c'.repeat(40)).teamAnnualAction,frame={},observer=createTeamAnnualResponseSelection({contextId,origin,source,reserve:n=>{pool+=n;return true;},release:n=>{pool-=n;},requestCount:()=>4,mainFrame:()=>frame});
	const handle=observer.arm({path:'/en/analytics/team-performance',timeoutMs:50}),request={method:()=>"POST",url:()=>origin+'/en/analytics/team-performance',headers:()=>({'next-action':'40'+'a'.repeat(40)}),redirectChain:()=>[],frame:()=>frame},response={request:()=>request,url:request.url,status:()=>500};
	observer.response(response);await assert.rejects(observer.read(handle,response));observer.close();
	const d=observer.snapshot().diagnostic;assert.equal(d.firstFailureSite,'response');assert.equal(d.firstFailureStage,'response-identity');assert.equal(d.selectedProxyIdSha256,null);assert.equal(d.armRequestOrdinal,4);assert.equal(d.candidateResponses,1);assert.equal(d.readCalls,1);assert.equal(pool,16384);assert.equal(observer.snapshot().retainedBytes,16384);assert.doesNotMatch(JSON.stringify(d),/next-action|localhost|SECRET/);
});

test('annual diagnostic distinguishes CORE failure and transfers its one immutable row into the existing receipt charge',async()=>{
	const rejected=await annualProxyFixture({failed:true,readFailure:true});try{assert.equal(rejected.proxy.annualTeamSnapshot().diagnostic,null);await assert.rejects(rejected.proxy.readAnnualTeam(rejected.handle,rejected.response));rejected.proxy.closeTeamValues();const d=rejected.proxy.annualTeamSnapshot().diagnostic;assert.equal(d.firstFailureSite,'notify');assert.equal(d.firstFailureStage,'notify-core');assert.equal(d.coreReturned,false);assert.equal(d.projectionKnown,true);assert.equal(d.selectedProxyIdSha256,segmentHash(rejected.id));assert.equal(rejected.proxy.annualTeamSnapshot().retainedBytes,16384);}finally{rejected.proxy.closeTeamValues();}
	const accepted=await annualProxyFixture();try{await assert.rejects(accepted.proxy.readAnnualTeam({...accepted.handle},accepted.response));const result=await accepted.proxy.readAnnualTeam(accepted.handle,accepted.response);accepted.proxy.closeTeamValues();const state=accepted.proxy.annualTeamSnapshot();assert.equal(state.retainedBytes,1048576);assert.equal(state.diagnostic,result.annualDiagnostic);assert.equal(state.diagnostic.firstFailureSite,'read');assert.equal(state.diagnostic.stage,'published');assert.equal(state.diagnostic.selectedProxyIdSha256,segmentHash(accepted.id));assert.equal(state.diagnostic.selectedBrowserIdSha256,segmentHash('selected'));assert.ok(Object.isFrozen(state.diagnostic));
		const maximum=structuredClone(state.diagnostic);for(const key of ['candidateProxyIdSha256','selectedProxyIdSha256','selectedBrowserIdSha256'])maximum[key]='f'.repeat(64);for(const key of ['armRequestOrdinal','candidateResponses','recordedResponses','readCalls','packetOrdinal','requestBodyBytes','status','redirects'])maximum[key]=Number.MAX_VALUE;maximum.stage='response-document';maximum.firstFailureSite='response';maximum.firstFailureStage='response-identity';const charged=Buffer.byteLength(JSON.stringify(maximum))*8+2048;assert.ok(charged<=16384,`maximum fixed diagnostic charge ${charged}`);console.log(JSON.stringify({diagnosticMaximumChargedBytes:charged,reservationBytes:16384}));assert.doesNotMatch(JSON.stringify(state.diagnostic),/PRIVATE_|localhost|employeeCount|organizationTotal/);
	}finally{accepted.proxy.closeTeamValues();}
});

test('annual diagnostic records a genuine selected response even when a prior passive error rejects its read',async()=>{
	const f=await annualProxyFixture();try{f.proxy.observeAnnualResponse({...f.response,status:()=>500});await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response));f.proxy.closeTeamValues();const d=f.proxy.annualTeamSnapshot().diagnostic;assert.equal(d.firstFailureSite,'response');assert.equal(d.firstFailureStage,'response-identity');assert.equal(d.candidateResponses,2);assert.equal(d.recordedResponses,1);assert.equal(d.handleKnown,true);assert.equal(d.responseKnown,true);assert.equal(d.selectedProxyIdSha256,segmentHash(f.id));assert.equal(d.coreReturned,null);}finally{f.proxy.closeTeamValues();}
});

test('context snapshots preserve the exact phase clock and request certificates independently of caller mutation',()=>{
	const binding=testBrowserBinding('c'.repeat(40));binding.legacyClockReadiness={protocol:'synthetic-source-config',review:{sha256:'a'.repeat(64)}};binding.requestShapeDiagnostic={protocol:'synthetic-request-config',actionRegistrySha256:'b'.repeat(64)};
	const collector=createBrowserControlCollector({contextId,origin,compiledBinding:binding});collector.installed();
	const observed=collector.snapshot().allPhase.nativeContext.binding;
	assert.deepEqual(observed.legacyClockReadiness,binding.legacyClockReadiness);assert.deepEqual(observed.requestShapeDiagnostic,binding.requestShapeDiagnostic);
	observed.legacyClockReadiness.review.sha256='changed';observed.requestShapeDiagnostic.actionRegistrySha256='changed';
	assert.equal(binding.legacyClockReadiness.review.sha256,'a'.repeat(64));assert.equal(binding.requestShapeDiagnostic.actionRegistrySha256,'b'.repeat(64));
});

test('selected proxy inspection diagnostic observes the existing EOF publication and keeps both owned charges',async()=>{
	const f=await annualProxyFixture();try {
		const row=f.proxy.snapshot().rows[0],inspection=row.annualInspection;
		assert.equal(inspection.stage,'settled');assert.equal(inspection.eligible,true);assert.equal(inspection.opened,true);assert.equal(inspection.proofComplete,true);assert.equal(inspection.projection,true);assert.equal(inspection.outcome,'published');assert.equal(inspection.eof,true);assert.equal(inspection.sha256,row.transportBodyReceipt.bodySha256);assert.equal(inspection.bytes,row.transportBodyReceipt.decodedBytes);
		assert.equal(f.proxy.snapshot().annualInspectionRetainedBytes,8192);
		const result=await f.proxy.readAnnualTeam(f.handle,f.response);f.proxy.closeTeamValues();
		assert.deepEqual(result.annualDiagnostic.inspection,{...inspection,actionHeaderMatches:true,urlMatches:true});assert.notEqual(result.annualDiagnostic.inspection,inspection);assert.ok(Object.isFrozen(result.annualDiagnostic.inspection));assert.equal(f.proxy.annualTeamSnapshot().retainedBytes,1048576);assert.equal(f.proxy.snapshot().annualInspectionRetainedBytes,8192,'the request map still owns its fixed row after the selector closes');
		assert.doesNotMatch(JSON.stringify(inspection),/PRIVATE|localhost|teams|organizationTotal/);
	}finally{f.proxy.closeTeamValues();}
});

test('proxy inspection records every existing EOF exit only while the annual selector is active',async()=>{
	for(const mode of ['unarmed','not-flight-action','bounded','decode','ineligible','empty','ordinary','summary']){
		const source=testBrowserBinding('c'.repeat(40)).teamAnnualAction,p=createProxyControlCollector({contextId,origin,annualSource:source}),id='a'.repeat(32)+'.1';p.installed();
		if(mode!=='unarmed')assert.ok(p.armAnnualTeam({path:'/en/analytics/team-performance',timeoutMs:1000}));
		const target=origin+(mode==='ineligible'?'/en/not-team':'/en/analytics/team-performance');
		p.request(id,{url:target,method:'POST',headers:mode==='not-flight-action'?{}:{'next-action':'40'+'a'.repeat(40)},traceId:'a'.repeat(32)});
		p.response(id,{status:200,headers:{'content-type':mode==='not-flight-action'?'text/plain':'text/x-component',...(mode==='decode'?{'content-encoding':'gzip'}:{})}});
		assert.equal(p.snapshot().rows[0].annualInspection,undefined,'pre-EOF has no manufactured outcome');
		const body=mode==='bounded'?Buffer.alloc(controlCancellationPolicy.encodedLimit+1):mode==='empty'?Buffer.alloc(0):Buffer.from(mode==='ordinary'?'0:{"a":"$9"}\n':mode==='summary'?'0:{"a":{"success":true,"data":{"teams":[],"organizationTotal":"PRIVATE"}}}\n':'0:{"a":1}\n');
		p.bytes(id,body);p.end(id);await tick();
		const row=p.snapshot().rows[0],d=row.annualInspection;
		if(mode==='unarmed'){assert.equal(d,undefined);assert.equal(p.snapshot().annualInspectionRetainedBytes,0);}
		else {
			assert.equal(d.stage,'settled');assert.equal(p.snapshot().annualInspectionRetainedBytes,8192);assert.ok(Object.isFrozen(d));
			if(['not-flight-action','bounded'].includes(mode)){assert.equal(d.skip,mode);assert.equal(d.eligible,null);assert.equal(d.eof,null);}
			else if(mode==='decode'){assert.equal(d.catchStage,'decode');assert.equal(d.proofComplete,false);assert.equal(d.proofReasonSha256,segmentHash('proxy-body-unavailable'));}
			else if(mode==='ineligible'){assert.equal(d.eligible,false);assert.equal(d.opened,null);assert.equal(d.projection,false);}
			else if(mode==='empty'){assert.equal(d.eligible,true);assert.equal(d.opened,false);assert.equal(d.bytes,0);assert.equal(d.projection,false);}
			else if(mode==='ordinary'){assert.equal(d.opened,true);assert.equal(d.proofComplete,false);assert.equal(d.outcome,'ordinary-incomplete');assert.equal(d.projection,false);}
			else {assert.equal(d.proofComplete,true);assert.equal(d.outcome,'summary-type');assert.equal(d.projection,false);}
			assert.doesNotMatch(JSON.stringify(d),/PRIVATE|localhost|organizationTotal/);
		}
		p.closeTeamValues();assert.equal(p.snapshot().annualInspectionRetainedBytes,mode==='unarmed'?0:8192);
	}
});

test('selected inspection is detached from other rows and its complete maximum stays in the existing reservation',async()=>{
	const f=await annualProxyFixture();try{
		const id='a'.repeat(32)+'.2',headers=f.response.request().headers(),target=origin+'/en/analytics/team-performance';
		f.proxy.request(id,{url:target,method:'POST',headers,traceId:'a'.repeat(32)});f.proxy.response(id,{status:200,headers:{'content-type':'text/x-component'}});f.proxy.bytes(id,Buffer.from('0:{"a":{"success":true,"data":{"teams":[],"organizationTotal":"PRIVATE"}}}\n'));f.proxy.end(id);await tick();
		const result=await f.proxy.readAnnualTeam(f.handle,f.response);assert.equal(result.annualDiagnostic.packetOrdinal,1);assert.equal(result.annualDiagnostic.inspection.outcome,'published');assert.equal(f.proxy.snapshot().rows[1].annualInspection.outcome,'summary-type');
		const maximum=structuredClone(result.annualDiagnostic);for(const key of ['candidateProxyIdSha256','selectedProxyIdSha256','selectedBrowserIdSha256'])maximum[key]='f'.repeat(64);for(const key of ['armRequestOrdinal','candidateResponses','recordedResponses','readCalls','packetOrdinal','requestBodyBytes','status','redirects'])maximum[key]=Number.MAX_VALUE;maximum.stage='response-document';maximum.firstFailureSite='response';maximum.firstFailureStage='response-identity';
		maximum.inspection={stage:'settled',skip:'not-flight-action',eligible:false,opened:false,proofComplete:false,proofReasonSha256:'f'.repeat(64),projection:false,outcome:'projector-unavailable',eof:false,bytes:Number.MAX_VALUE,sha256:'f'.repeat(64),bounded:false,flight:false,action:false,actionHeaderMatches:false,urlMatches:false,catchStage:'eligible',prefix:'plain',form:'typed-outlined-path',length:controlCancellationPolicy.decodedLimit,tokenSha256:'f'.repeat(64),role:'suspended-host-props',pathFailure:'eager-cross-record-or-alias-cycle',lookupAttempted:false,valueUsed:false,authorityStage:'header-snapshot'};
		const rowMaximum={...maximum.inspection};delete rowMaximum.actionHeaderMatches;delete rowMaximum.urlMatches;
		const subBytes=Buffer.byteLength(JSON.stringify(maximum.inspection)),rowCharged=Buffer.byteLength(JSON.stringify(rowMaximum))*8+2048,charged=Buffer.byteLength(JSON.stringify(maximum))*8+2048;assert.ok(subBytes<=800);assert.ok(rowCharged<=8192);assert.ok(charged<=16384,`full maximum diagnostic ${charged}`);console.log(JSON.stringify({selectedInspectionMaximumBytes:subBytes,rowMaximumChargedBytes:rowCharged,fullDiagnosticMaximumChargedBytes:charged,rowReservation:8192,closedDiagnosticReservation:16384}));
		f.proxy.closeTeamValues();assert.ok(Object.isFrozen(f.proxy.annualTeamSnapshot().diagnostic.inspection));assert.equal(f.proxy.snapshot().annualInspectionRetainedBytes,16384);
	}finally{f.proxy.closeTeamValues();}
});

test('failed selected projection retains only its frozen diagnostic copy and no post-close row is allocated',async()=>{
	const f=await annualProxyFixture({bodyText:'0:{"a":{"success":true,"data":{"teams":[],"organizationTotal":"PRIVATE"}}}\n'});try{
		await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response));f.proxy.closeTeamValues();const state=f.proxy.annualTeamSnapshot(),d=state.diagnostic;
		assert.equal(d.firstFailureStage,'notify-candidate');assert.equal(d.inspection.outcome,'summary-type');assert.equal(d.inspection.proofComplete,true);assert.equal(d.inspection.projection,false);assert.equal(d.coreReturned,null);assert.ok(Object.isFrozen(d.inspection));assert.equal(state.retainedBytes,16384);assert.equal(f.proxy.snapshot().annualInspectionRetainedBytes,8192);
		const id='a'.repeat(32)+'.2';f.proxy.request(id,{url:origin+'/en/analytics/team-performance',method:'POST',headers:f.response.request().headers(),traceId:'a'.repeat(32)});f.proxy.response(id,{status:200,headers:{'content-type':'text/x-component'}});f.proxy.bytes(id,Buffer.from('0:{"a":1}\n'));f.proxy.end(id);await tick();assert.equal(f.proxy.snapshot().rows[1].annualInspection,undefined);assert.equal(f.proxy.snapshot().annualInspectionRetainedBytes,8192);assert.equal(f.proxy.annualTeamSnapshot().diagnostic,d);assert.doesNotMatch(JSON.stringify(d),/PRIVATE|localhost/);
	}finally{f.proxy.closeTeamValues();}
});

test('selected reference diagnostic preserves only the actual rejected token facts and temporary observation',async()=>{
	const f=await annualProxyFixture({bodyText:'0:{"a":{"success":true,"data":{"teams":[],"organizationTotal":1,"private":"$T0:0"}}}\n'});try{
		await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response));f.proxy.closeTeamValues();const d=f.proxy.annualTeamSnapshot().diagnostic.inspection;
		assert.equal(d.prefix,'T');assert.equal(d.form,'typed-outlined-path');assert.equal(d.length,5);assert.equal(d.tokenSha256,segmentHash('$T0:0'));assert.equal(d.role,'required');assert.equal(d.lookupAttempted,true);assert.equal(d.valueUsed,false);assert.equal(d.authorityStage,'handle');assert.equal(d.proofComplete,false);assert.equal(d.outcome,'ordinary-incomplete');assert.doesNotMatch(JSON.stringify(d),/\$T0:0|private|employeeCount|localhost/);assert.ok(Object.isFrozen(d));
	}finally{f.proxy.closeTeamValues();}
});

test('selected plain-path diagnostic retains the existing role and fixed failure while late inspection leaves EOF frozen',async()=>{
	const f=await annualProxyFixture({bodyText:'0:{"a":{"success":true,"data":{"teams":[],"organizationTotal":1,"private":"$9:missing"}}}\n'});try{
		const row=f.proxy.snapshot().rows[0],before=JSON.stringify(row.annualInspection),api=await import('./team-temporary-value-authority.mjs');
		const cap=f.proxy.temporaryInspectionFor({id:f.id},row.transportBodyReceipt.bodySha256,row.transportBodyReceipt.decodedBytes);assert.ok(cap);assert.equal(api.closeOriginalTeamBodyInspection(cap),true);assert.equal(JSON.stringify(row.annualInspection),before,'late CDP inspection cannot mutate or throw on the frozen EOF diagnostic');
		await assert.rejects(f.proxy.readAnnualTeam(f.handle,f.response));f.proxy.closeTeamValues();const d=f.proxy.annualTeamSnapshot().diagnostic.inspection;assert.equal(d.prefix,'plain');assert.equal(d.form,'outlined-path');assert.equal(d.role,'required');assert.equal(d.pathFailure,'missing-path-model');assert.equal(d.tokenSha256,null);assert.equal(d.lookupAttempted,false);assert.equal(d.valueUsed,false);assert.doesNotMatch(JSON.stringify(d),/\$9:missing|private|localhost/);
	}finally{f.proxy.closeTeamValues();}
});

test('authority diagnostic wrappers preserve actual short-circuit operands and the original call order',async()=>{
	// Source-preservation seam only: controlled Node boundaries observe this exact closure.
	// These objects grant no real private qualification, request or body authority.
	const source=await readFile(new URL('./browser-control-collector.mjs',import.meta.url),'utf8'),start=source.indexOf('const temporaryInspectionFor='),end=source.indexOf('\n\tconst retireValue=',start),expression=source.slice(start+'const temporaryInspectionFor='.length,end).trim().replace(/;$/,'');
	for(const mode of ['browser','handle','header-snapshot','headers-ready','header-join','header-hash','url-hash','document','action','redirect','origin','reservation','bind-rejected','bound','cached','frozen']){
		const calls=[],id='a'.repeat(32)+'.1',authority={},inspection={authorityStage:null},packet={annualInspection:inspection,requestBodyFacts:{},traceId:'a'.repeat(32),requestHeadersSha256:'headers',fullUrlSha256:'url',documentGeneration:'doc',requestOriginSha256:'origin',headerFieldSha256:{cookie:'cookie','next-action':'action'}},browser={requestId:'browser',requestHeaderSnapshotKnown:true,requestHeadersKnown:true,initialHeaderIdentity:{},extraHeaderIdentity:{},requestHeadersSha256:'headers',fullUrlSha256:'url',documentGeneration:'doc',action:true,ambiguousRedirect:false,requestOriginSha256:'origin'},authorities=new Map();
		const mutate={'header-snapshot':['requestHeaderSnapshotKnown',false],'headers-ready':['requestHeadersKnown',false],'header-hash':['requestHeadersSha256','foreign'],'url-hash':['fullUrlSha256','foreign'],document:['documentGeneration','foreign'],action:['action',false],redirect:['ambiguousRedirect',true],origin:['requestOriginSha256','foreign']}[mode];if(mutate)browser[mutate[0]]=mutate[1];if(mode==='frozen')Object.freeze(inspection);if(mode==='cached')authorities.set(id,authority);
		const env={requests:new Map([[id,packet]]),browserRows:new Map(mode==='browser'?[]:[[id,browser]]),requestHandles:new Map(mode==='handle'?[]:[[id,{}]]),requestAuthorities:authorities,knownOriginalTeamHeaderJoin:()=>{calls.push('headerJoin');return mode==='header-join'?false:{original:'truthy'};},reserveTeam:()=>{calls.push('reserve');return mode!=='reservation';},releaseTeam:()=>calls.push('release'),overflow:0,openOriginalTeamBodyInspection:input=>{calls.push('open');return input;},originalTeamRequestRouteFacts:()=>null,operatorSource:null,shapeRows:new Map(),teamReplayHeader:'replay',teamDispatch:null,bindOriginalTeamRequestValue:()=>{calls.push('bind');return ['bound','frozen'].includes(mode)?authority:null;},originalTeamRequestAuthorityFacts:()=>{calls.push('facts');return {};},qualification:null,teamStore:null,proxyCuts:new Map(),browserCuts:new WeakMap(),contextId};
		const inspect=runInNewContext('('+expression+')',env),result=inspect({id},'a'.repeat(64),1);
		const expected=['browser','handle','header-snapshot','headers-ready'].includes(mode)?['open']:['header-join','header-hash','url-hash','document','action','redirect','origin'].includes(mode)?['headerJoin','open']:mode==='reservation'?['headerJoin','reserve','open']:mode==='bind-rejected'?['headerJoin','reserve','bind','release','open']:mode==='cached'?['facts','open']:['headerJoin','reserve','bind','facts','open'];
		assert.deepEqual(calls,expected,mode);assert.equal(inspection.authorityStage,mode==='frozen'?null:mode,mode);if(['bound','cached','frozen'].includes(mode))assert.equal(result.requestAuthority,authority,mode);
	}
});

test('TEAM navigation inspection window never reads an accessor or Proxy timeout',()=>{
	const p=createProxyControlCollector({contextId,origin});let reads=0;
	assert.equal(p.beginTeamNavigation('goto',[origin,{get timeout(){reads++;throw Error('PRIVATE');}}],1),false);
	assert.equal(p.beginTeamNavigation('goto',[origin,new Proxy({timeout:90000},{getOwnPropertyDescriptor(){reads++;throw Error('PRIVATE');},getPrototypeOf(){reads++;throw Error('PRIVATE');}})],1),false);
	assert.equal(reads,0,'unsupported observation does not execute input code');
});

async function eventBoundInspectionFixture({timeout=1000,requestEOF=true,source=true,limit=controlCancellationPolicy.retainedLimit,path="/en/analytics/team-performance",cutKnown=true}={}){
	// Execute the actual factory at controlled Node boundaries. Synthetic source facts
	// select scheduling only; no real private T/source capability is minted or admitted.
	const text=await readFile(new URL('./browser-control-collector.mjs',import.meta.url),'utf8'),start=text.indexOf('export function createProxyControlCollector('),end=text.indexOf('\nconst progressTechnicalId',start),team=await import('./team-temporary-value-authority.mjs'),api=await import('./browser-control-collector.mjs'),control=await import('./control-cancellation-evidence.mjs');
	const binding={},action='40'+'a'.repeat(40),cut={},id='a'.repeat(32)+'.1',headers={'next-action':action,'accept-language':'en','content-type':'text/plain;charset=UTF-8','x-z8-fixture-document-generation':contextId+':1'},body=Buffer.from('0:{"a":1}\n');let parses=0,now=0;
	const env={...team,...api,...(await import("./mixed-technical-gzip.mjs")),createProxyHeaderCensus,utilTypes:(await import("node:util")).types,Buffer,URL,Object,Map,Set,WeakMap,performance:{now:()=>now},setImmediate,clearImmediate,createHash,gunzipSync,inflateSync:()=>{throw Error('unused');},brotliDecompressSync:()=>{throw Error('unused');},controlCancellationPolicy:{...controlCancellationPolicy,retainedLimit:limit},originalTeamBindings:new WeakMap(source?[[binding,{}]]:[]),requestShapeBindings:new WeakMap(),originalTeamSourceFacts:q=>q?{actionHeaderSha256:segmentHash(action)}:null,sha:segmentHash,lowerHeaders:value=>Object.fromEntries(Object.entries(value??{}).map(([key,item])=>[key.toLowerCase(),item])),renderedPathSourceFacts:()=>null,routingURLFacts:()=>({fallback:{scalarKeys:{known:false}}}),scalarFactBytes:()=>0,requestShapeLimits:{encodedBytes:16384,depth:2,punctuation:32,byteEvents:10000,parseReservation:262144,metadataReservation:2048},inspectRequestShape:()=>({known:false}),parseInertDateRangeRequest:(await import('./inert-date-range-request.mjs')).parseInertDateRangeRequest,projectCachedCdpText,assignBodyProof:(row,proof)=>{row.bodyProof=proof;},inspectCollectedFlightBody:(row,bytes)=>{parses++;return control.inspectRequiredFlightBody(bytes,{action:row.action,cachedNavigations:true});}};
	const factory=runInNewContext('('+text.slice(start,end).replace('export function','function')+')',env),p=factory({contextId,origin,compiledBinding:binding,currentTeamCut:()=>cutKnown?cut:null,operatorSource:{pageRoutes:{protocol:"source-qualified-team-page-routes-v1",originSha256:segmentHash(origin),destinations:[{locale:"en",fullUrlSha256:segmentHash(origin+"/en/analytics/team-performance")}]}}});p.installed();p.beginTeamNavigation?.('goto',[origin,{timeout}],1);
	p.request(id,{url:origin+path,method:'POST',headers,traceId:'a'.repeat(32)});const request=Buffer.from('[{"start":"$D2025-01-01T00:00:00.000Z","end":"$D2025-01-02T00:00:00.000Z","startDate":"2025-01-01","endDate":"2025-01-02","timezone":"SYNTHETIC"}]');
	const finishRequest=()=>{p.requestBodyBytes(id,request);p.requestBodyEnd(id);};if(requestEOF){finishRequest();await tick();}
	p.response(id,{status:200,headers:{'content-type':'text/x-component'}});p.bytes(id,body);
	const browser={...controlRequestIdentity(contextId,origin+'/en/analytics/team-performance','POST',headers),requestId:'browser',proxyResponseId:id,initialHeaderIdentity:{requestHeaderSnapshotKnown:true},requestHeadersKnown:false,bodyReadSettled:true};
	return {p,id,browser,parses:()=>parses,advance:n=>{now+=n;},finishRequest,body,end:()=>p.end(id),event:(kind='response')=>p.observeTeamBrowserRequest(browser,kind)};
}

test('source-qualified proxy EOF waits for the exact browser and ExtraInfo then inspects exactly once',async()=>{
	const f=await eventBoundInspectionFixture();f.end();await tick();assert.equal(f.parses(),0);assert.equal(f.p.snapshot().pendingBodies,1);assert.equal(f.p.snapshot().rows[0].inspectionJob.state,'waiting');
	f.p.observeTeamBrowserRequest({...f.browser,proxyResponseId:'b'.repeat(32)+'.1'},'response');await tick();assert.equal(f.parses(),0,'foreign response ID cannot wake the selected body');
	f.event();await tick();assert.equal(f.parses(),0,'actual response alone cannot replace missing ExtraInfo');f.browser.requestHeadersKnown=true;f.event('extra');await tick();assert.equal(f.parses(),1);assert.equal(f.p.snapshot().pendingBodies,0);assert.equal(f.p.snapshot().rows[0].inspectionJob.parseCalls,1);assert.equal(f.p.snapshot().rows[0].bodyProof.complete,true);
	f.event('terminal');f.event('body-settled');await tick();assert.equal(f.parses(),1);f.p.closeTeamValues();assert.equal(f.p.snapshot().inspectionJobs.unresolved,0);
});

test('event-bound inspection handles normal order and late request parsing without another pass',async()=>{
	for(const lateRequest of [false,true]){const f=await eventBoundInspectionFixture({requestEOF:!lateRequest});f.browser.requestHeadersKnown=true;f.event('extra');f.end();if(lateRequest){await tick();assert.equal(f.parses(),0);f.finishRequest();}await tick();await tick();assert.equal(f.parses(),1);assert.equal(f.p.snapshot().pendingBodies,0);f.p.closeTeamValues();}
	const head=await eventBoundInspectionFixture({source:false});head.end();await tick();assert.equal(head.parses(),1);assert.equal(head.p.snapshot().rows[0].inspectionJob,undefined);head.p.closeTeamValues();
});

test('event-bound unresolved close and original deadline discard bytes once without a late parse',async()=>{
	for(const deadline of [false,true]){const f=await eventBoundInspectionFixture({timeout:deadline?1:1000});f.end();if(deadline){f.advance(2);f.browser.requestHeadersKnown=true;f.event();}else f.p.closeTeamValues();await tick();const snapshot=f.p.snapshot();assert.equal(f.parses(),0);assert.equal(snapshot.pendingBodies,0);assert.equal(snapshot.inspectionJobs.unresolved,1);assert.equal(snapshot.errors,1);assert.equal(snapshot.rows[0].inspectionJob.state,'closed-unresolved');assert.equal(snapshot.rows[0].bodyProof.complete,false);f.browser.requestHeadersKnown=true;f.event('extra');await tick();assert.equal(f.parses(),0);f.p.closeTeamValues();assert.equal(f.p.snapshot().inspectionJobs.unresolved,1);}
});

test('event-bound jobs never borrow a newer window or defer foreign route source or HEAD requests',async()=>{
	const f=await eventBoundInspectionFixture();let getters=0;assert.equal(f.p.beginTeamNavigation('goto',[origin,{get timeout(){getters++;return 90000;}}],2),false);assert.equal(f.p.beginTeamNavigation('goto',[origin,new Proxy({timeout:90000},{getOwnPropertyDescriptor(){getters++;throw Error('PRIVATE');}})],2),false);assert.equal(getters,0);
	const deadline=f.p.snapshot().rows[0].inspectionJob.deadlineMs;f.end();f.p.beginTeamNavigation('goto',[origin,{timeout:90000}],2);assert.equal(f.p.snapshot().rows[0].inspectionJob.deadlineMs,deadline);f.advance(1001);f.browser.requestHeadersKnown=true;f.event();await tick();assert.equal(f.parses(),0);assert.equal(f.p.snapshot().inspectionJobs.unresolved,1);f.p.closeTeamValues();
	for(const options of [{path:'/en/not-team'},{cutKnown:false},{source:false}]){const other=await eventBoundInspectionFixture(options);other.end();await tick();assert.equal(other.p.snapshot().rows[0].inspectionJob,undefined);assert.equal(other.parses(),1);other.p.closeTeamValues();}
	const queued=await eventBoundInspectionFixture();queued.browser.requestHeadersKnown=true;queued.event();queued.end();assert.equal(queued.p.snapshot().rows[0].inspectionJob.state,'scheduled');queued.p.closeTeamValues();await tick();assert.equal(queued.parses(),0);assert.equal(queued.p.snapshot().pendingBodies,0);assert.equal(queued.p.snapshot().inspectionJobs.unresolved,1);
});

test('event-bound job and navigation metadata remain charged within the unchanged shared cap',async()=>{
	const f=await eventBoundInspectionFixture();f.end();f.p.closeTeamValues();const before=f.p.snapshot();assert.equal(before.inspectionJobs.retainedBytes,8192);assert.equal(before.inspectionJobs.navigationWindowRetainedBytes,4096);assert.ok(before.requestShapeDiagnostics.sharedProxyRetainedBytes>=8192+4096);
	const maximum={state:'closed-unresolved',kind:'navigation',deadlineMs:Number.MAX_VALUE,parseCalls:10000,reason:'deadline'};assert.ok((Buffer.byteLength(JSON.stringify(maximum))*2)*8+2048<=8192,'row and one detached snapshot metadata fit the existing job reservation');
	const capped=await eventBoundInspectionFixture({limit:8192});capped.end();capped.browser.requestHeadersKnown=true;capped.event();await tick();assert.ok(capped.p.snapshot().overflow>0);assert.equal(capped.p.snapshot().rows[0].inspectionJob,undefined);capped.p.closeTeamValues();
});

test('pre-EOF disposal is terminal for late bytes EOF and metadata and releases only once',async()=>{
	for(const close of [true,false]){const f=await eventBoundInspectionFixture({timeout:1});if(close)f.p.closeTeamValues();else {f.advance(2);f.event();}const before=f.p.snapshot();assert.equal(before.inspectionJobs.unresolved,1);assert.equal(before.pendingBodies,0);f.p.bytes(f.id,Buffer.alloc(100));f.end();f.browser.requestHeadersKnown=true;f.event('extra');await tick();const after=f.p.snapshot();assert.equal(f.parses(),0);assert.equal(after.pendingBodies,0);assert.equal(after.inspectionJobs.unresolved,1);assert.equal(after.errors,1);assert.equal(after.requestShapeDiagnostics.sharedProxyRetainedBytes,before.requestShapeDiagnostics.sharedProxyRetainedBytes);assert.equal(after.rows[0].inspectionJob.state,'closed-unresolved');f.p.closeTeamValues();}
});

test('manual and annual inspection deadlines are exact producer observations rather than fallback budgets',async()=>{
	const team=await import('./team-temporary-value-authority.mjs'),journal=team.createTeamReplayDispatchJournal({contextId,origin,reserve:()=>true,release:()=>{}}),action='40'+'a'.repeat(40),id='a'.repeat(32)+'.1';let reads=0;
	const input={traceId:'a'.repeat(32),action,body:'[]',url:origin+'/en/analytics/team-performance',observerDeadlineMs:1234},handle=journal.arm(input),nonce=journal.headers(handle)[team.teamReplayHeader];assert.equal(journal.proxyRequest({id,traceId:input.traceId,method:'POST',url:input.url,action,nonce}),true);assert.equal(journal.inspectionDeadline(id),1234);assert.equal(journal.inspectionDeadline('b'.repeat(32)+'.1'),null);assert.equal(journal.finished(handle,{error:false}),true);
	const accessor=journal.arm({...input,traceId:'b'.repeat(32),get observerDeadlineMs(){reads++;return 9999;}});assert.ok(accessor);assert.equal(reads,0);journal.finished(accessor,{error:false});journal.close();assert.equal(journal.inspectionDeadline(id),null);
	const observer=createTeamAnnualResponseSelection({contextId,origin,source:testBrowserBinding('c'.repeat(40)).teamAnnualAction,reserve:()=>true,release:()=>{},requestCount:()=>0});assert.ok(observer.arm({path:'/en/analytics/team-performance',timeoutMs:1000}));const row={fullUrlSha256:segmentHash(origin+'/en/analytics/team-performance')},deadline=observer.inspectionDeadline(row);assert.ok(Number.isFinite(deadline));assert.equal(observer.inspectionDeadline(row),deadline);assert.equal(observer.inspectionDeadline({fullUrlSha256:segmentHash(origin+'/en/not-team')}),null);observer.close();assert.equal(observer.inspectionDeadline(row),null);
	const metadata=structuredClone(temporaryValueObservation);delete metadata.annualTeam.proxyInspection;assert.equal(team.knownTemporaryValueObservation(metadata),false,'old observer metadata fails before IO in both phase readers');
});

test("mixed technical owner shares the proxy budget and rejects foreign cut leases",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs");
 const proxy=createProxyControlCollector({contextId,origin});proxy.installed();
 const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
 const value={failures:[],responses:[],proxy:[],nativeContext:{contextId},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:0};
 const cut=owner.capture(()=>value);assert.equal(owner.stats().liveCuts,1);
 assert.throws(()=>owner.encode({...cut}));
 const packed=owner.encode(cut);assert.ok(packed.bytes.length>48);
 assert.equal(proxy.reserveTemporaryObservation(33554432),false);
 owner.releaseCut(cut);packed.release();assert.equal(owner.stats().retainedBytes,0);
 assert.equal(proxy.reserveTemporaryObservation(33554432),true);proxy.releaseTemporaryObservation(33554432);
 const denied=createMixedTechnicalOwner({contextId,reserve:()=>false,release:()=>{throw Error("unexpected release");},reserveRecords:()=>true,releaseRecords:()=>{}});
 assert.throws(()=>denied.capture(()=>value));assert.equal(denied.stats().retainedBytes,0);
});

test("owned progress projection preserves the complete seven fields and attaches document facts before cloning",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs");
 const proxy=createProxyControlCollector({contextId,origin});proxy.installed();
 const collector=createBrowserControlCollector({contextId,origin,browserRevision:chromiumSWRRevision,proxyObservation:proxy.snapshot});collector.installed();
 const document=testTeamAnnualDocument(contextId,origin).journal,expected=collector.progressInput();expected.nativeContext.documentJournal=structuredClone(document);
 const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
 const cut=collector.progressInput({owner,documentJournal:()=>document});assert.deepEqual(cut,expected);assert.equal(owner.stats().liveCuts,1);
 document.executionEvents[0].frameId="changed-after-clone";assert.equal(cut.nativeContext.documentJournal.executionEvents[0].frameId,"frame");
 owner.releaseCut(cut);assert.equal(owner.stats().retainedBytes,0);
});

test("owned nonempty progress cut matches ordinary proof and keeps proxy source budgets releasable",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs");
 const proxy=createProxyControlCollector({contextId,origin});proxy.installed();
 const collector=createBrowserControlCollector({contextId,origin,browserRevision:chromiumSWRRevision,proxyObservation:proxy.snapshot,readBody:async()=>({body,base64Encoded:false})});collector.installed();
 const id="a".repeat(32)+".1";proxy.request(id,{url,method:"GET",headers,traceId:"a".repeat(32)});proxy.response(id,{status:200,headers:responseHeaders});proxy.bytes(id,Buffer.from(body));proxy.end(id);
 collector.request(event("owned-control",1));collector.requestExtra({requestId:"owned-control",headers});collector.response({requestId:"owned-control",response:{status:200,headers:{...responseHeaders,[controlResponseHeader]:id},fromDiskCache:false,fromServiceWorker:false}});collector.responseExtra({requestId:"owned-control",statusCode:200,headers:{...responseHeaders,[controlResponseHeader]:id}});collector.failed({requestId:"owned-control",errorText:"net::ERR_ABORTED",canceled:true,timestamp:2});await tick();await tick();
 const expected=collector.progressInput(),document=testTeamAnnualDocument(contextId,origin).journal;expected.nativeContext.documentJournal=structuredClone(document);
 const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords}),cut=collector.progressInput({owner,documentJournal:()=>document});assert.deepEqual(cut,expected);assert.equal(cut.failures[0].bodyProof.complete,true);
 const encoded=owner.encode(cut);assert.ok(encoded.bytes.length<4194304);encoded.release();owner.releaseCut(cut);assert.equal(owner.stats().retainedBytes,0);assert.equal(proxy.reserveTemporaryObservation(33554432),true);proxy.releaseTemporaryObservation(33554432);
});

test("retained cut records share the actual proxy allowance and closing never releases another owner's records",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs");
 const proxy=createProxyControlCollector({contextId,origin});proxy.installed();
 const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
 const value={failures:Array.from({length:6000},(_,i)=>({requestId:"record-"+i})),responses:[],proxy:[],nativeContext:{contextId},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:6000};
 const cut=owner.capture(()=>value);assert.equal(owner.stats().retainedRecords,6000);
 assert.throws(()=>owner.capture(()=>value));assert.equal(owner.stats().retainedRecords,6000);assert.equal(owner.stats().liveCuts,1);
 assert.equal(proxy.reserveTemporaryRecords(3999),true);owner.close();assert.equal(owner.stats().retainedRecords,0);assert.equal(owner.stats().retainedBytes,0);
 assert.equal(proxy.reserveTemporaryRecords(6002),false);proxy.releaseTemporaryRecords(3999);assert.equal(proxy.reserveTemporaryRecords(10000),true);proxy.releaseTemporaryRecords(10000);owner.releaseCut(cut);owner.close();
 assert.equal(proxy.reserveTemporaryObservation(33554432),true);proxy.releaseTemporaryObservation(33554432);
});

test("pending read views keep the real proxy reservation through close until their async finally",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();
 const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords}),read=owner.openRead();let finish;
 const pending=(async()=>{const view=read.keep(()=>({frameId:"frame",metadata:"x".repeat(100000)}));try{await new Promise(resolve=>{finish=resolve;});return view.frameId;}finally{read.finish();}})();
 owner.close();assert.equal(owner.stats().pendingReads,1);assert.ok(owner.stats().retainedBytes>100000);assert.equal(proxy.reserveTemporaryObservation(33554432),false);
 finish();assert.equal(await pending,"frame");assert.equal(owner.stats().pendingReads,0);assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);read.finish();assert.equal(proxy.reserveTemporaryObservation(33554432),true);proxy.releaseTemporaryObservation(33554432);
});

test("owned document ACK charges frame and result lifetimes through success and late readonly completion",async()=>{
 const {createMixedDocumentAcknowledgment}=await import("./browser-control-collector.mjs"),{createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs");
 for(const late of [false,true]){
  const id="owned-ack",proxy=createProxyControlCollector({contextId:id,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId:id,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords}),session=new EventEmitter();let finish,frames=0,evaluations=0,cookieReads=0,sourceReads=0;
  const metadata={result:{value:{available:true,secureContext:true,origin,documentIdentityStable:true,controllerIdentityStable:true,controllerBefore:null,controllerAfter:null,registrationCount:0,registrationOverflow:0,registrations:[]}}};
  session.send=async(method)=>{if(method==="Runtime.enable")session.emit("Runtime.executionContextCreated",{context:{id:1,uniqueId:"owned-unique",auxData:{isDefault:true,frameId:"frame"}}});if(method==="Page.getFrameTree"){frames++;return {frameTree:{frame:{id:"frame",loaderId:"loader",url:origin+"/en"}}};}if(method==="Runtime.evaluate"){evaluations++;return late?new Promise(resolve=>{finish=resolve;}):metadata;}return {};};
  const journal=await createMixedDocumentAcknowledgment({session,contextId:id,origin,generation:()=>1});session.emit("Network.requestWillBeSent",{requestId:"doc",type:"Document",frameId:"frame",loaderId:"loader",request:{url:origin+"/en",headers:{[controlDocumentHeader]:id+":1"}}});
  const principal=createPrincipalEpochObserver(id,{origin});principal.start([]);
  const result=await journal.read({technicalOwner:owner,checkpointOrdinal:1,deadlineMs:performance.now()+(late?10:1000),principalEpoch:principal,readCookies:async()=>{cookieReads++;return [];},readSources:async()=>{sourceReads++;return {known:true};}});
  assert.equal(evaluations,1);assert.equal(cookieReads,1);assert.equal(sourceReads,1);assert.equal(result.timedOut,late);assert.equal(owner.stats().pendingConsumers,1);
  if(!late){assert.equal(result.readErrors,0);assert.equal(frames,3);assert.equal(owner.stats().pendingReads,0);}
  owner.close();owner.releaseEvidence(result);
  if(late){assert.equal(owner.stats().pendingReads,1);assert.ok(owner.stats().retainedBytes>0);assert.equal(proxy.reserveTemporaryObservation(33554432),false);finish(metadata);await tick();await tick();}
  assert.equal(owner.stats().pendingReads,0);assert.equal(owner.stats().pendingConsumers,0);assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);journal.close();
 }
});


test("a progress cut reuses its exact synchronous proxy snapshot without dropping any environment fields",()=>{
 const proxy=createProxyControlCollector({contextId,origin});proxy.installed();let snapshots=0,anchor;
 const observe=()=>{snapshots++;return anchor=proxy.snapshot();};
 const legacy=createBrowserControlCollector({contextId,origin,proxyObservation:observe,environmentObservation:()=>({temporaryValues:observe().temporaryValues,sharedFact:"preserved"})});legacy.installed();
 const expected=legacy.progressInput();assert.equal(snapshots,2);snapshots=0;
 const current=createBrowserControlCollector({contextId,origin,proxyObservation:observe,environmentObservation:observed=>{assert.equal(observed,anchor);return {temporaryValues:observed.temporaryValues,sharedFact:"preserved"};}});current.installed();
 assert.deepEqual(current.progressInput(),expected);assert.equal(snapshots,1);
});


test("tracked candidate codec preserves complete JSON and separates typed records from metadata array slots",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),{gunzipSync}=await import("node:zlib");
 const proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
 const rows=Array.from({length:700},(_,index)=>({requestId:"request-"+index,metadata:Array(16).fill("漢字_\ud800"),conflict:index%2===0})),input={failures:rows,responses:[],proxy:[],nativeContext:{contextId},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:700};
 const cut=owner.capture(()=>input),packed=owner.encode(cut),logical=gunzipSync(packed.bytes.subarray(48),{maxOutputLength:8388608,rejectGarbageAfterEnd:true});
 assert.deepEqual(JSON.parse(logical.toString("utf8")),input);assert.equal(packed.bytes.subarray(0,8).toString("ascii"),"Z8MIXGZ2");assert.equal(packed.bytes.readUInt32BE(12),logical.length);assert.equal(createHash("sha256").update(logical).digest("hex"),packed.bytes.subarray(16,48).toString("hex"));
 assert.equal(packed.stats.logicalReceiptRows,700);assert.ok(packed.stats.codecArraySlots>10000);assert.equal(owner.stats().retainedRecords,700);
 packed.release();cut.failures[0].conflict="mutated";assert.throws(()=>owner.encode(cut));owner.releaseCut(cut);assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
 const tooMany={...input,failures:Array.from({length:10001},(_,i)=>({requestId:"request-"+i}))};assert.throws(()=>owner.capture(()=>tooMany));owner.close();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
});


test("sequential receipt constructors precharge one shared scratch window and release it after the loop",async()=>{
 const {createMixedTechnicalOwner,mixedOwnedRows}=await import("./mixed-technical-gzip.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();
 const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords}),source=[{requestId:"x".repeat(256),status:200}];let during;
 const result=owner.retainEvidence(()=>mixedOwnedRows(()=>source,row=>{during=owner.stats().retainedBytes;return {...row};},{constructorScratchBytes:16384,constructorViewCopies:2}));
 assert.ok(during>=148000&&during<149000,"one-row worked storage bound includes the 16KiB constructor window before projection");assert.deepEqual(result,source);assert.ok(owner.stats().retainedBytes<4096,"constructor scratch is gone while its small result remains owned");owner.releaseEvidence(result);assert.equal(owner.stats().retainedBytes,0);
 let calls=0;const many=Array.from({length:1000},(_,i)=>({requestId:"row-"+i,status:200}));
 const rows=owner.retainEvidence(()=>mixedOwnedRows(()=>many,row=>{calls++;return {...row};},{constructorScratchBytes:16384,constructorViewCopies:2}));assert.equal(calls,1000);assert.deepEqual(rows,many);assert.ok(owner.stats().peakBytes<8*1024*1024,"dead per-row scratch is not retained for the next projection");owner.releaseEvidence(rows);
 assert.throws(()=>owner.retainEvidence(()=>mixedOwnedRows(()=>source,()=>{throw Error("PRIVATE_PROJECTOR");},{constructorScratchBytes:16384,constructorViewCopies:2})),error=>!error.message.includes("PRIVATE_PROJECTOR"));assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);owner.close();
});


test("encoder traversal retains only each live frame vector under the unchanged depth limit",async()=>{
 const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let nested=null;for(let i=0;i<62;i++)nested={child:nested};
 const value={failures:[],responses:[],proxy:[],nativeContext:{contextId,nested},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:0},cut=owner.capture(()=>value),packed=owner.encode(cut);assert.ok(packed.bytes.length>48);assert.ok(owner.stats().peakBytes<10*1024*1024,"the63 small ancestor vectors do not each retain the full10001-key ceiling");packed.release();owner.releaseCut(cut);
 assert.throws(()=>owner.capture(()=>({...value,nativeContext:{contextId,nested:{child:nested}}})));assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);owner.close();
});


test("covered assembled cuts retain component leases through detachment and reject foreign or changed coverage",async()=>{
 const {createMixedTechnicalOwner,mixedOwnedFixedContainer,mixedOwnedClone}=await import("./mixed-technical-gzip.mjs");
 const make=id=>{const proxy=createProxyControlCollector({contextId:id,origin});proxy.installed();return {proxy,owner:createMixedTechnicalOwner({contextId:id,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords})};};
 const a=make("coverage-a"),b=make("coverage-b"),collector=createBrowserControlCollector({contextId:"coverage-a",origin,browserRevision:chromiumSWRRevision,proxyObservation:a.proxy.snapshot});collector.installed();
 const cut=collector.progressInput({owner:a.owner});assert.ok(a.owner.stats().peakBytes<2*1024*1024,"a covered assembled view does not acquire another provisional8MiB graph pin");
 assert.throws(()=>b.owner.capture(()=>mixedOwnedFixedContainer(()=>[["nativeContext",mixedOwnedFixedContainer(()=>[["contextId","coverage-b"]])],["foreign",cut]])));assert.equal(b.owner.stats().retainedBytes,0);assert.ok(a.owner.stats().retainedBytes>0);
 assert.throws(()=>b.owner.capture(()=>{const child=mixedOwnedClone({marker:"before"});child.marker="after!";return mixedOwnedFixedContainer(()=>[["nativeContext",mixedOwnedFixedContainer(()=>[["contextId","coverage-b"]])],["child",child]]);}));assert.equal(b.owner.stats().retainedBytes,0);
 assert.throws(()=>b.owner.capture(()=>mixedOwnedFixedContainer(()=>[["nativeContext",{contextId:"coverage-b"}]])));assert.equal(b.owner.stats().retainedBytes,0);
 const saved=structuredClone(cut);a.owner.releaseCut(cut);a.owner.close();b.owner.close();assert.deepEqual(saved.nativeContext.contextId,"coverage-a");assert.equal(a.owner.stats().retainedBytes,0);assert.equal(a.owner.stats().retainedRecords,0);assert.equal(b.owner.stats().retainedRecords,0);
});


test("covered container staging rejects oversized or escaped primitive storage before constructing its object",async()=>{
 const {createMixedTechnicalOwner,mixedOwnedFixedContainer}=await import("./mixed-technical-gzip.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
 const huge="x".repeat(1048576),escaped="\u0000".repeat(1000);const small=owner.capture(()=>mixedOwnedFixedContainer(()=>[["nativeContext",mixedOwnedFixedContainer(()=>[["contextId",contextId]])],["small","x"]]));owner.releaseCut(small);for(const entries of [[["large",huge]],[[huge,1]],[["escaped",escaped]],[["unsupported",1n]]]){assert.throws(()=>owner.capture(()=>mixedOwnedFixedContainer(()=>[["nativeContext",mixedOwnedFixedContainer(()=>[["contextId",contextId]])],...entries])));assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);}
 let traps=0;const proxyEntries=new Proxy([],{get(){traps++;throw Error("PRIVATE_TRAP");},getPrototypeOf(){traps++;throw Error("PRIVATE_TRAP");}});assert.throws(()=>owner.capture(()=>mixedOwnedFixedContainer(()=>proxyEntries)));assert.equal(traps,0);assert.equal(owner.stats().retainedBytes,0);owner.close();
});


test("byte JSON replay produces immutable private provenance and refuses unknown or copied JavaScript",async()=>{
 const {parseMixedTechnicalReplayJSON,mixedTechnicalCandidateDigest}=await import("./mixed-technical-gzip.mjs"),value={failures:[],responses:[],proxy:[],nativeContext:{contextId:"replay"},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:0,unicode:"漢字_\ud800",own:{["__proto__"]:{data:true}}},bytes=Buffer.from(JSON.stringify(value)),parsed=parseMixedTechnicalReplayJSON(bytes);
 assert.deepEqual(parsed,value);assert.equal(Object.isFrozen(parsed),true);assert.equal(Object.isFrozen(parsed.own.__proto__),true);assert.throws(()=>{parsed.nativeContext.contextId="changed";});assert.equal(mixedTechnicalCandidateDigest(parsed),createHash("sha256").update(bytes).digest("hex"));
 assert.equal(mixedTechnicalCandidateDigest(value),null);assert.equal(mixedTechnicalCandidateDigest(structuredClone(parsed)),null);let traps=0;const unknown=new Proxy(value,{ownKeys(){traps++;throw Error("PRIVATE_TRAP");},get(){traps++;throw Error("PRIVATE_TRAP");}});assert.equal(mixedTechnicalCandidateDigest(unknown),null);assert.equal(traps,0);
 for(const bad of [Buffer.from('{"PRIVATE_JSON_SENTINEL":'),Buffer.from([0xff,0xfe])])assert.throws(()=>parseMixedTechnicalReplayJSON(bad),error=>error.message==="Mixed technical JSON replay input rejected.");
});

test("private replay bounds are established before trusted traversal and nested pins precede workspace",async()=>{
 const {parseMixedTechnicalReplayJSON,mixedTechnicalCandidateDigest,createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),base={failures:[],responses:[],proxy:[],nativeContext:{contextId},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:0},bytes=Buffer.from(JSON.stringify(base)),parsed=parseMixedTechnicalReplayJSON(bytes),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const charges=[];
 const owner=createMixedTechnicalOwner({contextId,reserve:n=>{charges.push(n);return proxy.reserveTemporaryObservation(n);},release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});assert.match(owner.run(()=>mixedTechnicalCandidateDigest(parsed)),/^[a-f0-9]{64}$/);assert.equal(charges[1],bytes.length);assert.ok(charges.findIndex(n=>n>5000000)>1,"selected source pin precedes byte-derived traversal workspace");assert.equal(owner.stats().retainedBytes,0);
 let nested=null;for(let i=0;i<65;i++)nested={child:nested};const wide=Object.fromEntries(Array.from({length:10002},(_,i)=>["field"+i,i]));
 for(const value of [{...base,nested},{...base,wide},{...base,padding:"x".repeat(8388608)}]){
  const input=parseMixedTechnicalReplayJSON(Buffer.from(JSON.stringify(value))),old=Reflect.ownKeys;let traversals=0;Reflect.ownKeys=(...args)=>{traversals++;return old(...args);};try{assert.equal(mixedTechnicalCandidateDigest(input),null);assert.equal(traversals,0);}finally{Reflect.ownKeys=old;}
 }
 for(const numeric of ["-0","1e400"]){const input=parseMixedTechnicalReplayJSON(Buffer.from(JSON.stringify(base).slice(0,-1)+',"invalid":'+numeric+'}'));assert.equal(mixedTechnicalCandidateDigest(input),null);}
 owner.close();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
});


test("failed descendant registration never publishes released cut or evidence maps",async()=>{
 const {parseMixedTechnicalReplayJSON,createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),child={failures:[],responses:[],proxy:[],nativeContext:{contextId},coverage:{installed:true},browserRevision:chromiumSWRRevision,browserEventOrdinal:0},parsed=parseMixedTechnicalReplayJSON(Buffer.from(JSON.stringify({protocol:"acknowledged-mixed-native-prefix-v1",nativeContext:{contextId},begin:child,end:child})));
 for(const kind of ["replay","evidence"]){const proxy=createProxyControlCollector({contextId,origin});proxy.installed();let refuse=true,registrationFaults=0;const owner=createMixedTechnicalOwner({contextId,reserve:n=>{if(refuse&&n===2560){registrationFaults++;return false;}return proxy.reserveTemporaryObservation(n);},release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
  const perform=()=>kind==="replay"?owner.replay(parsed):owner.retainEvidence(()=>parsed);assert.throws(perform);assert.equal(registrationFaults,1);assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);assert.equal(owner.stats().liveCuts,0);
  refuse=false;let result;assert.doesNotThrow(()=>{result=perform();});if(kind==="replay")owner.releaseCut(result);else owner.releaseEvidence(result);owner.close();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);assert.equal(proxy.reserveTemporaryObservation(33554432),true);proxy.releaseTemporaryObservation(33554432);
 }
});


test("committed descendant rebinding forgets the replaced parent before its reservation is released",async()=>{
 const {setFlagsFromString}=await import("node:v8"),{runInNewContext}=await import("node:vm");setFlagsFromString("--expose_gc");const collect=runInNewContext("gc"),{parseMixedTechnicalReplayJSON,createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),child=parseMixedTechnicalReplayJSON(Buffer.from(JSON.stringify({nativeContext:{contextId}}))),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});
 let first=owner.retainEvidence(()=>({protocol:"acknowledged-mixed-native-prefix-v1",begin:child,end:child,unrelated:"x".repeat(1048576)}));const weak=new WeakRef(first),second=owner.retainEvidence(()=>({protocol:"acknowledged-mixed-native-prefix-v1",begin:child,end:child,unrelated:"small"}));owner.releaseEvidence(first);first=null;assert.ok(owner.stats().retainedBytes<10000);
 let forgotten=false;for(let index=0;index<12;index++){await tick();collect();await tick();if(weak.deref()===undefined){forgotten=true;break;}}assert.equal(forgotten,true,"successful child rebinding must not retain rollback-only prior.root");owner.releaseEvidence(second);owner.close();assert.equal(owner.stats().retainedBytes,0);assert.equal(owner.stats().retainedRecords,0);
});


test("capture failure diagnostic reports the same first charge refusal without changing callbacks or cleanup",async()=>{
 const codec=await import("./mixed-technical-gzip.mjs");assert.equal(typeof codec.observeMixedTechnicalCapture,"function");let reserves=0,releases=0,constructs=0,seen=null;const owner=codec.createMixedTechnicalOwner({contextId:"capture-diagnostic",reserve:()=>{reserves++;return false;},release:()=>{releases++;},reserveRecords:()=>true,releaseRecords:()=>{}});
 assert.throws(()=>codec.observeMixedTechnicalCapture(()=>owner.capture(()=>{constructs++;return{nativeContext:{contextId:"capture-diagnostic"}};}),value=>{seen=value;throw Error("PRIVATE_CALLBACK_SENTINEL");}),error=>error.message==="Mixed technical gzip rejected input.");
 assert.equal(reserves,1);assert.equal(releases,0);assert.equal(constructs,0);assert.equal(seen.stage,"constructor-shell");assert.equal(seen.refusal.kind,"parent-bytes-refused");assert.equal(seen.refusal.label,"snapshot-fixed-constructor-shells");assert.equal(seen.refusal.requestedBytes,131072);assert.equal(seen.refusal.ownerUsedBytes,0);assert.equal(seen.refusal.ownerUsedRecords,0);assert.equal(owner.stats().retainedBytes,0);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE|capture-diagnostic/);owner.close();
});

test("capture failure diagnostic preserves constructor errors and success results without retaining a stale scope",async()=>{
 const {createMixedTechnicalOwner,observeMixedTechnicalCapture}=await import("./mixed-technical-gzip.mjs");const proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let seen=null,calls=0;
 assert.throws(()=>observeMixedTechnicalCapture(()=>owner.capture(()=>{calls++;throw Error("PRIVATE_CONSTRUCTOR_SENTINEL");}),value=>{seen=value;}),error=>error.message==="Mixed technical gzip rejected input.");assert.equal(calls,1);assert.equal(seen.stage,"construct");assert.equal(seen.refusal,null);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE/);assert.equal(owner.stats().retainedBytes,0);
 let reported=0;const cut=observeMixedTechnicalCapture(()=>owner.capture(()=>({nativeContext:{contextId}})),()=>{reported++;});assert.equal(cut.nativeContext.contextId,contextId);assert.equal(reported,0);owner.releaseCut(cut);const foreign=Error("unrelated");assert.throws(()=>observeMixedTechnicalCapture(()=>{throw foreign;},value=>{assert.equal(value,null);}),error=>error===foreign);owner.close();assert.equal(owner.stats().retainedBytes,0);
});

test("first mixed input failure retains same-execution capture details and keeps untouched predicates null",async()=>{
 for(const phase of ["check","confirm"]){const {createMixedTechnicalOwner}=await import("./mixed-technical-gzip.mjs"),{createMixedProgressAcknowledgments}=await import("./browser-control-collector.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let calls=0;
 const observer=createMixedProgressAcknowledgments({technicalOwner:owner,input:()=>{calls++;return owner.capture(()=>{throw Error("PRIVATE_INPUT_SENTINEL");});},application:()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0}),acknowledge:()=>{throw Error("must not acknowledge");}});if(phase==="check")await assert.rejects(observer.check(),/Mixed technical gzip rejected input/);else assert.throws(()=>observer.confirm({}),/Mixed technical gzip rejected input/);const snapshot=observer.snapshot();assert.equal(calls,1);assert.equal(snapshot.firstFailure.stage,phase==="check"?"check-live":"confirm-live");assert.equal(snapshot.firstFailure.subreason,"input");assert.equal(snapshot.firstFailure.inputCapture.stage,"construct");assert.equal(snapshot.firstFailure.inputCapture.refusal,null);assert.equal(snapshot.firstFailure.cut,null);assert.equal(snapshot.firstFailure.predicates.candidateKnown,null);assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_INPUT_SENTINEL/);assert.ok(Buffer.byteLength(JSON.stringify(snapshot.firstFailure))*8+2048<=32768);observer.close();observer.releaseSnapshot(snapshot);observer.releaseSnapshot();assert.equal(owner.stats().retainedBytes,0);}
});


test("capture refusal distinguishes actual shared-parent usage and typed record denial without retry",async()=>{
 const {createMixedTechnicalOwner,observeMixedTechnicalCapture,mixedOwnedRows}=await import("./mixed-technical-gzip.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const held=33554432-131072+1;assert.equal(proxy.reserveTemporaryObservation(held),true);const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let seen=null;assert.throws(()=>observeMixedTechnicalCapture(()=>owner.capture(()=>({nativeContext:{contextId}})),value=>{seen=value;}));assert.equal(seen.refusal.parentUsedBytes,held);assert.equal(seen.refusal.parentUsedRecords,0);assert.equal(seen.refusal.requestedBytes,131072);proxy.releaseTemporaryObservation(held);owner.close();
 let records=0,reserves=0;const typed=createMixedTechnicalOwner({contextId,reserve:()=>{reserves++;return true;},release:()=>{},reserveRecords:()=>{records++;return false;},releaseRecords:()=>{throw Error("must not release refused records");}});assert.throws(()=>observeMixedTechnicalCapture(()=>typed.capture(()=>mixedOwnedRows(()=>[{marker:"data"}],row=>row)),value=>{seen=value;}));assert.equal(records,1);assert.equal(seen.refusal.kind,"parent-records-refused");assert.equal(seen.refusal.label,"snapshot-typed-rows");assert.equal(seen.refusal.requestedRecords,1);assert.ok(reserves>0);assert.equal(typed.stats().retainedBytes,0);assert.equal(typed.stats().retainedRecords,0);assert.ok(Object.isFrozen(seen)&&Object.isFrozen(seen.refusal));typed.close();
});

test("canonical capture rejection is identified without leaking a value and remains within the existing diagnostic reservation",async()=>{
 const {createMixedTechnicalOwner,observeMixedTechnicalCapture}=await import("./mixed-technical-gzip.mjs"),proxy=createProxyControlCollector({contextId,origin});proxy.installed();const owner=createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords});let seen;assert.throws(()=>observeMixedTechnicalCapture(()=>owner.capture(()=>({nativeContext:{contextId},PRIVATE_INVALID_NUMBER:NaN})),value=>{seen=value;}));assert.equal(seen.innerStage,"canonical-measure");assert.equal(seen.refusal,null);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE_INVALID_NUMBER/);assert.ok(Buffer.byteLength(JSON.stringify(seen))*8+2048<32768);assert.equal(owner.stats().retainedBytes,0);owner.close();
});

import { targetedPrefetchProfile, knownTargetedPrefetchProfile } from "./fixture-browser.mjs";
import { matchingBrowserControlBinding } from "./control-cancellation-evidence.mjs";

function snapshotProfileBinding(compiledBinding) {
 const collector=createBrowserControlCollector({contextId,origin,compiledBinding});
 collector.installed();collector.beginMeasurement();collector.endMeasurement();collector.endScope();
 return collector.snapshot();
}

test('public snapshot preserves the exact optional matched profile in measured and all-phase authority',()=>{
 const build='b'.repeat(40),binding=testBrowserBinding(build,{...testBrowserMetadata(),targetedPrefetchProfile:structuredClone(targetedPrefetchProfile)});
 const snapshot=snapshotProfileBinding(binding);
 for(const scope of ['measured','allPhase']){
  const projected=snapshot[scope].nativeContext.binding;
  assert.deepEqual(projected.targetedPrefetchProfile,targetedPrefetchProfile);
  assert.equal(matchingBrowserControlBinding({build,browserControl:binding},projected),true);
 }
});

test('public snapshot keeps a legacy authority without the optional matched profile absent',()=>{
 const build='b'.repeat(40),binding=testBrowserBinding(build),snapshot=snapshotProfileBinding(binding);
 for(const scope of ['measured','allPhase']){
  const projected=snapshot[scope].nativeContext.binding;
  assert.equal(Object.hasOwn(projected,'targetedPrefetchProfile'),false);
  assert.equal(matchingBrowserControlBinding({build,browserControl:binding},projected),true);
 }
});

test('public snapshot preserves malformed profile data without inventing a valid matching authority',()=>{
 const build='b'.repeat(40),malformed={...targetedPrefetchProfile,contractSha256:'invalid'},binding=testBrowserBinding(build,{...testBrowserMetadata(),targetedPrefetchProfile:malformed});
 const expected=testBrowserBinding(build,{...testBrowserMetadata(),targetedPrefetchProfile:structuredClone(targetedPrefetchProfile)}),snapshot=snapshotProfileBinding(binding);
 for(const scope of ['measured','allPhase']){
  const projected=snapshot[scope].nativeContext.binding;
  assert.deepEqual(projected.targetedPrefetchProfile,malformed);
  assert.equal(knownTargetedPrefetchProfile(projected.targetedPrefetchProfile),false);
  assert.equal(matchingBrowserControlBinding({build,browserControl:expected},projected),false);
 }
});
