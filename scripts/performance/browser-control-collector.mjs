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
} from "./control-cancellation-evidence.mjs";
import { createProxyHeaderCensus } from "./proxy-header-census.mjs";
import { projectCachedCdpText } from "./cdp-cached-text-projection.mjs";

export const controlResponseHeader = "x-z8-fixture-response-id";
export const controlDocumentHeader = "x-z8-fixture-document-generation";
export const mixedBrowserWorkScope = "all-mixed-context-work-before-first-app-io-through-finite-settlement-v1";
const sha = (value) => createHash("sha256").update(value).digest("hex");
// Private file locator only; all actual source/hash observations are serialized, not stored here.
const nativeManifestLocators = new WeakMap();
const shaChunks = (chunks) => {
	const hash = createHash("sha256");
	for (const chunk of chunks) hash.update(chunk);
	return hash.digest("hex");
};
const hasProtocolError = (proof) => proof?.serverErrors > 0 || proof?.explicitActionFailure === true;
const protocolErrorFact = (proof, capture, bodySha256) => ({
	capture,
	serverErrors: Number.isSafeInteger(proof.serverErrors) && proof.serverErrors > 0 ? proof.serverErrors : 0,
	explicitActionFailure: proof.explicitActionFailure === true,
	reason: ["flight-server-error", "embedded-runtime-prefetch-incomplete", "explicit-root-action-failure"].includes(proof.reason) ? proof.reason : "observed-protocol-error",
	bodySha256: /^[a-f0-9]{64}$/.test(bodySha256 ?? "") ? bodySha256 : null,
});
const assignBodyProof = (row, proof, capture, bodySha256) => {
	row.bodyProof = proof;
	if (!hasProtocolError(proof)) return;
	const fact = protocolErrorFact(proof, capture, bodySha256);
	row.observedProtocolError = { serverErrors: Math.max(row.observedProtocolError?.serverErrors ?? 0, fact.serverErrors),
		explicitActionFailure: row.observedProtocolError?.explicitActionFailure === true || fact.explicitActionFailure };
	const history = row.protocolErrorObservations ??= [];
	if (history.some((prior) => JSON.stringify(prior) === JSON.stringify(fact))) return;
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

/** Read-only browser metadata and local source recheck; shares the caller's existing deadline. */
export async function captureNativeEndMetadata({ page, binding, origin, deadlineMs }) {
	const started = performance.now(), remaining = deadlineMs - started;
	if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 10000)
		return { protocol: "native-environment-end-readonly-v1", timedOut: remaining <= 0, reason: "invalid-or-expired-deadline", pendingOperations: 0, readErrors: 0, controller: null, publicSourceRecheck: null, publicSourcesMatch: null };
	let pendingOperations = 2, readErrors = 0, controller = null, publicSourceRecheck = null, timer;
	const workerMetadata = raw => {
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
		controller = workerMetadata(raw);
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
				stablePrincipalClaim: false };
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
	if (row.requestKind === "segment-prefetch") {
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
		options.segmentBinding = row.segmentRequestBinding;
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
		const sources = [...rows().map((row) => ({ source: "browser", row })), ...proxy.rows.map((row) => ({ source: "proxy", row }))];
		const protocolErrorRecords = sources.flatMap(({ source, row }) => {
			const history = row.protocolErrorObservations ?? (hasProtocolError(row.bodyProof) ? [protocolErrorFact(row.bodyProof, "latest-proof",
				row.transportBodyReceipt?.bodySha256 ?? row.bodyReadbackReceipt?.bodySha256 ?? row.streamReceipt?.capturedBodySha256)] : []);
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
			const row = requests.get(event.requestId);
			if (row) applyExtra(row, headerIdentity(event.headers));
			else if (!limited())
				extra.set(event.requestId, headerIdentity(event.headers));
			else overflow++;
		},
		response(event) {
			principalEpoch.response(event.requestId, event.response.headers);
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("responseBeforeRequest");
				return;
			}
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
			const mimeField=Object.getOwnPropertyDescriptor(event.response,"mimeType"),charsetField=Object.getOwnPropertyDescriptor(event.response,"charset");
			const mime=mimeField && Object.hasOwn(mimeField,"value") && typeof mimeField.value === "string" && mimeField.value.length<=128 ? mimeField.value.toLowerCase() : null;
			const charset=charsetField && Object.hasOwn(charsetField,"value") && typeof charsetField.value === "string" && charsetField.value.length<=64 ? charsetField.value.toLowerCase() : null;
			row.effectiveCdpResponse={protocol:"cdp-effective-response-decoder-metadata-v1",provenance:"Network.responseReceived",
				mimeKnown:mime!==null,mime:mime===null?null:mime==="text/x-component"?mime:"other",charsetKnown:charset!==null,
				charset:charset===null?null:charset===""?"empty":["utf-8","utf8","iso-8859-1","latin1","us-ascii","windows-1252","utf-16le","utf-16be"].includes(charset)?charset:"other"};
			startStream(row);
		},
		responseExtra(event) {
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
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("finishedBeforeRequest");
				return;
			}
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
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("failedBeforeRequest");
				return;
			}
			if (captureContextFailures && !measurementClosed && row.observedInMeasurement) recordMeasuredFailure(event.requestId);
			if (row.failed) {
				errors++;
				return;
			}
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
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("dataBeforeRequest");
				return;
			}
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
	let workerObservation, endMetadata = null;
	const proxy = createProxyControlCollector({
		contextId,
		compiledCachedNavigations,
		compiledBinding:environmentBinding,
	});
	const transportErrors = transport.setControlCancellationObserver(proxy);
	const proxyObservation = () => {
		const proof = proxy.snapshot();
		return { ...proof, errors: proof.errors + transportErrors() };
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
	await session.send("Network.enable");
	await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "start", deadlineMs: performance.now() + 10000 });
	let browser;
	try { browser = context.browser?.(); } catch {}
	workerObservation = createNativeWorkerObserver({ browser, context, contextId, origin });
	let generation = 0;
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
	return {
		...collector,
		async close({ deadlineMs } = {}) {
			try {
				await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "end", deadlineMs });
				endMetadata = await captureNativeEndMetadata({ page, binding: environmentBinding, origin, deadlineMs });
			}
			finally {
				workerObservation.close();
				collector.endScope();
				for (const [method, original] of originals) page[method] = original;
				await session.detach();
			}
		},
	};
}

/** Same actual bytes as forwarding; no replay, clone, response hold, or public payload retention. */
export function createProxyControlCollector({
	contextId,
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
		},
		request(id, { url, method, headers, traceId }) {
			headerCensus.accepted(id);
			if (
				requests.size >= controlCancellationPolicy.recordLimit ||
				requests.has(id)
			) {
				overflow++;
				return;
			}
			requests.set(id, {
				...controlRequestIdentity(contextId, url, method, headers),
				id,
				traceId,
				upstreamError: false,
				canceled: false,
				complete: false,
				chunks: [],
				retainedBytes: 0,
			});
		},
		response(id, { status, headers }) {
			headerCensus.headers(id,headers);
			const row = requests.get(id);
			if (!row) {
				errors++;
				return;
			}
			Object.assign(row, controlResponseMetadata(headers, status));
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
				transportClosure.closedUpstreams === transportClosure.upstreamRequests && transportClosure.pendingUpstreams === 0) headerCensus.close();
			else headerCensus.observerError();
		},
		snapshot() {
			return {
				installed,
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
