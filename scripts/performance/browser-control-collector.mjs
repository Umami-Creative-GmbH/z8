/** Passive all-phase identity/body receipts. No app requests, payloads, URLs or header values are emitted. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import {
	classifyControlCancellations,
	controlCancellationPolicy,
	inspectRequiredFlightBody,
	knownBrowserControlMetadata,
	knownNativePublicSources,
	controlIdentityHeaders,
	canonicalRouteScalarFacts,
	mixedNativeProgressInput,
	mixedNativePrefixCandidates,
	mixedNativeAuthorityDigest,
	mixedNativeProgressVector,
	mixedNativeProgressPolicy,
	mixedFailureOccurrenceCensus,
	createMixedNativePrefix,
	validateMixedNativePrefix,
	knownMixedOpenJournals,
	sameMixedReturnJournals,
	routePathSourceDigest,
} from "./control-cancellation-evidence.mjs";
import { createProxyHeaderCensus, proxyHeaderPrefix } from "./proxy-header-census.mjs";
import { projectCachedCdpText } from "./cdp-cached-text-projection.mjs";

export const controlResponseHeader = "x-z8-fixture-response-id";
export const controlDocumentHeader = "x-z8-fixture-document-generation";
export const mixedBrowserWorkScope = "all-mixed-context-work-before-first-app-io-through-finite-settlement-v1";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const scalarFactBytes=facts=>facts?.known===true?Buffer.byteLength(JSON.stringify(facts))+1024:0;
const ownData=(object,key)=>{
	try{const field=object && typeof object==="object"?Object.getOwnPropertyDescriptor(object,key):null;return field && Object.hasOwn(field,"value")?{present:true,value:field.value}:{present:field!==undefined && field!==null,unknown:field!==undefined && field!==null};}catch{return {present:false,unknown:true};}
};
const boundedText=value=>typeof value==="string" && Buffer.byteLength(value)<=2048;

/** Digests actual verified-manifest routing fields; no raw routing strings survive. */
export function compiledRoutingSourceFacts(config,manifestSha256){
	const base=ownData(config,"basePath"),output=ownData(config,"output");
	const configKnown=config && typeof config==="object" && [Object.prototype,null].includes(Object.getPrototypeOf(config)) && /^[a-f0-9]{64}$/.test(manifestSha256 ?? "");
	const baseKnown=Boolean(configKnown && base.present && !base.unknown && boundedText(base.value));
	const outputKnown=Boolean(configKnown && !output.unknown && (!output.present || ["export","standalone"].includes(output.value)));
	return {protocol:"compiled-routing-source-facts-v1",compiledManifestSha256:manifestSha256,
		basePathOwnKnown:baseKnown,basePathEmpty:baseKnown?base.value==="":null,basePathBytes:baseKnown?Buffer.byteLength(base.value):null,basePathSha256:baseKnown?sha(base.value):null,
		outputFieldPresent:output.present,outputKnown,output:outputKnown?(output.present?output.value:"absent"):"unknown"};
}
const routingURLFacts=(raw,compiled,origin,provenance,collectScalars=false)=>{
	let url;try{if(boundedText(raw))url=new URL(raw);}catch{}
	const actual={known:Boolean(url && ["http:","https:"].includes(url.protocol) && !url.username && !url.password),provenance,bytes:boundedText(raw)?Buffer.byteLength(raw):null,sha256:boundedText(raw)?sha(raw):null,originSha256:url?sha(url.origin):null,originMatches:url&&typeof origin==="string"?url.origin===origin:null};
	let fallback={known:false,reason:"unknown-response-url",pathnameSha256:null,pathnameBytes:null,partsCount:null,searchSha256:null,searchBytes:null};
	if(!actual.known)return {actual,fallback};
	if(compiled?.protocol!=="compiled-routing-source-facts-v1" || compiled.basePathOwnKnown!==true || compiled.outputKnown!==true)return {actual,fallback:{...fallback,reason:"unknown-compiled-routing"}};
	if(compiled.output==="export")return {actual,fallback:{...fallback,reason:"unsupported-export-routing"}};
	if(compiled.basePathEmpty!==true)return {actual,fallback:{...fallback,reason:"unsupported-nonempty-base-path"}};
	try{url.searchParams.delete("_rsc");const search=normalizeRoutingSearch(url.search);
		fallback={known:true,reason:null,pathnameSha256:sha(url.pathname),pathnameBytes:Buffer.byteLength(url.pathname),partsCount:url.pathname.split("/").filter(Boolean).length,searchSha256:sha(search),searchBytes:Buffer.byteLength(search)};
		if(collectScalars)fallback.scalarKeys=canonicalRouteScalarFacts(url.pathname);
	}catch{fallback={...fallback,reason:"unsupported-search-normalization"};}
	return {actual,fallback};
};
const normalizeRoutingSearch=raw=>{
	const grouped=Object.create(null);
	for(const [key,value] of new URLSearchParams(raw)){
		if(Object.hasOwn(Object.prototype,key))throw Error("Unsupported query key");
		(grouped[key] ??= []).push(value);
	}
	const pairs=[];for(const key of Object.keys(grouped))for(const value of grouped[key])pairs.push(encodeURIComponent(key)+"="+encodeURIComponent(value));
	return pairs.length?"?"+pairs.join("&"):"";
};
const rewriteSourceFacts=headers=>{
	const unknown={snapshotKnown:false,path:{known:false,present:null,bytes:null,sha256:null},query:{known:false,present:null,bytes:null,sha256:null}};
	if(!headers || typeof headers!=="object" || ![Object.prototype,null].includes(Object.getPrototypeOf(headers)))return {facts:unknown};
	const values=new Map();let bytes=0;
	try{const keys=Reflect.ownKeys(headers);if(keys.length>256)return {facts:unknown};
		for(const key of keys){if(typeof key!=="string" || key.length>256)return {facts:unknown};const field=ownData(headers,key);
			if(field.unknown || !field.present || typeof field.value!=="string")return {facts:unknown};
			bytes+=Buffer.byteLength(key)+Buffer.byteLength(field.value);if(bytes>65536 || values.has(key.toLowerCase()))return {facts:unknown};values.set(key.toLowerCase(),field.value);}
	}catch{return {facts:unknown};}
	const get=key=>{const present=values.has(key),value=values.get(key);return {known:!present || boundedText(value),present,bytes:present&&boundedText(value)?Buffer.byteLength(value):null,sha256:present&&boundedText(value)?sha(value):null};};
	return {facts:{snapshotKnown:true,path:get("x-nextjs-rewritten-path"),query:get("x-nextjs-rewritten-query")},path:values.get("x-nextjs-rewritten-path"),query:values.get("x-nextjs-rewritten-query")};
};

/** Source observations only; an unknown routing mode never selects a guessed pathname. */
export function renderedPathSourceFacts({response,compiledRouting,origin,requestURLFacts,collectScalars=false,responseOrdinal=null,observerSourceSha256=null}={}){
	const urlField=ownData(response,"url"),headersField=ownData(response,"headers");
	const urlFacts=requestURLFacts ?? routingURLFacts(!urlField.unknown && urlField.present?urlField.value:undefined,compiledRouting,origin,"Network.responseReceived.url",collectScalars);
	const rewrite=rewriteSourceFacts(!headersField.unknown && headersField.present?headersField.value:null),facts=rewrite.facts;
	const status=ownData(response,"status"),statusKnown=!status.unknown && status.present && Number.isSafeInteger(status.value) && status.value>=100 && status.value<=599;
	const result={protocol:"rendered-path-source-facts-v1",responseOrdinal,observerSourceSha256,sourceKnown:urlFacts.actual.known && facts.snapshotKnown && compiledRouting?.basePathOwnKnown===true && compiledRouting.outputKnown===true,
		responseStatusKnown:statusKnown,responseStatus:statusKnown?status.value:null,compiledRouting:compiledRouting ?? null,url:urlFacts.actual,rewrite:facts,rendered:{known:false,reason:"unknown-rewrite-header-snapshot",pathnameSource:null,pathnameSha256:null,pathnameBytes:null,partsCount:null,searchSource:null,searchSha256:null,searchBytes:null}};
	if(!facts.snapshotKnown || !facts.path.known || !facts.query.known)return result;
	try{let path,search;const rendered=result.rendered;
		if(facts.path.present){if(!rewrite.path || !rewrite.path.startsWith("/") || /[?#\r\n]/.test(rewrite.path))return {...result,rendered:{...rendered,reason:"unsupported-rewritten-path"}};
			path={pathnameSha256:sha(rewrite.path),pathnameBytes:Buffer.byteLength(rewrite.path),partsCount:rewrite.path.split("/").filter(Boolean).length};rendered.pathnameSource="rewrite-header";
		}else{if(!urlFacts.fallback.known)return {...result,rendered:{...rendered,reason:urlFacts.fallback.reason}};path=urlFacts.fallback;rendered.pathnameSource=urlFacts.actual.provenance==="Network.responseReceived.url"?"response-url":"owned-proxy-request-url-no-follow";}
		if(facts.query.present){const normalized=normalizeRoutingSearch(rewrite.query);search={searchSha256:sha(normalized),searchBytes:Buffer.byteLength(normalized)};rendered.searchSource="rewrite-header";}
		else{if(!urlFacts.fallback.known)return {...result,rendered:{...rendered,reason:urlFacts.fallback.reason}};search=urlFacts.fallback;rendered.searchSource=urlFacts.actual.provenance==="Network.responseReceived.url"?"response-url":"owned-proxy-request-url-no-follow";}
		Object.assign(rendered,{known:true,reason:null,...Object.fromEntries(["pathnameSha256","pathnameBytes","partsCount"].map(key=>[key,path[key]])),...Object.fromEntries(["searchSha256","searchBytes"].map(key=>[key,search[key]]))});
		if(collectScalars && !facts.path.present && !facts.query.present && urlFacts.fallback.scalarKeys)result.scalarKeys={...urlFacts.fallback.scalarKeys,sourceSha256:routePathSourceDigest(result)};
	}catch{result.rendered.reason="unsupported-search-normalization";}
	return result;
}
// Private file locator only; all actual source/hash observations are serialized, not stored here.
const nativeManifestLocators = new WeakMap();
const compiledRoutingSources = new WeakMap();
const requestShapeBindings = new WeakMap();
// Diagnostic-only: at most 16 KiB input, 32 punctuation tokens, and depth two.
// 256 KiB reserves concat + UTF-16 text/parsed strings + bounded graph/metadata
// BEFORE decoding/JSON.parse; it is charged to the existing proxy body pool.
const requestShapeLimits = Object.freeze({ encodedBytes: 16384, depth: 2, punctuation: 32, byteEvents: controlCancellationPolicy.recordLimit, parseReservation: 262144, metadataReservation: 2048 });
export const compiledRoutingForBinding = binding=>compiledRoutingSources.get(binding) ?? null;
const shaChunks = (chunks) => {
	const hash = createHash("sha256");
	for (const chunk of chunks) hash.update(chunk);
	return hash.digest("hex");
};
const hasProtocolError = (proof) => proof?.serverErrors > 0 || proof?.explicitActionFailure === true;
const protocolErrorFact = (proof, capture, bodySha256,row) => ({
	capture,
	serverErrors: Number.isSafeInteger(proof.serverErrors) && proof.serverErrors > 0 ? proof.serverErrors : 0,
	explicitActionFailure: proof.explicitActionFailure === true,
	reason: ["flight-server-error", "embedded-runtime-prefetch-incomplete", "explicit-root-action-failure"].includes(proof.reason) ? proof.reason : "observed-protocol-error",
	bodySha256: /^[a-f0-9]{64}$/.test(bodySha256 ?? "") ? bodySha256 : null,
	requestKind:["action","navigation","route-tree","segment-prefetch","runtime-shell","embedded-runtime-prefetch"].includes(row?.requestKind)?row.requestKind:"unknown",
	actionKnown:row?.requestHeaderSnapshotKnown===true && typeof row.action==="boolean",action:row?.requestHeaderSnapshotKnown===true && typeof row.action==="boolean"?row.action:null,
	nextActionHeader:{known:row?.requestHeaderSnapshotKnown===true && Object.hasOwn(row.headerFieldSha256 ?? {},"next-action"),sha256:row?.requestHeaderSnapshotKnown===true?row.headerFieldSha256?.["next-action"] ?? null:null,
		provenance:row?.id?"owned-proxy-request":row?.extraHeaderIdentity?.requestHeaderSnapshotKnown===true?"request-extra-info":row?.initialHeaderIdentity?.requestHeaderSnapshotKnown===true?"initial-request-event":"unknown"},
	returnedError:proof.returnedError?.known===true && Number.isSafeInteger(proof.returnedError.utf8Bytes) && proof.returnedError.utf8Bytes>=0 && proof.returnedError.utf8Bytes<=controlCancellationPolicy.decodedLimit && /^[a-f0-9]{64}$/.test(proof.returnedError.sha256 ?? "")?{known:true,utf8Bytes:proof.returnedError.utf8Bytes,sha256:proof.returnedError.sha256}:{known:false,utf8Bytes:null,sha256:null},
});
const assignBodyProof = (row, proof, capture, bodySha256) => {
	row.bodyProof = proof;
	if (!hasProtocolError(proof)) return;
	const fact = protocolErrorFact(proof, capture, bodySha256,row);
	row.observedProtocolError = { serverErrors: Math.max(row.observedProtocolError?.serverErrors ?? 0, fact.serverErrors),
		explicitActionFailure: row.observedProtocolError?.explicitActionFailure === true || fact.explicitActionFailure };
	const history = row.protocolErrorObservations ??= [];
	if (history.some((prior) => ["capture","serverErrors","explicitActionFailure","reason","bodySha256"].every(key=>prior[key]===fact[key]))) return;
	if (history.length >= 2) { row.protocolErrorObservationOverflow = (row.protocolErrorObservationOverflow ?? 0) + 1; return; }
	history.push(fact);
};

const nativeFileMetadata = async (path, limit) => {
	try {
		const before = await stat(path, { bigint: true });
		if (!before.isFile() || before.size > BigInt(limit)) return { known: false, bytes: null, sha256: null, reason: "file-limit-or-kind" };
		const hash = createHash("sha256"); let bytes = 0;
		for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
			bytes += chunk.length;
			if (bytes > limit) return { known: false, bytes: null, sha256: null, reason: "file-limit-or-kind" };
			hash.update(chunk);
		}
		const after = await stat(path, { bigint: true });
		if (["dev", "ino", "size", "mtimeNs"].some(key => before[key] !== after[key]) || BigInt(bytes) !== after.size)
			return { known: false, bytes: null, sha256: null, reason: "file-changed" };
		return { known: true, bytes, sha256: hash.digest("hex"), reason: null };
	} catch { return { known: false, bytes: null, sha256: null, reason: "file-unavailable" }; }
};

/** Actual serving public bytes are separate from the compiled manifest; no worker is fetched. */
export async function readNativePublicSources(manifestPath) {
	const servingRootKnown = typeof manifestPath === "string" && basename(manifestPath) === "required-server-files.json" && basename(dirname(manifestPath)) === ".next";
	const files = ["sw.js", "lib/offline-queue-db.js", "lib/sync-service.js", "lib/clock-command-dispatch.js"];
	return { protocol: "serving-public-worker-source-metadata-v1", servingRootKnown,
		files: await Promise.all(files.map(async file => ({ file, ...(servingRootKnown ? await nativeFileMetadata(resolve(dirname(manifestPath), "../public", file), controlCancellationPolicy.encodedLimit) :
			{ known: false, bytes: null, sha256: null, reason: "unqualified-manifest-location" }) }))) };
}

/** Files and arguments from the actual owned child; metadata alone is not a producer certificate. */
export async function captureNativeLaunchMetadata(browser) {
	let child;
	try { child = browser.process?.(); } catch {}
	const argumentList = child?.spawnargs?.slice(1), recorded = browser.fixtureLaunchPolicy?.arguments;
	const valid = args => {
		if (!Array.isArray(args) || args.length > 1024) return false;
		let bytes = 2;
		for (const arg of args) {
			if (typeof arg !== "string" || Buffer.byteLength(arg) > 65536) return false;
			bytes += Buffer.byteLength(JSON.stringify(arg)) + 1;
			if (bytes > controlCancellationPolicy.encodedLimit) return false;
		}
		return true;
	};
	const argumentsKnown = valid(argumentList), recordedKnown = valid(recorded);
	const normalized = argumentsKnown ? argumentList.filter(arg => !arg.startsWith("--user-data-dir=") && !arg.startsWith("--remote-debugging-port=")) : null;
	const profiles = argumentsKnown ? argumentList.filter(arg => arg.startsWith("--user-data-dir=")) : [];
	const profileArgumentSha256 = profiles.length === 1 ? sha(profiles[0].slice("--user-data-dir=".length)) : null;
	return { protocol: "owned-native-launch-metadata-v1", processKnown: typeof child?.spawnfile === "string" && argumentsKnown,
		fixturePolicy: browser.fixtureLaunchPolicy?.policy === "isolated-profile-no-prediction-v1" ? browser.fixtureLaunchPolicy.policy : "unknown", argumentsKnown,
		argumentsSha256: normalized ? sha(JSON.stringify(normalized)) : null,
		recordedArgumentsSha256: recordedKnown ? sha(JSON.stringify(recorded)) : null,
		argumentsMatchRecorded: argumentsKnown && recordedKnown ? JSON.stringify(normalized) === JSON.stringify(recorded) : null,
		argumentKeys: normalized?.map(arg => /^--[a-z0-9-]+(?:=|$)/.test(arg) ? arg.split("=")[0] : "positional") ?? null,
		profileArgumentCount: argumentsKnown ? profiles.length : null, profileArgumentSha256,
		recordedProfileDirectorySha256: /^[a-f0-9]{64}$/.test(browser.fixtureLaunchPolicy?.profileDirectorySha256 ?? "") ? browser.fixtureLaunchPolicy.profileDirectorySha256 : null,
		profileArgumentMatchesRecorded: profileArgumentSha256 && typeof browser.fixtureLaunchPolicy?.profileDirectorySha256 === "string" ? profileArgumentSha256 === browser.fixtureLaunchPolicy.profileDirectorySha256 : null,
		executable: await nativeFileMetadata(child?.spawnfile, 1024 * 1024 * 1024),
		observerSources: await Promise.all(["browser-control-collector.mjs", "fixture-browser.mjs"].map(async file => ({ file,
			...await nativeFileMetadata(new URL(file, import.meta.url), controlCancellationPolicy.encodedLimit) }))) };
}

/** Passive existing Puppeteer target-manager events; no discovery command or worker request. */
export function createNativeWorkerObserver({ browser, context, contextId, origin }) {
	let errors = 0, overflow = 0, scopeClosed = false, installed = false, contextJoinKnown = false, contextIdentitySha256 = null;
	const events = [], identities = new Map(), listeners = new Map();
	try { contextJoinKnown = context.browser() === browser && typeof context.id === "string" && context.id.length > 0;
		if (contextJoinKnown) contextIdentitySha256 = sha(context.id); } catch { errors++; }
	const record = (target, event) => {
		if (scopeClosed) return;
		try {
			if (target.browserContext() !== context) return;
			if (events.length >= 256) { overflow++; return; }
			if (!identities.has(target)) identities.set(target, identities.size + 1);
			const rawType = target.type(), type = ["page", "service_worker", "shared_worker", "other", "background_page", "webview", "tab"].includes(rawType) ? rawType : "unknown";
			const rawUrl = target.url(); let url;
			try { url = new URL(rawUrl); } catch {}
			events.push({ targetOrdinal: identities.get(target), event, type, urlKnown: Boolean(url), urlSha256: url ? sha(url.href) : null,
				originMatches: url ? url.origin === origin : null,
				ownedWorkerScript: type === "service_worker" && url ? url.href === `${origin}/sw.js` : null });
		} catch { errors++; }
	};
	try {
		for (const [name,event] of [["targetcreated","created"],["targetchanged","changed"],["targetdestroyed","destroyed"]]) {
			const listener = target => record(target,event); browser.on(name,listener); listeners.set(name,listener);
		}
		for (const target of browser.targets()) record(target,"initial");
		installed = true;
	} catch { errors++; }
	return {
		close() { scopeClosed = true; for (const [name,listener] of listeners) try { browser.off(name,listener); } catch { errors++; } listeners.clear(); },
		snapshot: () => ({ protocol: "owned-context-worker-target-metadata-v1", contextId, contextJoinKnown, contextIdentitySha256, installed, scopeClosed,
			enumerationBasis: "existing-puppeteer-target-manager", controllerObservation: "not-collected", errors, overflow, events: events.map(row=>({...row})) }),
	};
}

const nativeControllerMetadata = (raw,origin) => {
		const url = value => { try { return typeof value === "string" && value.length <= 2048 ? new URL(value) : null; } catch { return null; } };
		const worker = value => {
			if (value === null) return { present: false, known: true };
			const script = url(value?.scriptURL), stateKnown = ["installing","installed","activating","activated","redundant"].includes(value?.state);
			return { present: value ? true : null, known: Boolean(script) && stateKnown, scriptUrlSha256: script ? sha(script.href) : null,
				ownedScript: script ? script.href === `${origin}/sw.js` : null, state: stateKnown ? value.state : "unknown" };
		};
		if (raw?.available !== true) return { available: false, known: false };
		const registrations = Array.isArray(raw.registrations) && raw.registrations.length <= 32 ? raw.registrations.map(registration => {
			const scope = url(registration?.scope);
			return { scopeKnown: Boolean(scope), scopeSha256: scope ? sha(scope.href) : null, ownedRootScope: scope ? scope.href === `${origin}/` : null,
				active: worker(registration?.active), waiting: worker(registration?.waiting), installing: worker(registration?.installing) };
		}) : null;
		return { available: true, secureContext: raw.secureContext === true, originMatches: raw.origin === origin,
			controllerIdentityStable: typeof raw.controllerIdentityStable === "boolean" ? raw.controllerIdentityStable : null,
			controllerBefore: worker(raw.controllerBefore), controllerAfter: worker(raw.controllerAfter),
			registrationCount: Number.isSafeInteger(raw.registrationCount) && raw.registrationCount >= 0 ? raw.registrationCount : null,
			registrationOverflow: Number.isSafeInteger(raw.registrationOverflow) && raw.registrationOverflow >= 0 ? raw.registrationOverflow : null, registrations };
	};

/** Read-only browser metadata and local source recheck; shares the caller's existing deadline. */
export async function captureNativeEndMetadata({ page, binding, origin, deadlineMs }) {
	const started = performance.now(), remaining = deadlineMs - started;
	if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 10000)
		return { protocol: "native-environment-end-readonly-v1", timedOut: remaining <= 0, reason: "invalid-or-expired-deadline", pendingOperations: 0, readErrors: 0, controller: null, publicSourceRecheck: null, publicSourcesMatch: null };
	let pendingOperations = 2, readErrors = 0, controller = null, publicSourceRecheck = null, timer;

	const tasks = [Promise.resolve().then(async () => {
		const raw = await page.evaluate(async () => {
			const serviceWorker = globalThis.navigator?.serviceWorker;
			if (!serviceWorker || typeof serviceWorker.getRegistrations !== "function") return { available: false };
			const describe = worker => worker === null ? null : { scriptURL: worker?.scriptURL, state: worker?.state };
			const before = serviceWorker.controller, beforeMetadata = describe(before), registrations = await serviceWorker.getRegistrations(), after = serviceWorker.controller;
			return { available: true, secureContext: globalThis.isSecureContext === true, origin: globalThis.location?.origin,
				controllerBefore: beforeMetadata, controllerAfter: describe(after), controllerIdentityStable: before === after,
				registrationCount: Array.isArray(registrations) ? registrations.length : null,
				registrationOverflow: Array.isArray(registrations) ? Math.max(0,registrations.length - 32) : null,
				registrations: Array.isArray(registrations) && registrations.length <= 32 ? registrations.map(registration => ({scope:registration.scope,active:describe(registration.active),waiting:describe(registration.waiting),installing:describe(registration.installing)})) : null };
		});
		controller = nativeControllerMetadata(raw,origin);
	}), Promise.resolve().then(async () => {
		const locator = binding && nativeManifestLocators.get(binding);
		publicSourceRecheck = locator ? await readNativePublicSources(locator) : { protocol: "serving-public-worker-source-metadata-v1", servingRootKnown: false, files: null, reason: "missing-bound-serving-root" };
	})].map(task => task.catch(() => { readErrors++; }).finally(() => { pendingOperations--; }));
	try { await Promise.race([Promise.all(tasks),new Promise(resolve=>{timer=setTimeout(resolve,remaining);})]); }
	finally { clearTimeout(timer); }
	const before = binding?.servingPublicSources, after = publicSourceRecheck;
	const sourcesKnown = before?.files?.length === 4 && after?.files?.length === 4 && [...before.files,...after.files].every(file=>file.known===true);
	return { protocol: "native-environment-end-readonly-v1", timedOut: pendingOperations > 0 || performance.now() > deadlineMs,
		deadlineBudgetMs: remaining, elapsedMs: performance.now() - started, pendingOperations, readErrors, controller, publicSourceRecheck,
		publicSourcesMatch: sourcesKnown ? JSON.stringify(before) === JSON.stringify(after) : null };
}

/** Read the compiled source boundary before app/control/browser IO; never infer a missing flag. */
export async function readBrowserControlBinding({ plan, manifestPath }) {
	const metadata = plan.runtime?.browserControl;
	if (!knownBrowserControlMetadata(metadata) || !/^[a-f0-9]{40}$/.test(plan.runtime?.build ?? "") || !manifestPath)
		throw Error("Missing qualified browser control runtime metadata or app manifest.");
	const bytes = await readFile(manifestPath);
	let manifest;
	try { manifest = JSON.parse(bytes.toString("utf8")); }
	catch { throw Error("Compiled app manifest is unavailable or malformed."); }
	if (sha(bytes) !== metadata.compiledManifestSha256 || manifest.config?.deploymentId !== plan.runtime.build ||
		typeof manifest.config?.experimental?.cachedNavigations !== "boolean" ||
		manifest.config.experimental.cachedNavigations !== metadata.compiledCachedNavigations)
		throw Error("Compiled app manifest differs from the qualified browser control metadata.");
	const servingPublicSources=await readNativePublicSources(manifestPath);
	if (metadata.nativePublicSources && (!knownNativePublicSources(metadata.nativePublicSources,plan.runtime.build,metadata.compiledManifestSha256) ||
		!servingPublicSources.servingRootKnown || !servingPublicSources.files.every((row,index)=>row.known === true &&
			row.file === metadata.nativePublicSources.files[index].file && row.bytes === metadata.nativePublicSources.files[index].bytes && row.sha256 === metadata.nativePublicSources.files[index].sha256)))
		throw Error("Serving public sources differ from the independently qualified compiled source.");
	const binding = Object.freeze({ ...metadata, compiledBuild: plan.runtime.build, manifestVerified: true, browserVerified: false,servingPublicSources });
	if (Object.hasOwn(metadata,"requestShapeDiagnostic")) {
		const configuration=metadata.requestShapeDiagnostic;
		const keys=["protocol","compiledBuild","compiledManifestSha256","actionRegistrySha256","actionHeaderSha256","actionName"];
		if (!configuration || JSON.stringify(Object.keys(configuration).sort())!==JSON.stringify([...keys].sort()) ||
			configuration.protocol!=="request-shape-diagnostic-v1" || configuration.actionName!=="getTeamPerformanceData" ||
			configuration.compiledBuild!==binding.compiledBuild || configuration.compiledManifestSha256!==binding.compiledManifestSha256 ||
			![configuration.actionRegistrySha256,configuration.actionHeaderSha256].every(value=>typeof value==="string" && /^[a-f0-9]{64}$/.test(value)))
			throw Error("Request-shape diagnostic source binding is invalid.");
		const registryPath=resolve(dirname(manifestPath),"server/server-reference-manifest.json"),before=await stat(registryPath,{bigint:true});
		if (!before.isFile() || before.size>BigInt(controlCancellationPolicy.encodedLimit)) throw Error("Request-shape registry exceeds the source bound.");
		const chunks=[];let registryLength=0;
		for await(const chunk of createReadStream(registryPath,{highWaterMark:65536})){registryLength+=chunk.length;if(registryLength>controlCancellationPolicy.encodedLimit)throw Error("Request-shape registry exceeds the source bound.");chunks.push(chunk);}
		const after=await stat(registryPath,{bigint:true});
		if(["dev","ino","size","mtimeNs"].some(key=>before[key]!==after[key]) || BigInt(registryLength)!==after.size)throw Error("Request-shape registry changed during admission.");
		const registryBytes=Buffer.concat(chunks,registryLength);
		if (sha(registryBytes)!==configuration.actionRegistrySha256) throw Error("Request-shape action registry hash differs.");
		let registry;
		try { registry=JSON.parse(registryBytes.toString("utf8")); }
		catch { throw Error("Request-shape action registry is malformed."); }
		const matches=Object.entries(registry.node ?? {}).filter(([id])=>/^[a-f0-9]{42}$/.test(id) && sha(id)===configuration.actionHeaderSha256);
		if (matches.length!==1 || matches[0][1]?.exportedName!==configuration.actionName ||
			matches[0][1]?.filename!=="apps/webapp/src/app/[locale]/(app)/analytics/actions.ts") throw Error("Request-shape action identity differs.");
		requestShapeBindings.set(binding,Object.freeze({...configuration}));
	}
	compiledRoutingSources.set(binding,Object.freeze(compiledRoutingSourceFacts(manifest.config,sha(bytes))));
	nativeManifestLocators.set(binding,manifestPath);
	return binding;
}

/** One actual startup command, before visits; no app requests and no browser-revision default. */
export async function verifyBrowserControlBrowser(browser, binding) {
	if (!knownBrowserControlMetadata(binding) || binding.manifestVerified !== true)
		throw Error("Browser control manifest admission is missing.");
	const session = await browser.target().createCDPSession();
	try {
		const actual = await session.send("Browser.getVersion");
		if (actual.revision?.replace(/^@/, "") !== binding.browserRevision)
			throw Error("Actual browser revision differs from qualified protocol control source.");
		const verified = Object.freeze({ ...binding, browserVerified: true, nativeLaunchMetadata: await captureNativeLaunchMetadata(browser) });
		if (nativeManifestLocators.has(binding)) nativeManifestLocators.set(verified,nativeManifestLocators.get(binding));
		if(compiledRoutingSources.has(binding))compiledRoutingSources.set(verified,compiledRoutingSources.get(binding));
		if(requestShapeBindings.has(binding))requestShapeBindings.set(verified,requestShapeBindings.get(binding));
		return verified;
	} finally { await session.detach(); }
}
const selectedHeaders = controlIdentityHeaders;
const lowerHeaders = (headers = {}) =>
	Object.fromEntries(
		Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
	);

/** Cookie values live only in the actual browser snapshot and temporary hashing input. */
export function createPrincipalEpochObserver(contextId, { origin } = {}) {
	let originHost;
	try { originHost = new URL(origin).hostname.replace(/^\[|\]$/g, ""); } catch {}
	let before, after, scopeClosed = false, readErrors = 0, pendingReads = 0, observationErrors = 0, overflow = 0, unknownResponseHeaders = 0;
	const setCookies = new Map();
	const progressReads=new Map(),progressReadHistory=new Map(),progressReadIds=new Set();let progressReadsStarted=0,progressReadsFinished=0;
	const unknown = () => ({ known: false, cookieCount: null, sha256: null });
	const snapshotCookies = (cookies) => {
		if (!Array.isArray(cookies) || cookies.length > controlCancellationPolicy.recordLimit || cookies.some((cookie) =>
			!cookie || ["name", "domain", "path", "value"].some((key) => typeof cookie[key] !== "string") || cookie.partitionKey !== undefined)) return unknown();
		const rows = cookies.map(({ name, domain, path, value }) => [name, domain, path, value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		if (new Set(rows.map((row) => JSON.stringify(row.slice(0, 3)))).size !== rows.length) return unknown();
		const bytes = JSON.stringify(rows);
		if (Buffer.byteLength(bytes) > controlCancellationPolicy.encodedLimit) return unknown();
		const httpOnlyKnown = cookies.every((cookie) => typeof cookie.httpOnly === "boolean");
		const single = cookies[0];
		const singleOwnedRootHttpOnlyCookie = !originHost || !httpOnlyKnown ? null : cookies.length === 1 && single.httpOnly === true && single.path === "/" &&
			single.domain.toLowerCase().replace(/^\./, "") === originHost && /^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(single.name) &&
			single.value.length > 0 && /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(single.value);
		return { known: true, cookieCount: rows.length, sha256: sha(bytes), cookieAttributes: { originKnown: Boolean(originHost), httpOnlyKnown,
			allHttpOnly: httpOnlyKnown ? cookies.every((cookie) => cookie.httpOnly) : null, singleOwnedRootHttpOnlyCookie,
			singleCookieHeaderSha256: singleOwnedRootHttpOnlyCookie === true ? sha(`${single.name}=${single.value}`) : null } };
	};
	return {
		progressStarted(acknowledgmentOrdinal){
   if(scopeClosed || !Number.isSafeInteger(acknowledgmentOrdinal) || acknowledgmentOrdinal<1 || acknowledgmentOrdinal>controlCancellationPolicy.recordLimit || progressReadIds.has(acknowledgmentOrdinal) || progressReadIds.size>=controlCancellationPolicy.recordLimit){observationErrors++;return false;}
   progressReadIds.add(acknowledgmentOrdinal);const row={acknowledgmentOrdinal,kind:"read-only-context-cookies-v1",startedOrdinal:++progressReadsStarted,finishedOrdinal:null,snapshotSha256:null,error:false};progressReads.set(acknowledgmentOrdinal,row);progressReadHistory.set(acknowledgmentOrdinal,row);pendingReads++;return true;
  },
  progressFinished(acknowledgmentOrdinal,cookies){
   const row=progressReads.get(acknowledgmentOrdinal);if(!row){observationErrors++;return unknown();}
   progressReads.delete(acknowledgmentOrdinal);row.finishedOrdinal=++progressReadsFinished;pendingReads--;const result=snapshotCookies(cookies);row.snapshotSha256=result.sha256;if(!result.known){readErrors++;row.error=true;}return result;
  },
  progressFailed(acknowledgmentOrdinal){
   readErrors++;const row=progressReads.get(acknowledgmentOrdinal);if(!row){observationErrors++;return;}progressReads.delete(acknowledgmentOrdinal);row.finishedOrdinal=++progressReadsFinished;row.error=true;pendingReads--;
  },
  progressOperation(ordinal){const row=progressReadHistory.get(ordinal);return row?{...row}:null;},
		readStarted() { pendingReads++; },
		readFinished() { pendingReads--; },
		start(cookies) {
			if (before) { observationErrors++; return; }
			before = snapshotCookies(cookies);
		},
		end(cookies) {
			if (scopeClosed) { observationErrors++; return; }
			after = snapshotCookies(cookies); scopeClosed = true;
		},
		readFailure(stage) {
			readErrors++;
			if (stage === "start" && !before) before = unknown();
			else if (stage === "end" && !scopeClosed) { after = unknown(); scopeClosed = true; }
			else observationErrors++;
		},
		response(requestId, headers) {
			if (!headers || typeof headers !== "object" || Array.isArray(headers)) { unknownResponseHeaders++; return; }
			const value = lowerHeaders(headers)["set-cookie"];
			if (value === undefined) return;
			if (typeof requestId !== "string" || setCookies.size >= controlCancellationPolicy.recordLimit) { overflow++; return; }
			const digest = sha(value);
			if (setCookies.has(requestId) && setCookies.get(requestId) !== digest) observationErrors++;
			setCookies.set(requestId, digest);
		},
		snapshot() {
			const actualBefore = before ?? unknown(), actualAfter = after ?? unknown();
			return { protocol: "actual-browser-cookie-boundaries-v1", contextId, before: { ...actualBefore }, after: { ...actualAfter },
				matchesAtBoundaries: actualBefore.known && actualAfter.known ? actualBefore.sha256 === actualAfter.sha256 : null,
				scopeClosed, observedSetCookieResponses: setCookies.size, unknownResponseHeaders, readErrors, pendingReads, observationErrors, overflow,
				stablePrincipalClaim: false,progressReads:{protocol:"owned-read-only-principal-operations-v1",started:progressReadsStarted,finished:progressReadsFinished,pending:[...progressReads.values()].map(({acknowledgmentOrdinal,kind})=>({acknowledgmentOrdinal,kind})).sort((a,b)=>a.acknowledgmentOrdinal-b.acknowledgmentOrdinal),records:[...progressReadHistory.values()].map(row=>({...row})).sort((a,b)=>a.acknowledgmentOrdinal-b.acknowledgmentOrdinal)} };
		},
	};
}

/** A metadata read only: never waits past the caller's existing off-critical deadline. */
export async function capturePrincipalBoundary({ context, observer, stage, deadlineMs }) {
	const remaining = deadlineMs - performance.now();
	if (!["start", "end"].includes(stage) || !Number.isFinite(remaining) || remaining <= 0 || remaining > 10000 || typeof context?.cookies !== "function") {
		observer.readFailure(stage); return;
	}
	let timer;
	observer.readStarted();
	const actual = Promise.resolve().then(() => context.cookies()).finally(() => observer.readFinished());
	try {
		const cookies = await Promise.race([actual, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Cookie metadata deadline elapsed.")), remaining); })]);
		observer[stage](cookies);
	} catch { observer.readFailure(stage); }
	finally { clearTimeout(timer); }
}
export function controlRequestIdentity(contextId, url, method, headers) {
	const h = lowerHeaders(headers);
	let requestOriginSha256=null;try{requestOriginSha256=sha(new URL(url).origin);}catch{}
	const action = h["next-action"] !== undefined;
	const requestKind = action
		? "action"
		: h["next-router-segment-prefetch"] === undefined
			? h["rsc"] === "1" && h["next-router-prefetch"] === "3" ? "runtime-shell" : "navigation"
			: h["next-router-segment-prefetch"] === "/_tree"
				? "route-tree"
				: "segment-prefetch";
	return {
		contextId,
		requestHeaderSnapshotKnown: Boolean(headers && typeof headers === "object" && !Array.isArray(headers) && Object.values(headers).every((value) => value === undefined || typeof value === "string")),
		method,
		fullUrlSha256: sha(url),
		requestOriginSha256,
		requestHeadersSha256: sha(
			JSON.stringify(selectedHeaders.map((key) => [key, h[key] ?? null])),
		),
		// Diagnostic comparison only: full browser/proxy identity still includes this token.
		withoutTechnicalDocumentSha256: sha(
			JSON.stringify(
				selectedHeaders
					.filter((key) => key !== controlDocumentHeader)
					.map((key) => [key, h[key] ?? null]),
			),
		),
		headerFieldSha256: Object.fromEntries(
			selectedHeaders.map((key) => [
				key,
				h[key] === undefined ? null : sha(h[key]),
			]),
		),
		documentGeneration: h[controlDocumentHeader] ?? null,
		action,
		requestKind,
		rsc: h.rsc === "1",
		purposeHeaderPresent:h.purpose !== undefined,
		secPurposeHeaderPresent:h["sec-purpose"] !== undefined,
		prefetch: h["next-router-prefetch"] === "1",
		flight: h.rsc === "1",
	};
}

/** Exact response-ID ancestry facts only. Identity gaps never become a cache-control verdict. */
export function cachedOriginWireEvidence(candidate, packets) {
	const matches = typeof candidate.proxyResponseId === "string" && candidate.proxyResponseId ? packets.filter((packet) => packet.id === candidate.proxyResponseId) : [];
	const identityKnown = typeof candidate.contextId === "string" && candidate.contextId.length > 0 && ["GET", "POST", "HEAD"].includes(candidate.method) && /^[a-f0-9]{64}$/.test(candidate.fullUrlSha256 ?? "");
	const exact = identityKnown ? matches.filter((packet) => packet.contextId === candidate.contextId && packet.method === candidate.method && packet.fullUrlSha256 === candidate.fullUrlSha256) : [];
	return { responseIdMatches: matches.length, candidateIdentityKnown: identityKnown, exactRequestMatches: exact.length, selectedTruncated: matches.length > 8,
		selected: matches.slice(0, 8).map((packet) => ({ id: packet.id, contextId: packet.contextId, method: packet.method,
			fullUrlSha256: packet.fullUrlSha256, requestHeadersSha256: packet.requestHeadersSha256,
			headerFieldSha256: packet.headerFieldSha256, documentGeneration: packet.documentGeneration,
			requestHeaderSnapshotKnown: packet.requestHeaderSnapshotKnown, vary: packet.vary ?? null,
			complete: typeof packet.complete === "boolean" ? packet.complete : null,
			canceled: typeof packet.canceled === "boolean" ? packet.canceled : null,
			upstreamError: typeof packet.upstreamError === "boolean" ? packet.upstreamError : null,
			transportBodyReceipt: packet.transportBodyReceipt ?? null, bodyProof: packet.bodyProof ? { complete: typeof packet.bodyProof.complete === "boolean" ? packet.bodyProof.complete : null,
				requestKind: packet.bodyProof.requestKind ?? null, requiredStage: packet.bodyProof.requiredStage ?? null,
				bodySha256: packet.bodyProof.bodySha256 ?? null } : null })) };
}
export function controlResponseMetadata(headers, status) {
	const h = lowerHeaders(headers);
	const contentType = h["content-type"];
	const mime = typeof contentType === "string" ? contentType.split(";",1)[0].trim().toLowerCase() : null;
	const charsetMatches = typeof contentType === "string" ? [...contentType.matchAll(/;\s*charset\s*=\s*(?:"([^"]*)"|([^;\s]*))/gi)] : [];
	const charset = charsetMatches.length === 1 ? (charsetMatches[0][1] ?? charsetMatches[0][2]).toLowerCase() : null;
	const responseContentType = { headerKnown: typeof contentType === "string", mime: mime === null ? null : mime === "text/x-component" ? mime : "other",
		charset: charsetMatches.length > 1 ? "ambiguous" : charset === null ? "absent" : ["utf-8","utf8","iso-8859-1","latin1","us-ascii","windows-1252","utf-16le","utf-16be"].includes(charset) ? charset : "other" };
	const varyValue = h.vary;
	const boundedVary = headers !== undefined && headers !== null && typeof headers === "object" && !Array.isArray(headers) &&
		(varyValue === undefined || varyValue.length <= 1024);
	const varyFields = boundedVary && varyValue !== undefined ? varyValue.split(",").map((field) => field.trim().toLowerCase()) : [];
	const unknownVaryFields = varyFields.filter((field) => !selectedHeaders.includes(field));
	const vary = { known: boundedVary && unknownVaryFields.length === 0,
		fields: [...new Set(varyFields.filter((field) => selectedHeaders.includes(field)))].sort(),
		star: varyFields.includes("*"), unknownFields: boundedVary ? unknownVaryFields.length : null };
	const swr = /(?:^|,)\s*stale-while-revalidate\s*=\s*(\d+)\s*(?:,|$)/i.exec(
		h["cache-control"] ?? "",
	);
	const seconds = swr ? Number(swr[1]) : null;
	return {
		status,
		vary,
		responseContentType,
		responseHeaderSnapshotKnown: Boolean(headers && typeof headers === "object" && !Array.isArray(headers) && Object.values(headers).every(value=>typeof value === "string")),
		postponed: h["x-nextjs-postponed"] === "2",
		responseDeploymentSha256: typeof h["x-nextjs-deployment-id"] === "string" ? sha(h["x-nextjs-deployment-id"]) : null,
		flight: /^text\/x-component(?:;|$)/i.test(h["content-type"] ?? ""),
		staleWhileRevalidateSeconds: Number.isSafeInteger(seconds) ? seconds : null,
		proxyResponseId: /^[a-f0-9]{32}\.[1-9]\d{0,9}$/.test(
			h[controlResponseHeader] ?? "",
		)
			? h[controlResponseHeader]
			: null,
	};
}

// These are actual observation inputs, not a verdict or a default deployment ID.
// The body inspector derives the key and rechecks Next's header-before-body rule.
function bodyInspectionOptions(row, compiledCachedNavigations, compiledBinding) {
	const options = {action:row.action,cachedNavigations:compiledCachedNavigations,requestKind:row.requestKind};
	if (["segment-prefetch","route-tree"].includes(row.requestKind)) {
		const response = row.initialSegmentResponse ?? row;
		row.segmentRequestBinding = {
			method:row.method,status:row.status,flight:response.flight === true,rsc:row.rsc === true,prefetch:row.prefetch === true,
			postponed:response.postponed === true,requestHeadersSha256:row.requestHeadersSha256,
			requestKeySha256:row.headerFieldSha256?.["next-router-segment-prefetch"] ?? null,
			responseDeploymentSha256:response.responseDeploymentSha256 ?? null,
			compiledBuild:compiledBinding?.compiledBuild ?? null,compiledManifestSha256:compiledBinding?.compiledManifestSha256 ?? null,
			manifestVerified:knownBrowserControlMetadata(compiledBinding) && compiledBinding?.manifestVerified === true &&
				row.requestHeaderSnapshotKnown === true && response.responseHeaderSnapshotKnown === true,
		};
		if(row.requestKind==="route-tree") options.routeTreeBinding={...row.segmentRequestBinding,pathSourceFacts:row.pathSourceFacts,requestUrlSha256:row.fullUrlSha256,requestOriginSha256:row.requestOriginSha256,ambiguousRedirect:row.id?false:row.ambiguousRedirect};
		else options.segmentBinding = row.segmentRequestBinding;
	}
	return options;
}

/** readBody is the existing session's Network.getResponseBody; proxyRecords is owned transport data. */
export function createBrowserControlCollector({
	contextId,
	origin,
	browserRevision,
	compiledCachedNavigations,
	compiledBinding,
	protocolSources,
	operatorFile,
	readBody,
	readStream,
	captureContextFailures = false,
	principalEpoch = createPrincipalEpochObserver(contextId, { origin }),
	environmentObservation = () => null,
	proxyObservation = () => ({
		rows: [],
		installed: false,
		errors: 0,
		overflow: 0,
	}),
}) {
	const requests = new Map(),
		extra = new Map(),
		responseExtras = new Map(),
		pending = new Set(),
		queue = [],
		measuredFailureIds = [];
	let installed = false,
		measurementStarted = false,
		measurementClosed = false,
		closed = false,
		errors = 0,
		overflow = 0,
		missing = 0,
		retained = 0,
		streamRetained = 0,
		joinedResponseExtras = 0,
		rawMeasuredFailedRequests = 0;
	const limited = () =>
		requests.size + extra.size + responseExtras.size >=
		controlCancellationPolicy.recordLimit;
	const rows = () => [...requests.values()];
	const recordMeasuredFailure = (requestId) => {
		rawMeasuredFailedRequests++;
		if (!measurementStarted || measurementClosed) errors++;
		if (measuredFailureIds.length >= controlCancellationPolicy.recordLimit) { overflow++; return; }
		measuredFailureIds.push(requestId);
	};
	const missingFamilies = {
		duplicateRequest: 0,
		responseBeforeRequest: 0,
		responseExtraBeforeRequest: 0,
		dataBeforeRequest: 0,
		finishedBeforeRequest: 0,
		failedBeforeRequest: 0,
	};
	const missingEvent = (family) => {
		missing++;
		missingFamilies[family]++;
	};
	const processBodies = () => {
		while (
			pending.size < 1 &&
			queue.length &&
			retained + controlCancellationPolicy.decodedLimit <=
				controlCancellationPolicy.retainedLimit
		) {
			const row = queue.shift();
			retained += controlCancellationPolicy.decodedLimit;
			const task = Promise.resolve().then(async () => {
				try {
					const result = await readBody(row.requestId);
					if (
						typeof result?.body !== "string" ||
						typeof result.base64Encoded !== "boolean"
					) {
						row.bodyProof = { complete: false, reason: "invalid-cdp-body" };
						return;
					}
					if (
						result.base64Encoded &&
						!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
							result.body,
						)
					) {
						row.bodyProof = { complete: false, reason: "invalid-cdp-body" };
						return;
					}
					const upper = result.base64Encoded
						? Math.ceil((result.body.length * 3) / 4)
						: Buffer.byteLength(result.body);
					if (upper > controlCancellationPolicy.decodedLimit) {
						row.bodyProof = { complete: false, reason: "body-limit" };
						return;
					}
					const bytes = Buffer.from(
						result.body,
						result.base64Encoded ? "base64" : "utf8",
					);
					row.bodyReadbackReceipt = { available: true, base64Encoded:typeof result.base64Encoded === "boolean" ? result.base64Encoded : null,
						utf16CodeUnitLength:result.base64Encoded === false ? result.body.length : null,
						observedDataLengthAtReadback:row.loadingFinished === true && row.observedDataLengthInvalid !== true && Number.isSafeInteger(row.observedDataLength) ? row.observedDataLength : null,
						responseContentType:row.initialSegmentResponse?.responseContentType ?? row.responseContentType ?? null, effectiveCdpResponse:row.effectiveCdpResponse ?? null, decodedBytes: bytes.length, bodySha256: sha(bytes),
						terminal: row.failed ? "failed" : row.loadingFinished ? "finished" : "pending", naturalEOFClaim: false };
					assignBodyProof(row, inspectRequiredFlightBody(bytes, bodyInspectionOptions(row,compiledCachedNavigations,compiledBinding)), "cdp-readback", row.bodyReadbackReceipt.bodySha256);
					row.bodyReadbackComplete = true;
				} catch {
					if (!row.streamReceipt?.captureComplete)
						row.bodyProof = { complete: false, reason: "cdp-body-unavailable" };
				} finally {
					retained -= controlCancellationPolicy.decodedLimit;
					pending.delete(task);
					processBodies();
				}
			});
			pending.add(task);
		}
	};
	const finishStream = (row) => {
		const stream = row.stream;
		if (!stream?.terminal || !stream.acknowledged || stream.finalized) return;
		stream.finalized = true;
		const captureComplete = !stream.reason && stream.bytes === stream.observed;
		row.streamReceipt = {
			protocol: "passive-network-copy-v1",
			sourceRevision: browserRevision,
			captureComplete,
			byteCoverageExact: captureComplete,
			terminal: stream.terminal,
			capturedBytes: stream.bytes,
			capturedBodySha256: shaChunks(stream.chunks),
			observedDataLength: stream.observed,
			reason: stream.reason ?? (captureComplete ? null : "byte-coverage-gap"),
		};
		if (captureComplete)
			assignBodyProof(row, inspectRequiredFlightBody(Buffer.concat(stream.chunks), bodyInspectionOptions(row,compiledCachedNavigations,compiledBinding)), "passive-stream", row.streamReceipt.capturedBodySha256);
		retained -= stream.bytes;
		streamRetained -= stream.bytes;
		stream.chunks = [];
		processBodies();
	};
	const appendStream = (row, encoded, prefix = false) => {
		const stream = row.stream;
		if (!stream || stream.reason || stream.finalized) return;
		if (
			typeof encoded !== "string" ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
				encoded,
			)
		) {
			stream.reason = "invalid-stream-data";
			return;
		}
		const upper = Math.ceil((encoded.length * 3) / 4);
		if (
			stream.bytes + upper > controlCancellationPolicy.decodedLimit ||
			retained + upper > controlCancellationPolicy.retainedLimit ||
			streamRetained + upper >
				controlCancellationPolicy.retainedLimit -
					controlCancellationPolicy.decodedLimit
		) {
			stream.reason = "body-limit";
			return;
		}
		const bytes = Buffer.from(encoded, "base64");
		if (prefix) stream.chunks.unshift(bytes);
		else stream.chunks.push(bytes);
		stream.bytes += bytes.length;
		retained += bytes.length;
		streamRetained += bytes.length;
	};
	const startStream = (row) => {
		if (
			!readStream ||
			row.stream ||
			row.type === "Other" ||
			row.fromDiskCache ||
			!row.applicationOrigin ||
			(!row.flight && !row.action)
		)
			return;
		row.stream = {
			acknowledged: false,
			bytes: 0,
			observed: row.observedDataLength ?? 0,
			chunks: [],
			terminal: null,
			finalized: false,
		};
		Promise.resolve()
			.then(() => readStream(row.requestId))
			.then(
				(result) => {
					appendStream(row, result?.bufferedData, true);
					row.stream.acknowledged = true;
					finishStream(row);
				},
				() => {
					row.stream.reason = "stream-command-unavailable";
					row.stream.acknowledged = true;
					finishStream(row);
				},
			);
	};
	const read = (row) => {
		if (
			!row.applicationOrigin ||
			(!row.flight && !row.action) ||
			row.bodyRequested
		)
			return;
		row.bodyRequested = true;
		queue.push(row);
		processBodies();
	};
	const headerIdentity = (headers) => {
		const { fullUrlSha256, method, requestOriginSha256, ...identity } = controlRequestIdentity(
			contextId,
			"",
			"",
			headers,
		);
		return identity;
	};
	const applyExtra = (row, identity) => {
		row.extraHeaderIdentity = identity;
		Object.assign(row, identity);
		row.requestHeadersKnown = true;
	};
	const applyResponseExtra = (row, metadata) => {
		row.extraResponseVary = metadata.vary;
		if (row.status !== undefined)
			metadata = { ...metadata, status: row.status };
		Object.assign(row, metadata, { vary: row.initialResponseVary ?? metadata.vary });
	};
	let browserEventOrdinal=0,progressInput;
	const snapshot = () => {
		const failures = rows().filter((row) => row.failed),
			responses = rows().filter((row) => row.loadingFinished);
		const proxy = proxyObservation();
		const coverage = {
			installed: installed && proxy.installed === true,
			scopeClosed: closed,
			errors: errors + proxy.errors,
			overflow: overflow + proxy.overflow,
			// ExtraInfo is optional by CDP contract, not an event-loss census.
			// Missing positive request identity still leaves that failure UNKNOWN.
			missing: missing + responseExtras.size,
			optionalRequestExtraInfoAbsent: failures.filter(
				(row) => !row.requestHeadersKnown,
			).length,
			pendingBodies: pending.size + queue.length + proxy.pendingBodies,
		};
		for(const row of rows()) row.browserDataLedger={protocol:"cached-browser-data-ledger-v1",requestObserved:true,responseEvents:row.responseEvents,finishedEvents:row.finishedEvents,failedEvents:row.failedEvents,
			dataEvents:row.dataEvents,dataAfterTerminal:row.dataAfterTerminal,dataBeforeResponse:row.dataBeforeResponse,responseAfterTerminal:row.responseAfterTerminal,terminalBeforeResponse:row.terminalBeforeResponse,invalidData:row.observedDataLengthInvalid===true,observedDataLength:row.observedDataLength};
		const sources = [...rows().map((row) => ({ source: "browser", row })), ...proxy.rows.map((row) => ({ source: "proxy", row }))];
		const protocolErrorRecords = sources.flatMap(({ source, row }) => {
			const history = row.protocolErrorObservations ?? (hasProtocolError(row.bodyProof) ? [protocolErrorFact(row.bodyProof, "latest-proof",
				row.transportBodyReceipt?.bodySha256 ?? row.bodyReadbackReceipt?.bodySha256 ?? row.streamReceipt?.capturedBodySha256,row)] : []);
			return history.map((fact) => ({ source, contextId: row.contextId, requestId: row.requestId ?? row.id,
				proxyResponseId: row.proxyResponseId ?? (source === "proxy" ? row.id : null), ...fact }));
		});
		const protocolErrorOverflow = sources.reduce((total, { row }) => total + (row.protocolErrorObservationOverflow ?? 0), 0);
		const protocolErrors={protocol:"positive-flight-error-observations-v1",contextId,installed:coverage.installed,scopeClosed:closed,
			observed:protocolErrorRecords.length,overflow:protocolErrorOverflow+Math.max(0,protocolErrorRecords.length-controlCancellationPolicy.recordLimit),records:protocolErrorRecords.slice(0,controlCancellationPolicy.recordLimit)};
		const environment=environmentObservation(),principal=principalEpoch.snapshot();
		const nativeContext={protocol:"qualified-known-extra-native-context-v1",contextId,originSha256:sha(origin),workerScriptSha256:sha(origin+"/sw.js"),rootScopeSha256:sha(origin+"/"),
			binding:compiledBinding ? Object.fromEntries(["policy","browserRevision","compiledBuild","compiledManifestSha256","compiledCachedNavigations","manifestVerified","browserVerified","nativePublicSources"].filter(key=>Object.hasOwn(compiledBinding,key)).map(key=>[key,compiledBinding[key]])) : null,
			protocolSources:protocolSources ?? null,operatorFile:operatorFile ?? null,principalEpoch:principal,headerCensus:proxy.headerCensus ?? null,headerLifetime:proxy.headerLifetime ?? null,
			protocolErrors,environment};
		const data = { responses, proxy: proxy.rows, coverage, browserRevision,nativeContext };
		progressInput={...data,failures,browserEventOrdinal,nativeContext:{...nativeContext,headerPrefix:proxy.headerPrefix ?? null}};
		const measuredRows = measuredFailureIds.map((id) =>
			requests.get(id)?.failed
				? requests.get(id)
				: { contextId, requestId: id },
		);
		const measuredCoverage = {
			...coverage,
			installed: coverage.installed && measurementStarted,
			scopeClosed: coverage.scopeClosed && measurementClosed,
			optionalRequestExtraInfoAbsent: measuredRows.filter(
				(row) => row.failed && !row.requestHeadersKnown,
			).length,
			missing:
				coverage.missing + measuredRows.filter((row) => !row.failed).length,
		};
		const headerProvenance = (row) => ({
			requestHeaderSnapshotKnown: row.requestHeaderSnapshotKnown === true,
			documentGeneration: row.documentGeneration,
			requestHeadersSha256: row.requestHeadersSha256,
			withoutTechnicalDocumentSha256: row.withoutTechnicalDocumentSha256,
			headerFieldSha256: row.headerFieldSha256,
		});
		return {
			contextId,
			...(proxy.requestShapeDiagnostics?{requestShapeDiagnostics:proxy.requestShapeDiagnostics}:{}),
			...(captureContextFailures?{browserEventOrdinal,proxyHeaderLifecycle:proxy.headerLifecycle ?? null,browserFailureOccurrences:mixedFailureOccurrenceCensus({contextId,scopeClosed:closed,browserEventOrdinal,records:failures.map(row=>({requestId:row.requestId,eventOrdinal:row.failedEventOrdinal ?? null,failedEvents:row.failedEvents}))})}:{}),
			proxyHeaderCensus: proxy.headerCensus ?? null,
			proxyHeaderLifetime: proxy.headerLifetime ?? null,
			protocolErrors: { protocol: "positive-flight-error-observations-v1", contextId, installed: coverage.installed, scopeClosed: closed,
				observed: protocolErrorRecords.length, overflow: protocolErrorOverflow + Math.max(0, protocolErrorRecords.length - controlCancellationPolicy.recordLimit),
				records: protocolErrorRecords.slice(0, controlCancellationPolicy.recordLimit) },
			principalEpoch: principal,
			nativeEnvironment: environment,
			rawMeasuredFailedRequests,
			diagnostics: {
				earlyResponseExtra: {
					joined: joinedResponseExtras,
					orphan: responseExtras.size,
				},
				missingFamilies: {
					...missingFamilies,
					responseExtraBeforeRequest:
						missingFamilies.responseExtraBeforeRequest + responseExtras.size,
					failedRequestHeadersUnknown: failures.filter(
						(row) => !row.requestHeadersKnown,
					).length,
					measuredFailureNotObserved: measuredRows.filter((row) => !row.failed)
						.length,
				},
				failures: failures.map((row) => {
					const candidates = proxy.rows.filter(
						(candidate) =>
							candidate.contextId === row.contextId &&
							candidate.method === row.method &&
							candidate.fullUrlSha256 === row.fullUrlSha256,
					);
					const cached = responses.filter(
						(candidate) =>
							candidate.fromDiskCache &&
							candidate.fullUrlSha256 === row.fullUrlSha256 &&
							candidate.method === row.method,
					);
					const selectedPackets = row.proxyResponseId
						? candidates.filter(
								(candidate) => candidate.id === row.proxyResponseId,
							)
						: candidates;
					return {
						requestId: row.requestId,
						type: row.type,
						method: row.method,
						requestKind: row.requestKind,
						failureEvent:{known:row.failureEventMetadata!==undefined,events:row.failedEvents,...(row.failureEventMetadata ?? {errorKnown:false,errorEnum:"unknown",canceledKnown:false,canceled:null})},
						action: row.action,
						flight: row.flight,
						prefetch: row.prefetch,
						status: row.status ?? null,
						requestHeadersKnown: row.requestHeadersKnown === true,
						vary: row.vary ?? null,
						initialResponseVary: row.initialResponseVary ?? null,
						extraResponseVary: row.extraResponseVary ?? null,
						headerKnowledgeSource:
							row.requestHeadersKnown === true
								? "request-extra-info"
								: "initial-event-only",
						initialHeaderIdentity: row.initialHeaderIdentity
							? headerProvenance(row.initialHeaderIdentity)
							: null,
						extraHeaderIdentity: row.extraHeaderIdentity
							? headerProvenance(row.extraHeaderIdentity)
							: null,
						documentGeneration: row.documentGeneration,
						fullUrlSha256: row.fullUrlSha256,
						requestHeadersSha256: row.requestHeadersSha256,
						proxyResponseId: row.proxyResponseId ?? null,
						fromDiskCache: row.fromDiskCache === true,
						loaderId: row.loaderId,
						cachedCandidates: {
							selected: cached.slice(0, 8).map((candidate) => ({
								requestId: candidate.requestId,
								loaderId: candidate.loaderId,
								...headerProvenance(candidate),
								bodyProofReason: candidate.bodyProof?.reason ?? null,
								bodyComplete: candidate.bodyProof?.complete === true,
								proxyResponseId: candidate.proxyResponseId ?? null,
								vary: candidate.vary ?? null,
								bodyReadbackReceipt: candidate.bodyReadbackReceipt ?? null,
								initialHeaderIdentity: candidate.initialHeaderIdentity ? headerProvenance(candidate.initialHeaderIdentity) : null,
								extraHeaderIdentity: candidate.extraHeaderIdentity ? headerProvenance(candidate.extraHeaderIdentity) : null,
								originWire: cachedOriginWireEvidence(candidate, proxy.rows),
							})),
							selectedTruncated: cached.length > 8,
							sameUrlMethod: cached.length,
							sameLoader: cached.filter(
								(candidate) => candidate.loaderId === row.loaderId,
							).length,
							fullIdentity: cached.filter(
								(candidate) =>
									candidate.requestHeadersSha256 === row.requestHeadersSha256 &&
									candidate.documentGeneration === row.documentGeneration,
							).length,
							completeBody: cached.filter(
								(candidate) => candidate.bodyProof?.complete === true,
							).length,
							bodyProofReasons: [
								...new Set(
									cached.map(
										(candidate) => candidate.bodyProof?.reason ?? "not-read",
									),
								),
							].slice(0, 16),
						},
						bodyProofReason: row.bodyProof?.reason ?? null,
						proxyCandidates: {
							selected: selectedPackets.slice(0, 8).map((candidate) => ({
								id: candidate.id,
								...headerProvenance(candidate),
								complete: candidate.complete,
								canceled: candidate.canceled,
								vary: candidate.vary ?? null,
								transportBodyReceipt: candidate.transportBodyReceipt ?? null,
								pathSourceFacts:candidate.pathSourceFacts ?? null,
							})),
							selectedTruncated: selectedPackets.length > 8,
							sameUrlMethod: candidates.length,
							fullIdentity: candidates.filter(
								(candidate) =>
									candidate.requestHeadersSha256 === row.requestHeadersSha256 &&
									candidate.documentGeneration === row.documentGeneration,
							).length,
							responseId: candidates.filter(
								(candidate) =>
									row.proxyResponseId && candidate.id === row.proxyResponseId,
							).length,
						},
					};
				}),
			},
			measured: classifyControlCancellations({
				...data,
				coverage: measuredCoverage,
				failures: measuredRows,
			}),
			allPhase: classifyControlCancellations({
				...data,
				failures,
				scope: "all-phase-semantic-correlation",
			}),
			// Technical body availability remains distinct from positive protocol completion.
			bodyReceipts: rows()
				.filter((row) => row.bodyRequested || row.streamReceipt)
				.map((row) => ({
					requestId: row.requestId,
					loadingFinished: row.loadingFinished === true,
					failed: row.failed === true,
					action: row.action,
					bodyReadbackComplete: row.bodyReadbackComplete === true,
					bodyReadbackReceipt: row.bodyReadbackReceipt ?? null,
					pathSourceFacts:row.pathSourceFacts ?? null,
					browserDataLedger:row.browserDataLedger,
					streamReceipt: row.streamReceipt ?? null,
					bodyProof: row.bodyProof ?? null,
				})),
		};
	};
	return {
		installed() {
			installed = true;
		},
		beginMeasurement() {
			if (measurementStarted) errors++;
			measurementStarted = true;
		},
		endMeasurement() {
			measurementClosed = measurementStarted;
		},
		recordMeasuredFailure,
		progressInput(){snapshot();return mixedNativeProgressInput(progressInput);},
		endScope() {
			closed = true;
			for (const row of rows())
				if (row.stream && !row.stream.finalized) {
					row.stream.finalized = true;
					row.streamReceipt = {
						protocol: "passive-network-copy-v1",
						sourceRevision: browserRevision,
						captureComplete: false,
						byteCoverageExact: false,
						terminal: "scope-ended",
						capturedBytes: row.stream.bytes,
						capturedBodySha256: shaChunks(row.stream.chunks),
						observedDataLength: row.stream.observed,
						reason: "scope-ended-before-terminal",
					};
					retained -= row.stream.bytes;
					streamRetained -= row.stream.bytes;
					row.stream.chunks = [];
				}
		},
		observerError() {
			errors++;
		},
		request(event) {
			browserEventOrdinal++;
			if (limited()) {
				overflow++;
				return;
			}
			const previous = requests.get(event.requestId);
			if (previous && !event.redirectResponse) {
				missingEvent("duplicateRequest");
				return;
			}
			const row = {
				...controlRequestIdentity(
					contextId,
					event.request.url,
					event.request.method,
					event.request.headers,
				),
				requestId: event.requestId,
				loaderId: event.loaderId,
				startedAt: event.timestamp,
				type: event.type,
				priority: event.request.initialPriority,
				initiator: event.initiator?.type,
				initiatorStackKnownAbsent:
					event.initiator?.type === "other" &&
					event.initiator.stack === undefined,
				applicationOrigin: new URL(event.request.url).origin === origin,
				ambiguousRedirect: previous !== undefined,
				observedInMeasurement: measurementStarted && !measurementClosed,
				responseEvents:0,finishedEvents:0,failedEvents:0,dataEvents:0,dataAfterTerminal:0,dataBeforeResponse:0,responseAfterTerminal:0,terminalBeforeResponse:0,observedDataLength:0,
			};
			row.initialHeaderIdentity = headerIdentity(event.request.headers);
			requests.set(event.requestId, row);
			if (extra.has(event.requestId)) {
				applyExtra(row, extra.get(event.requestId));
				extra.delete(event.requestId);
			}
			if (responseExtras.has(event.requestId)) {
				applyResponseExtra(row, responseExtras.get(event.requestId));
				responseExtras.delete(event.requestId);
				joinedResponseExtras++;
			}
		},
		requestExtra(event) {
			browserEventOrdinal++;
			const row = requests.get(event.requestId);
			if (row) applyExtra(row, headerIdentity(event.headers));
			else if (!limited())
				extra.set(event.requestId, headerIdentity(event.headers));
			else overflow++;
		},
		response(event) {
			browserEventOrdinal++;
			principalEpoch.response(event.requestId, event.response.headers);
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("responseBeforeRequest");
				return;
			}
			row.responseEvents++;
			if(row.loadingFinished || row.failed) row.responseAfterTerminal++;
			Object.assign(
				row,
				controlResponseMetadata(event.response.headers, event.response.status),
				{
					fromDiskCache: event.response.fromDiskCache === true,
					fromServiceWorker: event.response.fromServiceWorker === true,
				},
			);
			row.initialResponseVary = row.vary;
			row.initialSegmentResponse = controlResponseMetadata(event.response.headers,event.response.status);
			if(!row.pathSourceFacts){
				row.pathSourceFacts=renderedPathSourceFacts({response:event.response,compiledRouting:compiledRoutingForBinding(compiledBinding),origin,collectScalars:row.requestKind==="route-tree" && row.rsc && row.prefetch,responseOrdinal:row.responseEvents,observerSourceSha256:protocolSources?.["browser-control-collector.mjs"] ?? null});
				const scalarBytes=scalarFactBytes(row.pathSourceFacts.scalarKeys);
				if(retained+scalarBytes>controlCancellationPolicy.retainedLimit){overflow++;row.pathSourceFacts.scalarKeys={known:false,reason:"scalar-retention-limit"};}
				else retained+=scalarBytes;
			}
			const mimeField=Object.getOwnPropertyDescriptor(event.response,"mimeType"),charsetField=Object.getOwnPropertyDescriptor(event.response,"charset");
			const mime=mimeField && Object.hasOwn(mimeField,"value") && typeof mimeField.value === "string" && mimeField.value.length<=128 ? mimeField.value.toLowerCase() : null;
			const charset=charsetField && Object.hasOwn(charsetField,"value") && typeof charsetField.value === "string" && charsetField.value.length<=64 ? charsetField.value.toLowerCase() : null;
			row.effectiveCdpResponse={protocol:"cdp-effective-response-decoder-metadata-v1",provenance:"Network.responseReceived",
				mimeKnown:mime!==null,mime:mime===null?null:mime==="text/x-component"?mime:"other",charsetKnown:charset!==null,
				charset:charset===null?null:charset===""?"empty":["utf-8","utf8","iso-8859-1","latin1","us-ascii","windows-1252","utf-16le","utf-16be"].includes(charset)?charset:"other"};
			startStream(row);
		},
		responseExtra(event) {
			browserEventOrdinal++;
			principalEpoch.response(event.requestId, event.headers);
			const row = requests.get(event.requestId);
			const metadata = {
				...controlResponseMetadata(event.headers, event.statusCode),
				httpErrorObserved: event.statusCode >= 400,
			};
			if (!row) {
				if (responseExtras.has(event.requestId)) {
					errors++;
					responseExtras.get(event.requestId).httpErrorObserved ||=
						metadata.httpErrorObserved;
				} else if (limited()) overflow++;
				else responseExtras.set(event.requestId, metadata);
				return;
			}
			applyResponseExtra(row, metadata);
		},
		finished(event) {
			browserEventOrdinal++;
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("finishedBeforeRequest");
				return;
			}
			row.finishedEvents++;
			if(row.responseEvents===0) row.terminalBeforeResponse++;
			row.loadingFinished = true;
			row.failed ??= false;
			row.finishedAt = event.timestamp;
			if (row.stream) {
				row.stream.terminal = "finished";
				finishStream(row);
			}
			if (row.fromDiskCache) read(row);
		},
		failed(event) {
			browserEventOrdinal++;
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("failedBeforeRequest");
				return;
			}
			row.failedEvents++;
			const knownError=typeof event.errorText==="string" && event.errorText.length<=64 && /^net::ERR_[A-Z_]+$/.test(event.errorText);
			row.failureEventMetadata ??= {errorKnown:knownError,errorEnum:knownError?event.errorText:event.errorText===undefined?"unknown":"other",canceledKnown:typeof event.canceled==="boolean",canceled:typeof event.canceled==="boolean"?event.canceled:null};
			if(row.responseEvents===0) row.terminalBeforeResponse++;
			if (captureContextFailures && !measurementClosed && row.observedInMeasurement) recordMeasuredFailure(event.requestId);
			if (row.failed) {
				errors++;
				return;
			}
			row.failedEventOrdinal=browserEventOrdinal;
			row.failed = true;
			row.error = event.errorText;
			row.canceled = event.canceled === true;
			if (row.stream) {
				row.stream.terminal = "failed";
				finishStream(row);
			}
			read(row);
		},
		data(event) {
			browserEventOrdinal++;
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("dataBeforeRequest");
				return;
			}
			row.dataEvents++;
			if(row.responseEvents===0) row.dataBeforeResponse++;
			if(row.loadingFinished || row.failed) row.dataAfterTerminal++;
			if (!Number.isSafeInteger(event.dataLength) || event.dataLength < 0) {
				row.observedDataLengthInvalid = true;
				if (row.stream) row.stream.reason = "invalid-data-length";
				return;
			}
			row.observedDataLength = (row.observedDataLength ?? 0) + event.dataLength;
			if (row.stream) {
				if (row.stream.finalized) {
					row.streamReceipt.captureComplete = false;
					row.streamReceipt.reason = "data-after-terminal";
					return;
				}
				row.stream.observed += event.dataLength;
				if (event.data !== undefined) appendStream(row, event.data);
			}
		},
		snapshot,
	};
}

/** Optional prospective installation; callers retain their normal measurement boundaries. */
export async function installBrowserControlCollector({
	page,
	context,
	transport,
	origin,
	headers,
	contextId,
	browserRevision,
	compiledCachedNavigations,
	captureContextFailures = false,
	environmentBinding,
	protocolSources,
	operatorFile,
}) {
	const session = await page.createCDPSession();
	const principalEpoch = createPrincipalEpochObserver(contextId, { origin });
	let workerObservation, endMetadata = null, generation = 0, documentAcknowledgment;
	const proxy = createProxyControlCollector({
		origin,
		protocolSources,
		contextId,
		compiledCachedNavigations,
		compiledBinding:environmentBinding,
	});
	const transportErrors = transport.setControlCancellationObserver(proxy,{captureHeaderPrefixes:captureContextFailures});
	const proxyObservation = () => {
		const proof = proxy.snapshot();
		const cut=typeof transport.controlHeaderCut==="function"?transport.controlHeaderCut():null;
		return { ...proof, errors: proof.errors + transportErrors(),headerPrefix:cut?proxyHeaderPrefix(proof.headerCensus,cut):null,headerLifecycle:cut };
	};
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		browserRevision,
		compiledCachedNavigations,
		compiledBinding:environmentBinding,
		captureContextFailures,
		protocolSources,
		operatorFile,
		principalEpoch,
		environmentObservation: () => ({ protocol: "native-cache-environment-metadata-v1", contextId,
			servingPublicSources: environmentBinding?.servingPublicSources ?? null,
			nativeLaunchMetadata: environmentBinding?.nativeLaunchMetadata ?? null,
			workerTargets: workerObservation?.snapshot() ?? null,
			controllerObservation: endMetadata ? "read-only-end-snapshot" : "not-collected",
			publicSourceRecheck: endMetadata?.publicSourceRecheck ?? "not-collected", endRead: endMetadata, acceptanceClaim: "none" }),
		proxyObservation,
		readBody: (requestId) =>
			session.send("Network.getResponseBody", { requestId }),
		readStream: (requestId) =>
			session.send("Network.streamResourceContent", { requestId }),
	});
	const events = {
		requestWillBeSent: "request",
		requestWillBeSentExtraInfo: "requestExtra",
		responseReceived: "response",
		responseReceivedExtraInfo: "responseExtra",
		loadingFinished: "finished",
		loadingFailed: "failed",
		dataReceived: "data",
	};
	for (const [event, name] of Object.entries(events))
		session.on(`Network.${event}`, (value) => {
			try {
				collector[name](value);
			} catch {
				collector.observerError();
			}
		});
	if(captureContextFailures)documentAcknowledgment=await createMixedDocumentAcknowledgment({session,contextId,origin,generation:()=>generation});
	await session.send("Network.enable");
	await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "start", deadlineMs: performance.now() + 10000 });
	let browser;
	try { browser = context.browser?.(); } catch {}
	workerObservation = createNativeWorkerObserver({ browser, context, contextId, origin });
	const originals = new Map();
	for (const method of ["goto", "reload", "goBack"]) {
		const original = page[method];
		originals.set(method, original);
		page[method] = async function (...args) {
			// This declared technical header is observed on both HTTP and CDP, never inferred from timing.
			await session.send("Network.setExtraHTTPHeaders", {
				headers: {
					...headers,
					[controlDocumentHeader]: `${contextId}:${++generation}`,
				},
			});
			return Reflect.apply(original, this, args);
		};
	}
	collector.installed();
 const progress=captureContextFailures?createMixedProgressAcknowledgments({input:()=>{const cut=collector.progressInput();cut.nativeContext.documentJournal=documentAcknowledgment.snapshot();return cut;},application:()=>transport.snapshot().applicationEvidence,
  acknowledge:options=>documentAcknowledgment.read({...options,principalEpoch,readCookies:()=>context.cookies(),readSources:async()=>{const locator=environmentBinding && nativeManifestLocators.get(environmentBinding);return locator?await readNativePublicSources(locator):null;}})}):null;
	return {
		...collector,
  acknowledgeMixedProgress(options){if(!progress)throw Error("Mixed progress observation was not installed before app IO.");return progress.check(options);},
  confirmMixedProgress(token){if(!progress)throw Error("Mixed progress observation is unavailable.");return progress.confirm(token);},
  snapshot(){return {...collector.snapshot(),...(progress?{mixedProgress:progress.snapshot(),mixedDocumentJournal:documentAcknowledgment.snapshot()}:{})};},
		async close({ deadlineMs } = {}) {
			try {
				await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "end", deadlineMs });
				endMetadata = await captureNativeEndMetadata({ page, binding: environmentBinding, origin, deadlineMs });
			}
			finally {
				documentAcknowledgment?.close();
				workerObservation.close();
				collector.endScope();
				for (const [method, original] of originals) page[method] = original;
				await session.detach();
			}
		},
	};
}

/** Fixed diagnostic facts only. No model references, temporary map, or business values escape. */
function inspectRequestShape(bytes) {
	let text;
	try { text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes); }
	catch { return {known:false,jsonParsed:false,reason:"invalid-utf8"}; }
	let quoted=false,escaped=false,depth=0,punctuation=0;
	for (const char of text) {
		if (quoted) { if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue; }
		if(char==='"')quoted=true;
		else if(char==="[" || char==="{") { if(++depth>requestShapeLimits.depth)return {known:false,jsonParsed:false,reason:"shape-depth-limit"}; }
		else if(char==="]" || char==="}")depth--;
		else if((char==="," || char===":") && ++punctuation>requestShapeLimits.punctuation)return {known:false,jsonParsed:false,reason:"shape-work-limit"};
	}
	let value;
	try { value=JSON.parse(text); } catch { return {known:false,jsonParsed:false,reason:"invalid-json"}; }
	const kind=value=>value===null?"null":Array.isArray(value)?"array":typeof value;
	const argument=Array.isArray(value)&&value.length===1?value[0]:null;
	const fields={};
	for (const key of ["start","end","startDate","endDate","timezone"]) {
		const descriptor=argument && typeof argument==="object" && !Array.isArray(argument)?Object.getOwnPropertyDescriptor(argument,key):null;
		const item=descriptor?.value,date=typeof item==="string" && item.startsWith("$D");
		let canonicalDate=null;
		if(date){const suffix=item.slice(2);canonicalDate=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(suffix) && Number.isFinite(Date.parse(suffix)) && new Date(suffix).toISOString()===suffix;}
		fields[key]={present:Boolean(descriptor),type:!descriptor?"absent":date?"date-string":typeof item==="string"&&item.startsWith("$")?"protocol-string":kind(item),canonicalDate};
	}
	const keys=argument && typeof argument==="object" && !Array.isArray(argument)?Object.keys(argument):[];
	return {known:false,jsonParsed:true,reason:"duplicate-key-knowledge-unavailable",duplicateKeyStatus:"not-inspected",rootKind:kind(value),argumentCount:Array.isArray(value)?value.length:null,
		fields,unknownKeys:keys.filter(key=>!Object.hasOwn(fields,key)).length,prototypeSensitiveKeys:keys.filter(key=>["__proto__","constructor","prototype"].includes(key)).length};
}

/** Same actual bytes as forwarding; no replay, clone, response hold, or public payload retention. */
export function createProxyControlCollector({
	contextId,
	origin,
	protocolSources,
	compiledCachedNavigations,
	compiledBinding,
}) {
	const requests = new Map();
	const headerCensus = createProxyHeaderCensus({contextId});
	let transportInstallation = null, transportClosure = null;
	let installed = false,
		retained = 0,
		errors = 0,
		overflow = 0,
		pendingBodies = 0;
	const shapeConfiguration=requestShapeBindings.get(compiledBinding),shapeRows=new Map();
	if(Object.hasOwn(compiledBinding ?? {},"requestShapeDiagnostic") && (!shapeConfiguration || JSON.stringify(shapeConfiguration)!==JSON.stringify(compiledBinding.requestShapeDiagnostic)))
		throw Error("Request-shape diagnostic requires the actual verified source binding.");
	let shapeErrors=0,shapeOverflow=0,shapeClosed=false,shapePendingParses=0,shapeSelected=0,shapeUnretainedSelections=0;
	const shapeRelease=row=>{retained-=row.retained;row.retained=0;row.buffer=null;};
	const shapeReserve=(row,bytes)=>{if(retained+bytes>controlCancellationPolicy.retainedLimit){shapeOverflow++;row.unavailable=true;return false;}retained+=bytes;row.retained+=bytes;return true;};
	const shapeSnapshot=()=>({protocol:"request-shape-diagnostic-v1",source:shapeConfiguration,limits:requestShapeLimits,closed:shapeClosed,
		selected:shapeSelected,unretainedSelections:shapeUnretainedSelections,errors:shapeErrors,overflow:shapeOverflow,pendingRequests:shapeUnretainedSelections?null:[...shapeRows.values()].filter(row=>!row.requestEOF && row.terminal===null).length,
		pendingParses:shapePendingParses,sharedProxyRetainedBytes:retained,acceptanceClaim:"none",complete:false,
		rows:[...shapeRows.values()].map(row=>({id:row.id,requestEOF:row.requestEOF,terminal:row.terminal,encodedBytes:row.bytes,bodySha256:row.bodySha256,
			contentType:row.contentType,charset:row.charset,contentEncoding:row.contentEncoding,unavailable:row.unavailable,shape:row.shape}))});
	const release = (row) => {
		retained -= row.retainedBytes;
		row.retainedBytes = 0;
		row.chunks = [];
	};
	return {
		installed(binding) {
			installed = true;
			if (binding) transportInstallation = {
				protocol:binding.protocol === "owned-context-upstream-header-lifetime-v1" ? binding.protocol : null,
				proxyInstanceId:/^[a-f0-9]{32}$/.test(binding.proxyInstanceId ?? "") ? binding.proxyInstanceId : null,
				originSha256:/^[a-f0-9]{64}$/.test(binding.originSha256 ?? "") ? binding.originSha256 : null,
				allowedOriginSha256:Array.isArray(binding.allowedOriginSha256) && binding.allowedOriginSha256.length <= 32 && binding.allowedOriginSha256.every(value=>/^[a-f0-9]{64}$/.test(value)) ? [...binding.allowedOriginSha256] : null,
				acceptedRequestsAtInstall:binding.acceptedRequestsAtInstall === 0 ? 0 : null,
			};
		},
		observerError() {
			errors++;
			headerCensus.observerError();
			if(shapeConfiguration)shapeErrors++;
		},
		request(id, { url, method, headers, traceId }) {
			headerCensus.accepted(id);
			if (
				requests.size >= controlCancellationPolicy.recordLimit ||
				requests.has(id)
			) {
				if(shapeConfiguration && shapeRows.has(id) && method==="POST" && sha(lowerHeaders(headers)["next-action"] ?? "")===shapeConfiguration.actionHeaderSha256){shapeErrors++;shapeSelected++;shapeUnretainedSelections++;}
				overflow++;
				return;
			}
			const identity=controlRequestIdentity(contextId,url,method,headers);
			const urlFacts=routingURLFacts(url,compiledRoutingForBinding(compiledBinding),origin,"owned-proxy-request-url-no-follow",identity.requestKind==="route-tree" && identity.rsc && identity.prefetch);
			const scalarBytes=scalarFactBytes(urlFacts.fallback.scalarKeys);
			if(retained+scalarBytes>controlCancellationPolicy.retainedLimit){overflow++;urlFacts.fallback.scalarKeys={known:false,reason:"scalar-retention-limit"};}
			else retained+=scalarBytes;
			requests.set(id, {
				...identity,
				requestURLFacts:urlFacts,
				id,
				traceId,
				upstreamError: false,
				canceled: false,
				complete: false,
				responseEvents:0,
				chunks: [],
				retainedBytes: 0,
			});
			if(shapeConfiguration && method==="POST" && new URL(url).origin===origin && identity.headerFieldSha256["next-action"]===shapeConfiguration.actionHeaderSha256){
				shapeSelected++;
				if(retained+requestShapeLimits.metadataReservation>controlCancellationPolicy.retainedLimit){shapeOverflow++;shapeUnretainedSelections++;return;}
				retained+=requestShapeLimits.metadataReservation;
				const values=lowerHeaders(headers),parts=(values["content-type"] ?? "").toLowerCase().split(";").map(value=>value.trim());
				const row={id,requestEOF:false,terminal:null,bytes:0,events:0,bodySha256:null,hash:createHash("sha256"),buffer:null,retained:0,metadataRetained:requestShapeLimits.metadataReservation,unavailable:false,
					contentType:parts[0]==="text/plain"?"text/plain":"unsupported",charset:parts.length===2 && parts[1]==="charset=utf-8"?"utf-8":"unsupported",
					contentEncoding:values["content-encoding"]===undefined || values["content-encoding"]==="identity"?"identity":"unsupported",
					shape:{known:false,jsonParsed:false,reason:"request-pending"}};
				shapeRows.set(id,row);
				if(shapeReserve(row,requestShapeLimits.encodedBytes))row.buffer=Buffer.alloc(requestShapeLimits.encodedBytes);
				else row.shape={known:false,jsonParsed:false,reason:"request-buffer-reservation"};
				return true;
			}
		},
		requestBodyBytes(id,chunk){
			const row=shapeRows.get(id);if(!row || shapeClosed || row.requestEOF || row.terminal!==null || !Buffer.isBuffer(chunk)){shapeErrors++;return;}
			const offset=row.bytes;row.bytes+=chunk.length;
			if(row.unavailable)return;
			if(row.bytes>requestShapeLimits.encodedBytes || row.bytes>controlCancellationPolicy.encodedLimit || ++row.events>requestShapeLimits.byteEvents){
				if(!row.unavailable)shapeOverflow++;row.unavailable=true;shapeRelease(row);row.shape={known:false,jsonParsed:false,reason:"request-byte-limit"};return;
			}
			row.hash.update(chunk);chunk.copy(row.buffer,offset);
		},
		requestBodyEnd(id){
			const row=shapeRows.get(id);if(!row || shapeClosed || row.requestEOF || row.terminal!==null){shapeErrors++;return;}
			row.requestEOF=true;row.terminal="end";
			if(row.unavailable){row.shape={known:false,jsonParsed:false,reason:"request-unavailable"};shapeRelease(row);return;}
			row.bodySha256=row.hash.digest("hex");
			if(row.contentType!=="text/plain" || row.charset!=="utf-8" || row.contentEncoding!=="identity"){
				row.shape={known:false,jsonParsed:false,reason:"unsupported-request-encoding"};shapeRelease(row);return;
			}
			if(!shapeReserve(row,requestShapeLimits.parseReservation)){row.bodySha256=null;row.shape={known:false,jsonParsed:false,reason:"request-parse-reservation"};shapeRelease(row);return;}
			shapePendingParses++;
			setImmediate(()=>{try{row.shape=inspectRequestShape(row.buffer.subarray(0,row.bytes));}catch{shapeErrors++;row.shape={known:false,jsonParsed:false,reason:"request-shape-unavailable"};}
				finally{shapeRelease(row);shapePendingParses--;}});
		},
		requestBodyFailure(id,kind){
			const row=shapeRows.get(id);if(!row || !["error","aborted","close"].includes(kind)){shapeErrors++;return;}
			if(kind==="close" && row.requestEOF)return;
			shapeErrors++;
			if(!row.requestEOF && row.terminal===null){row.terminal=kind;row.unavailable=true;row.shape={known:false,jsonParsed:false,reason:"request-incomplete"};shapeRelease(row);}
		},
		response(id, { status, headers }) {
			headerCensus.headers(id,headers);
			const row = requests.get(id);
			if (!row) {
				errors++;
				return;
			}
			Object.assign(row, controlResponseMetadata(headers, status));
			row.responseEvents++;
			row.pathSourceFacts ??= renderedPathSourceFacts({response:{headers,status},compiledRouting:compiledRoutingForBinding(compiledBinding),origin,requestURLFacts:row.requestURLFacts,collectScalars:row.requestKind==="route-tree" && row.rsc && row.prefetch,responseOrdinal:row.responseEvents,observerSourceSha256:protocolSources?.["browser-control-collector.mjs"] ?? null});
			row.encoding = lowerHeaders(headers)["content-encoding"] ?? "identity";
		},
		bytes(id, chunk) {
			const row = requests.get(id);
			if (!row || row.canceled || row.complete) return;
			if (!row.flight && !row.action) return;
			if (
				row.bounded ||
				row.retainedBytes + chunk.length >
					controlCancellationPolicy.encodedLimit ||
				retained + chunk.length > controlCancellationPolicy.retainedLimit
			) {
				if (!row.bounded) {
					overflow++;
					row.bounded = true;
					release(row);
				}
				return;
			}
			row.chunks.push(chunk);
			row.retainedBytes += chunk.length;
			retained += chunk.length;
		},
		end(id) {
			const row = requests.get(id);
			if (!row || row.canceled || row.complete) return;
			row.complete = true;
			pendingBodies++;
			// Do not hold response forwarding/EOF open for proof parsing.
			setImmediate(() => {
				try {
					if ((!row.flight && !row.action) || row.bounded) return;
					let bytes = Buffer.concat(row.chunks);
					const options = {
						maxOutputLength: controlCancellationPolicy.decodedLimit,
					};
					if (row.encoding === "gzip") bytes = gunzipSync(bytes, options);
					else if (row.encoding === "br")
						bytes = brotliDecompressSync(bytes, options);
					else if (row.encoding === "deflate")
						bytes = inflateSync(bytes, options);
					else if (!["", "identity"].includes(row.encoding))
						throw Error("Unsupported encoding");
					row.transportBodyReceipt = { protocol: "proxy-natural-eof-decoded-bytes-v1", naturalEOF: true,
						decodedBytes: bytes.length, bodySha256: sha(bytes) };
					try {
						row.transportBodyReceipt.cdpTextProjection = {available:true,...projectCachedCdpText(bytes)};
					} catch(error) {
						const reason=["unsupported-original-buffer","original-byte-limit","unsupported-bom-prefix","projected-byte-limit"].includes(error?.message) ? error.message : "projection-unavailable";
						row.transportBodyReceipt.cdpTextProjection = {available:false,reason};
					}
					assignBodyProof(row, inspectRequiredFlightBody(bytes, bodyInspectionOptions(row,compiledCachedNavigations,compiledBinding)), "proxy-natural-eof", row.transportBodyReceipt.bodySha256);
				} catch {
					row.bodyProof = { complete: false, reason: "proxy-body-unavailable" };
				} finally {
					release(row);
					pendingBodies--;
				}
			});
		},
		cancel(id) {
			const row = requests.get(id);
			if (!row || row.complete) return;
			row.canceled = true;
			release(row);
		},
		failure(id) {
			const row = requests.get(id);
			if (!row) {
				errors++;
				return;
			}
			row.upstreamError = true;
			release(row);
		},
		upstreamClosedBeforeHeaders(id, fact) {
			headerCensus.terminalBeforeHeaders(id,fact);
		},
		transportClosed(fact) {
			if (transportClosure !== null) headerCensus.observerError();
			const count = value=>Number.isSafeInteger(value) && value >= 0 ? value : null;
			transportClosure ??= {serverClosed:fact?.serverClosed === true,acceptedRequests:count(fact?.acceptedRequests),
				upstreamRequests:count(fact?.upstreamRequests),closedUpstreams:count(fact?.closedUpstreams),pendingUpstreams:count(fact?.pendingUpstreams)};
			if (transportClosure.serverClosed && transportClosure.acceptedRequests === headerCensus.snapshot().counts.accepted &&
				transportClosure.upstreamRequests !== null && transportClosure.upstreamRequests === transportClosure.acceptedRequests &&
				transportClosure.closedUpstreams === transportClosure.upstreamRequests && transportClosure.pendingUpstreams === 0) {
				headerCensus.close();
				if(shapeConfiguration){shapeClosed=true;for(const row of shapeRows.values())if(!row.requestEOF && row.terminal===null){shapeErrors++;row.terminal="transport-closed-without-request-end";row.unavailable=true;row.shape={known:false,jsonParsed:false,reason:"request-incomplete"};shapeRelease(row);}}
			}
			else {headerCensus.observerError();if(shapeConfiguration)shapeErrors++;}
		},
		snapshot() {
			return {
				installed,
				...(shapeConfiguration?{requestShapeDiagnostics:shapeSnapshot()}:{}),
				headerCensus:headerCensus.snapshot(),
				headerLifetime:{protocol:"owned-context-upstream-header-lifetime-v1",contextId,installation:transportInstallation,closure:transportClosure},
				errors,
				overflow,
				pendingBodies,
				rows: [...requests.values()].map(
					({ chunks, retainedBytes, encoding, ...proof }) => ({ ...proof }),
				),
			};
		},
	};
}

const progressTechnicalId=value=>typeof value==="string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
/** Mixed only: actual public CDP identities, never private Puppeteer fields or temporal joins. */
export async function createMixedDocumentAcknowledgment({session,contextId,origin,generation}) {
 const contexts=new Map(),documents=[],executionEvents=[];let executionEventOrdinal=0,documentEventOrdinal=0,errors=0,overflow=0,closed=false,installed=false;
 const listeners=new Map();
 const on=(name,read)=>{const listener=value=>{if(closed){errors++;return;}try{read(value);}catch{errors++;}};session.on(name,listener);listeners.set(name,listener);};
 on("Runtime.executionContextCreated",({context})=>{executionEventOrdinal++;if(!Number.isSafeInteger(context?.id) || !progressTechnicalId(context.uniqueId) || typeof context.auxData?.isDefault!=="boolean" || !progressTechnicalId(context.auxData.frameId)){errors++;return;}if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit || contexts.has(context.id)){overflow++;return;}contexts.set(context.id,{id:context.id,uniqueId:context.uniqueId,frameId:context.auxData.frameId,isDefault:context.auxData.isDefault});executionEvents.push({ordinal:executionEventOrdinal,event:"created",executionContextId:context.id,uniqueId:context.uniqueId,frameId:context.auxData.frameId,isDefault:context.auxData.isDefault});});
 on("Runtime.executionContextDestroyed",event=>{executionEventOrdinal++;if(!contexts.delete(event.executionContextId))errors++;if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit){overflow++;return;}executionEvents.push({ordinal:executionEventOrdinal,event:"destroyed",executionContextId:event.executionContextId});});
 on("Runtime.executionContextsCleared",()=>{executionEventOrdinal++;contexts.clear();if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit){overflow++;return;}executionEvents.push({ordinal:executionEventOrdinal,event:"cleared"});});
 on("Network.requestWillBeSent",event=>{
  if(event.type!=="Document")return;documentEventOrdinal++;
  if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit){overflow++;return;}
  const identity=controlRequestIdentity(contextId,event.request?.url,event.request?.method ?? "GET",event.request?.headers);
  documents.push({ordinal:documentEventOrdinal,requestId:event.requestId,frameId:event.frameId,loaderId:event.loaderId,originSha256:identity.requestOriginSha256,documentGeneration:identity.documentGeneration});
 });
 try{await session.send("Runtime.enable");installed=true;}catch{errors++;}
 const frame=async()=>{
  const value=(await session.send("Page.getFrameTree"))?.frameTree?.frame;
  if(!progressTechnicalId(value?.id) || !progressTechnicalId(value.loaderId) || new URL(value.url).origin!==origin)throw Error("Missing owned document frame.");
  const matching=[...contexts.values()].filter(row=>row.isDefault && row.frameId===value.id);
  const docs=documents.filter(row=>row.frameId===value.id && row.loaderId===value.loaderId && row.originSha256===sha(origin));
  const number=generation();
  if(matching.length!==1 || docs.length!==1 || !Number.isSafeInteger(number) || number<1 || docs[0].documentGeneration!==contextId+":"+number)throw Error("Missing actual document/context/generation join.");
  return {frameId:value.id,loaderId:value.loaderId,executionContextUniqueId:matching[0].uniqueId,executionContextId:matching[0].id,documentRequestId:docs[0].requestId,documentGeneration:number};
 };
 const snapshot=()=>structuredClone({protocol:"actual-cdp-document-journal-v1",contextId,installed,currentGeneration:generation(),executionEventOrdinal,documentEventOrdinal,errors,overflow,closed,executionEvents,documents});
 return {
  snapshot,
  close(){closed=true;for(const [name,listener]of listeners)session.off(name,listener);},
  async read({checkpointOrdinal,deadlineMs,principalEpoch,readCookies,readSources}){
   const startedAtMs=performance.now(),deadlineBudgetMs=deadlineMs-startedAtMs;
   let pendingOperations=0,readErrors=0,document=null,controller=null,principalRead=null,principalReadOperation=null,publicSourceRecheck=null,timer;
   const result=()=>{const finishedAtMs=performance.now();return structuredClone({protocol:"native-environment-progress-readonly-v1",contextId,checkpointOrdinal,startedAtMs,finishedAtMs,deadlineMs,deadlineBudgetMs,elapsedMs:finishedAtMs-startedAtMs,timedOut:pendingOperations>0 || finishedAtMs>deadlineMs,pendingOperations,readErrors,document:document?{...document,sourceJournal:snapshot()}:null,controller,principalRead,principalReadOperation,publicSourceRecheck});};
   if(closed || errors || overflow || !Number.isFinite(deadlineBudgetMs) || deadlineBudgetMs<=0 || deadlineBudgetMs>10000 || !principalEpoch.progressStarted(checkpointOrdinal)){readErrors++;return result();}
   const track=task=>{pendingOperations++;return Promise.resolve().then(task).catch(()=>{readErrors++;}).finally(()=>{pendingOperations--;});};
   const tasks=[track(async()=>{
    const executionBefore=executionEventOrdinal,documentBefore=documentEventOrdinal;
    const before=await frame();
    const evaluated=await session.send("Runtime.evaluate",{uniqueContextId:before.executionContextUniqueId,awaitPromise:true,returnByValue:true,expression:`(async()=>{const doc=globalThis.document,sw=globalThis.navigator?.serviceWorker;if(!doc||!sw||typeof sw.getRegistrations!=="function")return {available:false};const describe=w=>w===null?null:{scriptURL:w?.scriptURL,state:w?.state};const before=sw.controller,beforeMetadata=describe(before),registrations=await sw.getRegistrations(),after=sw.controller;return {available:true,secureContext:globalThis.isSecureContext===true,origin:globalThis.location?.origin,documentIdentityStable:doc===globalThis.document,controllerIdentityStable:before===after,controllerBefore:beforeMetadata,controllerAfter:describe(after),registrationCount:Array.isArray(registrations)?registrations.length:null,registrationOverflow:Array.isArray(registrations)?Math.max(0,registrations.length-32):null,registrations:Array.isArray(registrations)&&registrations.length<=32?registrations.map(r=>({scope:r.scope,active:describe(r.active),waiting:describe(r.waiting),installing:describe(r.installing)})):null};})()`});
    if(evaluated?.exceptionDetails || !evaluated?.result || !Object.hasOwn(evaluated.result,"value"))throw Error("Document read rejected.");
    const after=await frame();
    if(JSON.stringify(before)!==JSON.stringify(after) || executionBefore!==executionEventOrdinal || documentBefore!==documentEventOrdinal || errors || overflow || closed || evaluated.result.value?.documentIdentityStable!==true)throw Error("Document changed across acknowledgment.");
    controller=nativeControllerMetadata(evaluated.result.value,origin);
    document={protocol:"actual-cdp-document-acknowledgment-v1",contextId,...before,originSha256:sha(origin),actualDocumentIdentityStable:true,executionEventOrdinalBefore:executionBefore,executionEventOrdinalAfter:executionEventOrdinal,documentEventOrdinalBefore:documentBefore,documentEventOrdinalAfter:documentEventOrdinal};
   }),track(async()=>{try{principalRead=principalEpoch.progressFinished(checkpointOrdinal,await readCookies());principalReadOperation=principalEpoch.progressOperation(checkpointOrdinal);}catch{principalEpoch.progressFailed(checkpointOrdinal);throw Error("Cookie read failed.");}}),track(async()=>{publicSourceRecheck=await readSources();})];
   try{
    await Promise.race([Promise.all(tasks),new Promise(resolve=>{timer=setTimeout(resolve,deadlineBudgetMs);})]);clearTimeout(timer);
    if(pendingOperations===0 && readErrors===0 && document && performance.now()<deadlineMs){
     const seal=track(async()=>{const end=await frame();if(JSON.stringify(end)!==JSON.stringify(Object.fromEntries(["frameId","loaderId","executionContextUniqueId","executionContextId","documentRequestId","documentGeneration"].map(key=>[key,document[key]]))) || document.executionEventOrdinalAfter!==executionEventOrdinal || document.documentEventOrdinalAfter!==documentEventOrdinal || closed || errors || overflow)throw Error("Document changed during other acknowledged reads.");});
     await Promise.race([seal,new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,deadlineMs-performance.now()));})]);
    }
   }finally{clearTimeout(timer);}
   return result();
  },
 };
}

const progressApplicationKeys=["failures","serverErrors","unknown","httpErrors","overflows","decodeFailures","registryConflicts"];
const progressApplicationKnown=application=>progressApplicationKeys.every(key=>application?.[key]===0);
/** Independent acknowledgments at existing mixed stop guards. No mutex, retry, quiescence or business operation. */
export function createMixedProgressAcknowledgments({input,application,acknowledge}) {
 const prefixes=[],checks=[],tokens=new WeakMap();let attempted=0,guardChecks=0,failed=0,overflow=0,authoritySha256=null,contextId=null;
 const bytes=()=>Buffer.byteLength(JSON.stringify(checks))+prefixes.reduce((sum,prefix)=>sum+Buffer.byteLength(JSON.stringify(prefix)),0);
 const live=()=>{
  if(failed || overflow || !progressApplicationKnown(application()))throw Error("Mixed required application observation is not clean.");
  const cut=input(),candidate=mixedNativePrefixCandidates(cut),authority=mixedNativeAuthorityDigest(cut.nativeContext);
  if(!knownMixedOpenJournals(cut.nativeContext) || cut.nativeContext?.protocolErrors?.observed!==0 || cut.nativeContext.protocolErrors.overflow!==0 || !candidate || !authority || authoritySha256!==null && authoritySha256!==authority)throw Error("Mixed browser observation lacks request-local evidence.");
  authoritySha256=authority;contextId=cut.nativeContext.contextId;return {cut,candidate};
 };
 const retained=()=>{if(bytes()>controlCancellationPolicy.retainedLimit){overflow++;throw Error("Mixed prefix retention bound exceeded.");}};
 return {
  async check({operationDeadlineMs=null}={}){
   try{
    const {cut:begin,candidate}=live();
    if(guardChecks>=controlCancellationPolicy.recordLimit){overflow++;throw Error("Mixed guard bound exceeded.");}
    const ordinal=++guardChecks;let receipt=null,end=begin;
    if(candidate.cores.length!==0){
     const checkpointOrdinal=++attempted;
     const observerDeadline=performance.now()+mixedNativeProgressPolicy.observerCeilingMs;
     const deadlineMs=operationDeadlineMs===null?observerDeadline:Math.min(observerDeadline,operationDeadlineMs);
     const acknowledgment=await acknowledge({checkpointOrdinal,deadlineMs});
     if(acknowledgment?.checkpointOrdinal!==checkpointOrdinal || acknowledgment.deadlineMs!==deadlineMs)throw Error("Mixed acknowledgment used another read or deadline.");
     end=live().cut;receipt=createMixedNativePrefix({checkpointOrdinal,begin,end,acknowledgment,headerPrefix:end.nativeContext.headerPrefix,operationDeadlineMs,returnedAtMs:performance.now()});prefixes.push(receipt);
    }
    const check={ordinal,begin:mixedNativeProgressVector(begin),returned:null,checkpointOrdinal:receipt?.checkpointOrdinal ?? null,prefixSha256:receipt?.prefixSha256 ?? null};checks.push(check);retained();
    const token=Object.freeze({ordinal,contextId,authoritySha256,failureIds:Object.freeze(progressFailureIdsForCollector(end))});tokens.set(token,{check,begin,receipt});return token;
   }catch(error){failed++;throw error;}
  },
  confirm(token){
   try{
    const {cut,candidate}=live(),owned=tokens.get(token),check=owned?.check;
    if(!check || check.returned!==null || token.contextId!==contextId || token.authoritySha256!==authoritySha256 || JSON.stringify(token.failureIds)!==JSON.stringify(candidate.failureIds))throw Error("New mixed failed request or wrong acknowledgment at return cut.");
    if(!sameMixedReturnJournals(owned.begin.nativeContext,cut.nativeContext))throw Error("Mixed current authority changed after acknowledgment.");
    if(owned.receipt){const initial=owned.receipt;const sealed=createMixedNativePrefix({checkpointOrdinal:initial.checkpointOrdinal,begin:initial.begin,end:cut,acknowledgment:initial.acknowledgment,headerPrefix:cut.nativeContext.headerPrefix,operationDeadlineMs:initial.operationDeadlineMs,returnedAtMs:performance.now()});if(performance.now()>initial.acknowledgment.deadlineMs)throw Error("Mixed acknowledgment deadline expired before return.");const index=prefixes.findIndex(row=>row.checkpointOrdinal===initial.checkpointOrdinal);if(index<0)throw Error("Mixed acknowledgment lost its owned prefix.");prefixes[index]=sealed;check.prefixSha256=sealed.prefixSha256;}
    const principal=cut.nativeContext?.principalEpoch,census=cut.nativeContext?.headerCensus,errors=cut.nativeContext?.protocolErrors;
    if(principal?.observedSetCookieResponses!==0 || principal.unknownResponseHeaders!==0 || principal.readErrors!==0 || principal.observationErrors!==0 || principal.overflow!==0 || errors?.observed!==0 || errors.overflow!==0 || !["unknownHeaders","setCookieResponses","setCookieLines","errors","duplicates","missing","late","overflow"].every(key=>census?.counts?.[key]===0))throw Error("A new principal/header/protocol error invalidated the mixed return cut.");
    check.returned=mixedNativeProgressVector(cut);tokens.delete(token);retained();return true;
   }catch(error){failed++;throw error;}
  },
  snapshot:()=>structuredClone({protocol:"mixed-native-progress-observations-v1",contextId,authoritySha256,guardChecks,attempted,failed,overflow,retainedBytes:bytes(),checks:[...checks].sort((a,b)=>a.ordinal-b.ordinal),prefixes:[...prefixes].sort((a,b)=>a.checkpointOrdinal-b.checkpointOrdinal)}),
 };
}
const progressFailureIdsForCollector=input=>input.failures.map(row=>row.requestId).sort();
