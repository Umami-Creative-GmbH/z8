import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { cleanBrowserContextEvidence } from "./clean-evidence.mjs";
import { setImmediate as tick } from "node:timers/promises";
import {
	chromiumSWRRevision,
	cleanBrowserFailureEvidence,
} from "./control-cancellation-evidence.mjs";
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
	createBrowserControlCollector,
	createProxyControlCollector,
	installBrowserControlCollector,
	controlDocumentHeader,
	controlResponseHeader,
} from "./browser-control-collector.mjs";
import { controlCancellationPolicy } from "./control-cancellation-evidence.mjs";
import { validateProxyHeaderCensus } from "./proxy-header-census.mjs";
import { projectCachedCdpText } from "./cdp-cached-text-projection.mjs";
import { primaryProtocolIdentity, companionProtocolIdentity, budgetProtocolIdentity } from "./protocol-fingerprints.mjs";
import { mixedProtocolFiles } from "./mixed-clock-budgets.mjs";

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
	proxy.response(id(2),{status:200,headers:{"set-cookie":["private-value"],"content-type":"text/plain"}});
	proxy.upstreamClosedBeforeHeaders(id(3),{upstreamClosed:true,headersReceived:false});
	proxy.transportClosed({serverClosed:true,acceptedRequests:3,upstreamRequests:3,closedUpstreams:3,pendingUpstreams:0});
	proof=proxy.snapshot().headerCensus;
	assert.equal(validateProxyHeaderCensus(proof,{contextId}),true);
	assert.equal(proof.closed,true);assert.equal(proof.counts.pending,0);assert.equal(proof.counts.setCookieResponses,1);
	assert.equal(proof.counts.terminalBeforeHeaders,1);
	assert.equal(collector.snapshot().proxyHeaderCensus.closed,true,"browser semantic closure does not close the transport census early");
	assert.doesNotMatch(JSON.stringify(proxy.snapshot()),/private-value/);
	proxy.response(id(3),{status:200,headers:{}});
	assert.equal(proxy.snapshot().headerCensus.counts.late,1,"late header facts remain sticky after closure");
});

test("every protocol source closure binds the newly wired proxy header census",async()=>{
	const maps=await Promise.all([primaryProtocolIdentity(),companionProtocolIdentity(),budgetProtocolIdentity()]);
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
		const browser={process:()=>({spawnfile:executable,spawnargs:[executable,"--disable-extensions","--user-data-dir=PRIVATE_PROFILE","--remote-debugging-port=0"]}),
			fixtureLaunchPolicy:{policy:"isolated-profile-no-prediction-v1",arguments:["--disable-extensions"],profileDirectorySha256:createHash("sha256").update("PRIVATE_PROFILE").digest("hex")}};
		const metadata=await captureNativeLaunchMetadata(browser);
		assert.equal(metadata.processKnown,true); assert.equal(metadata.argumentsMatchRecorded,true);
		assert.equal(metadata.profileArgumentMatchesRecorded,true);
		assert.equal(metadata.executable.sha256,createHash("sha256").update("SYNTHETIC_EXECUTABLE").digest("hex"));
		assert.equal((await captureNativeLaunchMetadata({})).processKnown,false);
		assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE_PROFILE|synthetic.exe|SYNTHETIC_EXECUTABLE/);
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
		const binding=await readBrowserControlBinding({manifestPath,plan:{runtime:{build,browserControl:{policy:controlCancellationPolicy,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:createHash("sha256").update(bytes).digest("hex")}}}});
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
		const browserControl = { policy: controlCancellationPolicy, browserRevision: chromiumSWRRevision,
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
		assert.equal((await verifyBrowserControlBrowser(browser, binding)).browserVerified, true);
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
	const compiledBinding=await readBrowserControlBinding({manifestPath,plan:{runtime:{build,browserControl:{policy:controlCancellationPolicy,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:createHash("sha256").update(bytes).digest("hex")}}}});
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
		const plan={runtime:{build,browserControl:{policy:controlCancellationPolicy,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,compiledManifestSha256:manifestSha,nativePublicSources}}};
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
	const page = { createCDPSession: async () => session };
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
	const observer = await installBrowserControlCollector({
		page,
		context: { async cookies() { cookieReads++; return [{ name: "session", domain: "localhost", path: "/", value: "PRIVATE_COOKIE" }]; } },
		transport,
		origin,
		headers: { "Accept-Language": "en" },
		contextId,
		browserRevision: chromiumSWRRevision,
	});
	assert.equal(await page.goto(...args), "original-result");
	await assert.rejects(page.reload(), (value) => value === error);
	assert.equal(
		calls.filter(([method]) => method === "Network.setExtraHTTPHeaders").length,
		2,
	);
	assert.equal(calls[1][1].headers["Accept-Language"], "en");
	await observer.close({ deadlineMs: performance.now() + 1000 });
	assert.equal(page.goto, goto);
	assert.equal(cookieReads, 2);
	assert.equal(observer.snapshot().principalEpoch.matchesAtBoundaries, true);
	assert.equal(observer.snapshot().principalEpoch.stablePrincipalClaim, false);
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
	const compiledBinding={policy:controlCancellationPolicy,browserRevision:chromiumSWRRevision,compiledCachedNavigations:true,
		compiledManifestSha256:"c".repeat(64),compiledBuild:"b".repeat(40),manifestVerified:true};
	const staged='0:{"t":{"t":{"s":"","d":{"r":null,"p":"$@3","v":null,"s":"$4"}}},"a":"$@5","u":"$@6"}\n3:"$undefined"\n4:X\n4:60\n4:C\n5:null\n6:false\n';
	const requestHeaders={...headers,"next-router-segment-prefetch":"/_index"};
	const segmentHeaders={...responseHeaders,"x-nextjs-postponed":"2","x-nextjs-deployment-id":compiledBinding.compiledBuild};
	for(const missing of [null,"compiledBinding","x-nextjs-postponed","x-nextjs-deployment-id","RSC","next-router-prefetch","next-router-segment-prefetch"]){
		const actualRequest={...requestHeaders},actualResponse={...segmentHeaders};
		delete actualRequest[missing]; delete actualResponse[missing];
		const options={contextId,compiledCachedNavigations:true,compiledBinding:missing==="compiledBinding"?undefined:compiledBinding};
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
			const collector = createBrowserControlCollector({ contextId, origin, browserRevision: chromiumSWRRevision, compiledCachedNavigations: false,
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
