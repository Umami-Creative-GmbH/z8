/** Only the fresh profile owned by this launch is configured; app network requests remain observable. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { knownFixtureUpstreamSocketPolicy } from "./trace-transport.mjs";

export const fixtureBrowserPolicy = "isolated-profile-no-prediction-v1";
/** A changed, matched HTTP validation condition; never an error/body/Native exemption. */
export const targetedPrefetchProfileContract = Object.freeze({
	protocol: "targeted-prefetch-profile-v1",
	profileId: "same-origin-next-prefetch-no-cache-v1",
	selection: "same-origin GET, own-data RSC=1 and Next-Router-Prefetch=1, no Next-Action",
	change: "one original fetch with original input/receiver/values and fresh top-level init cache=no-cache",
	ordinary: "known foreign origin, API/static/navigation, non-GET, action or known non-prefetch passes unchanged",
	uncertainty: "potential prefetch with unsupported URL/init/headers/cache/controller or overwritten installation fails coverage",
	controller: "fresh isolated context; phase-qualified serving public4 epoch; activated current /sw.js; no replacement",
	documents: "before every same-origin document bootstrap; retained capsule checked on BFCache restore",
	observation: "all validation traffic retained; existing errors/resources/Native/body/deadlines/caps unchanged",
});
export const targetedPrefetchProfile = Object.freeze({
	protocol: targetedPrefetchProfileContract.protocol, profileId: targetedPrefetchProfileContract.profileId,
	contractSha256: createHash("sha256").update(JSON.stringify(targetedPrefetchProfileContract)).digest("hex"),
});
export const knownTargetedPrefetchProfile = value => value !== null && typeof value === "object" &&
	JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(targetedPrefetchProfile).sort()) &&
	Object.entries(targetedPrefetchProfile).every(([key, field]) => value[key] === field);
/** Current source qualification, not an assertion about historical framework15/build-time observation. */
export const targetedPrefetchProducerChain=Object.freeze({version:"16.4.0",files:Object.freeze([
	{file:"dist/client/components/segment-cache/fetch.js",bytes:1379,sha256:"378770d930578c5103083c029f8e388c4315ec67666d5843b2ddfc8af9469061"},
	{file:"dist/esm/client/components/segment-cache/fetch.js",bytes:847,sha256:"c654815886065d532207f212ad58a2198fa2c58cef9ca13d7a6bc66fa4c5abdb"},
	{file:"dist/client/components/router-reducer/fetch-server-response.js",bytes:29577,sha256:"fba387124134c7becf61938ca1ce38738220a554a97931ad745ed4976c989a51"},
	{file:"dist/esm/client/components/router-reducer/fetch-server-response.js",bytes:29946,sha256:"3c29b2c86b4f66407b2694fd236b96eb6531771feb7c4933a81294b16df1f208"},
	{file:"dist/build/define-env.js",bytes:17758,sha256:"0ea6c29ea783a910159e4a15855434d080d24c750be0636633064908810b883f"},
].map(Object.freeze))});
export const targetedPrefetchProducerChainSha256=createHash("sha256").update(JSON.stringify(targetedPrefetchProducerChain)).digest("hex");
export const targetedPrefetchSourceEpoch = (publicSources, nativePublicSources) => createHash("sha256").update(JSON.stringify({profile:targetedPrefetchProfile,publicSources,nativePublicSources,producerChainSha256:targetedPrefetchProducerChainSha256})).digest("hex");
const targetedPrefetchExports=new WeakMap();
/** Caller has forgotten the last public field after its final file/validation consumer. */
export function releaseTargetedPrefetchProfileEvidence(value) {
	const owner=value&&typeof value==="object"?targetedPrefetchExports.get(value):null;
	if(!owner)return false;
	targetedPrefetchExports.delete(value);owner.dispose();return true;
}
export function releaseTargetedPrefetchProfileSamples(samples) {
	const owners=new Set();
	for(const sample of samples){const evidence=sample.browserControlEvidence,value=evidence?.targetedPrefetchProfile;
		if(value && targetedPrefetchExports.has(value)){delete evidence.targetedPrefetchProfile;owners.add(value);}}
	let failure=null;
	for(const value of owners)try{releaseTargetedPrefetchProfileEvidence(value);}catch(error){failure??=error;}
	if(failure)throw failure;
}

/** Partition-scoped passive version evidence supplements (never replaces) the actual document controller. */
export function createTargetedPrefetchWorkerWitness({origin,targetId}) {
	let registrationId=null,versionId=null,versionRegistration=null,activated=false,clientObserved=false,errors=0,events=0,runningStatus="unknown";
	const id=value=>typeof value==="string" && value.length>0 && Buffer.byteLength(value)<=256;
	if(!id(targetId))throw Error("Missing owned page target identity.");
	const bad=()=>{errors++;};
	return Object.freeze({
		registration(event){try{if(!Array.isArray(event.registrations)||event.registrations.length>32){bad();return;}
			for(const row of event.registrations){if(++events>10000){bad();return;}if(!id(row.registrationId)||row.scopeURL!==`${origin}/`||row.isDeleted!==false){bad();continue;}
				if(registrationId!==null && registrationId!==row.registrationId){bad();continue;}registrationId=row.registrationId;if(versionRegistration!==null&&versionRegistration!==registrationId)bad();}
		}catch{bad();}},
		version(event){try{if(!Array.isArray(event.versions)||event.versions.length>32){bad();return;}
			for(const row of event.versions){if(++events>10000){bad();return;}
				if(!id(row.versionId)||!id(row.registrationId)||row.scriptURL!==`${origin}/sw.js`||!["new","installing","installed","activating","activated"].includes(row.status)||!["stopped","starting","running","stopping"].includes(row.runningStatus)){bad();continue;}
				if(versionId!==null && versionId!==row.versionId || registrationId!==null&&registrationId!==row.registrationId){bad();continue;}
				versionId=row.versionId;versionRegistration=row.registrationId;runningStatus=row.runningStatus;activated ||= row.status==="activated";
				if(row.controlledClients!==undefined){if(!Array.isArray(row.controlledClients)||row.controlledClients.length>128||row.controlledClients.some(value=>!id(value))){bad();continue;}clientObserved ||= row.controlledClients.includes(targetId);}
			}
		}catch{bad();}},
		error:bad,
		dispose(){registrationId=null;versionId=null;versionRegistration=null;targetId=null;},
		snapshot(){return {complete:errors===0&&registrationId!==null&&versionId!==null&&registrationId===versionRegistration&&activated&&clientObserved,errors,events,activated,clientObserved,runningStatus,
			registrationSha256:registrationId?createHash("sha256").update(registrationId).digest("hex"):null,versionSha256:versionId?createHash("sha256").update(versionId).digest("hex"):null};},
	});
}

/** Each retained document costs one existing record unit and a conservative 4096-byte envelope
 * for the private entry, primitive live receipt and two public snapshot copies. No request graph is retained. */
export function createTargetedPrefetchProfileJournal({profile, sourceEpoch, workerWitness=null, reserve, release, reserveRecords, releaseRecords}) {
	if (!knownTargetedPrefetchProfile(profile) || !/^[a-f0-9]{64}$/.test(sourceEpoch)) throw Error("Unqualified prefetch profile source epoch.");
	// Includes the fixed source capsule/three UTF16 script copies (<=16384 characters each),
	// public4 epoch inputs and journal/listener/worker controls. This is in the existing parent pool.
	if(reserve(131072)!==true)throw Error("Targeted-prefetch profile control budget unavailable.");
	const documents = new Map(), fields = ["calls", "selected", "passed", "unsupported", "overwritten", "errors", "restores"];
	let errors = 0, overflow = 0, scopeClosed = false, active = null, disposed = false,closedSnapshot=null;
	const bad = () => { errors++; };
	const owner=Object.freeze({
		receive(id, payload) {
			if (scopeClosed) { bad(); return; }
			try {
				if (!Number.isSafeInteger(id) || id <= 0 || typeof payload !== "string" || Buffer.byteLength(payload) > 1024) { bad(); return; }
				const value = JSON.parse(payload);
				if (!value || Object.keys(value).length !== 11 || value.sourceEpoch !== sourceEpoch || value.installed !== true ||
					!fields.every(name => Number.isSafeInteger(value[name]) && value[name] >= 0 && value[name] <= 1000000) ||
					value.calls !== value.selected + value.passed || !["installed", "call", "checkpoint", "controller", "pagehide", "restore", "overwrite"].includes(value.event) ||
					!["uncontrolled", "activating", "bound", "invalid"].includes(value.controllerState)) { bad(); return; }
				let row = documents.get(id);
				if (!row) {
					if (value.event !== "installed" || documents.size >= 128) { overflow++; return; }
					if (!reserveRecords(1)) { overflow++; return; }
					let granted = false; try { granted = reserve(4096) === true; } finally { if (!granted) releaseRecords(1); }
					if (!granted) { overflow++; return; }
					row = { ordinal: documents.size + 1, ...Object.fromEntries(fields.map(name => [name, 0])), controllerState: "uncontrolled", departed: false, checkpoint: false };
					documents.set(id, row);
				} else if (value.event === "installed" || fields.some(name => value[name] < row[name])) { bad(); return; }
				for (const name of fields) row[name] = value[name];
				row.controllerState = value.controllerState;
				if (value.event === "pagehide") row.departed = true;
				else if (value.event === "installed" || value.event === "restore") { row.departed = false; active = id; }
				row.checkpoint = value.event === "checkpoint";
			} catch { bad(); }
		},
		error: bad,
		errors() { return errors + overflow + (workerWitness?.snapshot().errors ?? 0) + [...documents.values()].reduce((sum, row) => sum + row.errors + row.unsupported + row.overwritten + Number(row.controllerState === "invalid"), 0); },
		boundary() { return documents.size + [...documents.values()].reduce((sum, row) => sum + row.restores, 0); },
		close() { scopeClosed = true; if (!documents.size || !documents.get(active)?.checkpoint || [...documents].some(([id, row]) => id !== active && !row.departed)) bad(); },
		snapshot() {
			if(disposed)throw Error("Targeted-prefetch evidence has been released.");
			if(closedSnapshot)return closedSnapshot;
			const value={ profile: { ...profile }, sourceEpoch, installed: documents.size > 0, scopeClosed, errors, overflow,...(workerWitness?{workerVersion:workerWitness.snapshot()}:{}), documents: [...documents.values()].map(row => ({ ...row })) };
			if(scopeClosed){Object.freeze(value.profile);value.documents.forEach(Object.freeze);Object.freeze(value.documents);if(value.workerVersion)Object.freeze(value.workerVersion);closedSnapshot=Object.freeze(value);targetedPrefetchExports.set(closedSnapshot,owner);}
			return value;
		},
		dispose() { if (!disposed) { disposed = true; if(closedSnapshot)targetedPrefetchExports.delete(closedSnapshot);closedSnapshot=null;const count = documents.size; documents.clear();workerWitness?.dispose(); release(count * 4096 + 131072); releaseRecords(count); } },
	});
	return owner;
}

export function completeTargetedPrefetchProfileEvidence(value, profile = targetedPrefetchProfile, {closed = true} = {}) {
	return knownTargetedPrefetchProfile(profile) && knownTargetedPrefetchProfile(value?.profile) &&
		/^[a-f0-9]{64}$/.test(value.sourceEpoch ?? "") && value.installed === true && value.scopeClosed === closed && value.errors === 0 && value.overflow === 0 &&
		Array.isArray(value.documents) && value.documents.length > 0 && value.documents.length <= 128 && value.documents.every((row, index) =>
			row.ordinal === index + 1 && typeof row.departed==="boolean" && typeof row.checkpoint==="boolean" && ["uncontrolled", "bound"].includes(row.controllerState) && ["unsupported", "overwritten", "errors"].every(name => row[name] === 0) &&
			["calls", "selected", "passed", "restores"].every(name => Number.isSafeInteger(row[name]) && row[name] >= 0 && row[name] <= 1000000) && row.calls === row.selected + row.passed) &&
		(!closed || value.documents.filter(row=>!row.departed).length===1 && value.documents.find(row=>!row.departed).checkpoint===true) &&
		(value.workerVersion===undefined || value.workerVersion.errors===0) && (!value.documents.some(row=>row.controllerState==="bound") || value.workerVersion?.complete===true);
}

/** Self-contained pre-bootstrap capsule. Source epoch is supplied only by the file-qualified installer. */
export function installTargetedPrefetchProfile(target, profile, sourceEpoch, expectedOrigin) {
	const key = "__z8TargetedPrefetchProfileV1", binding = "__z8TargetedPrefetchReceiptV1";
	const own = (object, name) => { const d = Object.getOwnPropertyDescriptor(object, name); return d && Object.hasOwn(d, "value") ? d : null; };
	const plain = value => value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value));
	const NativeURL = URL, prototype = NativeURL.prototype, href = Object.getOwnPropertyDescriptor(prototype, "href").get;
	const counts = { calls: 0, selected: 0, passed: 0, unsupported: 0, overwritten: 0, errors: 0, restores: 0 };
	let installed = false, observedController = null, bound = null, currentFetch, wrapper, controllerState = "uncontrolled", hidden = false;
	const emit = event => { try { target[binding](JSON.stringify({ event, ...counts, installed, controllerState, sourceEpoch })); } catch { counts.errors++; } };
	const bump = name => { if (counts[name] < 1000000) counts[name]++; else counts.errors++; };
	const scope = input => {
		if (typeof input === "string") return {url:new NativeURL(input, target.location.href),native:false};
		let value; try { value = Reflect.apply(href, input, []); } catch { return null; }
		if (Object.getPrototypeOf(input) !== prototype || ["href", "origin", "toString", "valueOf", "toJSON", Symbol.toPrimitive].some(name => Object.getOwnPropertyDescriptor(input, name))) return null;
		return {url:new NativeURL(value),native:true};
	};
	const controller = () => {
		try {
			const actual = target.navigator?.serviceWorker?.controller;
			if (observedController && actual !== observedController) { controllerState = "invalid"; return; }
			if (actual == null) { if (bound) controllerState = "invalid"; return; }
			observedController ??= actual;
			if (actual.scriptURL !== `${expectedOrigin}/sw.js` || !["activating", "activated"].includes(actual.state)) { controllerState = "invalid"; return; }
			if (actual.state !== "activated") { controllerState = "activating"; actual.addEventListener?.("statechange", changed); return; }
			if (controllerState === "invalid") return;
			bound = actual; controllerState = "bound";
		} catch { controllerState = "invalid"; counts.errors++; }
	};
	const changed = () => { controller(); emit("controller"); };
	const intact = () => { const d = Object.getOwnPropertyDescriptor(target, "fetch"); if (currentFetch !== wrapper || d?.get !== getFetch || d?.set !== setFetch) bump("overwritten"); };
	function getFetch() { return currentFetch; }
	function setFetch(value) { if (value !== wrapper) bump("overwritten"); currentFetch = value; emit("overwrite"); }
	try {
		if (target.window !== target || target.top !== target || target.document.readyState !== "loading" || new NativeURL(target.location.href).origin !== expectedOrigin || !/^[a-f0-9]{64}$/.test(sourceEpoch) || own(target, key) || profile?.protocol!=="targeted-prefetch-profile-v1" || profile?.profileId!=="same-origin-next-prefetch-no-cache-v1" || !/^[a-f0-9]{64}$/.test(profile.contractSha256)) return null;
		const descriptor = own(target, "fetch"), original = descriptor?.value;
		if (typeof original !== "function" || descriptor.configurable !== true || descriptor.writable !== true) return null;
		wrapper = function (...args) {
			bump("calls"); let selected = false, forwarded = args;
			try {
				const input = scope(args[0]),url=input?.url;
				// Establish ordinary scope before inspecting possibly unsupported options.
				if (url && (url.origin !== expectedOrigin || url.pathname.startsWith("/api/") || (!url.pathname.startsWith("/_next/") && /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|css|js)$/.test(url.pathname)))) {}
				else {
					const init = args[1];
					if (init === undefined && url) {}
					else if (!plain(init)) bump("unsupported");
					else {
						const fields = Object.setPrototypeOf(Object.getOwnPropertyDescriptors(init),null), method = fields.method;
						if (method && Object.hasOwn(method, "value") && typeof method.value === "string" && method.value.toUpperCase() !== "GET") {}
						else if (fields.mode && Object.hasOwn(fields.mode, "value") && fields.mode.value === "navigate") {}
						else if (["method","mode","headers"].some(name=>!Object.hasOwn(fields,name)&&name in init)) bump("unsupported");
						else if (!url || Reflect.ownKeys(fields).some(name => typeof name !== "string" || !Object.hasOwn(fields[name], "value"))) bump("unsupported");
						else if (fields.headers === undefined) {}
						else if (!plain(fields.headers.value)) bump("unsupported");
						else {
							const headers = Object.getOwnPropertyDescriptors(fields.headers.value), values = new Map(); let known = true;
							for (const name of Reflect.ownKeys(headers)) { const d = headers[name]; if (typeof name !== "string" || !Object.hasOwn(d, "value") || typeof d.value !== "string" || values.has(name.toLowerCase())) { known = false; break; } values.set(name.toLowerCase(), d.value); }
							if (!known) bump("unsupported");
							else if (!values.has("next-action") && values.get("rsc") === "1" && values.get("next-router-prefetch") === "1") {
								controller();
								if ("cache" in init || method && method.value !== "GET" || !["uncontrolled", "bound"].includes(controllerState) || controllerState==="bound"&&!input.native) bump("unsupported");
								else { const clone = Object.defineProperties(Object.create(Object.getPrototypeOf(init)), fields); Object.defineProperty(clone, "cache", { value: "no-cache", writable: true, enumerable: true, configurable: true }); forwarded = args.slice(); forwarded[1] = clone; selected = true; }
							}
						}
					}
				}
			} catch { bump("unsupported"); }
			bump(selected ? "selected" : "passed"); emit("call");
			return Reflect.apply(original, this, forwarded);
		};
		currentFetch = wrapper;
		Object.defineProperty(target, "fetch", { get: getFetch, set: setFetch, enumerable: descriptor.enumerable, configurable: true });
		const capsule = Object.freeze({ snapshot() { intact(); controller(); emit("checkpoint"); return { ...counts, installed, controllerState, sourceEpoch }; } });
		Object.defineProperty(target, key, { value: capsule, configurable: false });
		target.navigator?.serviceWorker?.addEventListener("controllerchange", changed);
		target.addEventListener("pagehide", () => { intact(); hidden = true; emit("pagehide"); });
		target.addEventListener("pageshow", event => { if (event.persisted) { if (!hidden) counts.errors++; bump("restores"); intact(); controller(); emit("restore"); } hidden = false; });
		controller(); installed = true; emit("installed"); return capsule;
	} catch { counts.errors++; emit("installation-failed"); return null; }
}
const preferences = {
	net: { network_prediction_options: 2 },
	search: { suggest_enabled: false },
	default_search_provider: { enabled: false },
};

/** Pure acceptance guard: retained startup evidence never cancels later errors. */
export function fixtureTransportIsComplete(snapshot) {
	const init = snapshot?.browserInitialization,
		after = snapshot?.afterInitialization;
	if (
		!knownFixtureUpstreamSocketPolicy(snapshot?.upstreamSocketPolicy) ||
		!knownFixtureUpstreamSocketPolicy(init?.upstreamSocketPolicy) ||
		!init ||
		!after ||
		init.policy !== fixtureBrowserPolicy ||
		init.complete !== true ||
		init.capped !== false ||
		init.emptyContext !== true ||
		init.quietMs !== 2000 ||
		init.capMs !== 10000 ||
		!(init.quietObservedMs >= 2000) ||
		!(init.elapsedMs >= init.quietObservedMs && init.elapsedMs < 10000) ||
		init.pending !== 0 ||
		init.requests !== 0 ||
		init.responseBodyBytes !== 0 ||
		init.upstreamFailures !== 0 ||
		after.refusedRequests !== 0 ||
		after.upstreamFailures !== 0 ||
		init.launch?.policy !== fixtureBrowserPolicy ||
		JSON.stringify(init.launch.preferences) !== JSON.stringify(preferences) ||
		!init.launch.arguments?.some(
			(arg) =>
				arg.startsWith("--disable-features=") &&
				arg
					.slice("--disable-features=".length)
					.split(",")
					.includes("AutofillServerCommunication"),
		) ||
		!/^Chrome\//.test(init.launch.browserVersion ?? "")
	)
		return false;
	const fields = [
		"requests",
		"rewrittenRequests",
		"refusedRequests",
		"upstreamFailures",
		"responseBodyBytes",
	];
	const reasons = [
		"unexpectedLoopback",
		"nonLoopbackHttp",
		"loopbackConnect",
		"nonLoopbackConnect",
		"malformed",
	];
	for (const counters of [snapshot, init, after]) {
		if (
			fields.some(
				(key) => !Number.isSafeInteger(counters[key]) || counters[key] < 0,
			) ||
			reasons.some(
				(key) =>
					!Number.isSafeInteger(counters.refusalReasons?.[key]) ||
					counters.refusalReasons[key] < 0,
			) ||
			reasons.reduce((sum, key) => sum + counters.refusalReasons[key], 0) !==
				counters.refusedRequests
		)
			return false;
	}
	if (
		fields.some((key) => snapshot[key] !== init[key] + after[key]) ||
		reasons.some(
			(key) =>
				snapshot.refusalReasons[key] !==
				init.refusalReasons[key] + after.refusalReasons[key],
		) ||
		reasons.some(
			(key) => key !== "nonLoopbackConnect" && init.refusalReasons[key] !== 0,
		)
	)
		return false;
	return true;
}

export async function launchFixtureBrowser(puppeteer, executablePath) {
	const profile = await mkdtemp(join(tmpdir(), "z8-performance-chrome-"));
	try {
		await mkdir(join(profile, "Default"));
		await writeFile(
			join(profile, "Default", "Preferences"),
			JSON.stringify(preferences),
		);
		const browser = await puppeteer.launch({
			executablePath,
			headless: true,
			userDataDir: profile,
			args: ["--disable-features=AutofillServerCommunication"],
		});
		browser.fixtureLaunchPolicy = {
			policy: fixtureBrowserPolicy,
			profileDirectorySha256: createHash("sha256").update(profile).digest("hex"),
			headless: true,
			preferences: structuredClone(preferences),
			arguments: browser
				.process()
				.spawnargs.slice(1)
				.filter(
					(argument) =>
						!argument.startsWith("--user-data-dir=") &&
						!argument.startsWith("--remote-debugging-port="),
				),
			browserVersion: await browser.version(),
		};
		const close = browser.close.bind(browser);
		browser.close = async () => {
			try {
				await close();
			} finally {
				await rm(profile, { recursive: true, force: true });
			}
		};
		return browser;
	} catch (error) {
		await rm(profile, { recursive: true, force: true });
		throw error;
	}
}

/** Run exactly once, before cookies, permissions or any app IO, on a newly created context. */
export async function initializeFixtureBrowserContext({ context, transport }) {
	if (
		context.browser().fixtureLaunchPolicy?.policy !== fixtureBrowserPolicy ||
		(await context.pages()).length !== 0 ||
		transport.snapshot().requests !== 0
	)
		throw Error("Browser initialization requires an empty fresh context.");
	const page = await context.newPage();
	if (page.url() !== "about:blank")
		throw Error("Browser initialization requires about:blank.");
	const started = performance.now();
	let quietSince = started,
		previous,
		evidence;
	do {
		const at = performance.now(),
			counts = transport.snapshot(),
			wire = transport.wire.state(at);
		const activity = JSON.stringify(counts);
		if (activity !== previous) {
			previous = activity;
			quietSince = at;
		}
		const pending = Object.values(wire.groups).reduce(
			(sum, group) => sum + group.pending,
			0,
		);
		evidence = {
			policy: fixtureBrowserPolicy,
			launch: structuredClone(context.browser().fixtureLaunchPolicy),
			emptyContext: page.url() === "about:blank",
			quietMs: 2000,
			capMs: 10000,
			quietObservedMs: at - quietSince,
			elapsedMs: at - started,
			pending,
			...counts,
			complete: false,
			capped: at - started >= 10000,
		};
		if (
			!evidence.emptyContext ||
			counts.requests !== 0 ||
			counts.responseBodyBytes !== 0 ||
			counts.upstreamFailures !== 0 ||
			counts.refusalReasons.unexpectedLoopback !== 0 ||
			counts.refusalReasons.nonLoopbackHttp !== 0 ||
			counts.refusalReasons.loopbackConnect !== 0 ||
			counts.refusalReasons.malformed !== 0
		)
			throw Error("Empty browser initialization performed unexpected IO.");
		if (!evidence.capped && pending === 0 && evidence.quietObservedMs >= 2000) {
			evidence.complete = true;
			break;
		}
		if (evidence.capped) break;
		await pause(50);
	} while (!evidence.complete && !evidence.capped);
	if (!evidence.complete)
		throw Error("Empty browser initialization did not settle.");
	transport.finishBrowserInitialization(evidence);
	return { page, browserInitialization: evidence };
}
