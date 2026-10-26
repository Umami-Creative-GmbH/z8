import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
	readBrowserControlBinding,
	verifyBrowserControlBrowser,
	createBrowserControlCollector,
	createProxyControlCollector,
	installBrowserControlCollector,
	controlDocumentHeader,
	controlResponseHeader,
} from "./browser-control-collector.mjs";
import { controlCancellationPolicy } from "./control-cancellation-evidence.mjs";

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
const body = '#0:{"b":"PRIVATE_BUILD","t":{"t":{"s":""}}}\n';
const event = (requestId, timestamp, type = "Fetch") => ({
	requestId,
	timestamp,
	loaderId: "current-loader",
	type,
	initiator: { type: type === "Other" ? "other" : "script" },
	request: { url, method: "GET", headers, initialPriority: "VeryLow" },
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

test("normal admission binds the actual manifest before IO and actual browser revision without a mode default", async () => {
	const dir = await mkdtemp(join(tmpdir(), "z8-browser-admission-"));
	try {
		const manifestPath = join(dir, "required-server-files.json"), build = "c".repeat(40);
		const bytes = Buffer.from(JSON.stringify({ config: { deploymentId: build, experimental: { cachedNavigations: true } } }));
		await writeFile(manifestPath, bytes);
		const browserControl = { policy: controlCancellationPolicy, browserRevision: chromiumSWRRevision,
			compiledCachedNavigations: true, compiledManifestSha256: createHash("sha256").update(bytes).digest("hex") };
		const plan = { runtime: { build, browserControl } };
		const binding = await readBrowserControlBinding({ plan, manifestPath });
		assert.equal(binding.manifestVerified, true);
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
