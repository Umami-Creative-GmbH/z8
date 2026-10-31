/** Only the fresh profile owned by this launch is configured; app network requests remain observable. */
import { mkdir, mkdtemp, rm, writeFile, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
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
export const targetedPrefetchProducerChain=Object.freeze({version:"16.4.3",files:Object.freeze([
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

/** One existing record unit per document. The32768-byte envelope also covers bounded
 * storage/JSON/CDP handoff views; it is usage within the unchanged parent quota. */
export function createTargetedPrefetchProfileJournal({profile, sourceEpoch, workerWitness=null, reserve, release, reserveRecords, releaseRecords}) {
	if (!knownTargetedPrefetchProfile(profile) || !/^[a-f0-9]{64}$/.test(sourceEpoch)) throw Error("Unqualified prefetch profile source epoch.");
	// Includes the fixed source capsule/three UTF16 script copies (<=16384 characters each),
	// public4 epoch inputs and journal/listener/worker controls. This is in the existing parent pool.
	if(reserve(131072)!==true)throw Error("Targeted-prefetch profile control budget unavailable.");
	const documents = new Map(), fields = ["calls", "selected", "passed", "unsupported", "overwritten", "errors", "restores"],documentBytes=32768;
	let errors = 0, overflow = 0, scopeClosed = false, active = null, disposed = false,closedSnapshot=null;
	const bad = () => { errors++; };
	const events=["installed","call","checkpoint","controller","pagehide","restore","overwrite"],states=["uncontrolled","activating","bound","invalid"];
	const receipt=value=>value&&value.installed===true&&fields.every(name=>Number.isSafeInteger(value[name])&&value[name]>=0&&value[name]<=1000000)&&value.calls===value.selected+value.passed&&events.includes(value.event)&&states.includes(value.controllerState);
	const merge=(row,value,sequence)=>{
		if(sequence<row.sequence){if(fields.some(name=>value[name]>row[name])||states.indexOf(value.controllerState)>states.indexOf(row.controllerState)){bad();return null;}return false;}
		if(sequence===row.sequence){if(fields.some(name=>value[name]!==row[name])||value.controllerState!==row.controllerState||value.event!==row.event){bad();return null;}return false;}
		if(fields.some(name=>value[name]<row[name])||states.indexOf(value.controllerState)<states.indexOf(row.controllerState)){bad();return null;}
		for(const name of fields)row[name]=value[name];row.controllerState=value.controllerState;row.event=value.event;row.sequence=sequence;row.terminalSealed=row.departed&&row.terminalSequence===sequence;return true;
	};
	const handoff=(value,currentNonce)=>{
		if(!value||Object.keys(value).length!==7||value.version!==1||value.sourceEpoch!==sourceEpoch||value.stage!=="terminal"||typeof value.intact!=="boolean"||value.nonce===currentNonce||!Number.isSafeInteger(value.sequence)||value.sequence<1||value.sequence>1000000||!receipt(value.receipt)||Object.keys(value.receipt).length!==10||!["pagehide","call","controller","overwrite"].includes(value.receipt.event)){bad();return;}
		const matches=[...documents.values()].filter(row=>row.nonce===value.nonce);if(matches.length!==1){bad();return;}
		const row=matches[0];if(value.sequence<=row.terminalSequence){bad();return;}
		if(row.departed&&row.terminalSealed)bad();
		if(merge(row,value.receipt,value.sequence)===null)return;
		if(!value.intact)bad();row.departed=value.intact;row.checkpoint=false;row.terminalSequence=value.sequence;row.terminalSealed=value.intact&&row.sequence===value.sequence;
	};
	const owner=Object.freeze({
		receive(id, payload) {
			if (scopeClosed) { bad(); return; }
			try {
				if (!Number.isSafeInteger(id) || id <= 0 || typeof payload !== "string" || Buffer.byteLength(payload) > 1024) { bad(); return; }
				const value = JSON.parse(payload);
				if (!receipt(value)||Object.keys(value).length!==15||value.sourceEpoch!==sourceEpoch||!/^[a-f0-9]{32}$/.test(value.documentNonce??"")||!Number.isSafeInteger(value.sequence)||value.sequence<1||value.sequence>1000000||!["none","empty","consumed","invalid","unavailable"].includes(value.handoffState)) { bad(); return; }
				if(["installed","restore","checkpoint"].includes(value.event)?value.handoffState==="none":value.handoffState!=="none"){bad();return;}
				let row = documents.get(id);
				if (!row) {
					if (value.event !== "installed" || documents.size >= 128 || [...documents.values()].some(prior=>prior.nonce===value.documentNonce)) { overflow++; return; }
					if (!reserveRecords(1)) { overflow++; return; }
					let granted = false; try { granted = reserve(documentBytes) === true; } finally { if (!granted) releaseRecords(1); }
					if (!granted) { overflow++; return; }
					try{
						row = { ordinal: documents.size + 1, ...Object.fromEntries(fields.map(name => [name, 0])), controllerState: "uncontrolled", departed: false, checkpoint: false,nonce:value.documentNonce,documentNonceSha256:createHash("sha256").update(value.documentNonce).digest("hex"),sequence:0,nativeSequence:0,terminalSequence:0,terminalSealed:false };
						documents.set(id, row);
					}catch(error){release(documentBytes);releaseRecords(1);throw error;}
				} else if(value.event==="installed"||row.nonce!==value.documentNonce){bad();return;}
				if(value.sequence<=row.nativeSequence){bad();return;}row.nativeSequence=value.sequence;
				if(row.departed&&row.terminalSealed&&value.sequence>row.sequence&&!(value.event==="restore"&&value.restores===row.restores+1&&value.handoffState==="consumed"))bad();
				if(value.handoffState==="consumed")handoff(value.handoff,value.documentNonce);
				else if(value.handoff!==null||["invalid","unavailable"].includes(value.handoffState))bad();
				if((value.event==="installed"||value.event==="restore")&&active!==null&&active!==id){const previous=documents.get(active);if(!previous?.departed||!previous.terminalSealed)bad();}
				if(value.event==="restore"&&value.sequence>row.sequence&&(!row.departed||!row.terminalSealed||value.restores!==row.restores+1||value.handoffState!=="consumed"))bad();
				if(merge(row,value,value.sequence)){
					if(value.event==="installed"||value.event==="restore"){row.departed=false;row.terminalSealed=false;active=id;}
					row.checkpoint=value.event==="checkpoint";
				}
			} catch { bad(); }
		},
		error: bad,
		errors() { return errors + overflow + (workerWitness?.snapshot().errors ?? 0) + [...documents.values()].reduce((sum, row) => sum + row.errors + row.unsupported + row.overwritten + Number(row.controllerState === "invalid"), 0); },
		boundary() { return documents.size + [...documents.values()].reduce((sum, row) => sum + row.restores, 0); },
		close() { scopeClosed = true; if (!documents.size || !documents.get(active)?.checkpoint || [...documents].some(([id, row]) => id !== active && (!row.departed||!row.terminalSealed))) bad(); },
		snapshot() {
			if(disposed)throw Error("Targeted-prefetch evidence has been released.");
			if(closedSnapshot)return closedSnapshot;
			const value={ profile: { ...profile }, sourceEpoch, installed: documents.size > 0, scopeClosed, errors, overflow,...(workerWitness?{workerVersion:workerWitness.snapshot()}:{}), documents: [...documents.values()].map(row => ({ordinal:row.ordinal,...Object.fromEntries(fields.map(name=>[name,row[name]])),controllerState:row.controllerState,departed:row.departed,checkpoint:row.checkpoint,documentNonceSha256:row.documentNonceSha256,sequence:row.sequence,terminalSequence:row.terminalSequence,terminalSealed:row.terminalSealed})) };
			if(scopeClosed){Object.freeze(value.profile);value.documents.forEach(Object.freeze);Object.freeze(value.documents);if(value.workerVersion)Object.freeze(value.workerVersion);closedSnapshot=Object.freeze(value);targetedPrefetchExports.set(closedSnapshot,owner);}
			return value;
		},
		dispose() { if (!disposed) { disposed = true; if(closedSnapshot)targetedPrefetchExports.delete(closedSnapshot);closedSnapshot=null;const count = documents.size; documents.clear();workerWitness?.dispose(); release(count * documentBytes + 131072); releaseRecords(count); } },
	});
	return owner;
}

export function completeTargetedPrefetchProfileEvidence(value, profile = targetedPrefetchProfile, {closed = true} = {}) {
	return knownTargetedPrefetchProfile(profile) && knownTargetedPrefetchProfile(value?.profile) &&
		/^[a-f0-9]{64}$/.test(value.sourceEpoch ?? "") && value.installed === true && value.scopeClosed === closed && value.errors === 0 && value.overflow === 0 &&
		Array.isArray(value.documents) && value.documents.length > 0 && value.documents.length <= 128 && value.documents.every((row, index) =>
			row.ordinal === index + 1 && typeof row.departed==="boolean" && typeof row.checkpoint==="boolean" && /^[a-f0-9]{64}$/.test(row.documentNonceSha256??"") && Number.isSafeInteger(row.sequence)&&row.sequence>0&&row.sequence<=1000000&&Number.isSafeInteger(row.terminalSequence)&&row.terminalSequence>=0&&row.terminalSequence<=row.sequence&&typeof row.terminalSealed==="boolean"&&(!row.departed||row.terminalSealed&&row.terminalSequence===row.sequence) && ["uncontrolled", "bound"].includes(row.controllerState) && ["unsupported", "overwritten", "errors"].every(name => row[name] === 0) &&
			["calls", "selected", "passed", "restores"].every(name => Number.isSafeInteger(row[name]) && row[name] >= 0 && row[name] <= 1000000) && row.calls === row.selected + row.passed) &&
		(!closed || value.documents.filter(row=>!row.departed).length===1 && value.documents.find(row=>!row.departed).checkpoint===true) &&
		(value.workerVersion===undefined || value.workerVersion.errors===0) && (!value.documents.some(row=>row.controllerState==="bound") || value.workerVersion?.complete===true);
}

/** Self-contained pre-bootstrap capsule. Source epoch is supplied only by the file-qualified installer. */
export function installTargetedPrefetchProfile(target, profile, sourceEpoch, expectedOrigin) {
	const key = "__z8TargetedPrefetchProfileV1", binding = "__z8TargetedPrefetchReceiptV1";
	const terminalKey="__z8_prefetch_terminal_v1",counterNames=["calls","selected","passed","unsupported","overwritten","errors","restores"];
	const own = (object, name) => { const d = Object.getOwnPropertyDescriptor(object, name); return d && Object.hasOwn(d, "value") ? d : null; };
	const plain = value => value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value));
	const NativeURL = URL, prototype = NativeURL.prototype, href = Object.getOwnPropertyDescriptor(prototype, "href").get;
	const counts = { calls: 0, selected: 0, passed: 0, unsupported: 0, overwritten: 0, errors: 0, restores: 0 };
	let installed = false, observedController = null, bound = null, currentFetch, wrapper, controllerState = "uncontrolled", hidden = false,documentNonce=null,sequence=0,lastTerminalText=null,readStorage,writeStorage,removeStorage;
	const terminalValid=value=>value&&Object.keys(value).length===7&&value.version===1&&/^[a-f0-9]{32}$/.test(value.nonce??"")&&value.sourceEpoch===sourceEpoch&&value.stage==="terminal"&&typeof value.intact==="boolean"&&Number.isSafeInteger(value.sequence)&&value.sequence>0&&value.sequence<=1000000&&value.receipt&&Object.keys(value.receipt).length===10&&value.receipt.installed===true&&counterNames.every(name=>Number.isSafeInteger(value.receipt[name])&&value.receipt[name]>=0&&value.receipt[name]<=1000000)&&value.receipt.calls===value.receipt.selected+value.receipt.passed&&["pagehide","call","controller","overwrite"].includes(value.receipt.event)&&["uncontrolled","activating","bound","invalid"].includes(value.receipt.controllerState);
	const consume=()=>{
		try{let raw=readStorage();removeStorage();
			const probe=JSON.stringify({version:1,nonce:documentNonce,stage:"probe"});writeStorage(probe);const roundtrip=readStorage()===probe;removeStorage();if(!roundtrip)throw 0;
			if(raw===null)return {state:"empty",value:null};
			if(typeof raw!=="string"||raw.length>512){counts.errors++;return {state:"invalid",value:null};}
			const value=JSON.parse(raw);raw=null;
			if(!terminalValid(value)||value.nonce===documentNonce){counts.errors++;return {state:"invalid",value:null};}
			return {state:"consumed",value};
		}catch{counts.errors++;return {state:"unavailable",value:null};}
	};
	const poison=()=>{counts.errors++;try{writeStorage('{"version":1,"stage":"poison"}');}catch{}};
	const prepareTerminal=()=>{
		try{
			let raw=readStorage();if(raw!==null&&(typeof raw!=="string"||raw.length>512||raw!==lastTerminalText||!terminalValid(JSON.parse(raw))))throw 0;raw=null;
			const entry=JSON.stringify({version:1,nonce:documentNonce,sourceEpoch,sequence,stage:"entry"});writeStorage(entry);
			const matched=intact();controller();
			return {entry,matched};
		}catch{poison();return null;}
	};
	const finishTerminal=(event,prepared)=>{
		try{
			if(readStorage()!==prepared.entry)throw 0;
			const matched=intact();controller();
			const value={version:1,nonce:documentNonce,sourceEpoch,sequence,stage:"terminal",intact:prepared.matched&&matched,receipt:{event,...counts,installed,controllerState}},text=JSON.stringify(value);
			if(text.length>512)throw 0;writeStorage(text);lastTerminalText=text;
		}catch{poison();}
	};
	const emit = event => {
		sequence++;const prior=["installed","restore","checkpoint"].includes(event)?consume():{state:"none",value:null};
		const prepared=hidden&&["pagehide","call","controller","overwrite"].includes(event)?prepareTerminal():null;
		try { target[binding](JSON.stringify({event,...counts,installed,controllerState,sourceEpoch,documentNonce,sequence,handoffState:prior.state,handoff:prior.value})); } catch { counts.errors++; }
		if(prepared)finishTerminal(event,prepared);
	};
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
	const intact = () => { const d = Object.getOwnPropertyDescriptor(target, "fetch"),matched=currentFetch===wrapper&&d?.get===getFetch&&d?.set===setFetch;if(!matched)bump("overwritten");return matched; };
	function getFetch() { return currentFetch; }
	function setFetch(value) { if (value !== wrapper) bump("overwritten"); currentFetch = value; emit("overwrite"); }
	try {
		if (target.window !== target || target.top !== target || target.document.readyState !== "loading" || new NativeURL(target.location.href).origin !== expectedOrigin || !/^[a-f0-9]{64}$/.test(sourceEpoch) || own(target, key) || profile?.protocol!=="targeted-prefetch-profile-v1" || profile?.profileId!=="same-origin-next-prefetch-no-cache-v1" || !/^[a-f0-9]{64}$/.test(profile.contractSha256)) return null;
		const descriptor = own(target, "fetch"), original = descriptor?.value;
		if (typeof original !== "function" || descriptor.configurable !== true || descriptor.writable !== true) return null;
		const storage=target.sessionStorage,storagePrototype=target.Storage?.prototype;
		const get=own(storagePrototype,"getItem")?.value,set=own(storagePrototype,"setItem")?.value,remove=own(storagePrototype,"removeItem")?.value;
		if(![get,set,remove].every(value=>typeof value==="function")||typeof target.crypto?.getRandomValues!=="function")return null;
		readStorage=()=>Reflect.apply(get,storage,[terminalKey]);writeStorage=value=>Reflect.apply(set,storage,[terminalKey,value]);removeStorage=()=>Reflect.apply(remove,storage,[terminalKey]);
		const random=new Uint8Array(16);target.crypto.getRandomValues(random);documentNonce=Array.from(random,value=>value.toString(16).padStart(2,"0")).join("");
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
		target.addEventListener("pagehide", () => { hidden = true; emit("pagehide"); });
		target.addEventListener("pageshow", event => { if (event.persisted) { if (!hidden) counts.errors++; hidden=false;bump("restores");intact();controller();emit("restore"); } hidden = false; });
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

// Admission only: the rotating Chrome event budget is not a whole-file hard cap.
const nativeConnectionLogAdmissionBytes = 16 * 1024 * 1024;
async function retainNativeConnectionLog(reference) {
	reference.bytes = null;
	reference.sha256 = null;
	try {
		const before = await lstat(reference.file);
		reference.bytes = before.size;
		if (!before.isFile() || before.isSymbolicLink()) { reference.reason = "unavailable"; return; }
		if (before.size > nativeConnectionLogAdmissionBytes) { reference.reason = "admission-exceeded"; return; }
		const hash = createHash("sha256");
		let bytes = 0;
		for await (const chunk of createReadStream(reference.file, { end: nativeConnectionLogAdmissionBytes })) {
			bytes += chunk.length;
			if (bytes > nativeConnectionLogAdmissionBytes) { reference.reason = "admission-exceeded"; return; }
			hash.update(chunk);
		}
		const after = await lstat(reference.file);
		if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) { reference.reason = "changed-during-read"; return; }
		reference.sha256 = hash.digest("hex");
		reference.reason = "retained-unparsed";
	} catch (error) {
		reference.reason = error?.code === "ENOENT" ? "missing" : "unavailable";
	}
}

export async function launchFixtureBrowser(puppeteer, executablePath) {
	const profile = await mkdtemp(join(tmpdir(), "z8-performance-chrome-"));
	try {
		const logDirectory = await mkdtemp(join(tmpdir(), "z8-performance-netlog-"));
		const nativeConnectionLog = { file: join(logDirectory, "netlog.json"), status: "UNKNOWN", reason: "recording", bytes: null, sha256: null };
		await mkdir(join(profile, "Default"));
		await writeFile(
			join(profile, "Default", "Preferences"),
			JSON.stringify(preferences),
		);
		const browser = await puppeteer.launch({
			executablePath,
			headless: true,
			userDataDir: profile,
			args: ["--disable-features=AutofillServerCommunication", "--net-log-capture-mode=Default", "--net-log-max-size-mb=8", `--log-net-log=${nativeConnectionLog.file}`],
		});
		const actualArguments = browser.process()?.spawnargs?.slice(1);
		const expectedLogArguments = ["--net-log-capture-mode=Default", "--net-log-max-size-mb=8", `--log-net-log=${nativeConnectionLog.file}`];
		if (!Array.isArray(actualArguments) || !expectedLogArguments.every(expected => {
			const key = expected.slice(0, expected.indexOf("="));
			const matches = actualArguments.filter(argument => typeof argument === "string" && (argument === key || argument.startsWith(`${key}=`)));
			return matches.length === 1 && matches[0] === expected;
		})) {
			try { await browser.close(); } finally { throw Error("Native connection log launch configuration mismatch."); }
		}
		browser.fixtureLaunchPolicy = {
			policy: fixtureBrowserPolicy,
			nativeConnectionLog,
			profileDirectorySha256: createHash("sha256").update(profile).digest("hex"),
			headless: true,
			preferences: structuredClone(preferences),
			arguments: browser
				.process()
				.spawnargs.slice(1)
				.filter(
					(argument) =>
						!argument.startsWith("--user-data-dir=") &&
						!argument.startsWith("--remote-debugging-port=") &&
						!argument.startsWith("--log-net-log="),
				),
			browserVersion: await browser.version(),
		};
		const close = browser.close.bind(browser);
		browser.close = async () => {
			try {
				await close();
			} finally {
				await retainNativeConnectionLog(nativeConnectionLog);
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
