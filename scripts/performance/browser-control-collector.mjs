/** Passive all-phase identity/body receipts. No app requests, payloads, URLs or header values are emitted. */
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
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
	knownTeamAnnualActionSource, teamAnnualModule, teamAnnualWorkers,
	openTeamAnnualProjection, takeTeamAnnualProjection, closeTeamAnnualProjection,
	teamAnnualGoldenReceipt,
	knownMixedDocumentJournal,
} from "./control-cancellation-evidence.mjs";
import { createProxyHeaderCensus, proxyHeaderPrefix } from "./proxy-header-census.mjs";
import { projectCachedCdpText } from "./cdp-cached-text-projection.mjs";
import { readLegacyClockReadinessSource } from "./legacy-clock-readiness.mjs";
import { parseInertDateRangeRequest } from "./inert-date-range-request.mjs";
import { temporaryValueObservation, knownTemporaryValueObservation, knownOriginalTeamSourceConfiguration, readOriginalTeamSourceQualification,
 readOriginalTeamOperatorQualification, createTeamSourceCutJournal, createTeamTemporaryValueStore, createTeamReplayDispatchJournal, teamReplayHeader, createOriginalTeamUIProducerCut,
 originalTeamSourceFacts, originalTeamOperatorSourceFacts, originalTeamUIProducerCutFacts, originalTeamUIProducerWorkerExtension, originalTeamRequestRouteFacts, knownOriginalTeamHeaderJoin, bindOriginalTeamRequestValue, originalTeamRequestAuthorityFacts, openOriginalTeamBodyInspection, closeOriginalTeamBodyInspection, originalTeamBodyObservation } from "./team-temporary-value-authority.mjs";

export const controlResponseHeader = "x-z8-fixture-response-id";
export const controlDocumentHeader = "x-z8-fixture-document-generation";
export const mixedBrowserWorkScope = "all-mixed-context-work-before-first-app-io-through-finite-settlement-v1";
const sha = (value) => createHash("sha256").update(mixedOwnedHashInput(value)).digest("hex");
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
const legacyClockBindings = new WeakMap();
const originalTeamBindings = new WeakMap(), originalTeamPlans = new WeakMap();
const annualTeamBindings = new WeakMap();
export function annualTeamActionAuthority(binding){try{return binding?.browserVerified===true && annualTeamBindings.get(binding)===binding.teamAnnualAction?structuredClone(binding.teamAnnualAction):null;}catch{return null;}}

/** One pre-armed response-object selection. No raw request/body/header values survive a callback. */
export function createTeamAnnualResponseSelection({contextId,origin,source,reserve,release,requestCount,packetFor,browserFor,contextFor,mainFrame,documentForSelection,documentReady}) {
	let handles=new WeakMap(),responses=new WeakMap(),responseIds=new Set(),responseCount=0,active=null,armed=false,consumed=false,closed=false,errors=0,overflow=0,retained=0,receipt=null,waiter=null;
	let diagnostic=null;
	const mark=stage=>{if(diagnostic && !Object.isFrozen(diagnostic))diagnostic.stage=stage;};
	const failure=site=>{if(diagnostic && !Object.isFrozen(diagnostic) && diagnostic.firstFailureSite===null){diagnostic.firstFailureSite=site;diagnostic.firstFailureStage=diagnostic.stage;}};
	const observed=(key,value)=>{if(diagnostic && !Object.isFrozen(diagnostic))diagnostic[key]=typeof value==="boolean" || Number.isFinite(value)?value:null;return value;};
	const technicalHash=value=>typeof value==="string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value)?sha(value):null;
	const charge=n=>{if(reserve(n)!==true){overflow++;return false;}retained+=n;return true;};
	const safeError=()=>Error("Annual team selected response is unavailable or unqualified.");
	const headerValue=(headers,name)=>{
		if(!headers || ![Object.prototype,null].includes(Object.getPrototypeOf(headers)))throw safeError();
		const keys=Reflect.ownKeys(headers),seen=new Set();let bytes=0,result;
		if(keys.length>256)throw safeError();
		for(const key of keys){const field=typeof key==="string"?Object.getOwnPropertyDescriptor(headers,key):null;if(!field || !Object.hasOwn(field,"value") || typeof field.value!=="string" || seen.has(key.toLowerCase()))throw safeError();seen.add(key.toLowerCase());bytes+=Buffer.byteLength(key)+Buffer.byteLength(field.value);if(bytes>65536)throw safeError();if(key.toLowerCase()===name)result=field.value;}
		return result;
	};
	const notify=()=>{
		if(!waiter)return;
		mark("notify-state");
		try{
			const {held,selected}=waiter,packet=packetFor(selected.proxyResponseId),browser=browserFor(selected.proxyResponseId);
			diagnostic.packetKnown=Boolean(packet);diagnostic.browserKnown=Boolean(browser);diagnostic.selectedBrowserIdSha256=technicalHash(browser?.requestId);diagnostic.packetOrdinal=Number.isSafeInteger(packet?.annualRequestOrdinal)?packet.annualRequestOrdinal:null;diagnostic.projectionKnown=packet?Boolean(packet.teamAnnualProjection):null;
			diagnostic.inspection=packet?.annualInspection?Object.freeze({...packet.annualInspection,actionHeaderMatches:packet.headerFieldSha256?.["next-action"]===source.actionHeaderSha256,urlMatches:packet.fullUrlSha256===held.urlSha256}):null;
			if(closed || errors || overflow || performance.now()>held.deadlineMs)throw safeError();
			mark("notify-wait");
			if(!packet || !browser || !packet.proxyInspectionSettled || !browser.loadingFinished && !browser.failed || browser.failed===true && browser.bodyReadSettled!==true)return;
			const selection={protocol:"actual-response-object-selection-v1",contextId,proxyResponseId:selected.proxyResponseId,status:selected.status,mainFrame:selected.mainFrame,fullUrlSha256:selected.fullUrlSha256,armFullUrlSha256:held.urlSha256,locale:"en",document:selected.document,selectedContentType:selected.contentType,requestBodySha256:selected.requestBodySha256,encodedBytes:selected.encodedBytes,requestOrdinalAtArm:held.requestOrdinal,startedAtMs:held.startedAtMs,deadlineMs:held.deadlineMs,selectedAtMs:selected.selectedAtMs,fulfilledAtMs:performance.now()};
			mark("notify-candidate");if(packet.annualRequestOrdinal<=held.requestOrdinal || packet.fullUrlSha256!==held.urlSha256 || browser.fullUrlSha256!==held.urlSha256 || !packet.teamAnnualProjection)throw safeError();
			// Precharge a bounded CORE copy before request/semantic receipts are projected or cloned.
			if(!charge(1048576))throw safeError();
			if(!charge(controlCancellationPolicy.decodedLimit))throw safeError();
			let result;
			try {mark("notify-document");if(observed("documentReady",documentReady?.())!==true)throw safeError();mark("notify-core");result=teamAnnualGoldenReceipt({browser,packet,projection:packet.teamAnnualProjection,source,context:contextFor(),selection,origin});diagnostic.coreReturned=Boolean(result);}
			finally{release(controlCancellationPolicy.decodedLimit);retained-=controlCancellationPolicy.decodedLimit;}
			if(result)mark("notify-copy");
			const serialized=result?JSON.stringify({...result,annualDiagnostic:diagnostic}):null;
			if(!serialized || Buffer.byteLength(serialized)*8+2048>1048576)throw safeError();
			const detached=JSON.parse(serialized),queue=[detached];
			detached.annualDiagnostic.stage="published";
			for(let index=0;index<queue.length;index++){const value=queue[index];if(value && typeof value==="object"){for(const child of Object.values(value))if(child && typeof child==="object")queue.push(child);Object.freeze(value);}}
			receipt=detached;diagnostic=receipt.annualDiagnostic;held.consumed=true;consumed=true;const pending=waiter;waiter=null;clearTimeout(pending.timer);pending.resolve(receipt);
		}catch{failure("notify");errors++;const pending=waiter;waiter=null;if(pending){clearTimeout(pending.timer);pending.reject(safeError());}}
	};
	return Object.freeze({
		arm(input){try{
			if(closed || active || !knownTeamAnnualActionSource(source,source?.compiledBuild,source?.compiledManifestSha256) || input?.path!=="/en/analytics/team-performance" || !Number.isFinite(input.timeoutMs) || input.timeoutMs<=0 || input.timeoutMs>90000 || !charge(32768))return null;
			const startedAtMs=performance.now(),handle=Object.freeze({protocol:"private-annual-team-selection-v1"});
			active={startedAtMs,deadlineMs:startedAtMs+input.timeoutMs,requestOrdinal:requestCount(),urlSha256:sha(new URL(input.path,origin).href),consumed:false};armed=true;handles.set(handle,active);
			diagnostic={protocol:"annual-team-read-diagnostic-v1",stage:"armed",firstFailureSite:null,firstFailureStage:null,armRequestOrdinal:Number.isSafeInteger(active.requestOrdinal)?active.requestOrdinal:null,candidateResponses:0,recordedResponses:0,readCalls:0,candidateProxyIdSha256:null,selectedProxyIdSha256:null,selectedBrowserIdSha256:null,handleKnown:null,responseKnown:null,status:null,redirects:null,frameMatches:null,requestBodyKnown:null,requestBodyBytes:null,documentKnown:null,packetKnown:null,browserKnown:null,packetOrdinal:null,projectionKnown:null,documentReady:null,coreReturned:null,inspection:null};return handle;
		}catch{errors++;return null;}},
		eligible(row){return !closed && active && !active.consumed && performance.now()<=active.deadlineMs && row.annualRequestOrdinal>active.requestOrdinal && row.fullUrlSha256===active.urlSha256 && row.action===true && row.headerFieldSha256?.["next-action"]===source.actionHeaderSha256;},
		inspectionActive(){return Boolean(active && !closed && !active.consumed);},
		inspectionDeadline(row){return active && !closed && !active.consumed && row.fullUrlSha256===active.urlSha256?active.deadlineMs:null;},
		response(response){
			if(!active || closed || active.consumed)return;
			let transient=false,headerReservation=false,documentReservation=false;
			try {
				mark("response-request");
				const request=response.request();if(request.method()!=="POST" || sha(request.url())!==active.urlSha256 || sha(response.url())!==active.urlSha256)return;
				if(!charge(262144))throw safeError();headerReservation=true;
				if(sha(headerValue(request.headers(),"next-action") ?? "")!==source.actionHeaderSha256)return;
				diagnostic.candidateResponses++;mark("response-identity");
				if(responses.has(response) || observed("redirects",request.redirectChain().length)!==0 || observed("frameMatches",request.frame()===mainFrame())!==true || observed("status",response.status())!==200)throw safeError();
				mark("response-headers");
				const responseHeaders=response.headers(),value=headerValue(responseHeaders,controlResponseHeader);
				const contentType=headerValue(responseHeaders,"content-type"),match=typeof contentType==="string"?/^text\/x-component(?:;\s*charset=(utf-8))?$/i.exec(contentType.trim()):null;
				if(!match)throw safeError();
				if(typeof value!=="string" || !/^[a-f0-9]{32}\.[1-9][0-9]{0,9}$/.test(value) || responseIds.has(value) || responseCount>=controlCancellationPolicy.recordLimit || performance.now()>active.deadlineMs)throw safeError();
				diagnostic.candidateProxyIdSha256=technicalHash(value);mark("response-body");
				if(!charge(2*controlCancellationPolicy.encodedLimit))throw safeError();transient=true;
				const body=request.postData(),length=typeof body==="string"?Buffer.byteLength(body):0;
				diagnostic.requestBodyKnown=typeof body==="string";diagnostic.requestBodyBytes=typeof body==="string"?length:null;
				if(!length || length>controlCancellationPolicy.encodedLimit || !charge(controlCancellationPolicy.decodedLimit))throw safeError();documentReservation=true;
				mark("response-document");
				const document=documentForSelection?.(),documentBytes=document?Buffer.byteLength(JSON.stringify(document))*8+2048:0;
				diagnostic.documentKnown=Boolean(document);
				if(!document || documentBytes>controlCancellationPolicy.decodedLimit || !knownMixedDocumentJournal(document.journal,document.document) || !charge(32768+documentBytes))throw safeError();
				responseIds.add(value);responseCount++;responses.set(response,Object.freeze({proxyResponseId:value,status:200,mainFrame:true,fullUrlSha256:sha(request.url()),requestBodySha256:sha(body),encodedBytes:length,document,contentType:{mime:"text/x-component",charset:match[1]?"utf-8":"absent"},selectedAtMs:performance.now()}));
				diagnostic.recordedResponses=responseCount;mark("response-recorded");
			}catch{failure("response");errors++;}finally{if(transient){release(2*controlCancellationPolicy.encodedLimit);retained-=2*controlCancellationPolicy.encodedLimit;}if(headerReservation){release(262144);retained-=262144;}if(documentReservation){release(controlCancellationPolicy.decodedLimit);retained-=controlCancellationPolicy.decodedLimit;}}
			notify();
		},
		read(handle,response){
			return new Promise((resolve,reject)=>{
				mark("read-guard");if(diagnostic && !Object.isFrozen(diagnostic))diagnostic.readCalls++;
				const held=handles.get(handle),selected=responses.get(response),remaining=held?.deadlineMs-performance.now();
				observed("handleKnown",Boolean(held && held===active));observed("responseKnown",Boolean(selected));
				if(diagnostic && !Object.isFrozen(diagnostic) && held===active && selected && diagnostic.selectedProxyIdSha256===null)diagnostic.selectedProxyIdSha256=technicalHash(selected.proxyResponseId);
				if(closed || !held || held!==active || held.consumed || !selected || waiter || errors || overflow || !(remaining>0)){failure("read");reject(safeError());return;}
				waiter={held,selected,resolve,reject,timer:setTimeout(()=>{if(waiter){mark("deadline");failure("deadline");const pending=waiter;waiter=null;errors++;pending.reject(safeError());}},remaining)};notify();
			});
		},
		notify,
		close(){if(closed)return;mark("close");if(waiter)failure("close");closed=true;notify();handles=new WeakMap();responses=new WeakMap();responseIds=new Set();active=null;const privateBytes=retained-(receipt?1048576:diagnostic?16384:0);if(privateBytes){release(privateBytes);retained-=privateBytes;}if(diagnostic)Object.freeze(diagnostic);},
		snapshot(){return {protocol:"annual-team-selection-observation-v1",contextId,closed,armed,consumed,errors,overflow,pending:Number(waiter!==null),retainedBytes:retained,receipt,diagnostic:closed || consumed?diagnostic:null};},
	});
}
/** Actual compiled registry read, not a copied phase's action identifier. */
async function readTeamAnnualActionSource(manifestPath,build,manifestSha256) {
	try {
		const file=resolve(dirname(manifestPath),"server/server-reference-manifest.json"),before=await stat(file,{bigint:true});
		if(!before.isFile() || before.size>BigInt(controlCancellationPolicy.encodedLimit))throw Error();
		const chunks=[];let length=0;
		for await(const chunk of createReadStream(file,{highWaterMark:65536})){length+=chunk.length;if(length>controlCancellationPolicy.encodedLimit)throw Error();chunks.push(chunk);}
		const after=await stat(file,{bigint:true});
		if(["dev","ino","size","mtimeNs"].some(key=>before[key]!==after[key]) || BigInt(length)!==after.size)throw Error();
		const bytes=Buffer.concat(chunks,length),registry=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
		const matches=Object.entries(registry.node ?? {}).filter(([id,value])=>/^[a-f0-9]{42}$/.test(id) && value?.filename===teamAnnualModule && value.exportedName==="getTeamPerformanceData");
		if(matches.length!==1 || JSON.stringify(Object.keys(matches[0][1].workers ?? {}).sort())!==JSON.stringify([...teamAnnualWorkers].sort()))throw Error();
		const facts=Object.freeze({protocol:"compiled-team-annual-action-v1",compiledBuild:build,compiledManifestSha256:manifestSha256,registrySha256:sha(bytes),actionHeaderSha256:sha(matches[0][0]),moduleSha256:sha(teamAnnualModule),workersSha256:sha(JSON.stringify(teamAnnualWorkers)),exportName:"getTeamPerformanceData"});
		if(!knownTeamAnnualActionSource(facts,build,manifestSha256))throw Error();
		return facts;
	}catch{throw Error("Compiled annual team action source is unavailable or differs.");}
}
/** Source facts are not capabilities: only the exact privately branded, browser-verified binding matches. */
export function legacyClockReadinessAuthority(binding,{origin,phase}={}) {
	const facts=binding && legacyClockBindings.get(binding);
	if(!facts)return null;
	try{if(binding.manifestVerified!==true || binding.browserVerified!==true || binding.compiledBuild!==facts.compiledBuild || binding.compiledManifestSha256!==facts.compiledManifestSha256 || phase!==facts.phase || sha(new URL(origin).origin)!==facts.originSha256)return null;return structuredClone(facts);}catch{return null;}
}
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
			enumerationBasis: "existing-puppeteer-target-manager", controllerObservation: "not-collected", errors, overflow, events: mixedOwnedRows(()=>events,row=>({...row})) }),
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
		const registrations = Array.isArray(raw.registrations) && raw.registrations.length <= 32 ? mixedOwnedArray(raw.registrations.length,()=>raw.registrations.map(registration => {
			const scope = url(registration?.scope);
			return { scopeKnown: Boolean(scope), scopeSha256: scope ? sha(scope.href) : null, ownedRootScope: scope ? scope.href === `${origin}/` : null,
				active: worker(registration?.active), waiting: worker(registration?.waiting), installing: worker(registration?.installing) };
		}),{bytesPerEntry:2048,records:raw.registrations.length}) : null;
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
	if (!knownTemporaryValueObservation(metadata.temporaryValueObservation) || !Object.hasOwn(metadata,"originalTeamSource") ||
		!knownOriginalTeamSourceConfiguration(metadata.originalTeamSource,plan.runtime.build,metadata.compiledManifestSha256))
		throw Error("Missing temporary-value observation condition or qualified Original configuration.");
	const teamAnnualAction=await readTeamAnnualActionSource(manifestPath,plan.runtime.build,metadata.compiledManifestSha256);
	const binding = Object.freeze({ ...metadata, compiledBuild: plan.runtime.build, manifestVerified: true, browserVerified: false,servingPublicSources,teamAnnualAction });
	annualTeamBindings.set(binding,teamAnnualAction);
	originalTeamPlans.set(binding, structuredClone(plan));
	if(metadata.originalTeamSource!==null) {
		if(plan.phase!=="baseline")throw Error("Original temporary source cannot qualify a release phase.");
		const config=metadata.originalTeamSource;
		const qualification=await readOriginalTeamSourceQualification({profileId:config.profileId,phase:config.phase,compiledManifestPath:manifestPath,buildRecordPath:config.buildRecordPath});
		originalTeamBindings.set(binding,qualification);
	}
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
	if(Object.hasOwn(metadata,"legacyClockReadiness"))legacyClockBindings.set(binding,await readLegacyClockReadinessSource({configuration:metadata.legacyClockReadiness,manifestPath,compiledBuild:plan.runtime.build,manifestSha256:sha(bytes),origin:plan.origin,phase:plan.phase}));
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
		if(annualTeamBindings.has(binding))annualTeamBindings.set(verified,annualTeamBindings.get(binding));
		if(requestShapeBindings.has(binding))requestShapeBindings.set(verified,requestShapeBindings.get(binding));
		if(legacyClockBindings.has(binding))legacyClockBindings.set(verified,legacyClockBindings.get(binding));
        if(originalTeamBindings.has(binding))originalTeamBindings.set(verified,originalTeamBindings.get(binding));
        if(originalTeamPlans.has(binding))originalTeamPlans.set(verified,originalTeamPlans.get(binding));
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
		const rows = mixedOwnedRows(()=>cookies,({ name, domain, path, value }) => [name, domain, path, value],{keys:["name","domain","path","value"]}).sort((a, b) => mixedOwnedJSONString(a).localeCompare(mixedOwnedJSONString(b)));
		if (new Set(rows.map((row) => JSON.stringify(row.slice(0, 3)))).size !== rows.length) return unknown();
		const bytes = mixedOwnedJSONString(rows);
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
		nextTemporaryReadOrdinal(){
   if(scopeClosed || progressReadIds.size>=controlCancellationPolicy.recordLimit){overflow++;return null;}
   for(let ordinal=controlCancellationPolicy.recordLimit;ordinal>=1;ordinal--)if(!progressReadIds.has(ordinal))return ordinal;
   overflow++;return null;
  },
  sourceState(){return {before:before?{...before}:unknown(),scopeClosed,observedSetCookieResponses:setCookies.size,unknownResponseHeaders,readErrors,pendingReads,observationErrors,overflow};},
  sourceHistoryWithinLimit(){return progressReadHistory.size<=128;},
  sourceSnapshot(){return progressReadHistory.size<=128?this.snapshot():null;},
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
				stablePrincipalClaim: false,progressReads:{protocol:"owned-read-only-principal-operations-v1",started:progressReadsStarted,finished:progressReadsFinished,pending:mixedOwnedRows(()=>progressReads.values(),({acknowledgmentOrdinal,kind})=>({acknowledgmentOrdinal,kind})).sort((a,b)=>a.acknowledgmentOrdinal-b.acknowledgmentOrdinal),records:mixedOwnedRows(()=>progressReadHistory.values(),row=>({...row})).sort((a,b)=>a.acknowledgmentOrdinal-b.acknowledgmentOrdinal)} };
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
        incomingTraceId: /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/.test(h.traceparent ?? "") ? h.traceparent.split("-")[1] : null,
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
function inspectCollectedFlightBody(row, bytes, compiledCachedNavigations, compiledBinding, inspectionFor,teamAnnualProjection=null) {
	const options=bodyInspectionOptions(row,compiledCachedNavigations,compiledBinding);
	if(teamAnnualProjection)options.teamAnnualProjection=teamAnnualProjection;
	let inspection=null;
	if(row.action===true) {
		inspection=inspectionFor?.(row,sha(bytes),bytes.length) ?? openOriginalTeamBodyInspection({bodySha256:sha(bytes),decodedBytes:bytes.length});
		options.temporaryValueInspection=inspection;
	}
	try { return inspectRequiredFlightBody(bytes,options); }
	finally { if(inspection) { closeOriginalTeamBodyInspection(inspection);row.temporaryValueObservation=originalTeamBodyObservation(inspection);inspectionFor?.observed?.(row,row.temporaryValueObservation); } }
}
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
	temporaryInspectionFor,
	temporaryRequestObserved,
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
	const rows = () => mixedOwnedArray(requests.size,()=>[...requests.values()]);
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
					assignBodyProof(row, inspectCollectedFlightBody(row,bytes,compiledCachedNavigations,compiledBinding,temporaryInspectionFor), "cdp-readback", row.bodyReadbackReceipt.bodySha256);
					row.bodyReadbackComplete = true;
				} catch {
					if (!row.streamReceipt?.captureComplete)
						row.bodyProof = { complete: false, reason: "cdp-body-unavailable" };
				} finally {
					row.bodyReadSettled=true;temporaryRequestObserved?.(row,"body-settled");
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
			assignBodyProof(row, inspectCollectedFlightBody(row,Buffer.concat(stream.chunks),compiledCachedNavigations,compiledBinding,temporaryInspectionFor), "passive-stream", row.streamReceipt.capturedBodySha256);
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
        temporaryRequestObserved?.(row,"extra");
	};
	const applyResponseExtra = (row, metadata) => {
		row.extraResponseVary = metadata.vary;
		if (row.status !== undefined)
			metadata = { ...metadata, status: row.status };
		Object.assign(row, metadata, { vary: row.initialResponseVary ?? metadata.vary });
        temporaryRequestObserved?.(row,"response");
	};
	let browserEventOrdinal=0,progressInput;
	const browserLedger=row=>({protocol:"cached-browser-data-ledger-v1",requestObserved:true,responseEvents:row.responseEvents,finishedEvents:row.finishedEvents,failedEvents:row.failedEvents,
		dataEvents:row.dataEvents,dataAfterTerminal:row.dataAfterTerminal,dataBeforeResponse:row.dataBeforeResponse,responseAfterTerminal:row.responseAfterTerminal,terminalBeforeResponse:row.terminalBeforeResponse,invalidData:row.observedDataLengthInvalid===true,observedDataLength:row.observedDataLength});
	const snapshot = ({progressOnly=false}={}) => {
		const failures = mixedOwnedArray(requests.size,()=>rows().filter((row) => row.failed)),
			responses = mixedOwnedArray(requests.size,()=>rows().filter((row) => row.loadingFinished));
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
		if(!progressOnly)for(const row of rows()) row.browserDataLedger=browserLedger(row);
		const sources = mixedOwnedArray(requests.size+proxy.rows.length,()=>[...rows().map((row) => ({ source: "browser", row })), ...proxy.rows.map((row) => ({ source: "proxy", row }))],{bytesPerEntry:512});
		const protocolErrorRecords = mixedOwnedArray(sources.length*2,()=>sources.flatMap(({ source, row }) => {
			const history = row.protocolErrorObservations ?? (hasProtocolError(row.bodyProof) ? [protocolErrorFact(row.bodyProof, "latest-proof",
				row.transportBodyReceipt?.bodySha256 ?? row.bodyReadbackReceipt?.bodySha256 ?? row.streamReceipt?.capturedBodySha256,row)] : []);
			const extraBytesPerRow=512+Buffer.byteLength(row.contextId??"")+Buffer.byteLength(row.requestId??row.id??"")+Buffer.byteLength(row.proxyResponseId??(source==="proxy"?row.id:"")??"");
			return mixedOwnedRows(()=>history,(fact) => ({ source, contextId: row.contextId, requestId: row.requestId ?? row.id,
				proxyResponseId: row.proxyResponseId ?? (source === "proxy" ? row.id : null), ...fact }),{extraBytesPerRow});
		}));
		const protocolErrorOverflow = sources.reduce((total, { row }) => total + (row.protocolErrorObservationOverflow ?? 0), 0);
		const protocolErrors={protocol:"positive-flight-error-observations-v1",contextId,installed:coverage.installed,scopeClosed:closed,
			observed:protocolErrorRecords.length,overflow:protocolErrorOverflow+Math.max(0,protocolErrorRecords.length-controlCancellationPolicy.recordLimit),records:mixedOwnedArray(Math.min(protocolErrorRecords.length,controlCancellationPolicy.recordLimit),()=>protocolErrorRecords.slice(0,controlCancellationPolicy.recordLimit))};
		const environment=environmentObservation(proxy),principal=principalEpoch.snapshot();
		const nativeContext={protocol:"qualified-known-extra-native-context-v1",contextId,originSha256:sha(origin),workerScriptSha256:sha(origin+"/sw.js"),rootScopeSha256:sha(origin+"/"),
			binding:compiledBinding ? Object.fromEntries(["policy","browserRevision","compiledBuild","compiledManifestSha256","compiledCachedNavigations","manifestVerified","browserVerified","nativePublicSources","temporaryValueObservation","originalTeamSource","teamAnnualAction","legacyClockReadiness","requestShapeDiagnostic"].filter(key=>Object.hasOwn(compiledBinding,key)).map(key=>[key,["legacyClockReadiness","requestShapeDiagnostic"].includes(key)?structuredClone(compiledBinding[key]):compiledBinding[key]])) : null,
			protocolSources:protocolSources ?? null,operatorFile:operatorFile ?? null,principalEpoch:principal,headerCensus:proxy.headerCensus ?? null,headerLifetime:proxy.headerLifetime ?? null,headerPrefix:proxy.headerPrefix ?? null,
			protocolErrors,environment};
		const data = { responses, proxy: proxy.rows, coverage, browserRevision,nativeContext };
		progressInput={...data,failures,browserEventOrdinal,nativeContext:{...nativeContext,headerPrefix:proxy.headerPrefix ?? null}};
		if(progressOnly)return progressInput;
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
			proxyInspectionJobs:proxy.inspectionJobs ?? null,
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
		progressInput({owner=null,documentJournal=null}={}){
			if(!owner){snapshot();return mixedNativeProgressInput(progressInput);}
			return owner.capture(()=>{const view=snapshot({progressOnly:true});progressInput=null;if(documentJournal)view.nativeContext.documentJournal=documentJournal();return mixedNativeProgressInput(view,{copy:false,browserLedger});});
		},
		annualContext(){snapshot();return progressInput.nativeContext;},
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
				frameId: event.frameId,
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
            temporaryRequestObserved?.(row,"request");
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
			temporaryRequestObserved?.(row,"response");
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
			temporaryRequestObserved?.(row,"terminal");
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

/** Observer-only event queue. Each actual token keeps its first deadline; it never waits or retries business work. */
export function createTeamSourceReadScheduler({ready,read,accept,reserve,release}) {
 const queue=[],records=[],seen=new Set();let closed=false,running=false,scheduled=false,errors=0,overflow=0,unavailable=0,eventOrdinal=0,eventRetainedBytes=0;
 const tokenKnown=token=>token && Object.keys(token).length===8 && ["contextId","documentRequestId","frameId","loaderId","executionContextUniqueId"].every(key=>typeof token[key]==="string" && /^[A-Za-z0-9:_.-]{1,256}$/.test(token[key])) && ["documentGeneration","executionEventOrdinal","documentEventOrdinal"].every(key=>Number.isSafeInteger(token[key]) && token[key]>=1 && token[key]<=10000);
 const retain=(record,reserved)=>{const charge=Buffer.byteLength(JSON.stringify(record))*8+2048;if(charge>reserved){overflow++;release(reserved);return false;}records.push(record);release(reserved-charge);return true;};
 const pump=()=>{if(closed || running || scheduled || queue.length===0)return;scheduled=true;queueMicrotask(async()=>{
  scheduled=false;if(closed || running || queue.length===0)return;
  const event=queue.shift();
  if(JSON.stringify(ready())!==JSON.stringify(event.token) || performance.now()>=event.deadlineMs){unavailable++;records.push({eventOrdinal:event.ordinal,sourceEvent:event.token,unavailable:"source-event-obsolete-or-expired",issuedCut:null});pump();return;}
  if(!reserve(controlCancellationPolicy.decodedLimit)){overflow++;records.push({eventOrdinal:event.ordinal,sourceEvent:event.token,unavailable:"source-read-reservation",issuedCut:null});pump();return;}
  running=true;
  try {
   const result=await read(event.token,event.deadlineMs),current=!closed && JSON.stringify(ready())===JSON.stringify(event.token);
   const record={eventOrdinal:event.ordinal,sourceEvent:event.token,eventObservedAtMs:event.observedAtMs,observerDeadlineMs:event.deadlineMs,...result.record,issuedCut:current?result.record.issuedCut:null};
   if(!current)unavailable++;if(result.failed===true)errors++;
   if(retain(record,controlCancellationPolicy.decodedLimit)) {
    if(current && result.cut && accept(result.cut)!==true){errors++;record.issuedCut=null;}
   }
  }catch{errors++;release(controlCancellationPolicy.decodedLimit);}
  finally{running=false;pump();}
 });};
 return Object.freeze({event(){
  if(closed){errors++;return false;}const token=ready();if(!token)return false;if(!tokenKnown(token)){errors++;return false;}
  if(!reserve(32768)){overflow++;return false;}const key=JSON.stringify(token);if(seen.has(key)){release(32768);return false;}
  if(seen.size>=controlCancellationPolicy.recordLimit || records.length+queue.length>=controlCancellationPolicy.recordLimit){overflow++;release(32768);return false;}
  eventRetainedBytes+=32768;
  const observedAtMs=performance.now();seen.add(key);queue.push({ordinal:++eventOrdinal,token:structuredClone(token),observedAtMs,deadlineMs:observedAtMs+10000});pump();return true;
 },close(){closed=true;if(running || queue.length)errors++;},status(){return {scopeClosed:closed,pending:Number(running)+queue.length,errors,overflow,unavailable,eventRetainedBytes};},snapshot(){return {protocol:"actual-team-source-read-journal-v1",scopeClosed:closed,pending:Number(running)+queue.length,errors,overflow,unavailable,eventRetainedBytes,records:structuredClone(records)};}});
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
	const qualification=originalTeamBindings.get(environmentBinding);
	let operatorQualification=null;
	let teamCut=null,teamScheduler;
	const currentTeamCut=()=>{
		const state=teamScheduler?.status();if(!teamCut || !state || state.scopeClosed || state.errors || state.overflow || !documentAcknowledgment)return null;
		if(!documentAcknowledgment.sourceReady())return null;
        const facts=originalTeamUIProducerCutFacts(teamCut),principal=principalEpoch.sourceState(),workers=workerObservation?.snapshot(),journal=documentAcknowledgment.sourceSnapshot();
        if(!facts || facts.documentJournalSha256!==sha(JSON.stringify(journal)) || !originalTeamUIProducerWorkerExtension(teamCut,workers) || principal.before?.sha256!==facts.principalSha256 ||
			!["observedSetCookieResponses","unknownResponseHeaders","readErrors","pendingReads","observationErrors","overflow"].every(key=>principal[key]===0))return null;
		return teamCut;
	};
	const scheduleTeamRead=()=>{if(knownTemporaryValueObservation(environmentBinding?.temporaryValueObservation))teamScheduler?.event();};
	const proxy = createProxyControlCollector({
		currentTeamCut,
		annualSource:annualTeamActionAuthority(environmentBinding),annualContext:()=>collector.annualContext(),mainFrame:()=>page.mainFrame(),annualDocument:()=>documentAcknowledgment?.selectedDocument() ?? null,annualDocumentReady:()=>Boolean(documentAcknowledgment?.sourceReady()),
	origin,
		protocolSources,
		contextId,
		compiledCachedNavigations,
		compiledBinding:environmentBinding,
	});
	const technicalOwner=captureContextFailures?createMixedTechnicalOwner({contextId,reserve:proxy.reserveTemporaryObservation,release:proxy.releaseTemporaryObservation,reserveRecords:proxy.reserveTemporaryRecords,releaseRecords:proxy.releaseTemporaryRecords}):null;
	if(!annualTeamActionAuthority(environmentBinding))throw Error("Annual team observer requires actual compiled and browser admission.");
	if(qualification) {
		// One canonical immutable operator graph, including at most128 route rows, in the same pool.
		const reserved=128*8192;
		if(!proxy.reserveTemporaryObservation(reserved))throw Error("Original team operator route observation unavailable.");
		try {
			operatorQualification=await readOriginalTeamOperatorQualification({qualification,operatorFile,protocolSources,plan:originalTeamPlans.get(environmentBinding)});
			if(!proxy.setTeamOperatorSource(originalTeamOperatorSourceFacts(operatorQualification)))throw Error();
		}catch{proxy.releaseTemporaryObservation(reserved);throw Error("Original team operator route observation unavailable.");}
	}
	teamScheduler=createTeamSourceReadScheduler({ready:()=>knownTemporaryValueObservation(environmentBinding?.temporaryValueObservation) && generation>=1?documentAcknowledgment?.sourceReady() ?? null:null,
		reserve:bytes=>proxy.reserveTemporaryObservation(bytes),release:bytes=>proxy.releaseTemporaryObservation(bytes),
		accept:cut=>{if(!proxy.issueTeamCut(cut))return false;teamCut=cut;return true;},
		read:async(token,deadlineMs)=>{
			const journal=documentAcknowledgment.sourceSnapshot();
			if(!journal || !principalEpoch.sourceHistoryWithinLimit())return {record:{unavailable:"source-journal-subset-limit",issuedCut:null},cut:null,failed:false};
			const checkpointOrdinal=principalEpoch.nextTemporaryReadOrdinal();
			if(checkpointOrdinal===null)return {record:{unavailable:"source-principal-record-limit",issuedCut:null},cut:null,failed:true};
			const ack=await documentAcknowledgment.read({checkpointOrdinal,deadlineMs,principalEpoch,sourceSubsetLimit:128,sourceEvent:token,readCookies:()=>context.cookies(),readSources:async()=>{const path=nativeManifestLocators.get(environmentBinding);return path?readNativePublicSources(path):null;}});
			const principal=principalEpoch.sourceSnapshot(),workers=workerObservation.snapshot();
			const cut=createOriginalTeamUIProducerCut({qualification,operatorQualification,acknowledgment:ack,principal,workers,binding:environmentBinding,documentJournal:documentAcknowledgment.sourceSnapshot()});
			return {record:{checkpointOrdinal,acknowledgment:ack,principal,workers,...(ack.sourceSuperseded===true?{unavailable:"source-event-superseded"}:{}),issuedCut:cut?originalTeamUIProducerCutFacts(cut):null},cut,failed:ack.timedOut!==false || ack.pendingOperations!==0 || ack.readErrors!==0};
		}});
	const transportErrors = transport.setControlCancellationObserver(proxy,{captureHeaderPrefixes:captureContextFailures || knownTemporaryValueObservation(environmentBinding?.temporaryValueObservation)});
	const proxyObservation = () => {
		const proof = proxy.snapshot();
		const cut=typeof transport.controlHeaderCut==="function"?transport.controlHeaderCut():null;
		const sourceRead=teamScheduler.status();
        return { ...proof, errors: proof.errors + transportErrors()+sourceRead.errors,overflow:proof.overflow+sourceRead.overflow,headerPrefix:cut?proxyHeaderPrefix(proof.headerCensus,cut):null,headerLifecycle:cut };
	};
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		browserRevision,
		compiledCachedNavigations,
		compiledBinding:environmentBinding,
		captureContextFailures,
		temporaryInspectionFor:proxy.temporaryInspectionFor,
	temporaryRequestObserved:proxy.observeTeamBrowserRequest,
		protocolSources,
		operatorFile,
		principalEpoch,
		environmentObservation: anchoredProxy => ({ protocol: "native-cache-environment-metadata-v1", contextId,
			servingPublicSources: environmentBinding?.servingPublicSources ?? null,
			nativeLaunchMetadata: environmentBinding?.nativeLaunchMetadata ?? null,
			workerTargets: workerObservation?.snapshot() ?? null,
            temporaryValueSourceReads:{...teamScheduler.snapshot(),operatorSource:originalTeamOperatorSourceFacts(operatorQualification),documentJournal:documentAcknowledgment?.snapshot() ?? null},
            temporaryValues:anchoredProxy.temporaryValues,
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
	if(captureContextFailures || knownTemporaryValueObservation(environmentBinding?.temporaryValueObservation))documentAcknowledgment=await createMixedDocumentAcknowledgment({session,contextId,origin,generation:()=>generation,onSourceEvent:scheduleTeamRead});
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
			proxy.beginTeamNavigation(method,args,generation);
			return Reflect.apply(original, this, args);
		};
	}
	collector.installed();
	const annualResponse=response=>proxy.observeAnnualResponse(response);
	page.on("response",annualResponse);
 const progress=captureContextFailures?createMixedProgressAcknowledgments({technicalOwner,input:()=>collector.progressInput({owner:technicalOwner,documentJournal:()=>documentAcknowledgment.snapshot()}),application:()=>transport.snapshot().applicationEvidence,
  acknowledge:options=>documentAcknowledgment.read({...options,technicalOwner,principalEpoch,readCookies:()=>context.cookies(),readSources:async()=>{const locator=environmentBinding && nativeManifestLocators.get(environmentBinding);return locator?await readNativePublicSources(locator):null;}})}):null;
	return {
		...collector,
		armAnnualTeam(input){return proxy.armAnnualTeam(input);},
		readAnnualTeam(handle,response){return proxy.readAnnualTeam(handle,response);},
        armTeamReplay(input){return proxy.armTeamReplay(input);},
        teamReplayHeaders(handle){return proxy.teamReplayHeaders(handle);},
        finishTeamReplay(handle,facts){return proxy.finishTeamReplay(handle,facts);},
  acknowledgeMixedProgress(options){if(!progress)throw Error("Mixed progress observation was not installed before app IO.");return progress.check(options);},
  confirmMixedProgress(token){if(!progress)throw Error("Mixed progress observation is unavailable.");return progress.confirm(token);},
  releaseMixedProgressSnapshot(){progress?.releaseSnapshot();},
  validateMixedProgress(verify){if(!technicalOwner)throw Error("Mixed validation owner is unavailable.");return technicalOwner.run(verify);},
  snapshot(){return {...collector.snapshot(),annualTeam:proxy.annualTeamSnapshot(),temporaryValueSourceReads:teamScheduler.snapshot(),...(progress?{mixedProgress:progress.snapshot(),mixedDocumentJournal:documentAcknowledgment.snapshot()}:{})};},
		async close({ deadlineMs } = {}) {
			try {
				await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "end", deadlineMs });
				endMetadata = await captureNativeEndMetadata({ page, binding: environmentBinding, origin, deadlineMs });
			}
			finally {
				let progressCloseError=null;try{progress?.close();}catch(error){progressCloseError=error;}
				teamScheduler.close();
                documentAcknowledgment?.close();
                proxy.closeTeamValues();
				page.off("response",annualResponse);
				workerObservation.close();
				collector.endScope();
				for (const [method, original] of originals) page[method] = original;
				await session.detach();
				if(progressCloseError)throw progressCloseError;
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
	currentTeamCut = () => null,
	operatorSource = null,
	annualSource = null, annualContext=()=>null, mainFrame=()=>null,annualDocument=()=>null,annualDocumentReady=()=>false,
}) {
	const requests = new Map();
	const headerCensus = createProxyHeaderCensus({contextId});
	let transportInstallation = null, transportClosure = null;
	let installed = false,
		retained = 0,
		errors = 0,
		overflow = 0,
		pendingBodies = 0;
	let annualInspectionRetainedBytes=0,temporaryObservationRecords=0;
	let navigationWindow=null,navigationWindowCharged=false,annualWindowGeneration=null,jobBytes=0,unresolvedJobs=0;
	const qualification=originalTeamBindings.get(compiledBinding),sourceFacts=originalTeamSourceFacts(qualification);
	const shapeConfiguration=requestShapeBindings.get(compiledBinding) ?? (sourceFacts?{protocol:"original-team-request-observation-v1",actionHeaderSha256:sourceFacts.actionHeaderSha256}:annualSource?{protocol:"annual-team-request-observation-v1",actionHeaderSha256:annualSource.actionHeaderSha256}:null),shapeRows=new Map();
	const reserveTeam=bytes=>{if(!Number.isSafeInteger(bytes)||bytes<0||retained+bytes>controlCancellationPolicy.retainedLimit)return false;retained+=bytes;return true;};
	const releaseTeam=bytes=>{if(!Number.isSafeInteger(bytes)||bytes<0||bytes>retained)throw Error("Temporary value reservation mismatch.");retained-=bytes;};
	const teamStore=createTeamTemporaryValueStore({contextId,reserve:reserveTeam,release:releaseTeam});
	const teamDispatch=knownTemporaryValueObservation(compiledBinding?.temporaryValueObservation)?createTeamReplayDispatchJournal({contextId,origin,reserve:reserveTeam,release:releaseTeam}):null;
	const sourceCuts=createTeamSourceCutJournal({contextId,reserve:reserveTeam});
    const requestHandles=new Map(),proxyCuts=new Map(),browserRows=new Map(),browserCuts=new WeakMap(),requestAuthorities=new Map(),bodyUses=new Map();
	const annual=annualSource?createTeamAnnualResponseSelection({contextId,origin,source:annualSource,reserve:reserveTeam,release:releaseTeam,requestCount:()=>requests.size,packetFor:id=>requests.get(id),browserFor:id=>browserRows.get(id),contextFor:annualContext,mainFrame,documentForSelection:annualDocument,documentReady:annualDocumentReady}):null;
	let teamClosed=false;
	const temporaryInspectionFor=(row,bodySha256,decodedBytes)=>{
		const id=row.id ?? row.proxyResponseId,packet=requests.get(id),browser=row.requestId?row:browserRows.get(id),handle=requestHandles.get(id);
		const inspection=packet?.annualInspection,observe=(stage,value)=>{if(inspection && !Object.isFrozen(inspection))inspection.authorityStage=stage;return value;};
		let authority=requestAuthorities.get(id) ?? null;
        if(packet && browser){browser.requestBodyFacts=packet.requestBodyFacts;browser.traceId=packet.traceId;}
		if(observe("uncached",!authority) && observe("packet",packet) && observe("browser",browser) && observe("handle",handle) && observe("header-snapshot",browser.requestHeaderSnapshotKnown===true) && observe("headers-ready",browser.requestHeadersKnown===true) && observe("header-join",knownOriginalTeamHeaderJoin(browser.initialHeaderIdentity,browser.extraHeaderIdentity,packet,packet.headerFieldSha256.cookie)) &&
			observe("header-hash",browser.requestHeadersSha256===packet.requestHeadersSha256) && observe("url-hash",browser.fullUrlSha256===packet.fullUrlSha256) && observe("document",browser.documentGeneration===packet.documentGeneration) &&
			observe("action",browser.action===true) && observe("redirect",browser.ambiguousRedirect===false) && observe("origin",browser.requestOriginSha256===packet.requestOriginSha256)) {
			// The new hash-only header/route receipts use the same pool, before copying either receipt.
			if(!observe("reservation",reserveTeam(32768))){overflow++;return openOriginalTeamBodyInspection({bodySha256,decodedBytes});}
			const headerReceipt=value=>Object.fromEntries(["requestHeaderSnapshotKnown","requestHeadersSha256","headerFieldSha256"].map(key=>[key,key==="headerFieldSha256"?{...value[key]}:value[key]]));
			const request={contextId,proxyResponseId:id,requestId:browser.requestId,traceId:packet.traceId,method:packet.method,fullUrlSha256:packet.fullUrlSha256,
				requestHeadersSha256:packet.requestHeadersSha256,requestOriginSha256:packet.requestOriginSha256,documentGeneration:packet.documentGeneration,frameId:browser.frameId,loaderId:browser.loaderId,
				actionHeaderSha256:packet.headerFieldSha256["next-action"],requestBodySha256:shapeRows.get(id)?.bodySha256,encodedBytes:shapeRows.get(id)?.bytes,actualEOF:shapeRows.get(id)?.requestEOF===true,
				replayHeaderSha256:packet.headerFieldSha256[teamReplayHeader] ?? null,cookieHeaderSha256:packet.headerFieldSha256.cookie,pageRoute:originalTeamRequestRouteFacts(operatorSource,browser),headerEvidence:{initial:headerReceipt(browser.initialHeaderIdentity),extra:headerReceipt(browser.extraHeaderIdentity)}};
			if(request.replayHeaderSha256!==null)teamDispatch?.browserRequest({proxyId:id,contextId,requestId:browser.requestId,method:browser.method,traceId:browser.incomingTraceId,
				urlSha256:browser.fullUrlSha256,actionHeaderSha256:browser.headerFieldSha256["next-action"],initialHeadersKnown:browser.initialHeaderIdentity?.requestHeaderSnapshotKnown===true,extraHeadersKnown:browser.extraHeaderIdentity?.requestHeaderSnapshotKnown===true,
				initialReplaySha256:browser.initialHeaderIdentity?.headerFieldSha256?.[teamReplayHeader],extraReplaySha256:browser.extraHeaderIdentity?.headerFieldSha256?.[teamReplayHeader],frameId:browser.frameId,loaderId:browser.loaderId,documentGeneration:browser.documentGeneration});
			authority=bindOriginalTeamRequestValue({qualification,store:teamStore,handle,request,proxyCut:proxyCuts.get(id),browserCut:browserCuts.get(browser),dispatchJournal:teamDispatch,wire:packet});
			observe(authority?"bound":"bind-rejected",authority);
			if(!authority)releaseTeam(32768);
			if(authority){requestAuthorities.set(id,authority);const facts=originalTeamRequestAuthorityFacts(authority);row.temporaryRequestAuthority=facts;packet.temporaryRequestAuthority=facts;browser.temporaryRequestAuthority=facts;}
		}else if(authority){observe("cached",authority);row.temporaryRequestAuthority=originalTeamRequestAuthorityFacts(authority);}
		return openOriginalTeamBodyInspection({bodySha256,decodedBytes,requestAuthority:authority});
	};
	const retireValue=id=>{
		const packet=requests.get(id),browser=browserRows.get(id),handle=requestHandles.get(id);
		if(!handle || !packet || !browser || packet.valueRetired || !packet.proxyInspectionSettled || browser.bodyReadSettled!==true || browser.stream && browser.stream.finalized!==true)return;
		packet.valueRetired=true;if(!teamStore.release(handle))errors++;
	};
	Object.defineProperty(temporaryInspectionFor,"observed",{value:(row,observation)=>{
		if(observation?.valueUsed!==true)return;
		const id=row.id ?? row.proxyResponseId,key=id+":"+observation.bodySha256,prior=bodyUses.get(key);
		const fact={proxyResponseId:id,bodySha256:observation.bodySha256,decodedBytes:observation.decodedBytes,bindingSha256:observation.bindingSha256};
		if(prior){if(JSON.stringify(prior)!==JSON.stringify(fact))errors++;return;}
		if(bodyUses.size>=controlCancellationPolicy.recordLimit || !reserveTeam(2048)){overflow++;return;}bodyUses.set(key,Object.freeze(fact));
	}});
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
		const bytes=row.retainedBytes;
		row.chunks = [];
		row.retainedBytes = 0;
		retained -= bytes;
	};

	const runInspection=row=>{const id=row.id;
		let inspection=null;
		try {
			if(annual?.inspectionActive()){
				if(reserveTeam(8192)){annualInspectionRetainedBytes+=8192;inspection=row.annualInspection={stage:"entered",skip:null,eligible:null,opened:null,proofComplete:null,proofReasonSha256:null,projection:null,outcome:null,eof:null,bytes:null,sha256:null,bounded:row.bounded===true,flight:row.flight===true,action:row.action===true,catchStage:null,prefix:null,form:null,length:null,tokenSha256:null,role:null,pathFailure:null,lookupAttempted:null,valueUsed:null,authorityStage:null};}
				else overflow++;
			}
			if ((!row.flight && !row.action) || row.bounded) {if(inspection)inspection.skip=row.bounded?"bounded":"not-flight-action";return;}
			if(inspection)inspection.stage="decode";
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
			if(inspection){inspection.eof=true;inspection.bytes=bytes.length;inspection.sha256=row.transportBodyReceipt.bodySha256;}
			try {
				row.transportBodyReceipt.cdpTextProjection = {available:true,...projectCachedCdpText(bytes)};
			} catch(error) {
				const reason=["unsupported-original-buffer","original-byte-limit","unsupported-bom-prefix","projected-byte-limit"].includes(error?.message) ? error.message : "projection-unavailable";
				row.transportBodyReceipt.cdpTextProjection = {available:false,reason};
			}
			let projection=null;
			if(inspection)inspection.stage="eligible";
			const eligible=annual?.eligible(row);if(inspection)inspection.eligible=eligible===true;
			if(eligible){
				// Scratch UTF-8 decoding plus scalar/hash receipt only; no second body pool.
				if(!reserveTeam(65536)){overflow++;throw Error("Annual projection reservation unavailable.");}
				if(inspection)inspection.stage="open";
				projection=openTeamAnnualProjection({bodySha256:row.transportBodyReceipt.bodySha256,decodedBytes:bytes.length});
				if(inspection)inspection.opened=Boolean(projection);
			}
			try {
				if(inspection)inspection.stage="inspect";
				assignBodyProof(row, inspectCollectedFlightBody(row,bytes,compiledCachedNavigations,compiledBinding,temporaryInspectionFor,projection), "proxy-natural-eof", row.transportBodyReceipt.bodySha256);
				if(inspection){
					const proof=row.bodyProof,reference=proof?.modelReference,prefix=reference?.prefix,role=reference?.semanticRole ?? proof?.semanticRole,observation=row.temporaryValueObservation;
					inspection.prefix=["plain","other",..."QWiKBDnShTL@FINuZwH-"].includes(prefix)?prefix:null;
					inspection.form=["outlined-path","typed-outlined-path","other"].includes(reference?.form)?reference.form:null;
					inspection.length=Number.isSafeInteger(reference?.length) && reference.length>=0 && reference.length<=controlCancellationPolicy.decodedLimit?reference.length:null;
					inspection.tokenSha256=/^[a-f0-9]{64}$/.test(reference?.tokenSha256 ?? "")?reference.tokenSha256:null;
					inspection.role=["root","required","transport","tree","data","tree-map","tree-map-model","tree-map-pair","output","cache-output","suspended-output","fallback-output","component-data","element-type","element-key","host-props","cache-host-props","fallback-host-props","suspense-props","suspended-host-props"].includes(role)?role:null;
					inspection.pathFailure=["depth-or-model-limit","unsupported-eager-reference","noncanonical-eager-reference","unsupported-eager-collection","missing-eager-model","eager-import-model","eager-cross-record-or-alias-cycle","eager-binary-or-text-value","malformed-eager-element","unsupported-reference-shape","unsupported-cross-record-cycle","outlined-reference-cycle","path-component-limit","path-alias-cycle","missing-path-model","path-import-model","unsupported-path-model-kind","path-promise-not-unwrapped","unsupported-path-temporary-value","non-object-projection","binary-or-text-projection","missing-element-own-property","removed-proto-property","unsupported-parent-prototype","missing-own-property","non-data-own-property","removed-undefined-property","unavailable-own-data"].includes(proof?.pathFailure)?proof.pathFailure:null;
					inspection.lookupAttempted=typeof observation?.lookupAttempted==="boolean"?observation.lookupAttempted:null;inspection.valueUsed=typeof observation?.valueUsed==="boolean"?observation.valueUsed:null;
				}
				if(inspection){inspection.proofComplete=row.bodyProof?.complete===true;inspection.proofReasonSha256=typeof row.bodyProof?.reason==="string"?sha(row.bodyProof.reason):null;inspection.stage="take";}
				if(projection)row.teamAnnualProjection=takeTeamAnnualProjection(projection,inspection);
				if(inspection)inspection.projection=Boolean(row.teamAnnualProjection);
			}finally{if(projection)closeTeamAnnualProjection(projection);}
		} catch {
			if(inspection)inspection.catchStage=inspection.stage;
			row.bodyProof = { complete: false, reason: "proxy-body-unavailable" };
		} finally {
			if(inspection){inspection.stage="settled";if(inspection.catchStage!==null){inspection.proofComplete=false;inspection.proofReasonSha256=sha("proxy-body-unavailable");}Object.freeze(inspection);}
			row.proxyInspectionSettled=true;retireValue(id);
			annual?.notify();
			release(row);
			pendingBodies--;
			if(row.inspectionJob)row.inspectionJob.state="settled";
		}
	};
	const disposeInspection=(row,reason)=>{
		const job=row.inspectionJob;if(!job || ["settled","closed-unresolved"].includes(job.state))return;
		const pending=["waiting","scheduled","running"].includes(job.state);
		if(row.inspectionTask){clearImmediate(row.inspectionTask);row.inspectionTask=null;}
		job.state="closed-unresolved";job.reason=reason;unresolvedJobs++;errors++;
		row.bodyProof={complete:false,reason:"proxy-inspection-unresolved"};row.proxyInspectionSettled=true;
		release(row);if(pending)pendingBodies--;retireValue(row.id);
	};
	const resumeInspection=row=>{
		const job=row?.inspectionJob;if(!job || ["scheduled","running","settled","closed-unresolved"].includes(job.state))return;
		if(teamClosed || performance.now()>job.deadlineMs){disposeInspection(row,teamClosed?"closed":"deadline");return;}
		if(!row.complete || row.canceled)return;
		const shape=shapeRows.get(row.id),browser=browserRows.get(row.id);
		if(shape && !shape.unavailable && (shape.terminal===null && !shape.requestEOF || shape.requestEOF && !row.requestParseSettled))return;
		if(!browser || browser.initialHeaderIdentity?.requestHeaderSnapshotKnown===true && browser.requestHeadersKnown!==true)return;
		job.state="scheduled";row.inspectionTask=setImmediate(()=>{
			row.inspectionTask=null;if(teamClosed || job.state!=="scheduled")return;
			if(performance.now()>job.deadlineMs){disposeInspection(row,"deadline");return;}
			job.state="running";job.parseCalls++;runInspection(row);
		});
	};
	const requestParseDone=id=>{const packet=requests.get(id);if(packet){packet.requestParseSettled=true;resumeInspection(packet);}};
	return {
		beginTeamNavigation(method,args,generation){
			if(!sourceFacts || teamClosed)return false;
			const options=method==="goto"?args[1]:args[0];
			if(!options || typeof options!=="object" || utilTypes.isProxy(options))return false;
			const field=Object.getOwnPropertyDescriptor(options,"timeout"),timeout=field && Object.hasOwn(field,"value")?field.value:null;
			if(!Number.isFinite(timeout) || timeout<=0 || timeout>90000 || !Number.isSafeInteger(generation) || generation<1)return false;
			if(!navigationWindowCharged){if(!reserveTeam(4096)){overflow++;return false;}navigationWindowCharged=true;}
			navigationWindow={kind:"navigation",deadlineMs:performance.now()+timeout,generation};return true;
		},
		armAnnualTeam(input){const handle=annual?.arm(input) ?? null;if(handle)annualWindowGeneration=navigationWindow?.generation ?? null;return handle;},
		observeAnnualResponse(response){annual?.response(response);},
		readAnnualTeam(handle,response){if(!annual)return Promise.reject(Error("Annual team observer is unavailable."));return annual.read(handle,response);},
		annualTeamSnapshot(){return annual?.snapshot() ?? null;},
		setTeamOperatorSource(source){try{if(installed || operatorSource!==null || !source || !Object.isFrozen(source) || source.protocol!=="closed-team-operator-source-v1"){errors++;return false;}operatorSource=source;return true;}catch{errors++;return false;}},
		issueTeamCut(cut){return sourceCuts.issued(cut)!==null;},
        reserveTemporaryObservation(bytes){return reserveTeam(bytes);},
        releaseTemporaryObservation(bytes){releaseTeam(bytes);},
        reserveTemporaryRecords(count){if(!Number.isSafeInteger(count)||count<0||requests.size+temporaryObservationRecords+count>controlCancellationPolicy.recordLimit)return false;temporaryObservationRecords+=count;return true;},
        releaseTemporaryRecords(count){if(!Number.isSafeInteger(count)||count<0||count>temporaryObservationRecords)throw Error("Temporary observation record reservation mismatch.");temporaryObservationRecords-=count;},
        armTeamReplay(input){return teamDispatch?.arm(input) ?? null;},
		teamReplayHeaders(handle){return teamDispatch?.headers(handle) ?? null;},
		finishTeamReplay(handle,facts){return teamDispatch?.finished(handle,facts) ?? false;},
		temporaryInspectionFor,
		observeTeamBrowserRequest(row,kind){
			if(kind==="body-settled")retireValue(row.proxyResponseId);
            if(kind==="request" && (sourceFacts && row.headerFieldSha256?.["next-action"]===sourceFacts.actionHeaderSha256 || row.headerFieldSha256?.[teamReplayHeader]))browserCuts.set(row,sourceCuts.capture("browser-request",row.requestId,currentTeamCut(),originalTeamRequestRouteFacts(operatorSource,row)));
			if(row.proxyResponseId){const prior=browserRows.get(row.proxyResponseId);if(prior && prior!==row){errors++;return;}browserRows.set(row.proxyResponseId,row);}
			if(row.proxyResponseId)resumeInspection(requests.get(row.proxyResponseId));
			annual?.notify();
		},
		closeTeamValues(){if(teamClosed)return;teamClosed=true;for(const row of requests.values())disposeInspection(row,"closed");annual?.close();teamDispatch?.close();sourceCuts.close();teamStore.close();},
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
			const observedTeamCut=currentTeamCut();
			headerCensus.accepted(id);
			if (
				requests.size+temporaryObservationRecords >= controlCancellationPolicy.recordLimit ||
				requests.has(id)
			) {
				if(shapeConfiguration && shapeRows.has(id) && method==="POST" && sha(lowerHeaders(headers)["next-action"] ?? "")===shapeConfiguration.actionHeaderSha256){shapeErrors++;shapeSelected++;shapeUnretainedSelections++;}
				overflow++;
				return;
			}
			const identity=controlRequestIdentity(contextId,url,method,headers);

            const replayNonce=lowerHeaders(headers)[teamReplayHeader];
            const ownedReplay=replayNonce!==undefined && teamDispatch?teamDispatch.proxyRequest({id,traceId,method,url,action:lowerHeaders(headers)["next-action"],nonce:replayNonce}):false;
            if(ownedReplay || sourceFacts && identity.headerFieldSha256["next-action"]===sourceFacts.actionHeaderSha256)proxyCuts.set(id,sourceCuts.capture("proxy-request",id,observedTeamCut));
			const urlFacts=routingURLFacts(url,compiledRoutingForBinding(compiledBinding),origin,"owned-proxy-request-url-no-follow",identity.requestKind==="route-tree" && identity.rsc && identity.prefetch);
			const scalarBytes=scalarFactBytes(urlFacts.fallback.scalarKeys);
			if(retained+scalarBytes>controlCancellationPolicy.retainedLimit){overflow++;urlFacts.fallback.scalarKeys={known:false,reason:"scalar-retention-limit"};}
			else retained+=scalarBytes;
			requests.set(id, {
				...identity,
				annualRequestOrdinal:requests.size+1,
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
			const routes=operatorSource?.pageRoutes,routeMatches=routes?.protocol==="source-qualified-team-page-routes-v1" && routes.originSha256===sha(origin) && identity.requestOriginSha256===routes.originSha256 && Array.isArray(routes.destinations) && routes.destinations.length<=128?routes.destinations.filter(route=>route.fullUrlSha256===identity.fullUrlSha256 && identity.headerFieldSha256["accept-language"]===sha(route.locale)).length:0;
			if(sourceFacts && observedTeamCut && proxyCuts.get(id) && method==="POST" && routeMatches===1 && identity.headerFieldSha256["next-action"]===sourceFacts.actionHeaderSha256){
				const manual=ownedReplay?teamDispatch?.inspectionDeadline(id):null,annualDeadline=replayNonce===undefined && identity.documentGeneration===contextId+":"+annualWindowGeneration?annual?.inspectionDeadline(identity):null;
				const window=ownedReplay?{kind:"manual",deadlineMs:manual}:replayNonce!==undefined?null:Number.isFinite(annualDeadline)?{kind:"annual",deadlineMs:annualDeadline}:navigationWindow && contextId+":"+navigationWindow.generation===identity.documentGeneration?navigationWindow:null;
				if(window && Number.isFinite(window.deadlineMs) && window.deadlineMs>performance.now()){
					if(reserveTeam(8192)){jobBytes+=8192;requests.get(id).inspectionJob={state:"accepted",kind:window.kind,deadlineMs:window.deadlineMs,parseCalls:0,reason:null};}
					else overflow++;
				}
			}
			if(method==="POST" && new URL(url).origin===origin && (ownedReplay || shapeConfiguration && identity.headerFieldSha256["next-action"]===shapeConfiguration.actionHeaderSha256)){
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
			if(row.unavailable){row.shape={known:false,jsonParsed:false,reason:"request-unavailable"};shapeRelease(row);requestParseDone(id);return;}
			row.bodySha256=row.hash.digest("hex");
            const packet=requests.get(id);if(packet)packet.requestBodyFacts=Object.freeze({protocol:"owned-proxy-request-eof-v1",proxyResponseId:id,actualEOF:true,encodedBytes:row.bytes,bodySha256:row.bodySha256});
			if(row.contentType!=="text/plain" || row.charset!=="utf-8" || row.contentEncoding!=="identity"){
				row.shape={known:false,jsonParsed:false,reason:"unsupported-request-encoding"};shapeRelease(row);requestParseDone(id);return;
			}
			if(!shapeReserve(row,requestShapeLimits.parseReservation)){row.bodySha256=null;row.shape={known:false,jsonParsed:false,reason:"request-parse-reservation"};shapeRelease(row);requestParseDone(id);return;}
			shapePendingParses++;
			setImmediate(()=>{try{
				const bytes=row.buffer.subarray(0,row.bytes);row.shape=inspectRequestShape(bytes);
				if(sourceFacts && requests.get(id)?.headerFieldSha256?.["next-action"]===sourceFacts.actionHeaderSha256) {
					const descriptor=parseInertDateRangeRequest(bytes);row.inertRequestFacts=descriptor;
					if(descriptor.known===true){const handle=teamStore.retain({id,descriptor});if(handle)requestHandles.set(id,handle);}
				}
				if(requests.get(id)?.headerFieldSha256?.[teamReplayHeader]!==null)teamDispatch?.requestEOF(id,{encodedBytes:row.bytes,bodySha256:row.bodySha256});
			}catch{shapeErrors++;row.shape={known:false,jsonParsed:false,reason:"request-shape-unavailable"};}
				finally{shapeRelease(row);shapePendingParses--;requestParseDone(id);}});
		},
		requestBodyFailure(id,kind){
			const row=shapeRows.get(id);if(!row || !["error","aborted","close"].includes(kind)){shapeErrors++;return;}
			if(kind==="close" && row.requestEOF)return;
			shapeErrors++;
			if(!row.requestEOF && row.terminal===null){row.terminal=kind;row.unavailable=true;row.shape={known:false,jsonParsed:false,reason:"request-incomplete"};shapeRelease(row);requestParseDone(id);}
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
			if(row.inspectionJob?.state==="closed-unresolved")return;
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
			const row=requests.get(id);if(!row || row.canceled || row.complete)return;
			if(row.inspectionJob?.state==="closed-unresolved"){row.complete=true;return;}
			row.complete=true;pendingBodies++;
			// Forwarded EOF is never held; only the existing single observer inspection may await exact metadata.
			if(row.inspectionJob){row.inspectionJob.state="waiting";resumeInspection(row);}
			else setImmediate(()=>runInspection(row));
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
                temporaryValues:{condition:temporaryValueObservation,store:teamStore.snapshot(),manualDispatch:teamDispatch?.snapshot() ?? null,sourceCuts:sourceCuts.snapshot(),bodyUses:{protocol:"actual-body-value-observations-v1",contextId,observed:bodyUses.size,records:[...bodyUses.values()]}},
				...(shapeConfiguration?{requestShapeDiagnostics:shapeSnapshot()}:{}),
				headerCensus:headerCensus.snapshot(),
				annualInspectionRetainedBytes,
				inspectionJobs:{protocol:"event-bound-original-team-inspections-v1",closed:teamClosed,retainedBytes:jobBytes,navigationWindowRetainedBytes:navigationWindowCharged?4096:0,unresolved:unresolvedJobs,waiting:[...requests.values()].filter(row=>["waiting","scheduled","running"].includes(row.inspectionJob?.state)).length},
				headerLifetime:{protocol:"owned-context-upstream-header-lifetime-v1",contextId,installation:transportInstallation,closure:transportClosure},
				errors,
				overflow,
				pendingBodies,
				rows: mixedOwnedRows(()=>requests.values(),
					({ chunks, retainedBytes, encoding, inspectionTask, inspectionJob, ...proof }) => ({ ...proof,...(inspectionJob?{inspectionJob:Object.freeze({...inspectionJob})}:{}) }),{omit:["chunks","retainedBytes","encoding","inspectionTask"]},
				),
			};
		},
	};
}

const progressTechnicalId=value=>typeof value==="string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
/** Mixed only: actual public CDP identities, never private Puppeteer fields or temporal joins. */
export async function createMixedDocumentAcknowledgment({session,contextId,origin,generation,onSourceEvent}) {
 const contexts=new Map(),contextDocuments=new Map(),documents=[],executionEvents=[];let executionEventOrdinal=0,documentEventOrdinal=0,errors=0,overflow=0,closed=false,installed=false;
 const listeners=new Map();
 const on=(name,read)=>{const listener=value=>{if(closed){errors++;return;}try{read(value);}catch{errors++;}};session.on(name,listener);listeners.set(name,listener);};
 on("Runtime.executionContextCreated",({context})=>{executionEventOrdinal++;if(!Number.isSafeInteger(context?.id) || !progressTechnicalId(context.uniqueId) || typeof context.auxData?.isDefault!=="boolean" || !progressTechnicalId(context.auxData.frameId)){errors++;return;}if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit || contexts.has(context.id)){overflow++;return;}contexts.set(context.id,{id:context.id,uniqueId:context.uniqueId,frameId:context.auxData.frameId,isDefault:context.auxData.isDefault});contextDocuments.set(context.id,documentEventOrdinal);executionEvents.push({ordinal:executionEventOrdinal,event:"created",executionContextId:context.id,uniqueId:context.uniqueId,frameId:context.auxData.frameId,isDefault:context.auxData.isDefault});onSourceEvent?.();});
 on("Runtime.executionContextDestroyed",event=>{executionEventOrdinal++;if(!contexts.delete(event.executionContextId))errors++;if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit){overflow++;return;}executionEvents.push({ordinal:executionEventOrdinal,event:"destroyed",executionContextId:event.executionContextId});onSourceEvent?.();});
 on("Runtime.executionContextsCleared",()=>{executionEventOrdinal++;contexts.clear();if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit){overflow++;return;}executionEvents.push({ordinal:executionEventOrdinal,event:"cleared"});onSourceEvent?.();});
 on("Network.requestWillBeSent",event=>{
  if(event.type!=="Document")return;documentEventOrdinal++;
  if(documents.length+executionEvents.length>=controlCancellationPolicy.recordLimit){overflow++;return;}
  const identity=controlRequestIdentity(contextId,event.request?.url,event.request?.method ?? "GET",event.request?.headers);
  documents.push({ordinal:documentEventOrdinal,requestId:event.requestId,frameId:event.frameId,loaderId:event.loaderId,originSha256:identity.requestOriginSha256,documentGeneration:identity.documentGeneration});onSourceEvent?.();
 });
 try{await session.send("Runtime.enable");installed=true;}catch{errors++;}
 const frame=async(readScope=null)=>{
  const value=(await session.send("Page.getFrameTree"))?.frameTree?.frame;
  const construct=()=>{
  if(!progressTechnicalId(value?.id) || !progressTechnicalId(value.loaderId) || new URL(value.url).origin!==origin)throw Error("Missing owned document frame.");
  const matching=mixedOwnedArray(contexts.size,()=>[...contexts.values()].filter(row=>row.isDefault && row.frameId===value.id),{bytesPerEntry:16});
  const docs=mixedOwnedArray(documents.length,()=>documents.filter(row=>row.frameId===value.id && row.loaderId===value.loaderId && row.originSha256===sha(origin)));
  const number=generation();
  if(matching.length!==1 || docs.length!==1 || !Number.isSafeInteger(number) || number<1 || docs[0].documentGeneration!==contextId+":"+number)throw Error("Missing actual document/context/generation join.");
  return {frameId:value.id,loaderId:value.loaderId,executionContextUniqueId:matching[0].uniqueId,executionContextId:matching[0].id,documentRequestId:docs[0].requestId,documentGeneration:number};
  };return readScope?readScope.keep(construct):construct();
 };
 const snapshot=()=>structuredClone({protocol:"actual-cdp-document-journal-v1",contextId,installed,currentGeneration:generation(),executionEventOrdinal,documentEventOrdinal,errors,overflow,closed,executionEvents,documents});
 const sourceReady=()=>{
   if(closed || errors || overflow || generation()<1 || documents.length+executionEvents.length>128)return null;
   const docs=documents.filter(row=>row.documentGeneration===contextId+":"+generation());if(docs.length!==1)return null;const doc=docs[0];
   const defaults=[...contexts.values()].filter(row=>row.isDefault && row.frameId===doc.frameId && contextDocuments.get(row.id)===doc.ordinal);if(defaults.length!==1)return null;
   return {contextId,documentRequestId:doc.requestId,frameId:doc.frameId,loaderId:doc.loaderId,executionContextUniqueId:defaults[0].uniqueId,documentGeneration:generation(),executionEventOrdinal,documentEventOrdinal};
  };
 return {
  snapshot,
  sourceSnapshot(){return documents.length+executionEvents.length<=128?snapshot():null;},
  sourceReady,
  selectedDocument(){
   const token=sourceReady();if(!token)return null;
   const execution=[...contexts.values()].filter(row=>row.uniqueId===token.executionContextUniqueId);if(execution.length!==1)return null;
   const document={...token,executionContextId:execution[0].id,originSha256:sha(origin),executionEventOrdinalAfter:token.executionEventOrdinal,documentEventOrdinalAfter:token.documentEventOrdinal};
   const journal=snapshot();return knownMixedDocumentJournal(journal,document)?{document,journal}:null;
  },
  close(){closed=true;for(const [name,listener]of listeners)session.off(name,listener);},
  async read({checkpointOrdinal,deadlineMs,principalEpoch,readCookies,readSources,sourceSubsetLimit,sourceEvent,technicalOwner=null}){
   const startedAtMs=performance.now(),deadlineBudgetMs=deadlineMs-startedAtMs;
   let pendingOperations=0,readErrors=0,document=null,controller=null,principalRead=null,principalReadOperation=null,publicSourceRecheck=null,timer,readReturned=false;
   const readScope=technicalOwner?.openRead(),run=construct=>readScope?readScope.run(construct):construct(),keepRead=construct=>readScope?readScope.keep(construct):construct();
   try{
   const sourceMode=sourceSubsetLimit===128 && sourceEvent!==undefined,supersession=Symbol();let sourceSuperseded=false,sourceReadStage="not-started";
   // Only successful IO followed by an actual journal revision can produce this private sentinel.
   const checkSourceEvent=stage=>{
    if(!sourceMode)return;
    sourceReadStage=stage;
    if(closed || errors || overflow || documents.length+executionEvents.length>128)throw Error("Source journal is unavailable.");
    if(sourceEvent.executionEventOrdinal!==executionEventOrdinal || sourceEvent.documentEventOrdinal!==documentEventOrdinal)throw supersession;
    if(JSON.stringify(sourceReady())!==JSON.stringify(sourceEvent))throw Error("Source document identity is unavailable.");
   };
   const resultValue=()=>{const finishedAtMs=performance.now();return structuredClone({protocol:"native-environment-progress-readonly-v1",contextId,checkpointOrdinal,startedAtMs,finishedAtMs,deadlineMs,deadlineBudgetMs,elapsedMs:finishedAtMs-startedAtMs,timedOut:pendingOperations>0 || finishedAtMs>deadlineMs,pendingOperations,readErrors,...(sourceMode?{sourceSuperseded,sourceReadStage}:{}),document:document && !sourceSuperseded?{...document,sourceJournal:sourceSubsetLimit===128?(documents.length+executionEvents.length<=128?snapshot():null):snapshot()}:null,sourceSubsetExceeded:sourceSubsetLimit===128 && documents.length+executionEvents.length>128,controller:sourceSuperseded?null:controller,principalRead,principalReadOperation,publicSourceRecheck});};
   const result=()=>{try{return technicalOwner?technicalOwner.retainReadResult(resultValue):resultValue();}finally{readReturned=true;if(pendingOperations===0)readScope?.finish();}};
   if(sourceSubsetLimit!==undefined && sourceSubsetLimit!==128 || sourceEvent!==undefined && (!sourceMode || JSON.stringify(sourceReady())!==JSON.stringify(sourceEvent)) || sourceSubsetLimit===128 && documents.length+executionEvents.length>128 || closed || errors || overflow || !Number.isFinite(deadlineBudgetMs) || deadlineBudgetMs<=0 || deadlineBudgetMs>10000 || !principalEpoch.progressStarted(checkpointOrdinal)){readErrors++;return result();}
   const track=task=>{pendingOperations++;return Promise.resolve().then(task).catch(error=>{if(sourceMode && error===supersession)sourceSuperseded=true;else readErrors++;}).finally(()=>{pendingOperations--;if(readReturned&&pendingOperations===0)readScope?.finish();});};
   const tasks=[track(async()=>{
    const executionBefore=executionEventOrdinal,documentBefore=documentEventOrdinal;
    const before=await frame(readScope);
    checkSourceEvent("after-first-frame");
    const evaluated=await session.send("Runtime.evaluate",{uniqueContextId:before.executionContextUniqueId,awaitPromise:true,returnByValue:true,expression:`(async()=>{const doc=globalThis.document,sw=globalThis.navigator?.serviceWorker;if(!doc||!sw||typeof sw.getRegistrations!=="function")return {available:false};const describe=w=>w===null?null:{scriptURL:w?.scriptURL,state:w?.state};const before=sw.controller,beforeMetadata=describe(before),registrations=await sw.getRegistrations(),after=sw.controller;return {available:true,secureContext:globalThis.isSecureContext===true,origin:globalThis.location?.origin,documentIdentityStable:doc===globalThis.document,controllerIdentityStable:before===after,controllerBefore:beforeMetadata,controllerAfter:describe(after),registrationCount:Array.isArray(registrations)?registrations.length:null,registrationOverflow:Array.isArray(registrations)?Math.max(0,registrations.length-32):null,registrations:Array.isArray(registrations)&&registrations.length<=32?registrations.map(r=>({scope:r.scope,active:describe(r.active),waiting:describe(r.waiting),installing:describe(r.installing)})):null};})()`});
    if(evaluated?.exceptionDetails || !evaluated?.result || !Object.hasOwn(evaluated.result,"value"))throw Error("Document read rejected.");
    const metadata=keepRead(()=>nativeControllerMetadata(evaluated.result.value,origin));
    if(sourceMode && (evaluated.result.value?.documentIdentityStable!==true || metadata.available!==true || typeof evaluated.result.value.secureContext!=="boolean" || metadata.originMatches!==true || metadata.controllerIdentityStable===null || !metadata.controllerBefore.known || !metadata.controllerAfter.known || metadata.registrationOverflow!==0 || metadata.registrationCount!==metadata.registrations?.length || !metadata.registrations.every(row=>row.scopeKnown && [row.active,row.waiting,row.installing].every(worker=>worker.known))))throw Error("Source document result is malformed.");
    const after=await frame(readScope);
    checkSourceEvent("after-document-read");
    if(run(()=>mixedOwnedJSONString(before)!==mixedOwnedJSONString(after) || executionBefore!==executionEventOrdinal || documentBefore!==documentEventOrdinal || errors || overflow || closed || evaluated.result.value?.documentIdentityStable!==true))throw Error("Document changed across acknowledgment.");
    controller=metadata;
    document=keepRead(()=>({protocol:"actual-cdp-document-acknowledgment-v1",contextId,...before,originSha256:sha(origin),actualDocumentIdentityStable:true,executionEventOrdinalBefore:executionBefore,executionEventOrdinalAfter:executionEventOrdinal,documentEventOrdinalBefore:documentBefore,documentEventOrdinalAfter:documentEventOrdinal}));
   }),track(async()=>{try{const cookies=await readCookies();keepRead(()=>{principalRead=principalEpoch.progressFinished(checkpointOrdinal,cookies);principalReadOperation=principalEpoch.progressOperation(checkpointOrdinal);return {principalRead,principalReadOperation};});}catch{principalEpoch.progressFailed(checkpointOrdinal);throw Error("Cookie read failed.");}}),track(async()=>{const value=await readSources();publicSourceRecheck=keepRead(()=>value);})];
   try{
    await Promise.race([Promise.all(tasks),new Promise(resolve=>{timer=setTimeout(resolve,deadlineBudgetMs);})]);clearTimeout(timer);
    if(pendingOperations===0 && readErrors===0 && document && performance.now()<deadlineMs){
     const seal=track(async()=>{const end=await frame(readScope);checkSourceEvent("after-return-frame");if(run(()=>mixedOwnedJSONString(end)!==mixedOwnedJSONString(Object.fromEntries(["frameId","loaderId","executionContextUniqueId","executionContextId","documentRequestId","documentGeneration"].map(key=>[key,document[key]]))) || document.executionEventOrdinalAfter!==executionEventOrdinal || document.documentEventOrdinalAfter!==documentEventOrdinal || closed || errors || overflow))throw Error("Document changed during other acknowledged reads.");});
     await Promise.race([seal,new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,deadlineMs-performance.now()));})]);
    }
   }finally{clearTimeout(timer);}
   return result();
   }finally{readReturned=true;if(pendingOperations===0)readScope?.finish();}
  },
 };
}

const progressApplicationKeys=["failures","serverErrors","unknown","httpErrors","overflows","decodeFailures","registryConflicts"];
const progressApplicationKnown=application=>progressApplicationKeys.every(key=>application?.[key]===0);
/** Independent acknowledgments at existing mixed stop guards. No mutex, retry, quiescence or business operation. */
export function createMixedProgressAcknowledgments({input,application,acknowledge,technicalOwner=null}) {
 const prefixes=[],checks=[],tokens=new Map(),activeChecks=new Set(),exportedSnapshots=new Set();let attempted=0,guardChecks=0,failed=0,overflow=0,authoritySha256=null,contextId=null,firstFailure=null,diagnosticAttempted=false,closed=false,closedSnapshot=null,released=false;
 const keep=construct=>technicalOwner?technicalOwner.retainEvidence(construct):construct();
 const drop=value=>technicalOwner?.releaseEvidence(value);
 const replaceCheck=(owned,update)=>{const previous=owned.check,index=checks.indexOf(previous);if(index<0)throw Error("Mixed guard lost its owned check.");const next=keep(()=>({...previous,...update()}));checks[index]=next;owned.check=next;drop(previous);return next;};
 // One failure-only fixed record shares the existing retention and record bounds.
 const diagnosticCharge=32768;
 const byteCount=()=>Buffer.byteLength(mixedOwnedJSONString(checks))+prefixes.reduce((sum,prefix)=>sum+Buffer.byteLength(mixedOwnedJSONString(prefix)),0)+(firstFailure?diagnosticCharge:0);
 const bytes=()=>technicalOwner?technicalOwner.run(byteCount):byteCount();
 const own=(value,key)=>value && typeof value==="object" && !utilTypes.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
 const count=value=>Number.isSafeInteger(value) && value>=0?value:null;
 const flag=value=>typeof value==="boolean"?value:null;
 const hashed=value=>typeof value==="string" && value.length<=4096?sha(value):null;
 const boundedRows=value=>!utilTypes.isProxy(value) && Array.isArray(value) && value.length<=controlCancellationPolicy.recordLimit?value:null;
 const failureDiagnostic=state=>{
  const cut=state.cut,failures=boundedRows(own(cut,"failures")),packets=boundedRows(own(cut,"proxy")),coverage=own(cut,"coverage"),principal=own(own(cut,"nativeContext"),"principalEpoch");
  let latest=null,latestOrdinal=0,latestCount=0,matching=null,matchingCount=null;
  const digest=createHash("sha256");
  if(failures)for(let i=0;i<failures.length;i++){const row=own(failures,String(i)),ordinal=count(own(row,"failedEventOrdinal"));digest.update(JSON.stringify([hashed(own(row,"requestId")),ordinal]));if(ordinal!==null && ordinal>latestOrdinal){latest=row;latestOrdinal=ordinal;latestCount=1;}else if(ordinal===latestOrdinal)latestCount++;}
  if(latestCount!==1)latest=null;
  const proxyId=own(latest,"proxyResponseId");
  if(latest && typeof proxyId==="string" && proxyId.length<=256 && packets){matchingCount=0;for(let i=0;i<packets.length;i++){const packet=own(packets,String(i));if(own(packet,"id")===proxyId){matchingCount++;matching=packet;}}if(matchingCount!==1)matching=null;}
  const proof=own(matching,"bodyProof"),latestProof=own(latest,"bodyProof");
  const row={protocol:"mixed-first-failure-diagnostic-v1",stage:state.stage,cutStage:state.cutStage,subreason:state.subreason,guardChecks,attempted,contextIdSha256:hashed(own(own(cut,"nativeContext"),"contextId")),
   predicates:state.predicates,candidate:state.candidateDiagnostic,application:Object.fromEntries(progressApplicationKeys.map(key=>[key,count(own(state.application,key))])),
   cut:cut?{browserEventOrdinal:count(own(cut,"browserEventOrdinal")),failureCount:failures?.length??null,responseCount:boundedRows(own(cut,"responses"))?.length??null,proxyCount:packets?.length??null,
    failureSetSha256:failures?digest.digest("hex"):null,latestFailureMatches:latestCount,
    coverage:{installed:flag(own(coverage,"installed")),scopeClosed:flag(own(coverage,"scopeClosed")),errors:count(own(coverage,"errors")),overflow:count(own(coverage,"overflow")),missing:count(own(coverage,"missing")),pendingBodies:count(own(coverage,"pendingBodies"))},
    principal:Object.fromEntries(["observedSetCookieResponses","unknownResponseHeaders","readErrors","observationErrors","overflow","pendingReads"].map(key=>[key,count(own(principal,key))])),
    latestFailure:latest?{requestIdSha256:hashed(own(latest,"requestId")),proxyResponseIdSha256:hashed(proxyId),failedEventOrdinal:count(own(latest,"failedEventOrdinal")),failedEvents:count(own(latest,"failedEvents")),status:count(own(latest,"status")),failed:flag(own(latest,"failed")),loadingFinished:flag(own(latest,"loadingFinished")),canceled:flag(own(latest,"canceled")),errorSha256:hashed(own(latest,"error")),bodyProofKnown:latestProof!==undefined,bodyProofComplete:flag(own(latestProof,"complete")),bodyProofReasonSha256:hashed(own(latestProof,"reason"))}:null,
    matchingPacket:{count:matchingCount,idSha256:hashed(own(matching,"id")),complete:flag(own(matching,"complete")),canceled:flag(own(matching,"canceled")),upstreamError:flag(own(matching,"upstreamError")),responseEvents:count(own(matching,"responseEvents")),bodyProofKnown:matching?proof!==undefined:null,bodyProofComplete:flag(own(proof,"complete")),bodyProofReasonSha256:hashed(own(proof,"reason"))}}:null};
  return row;
 };
 const diagnose=state=>{if(diagnosticAttempted)return;diagnosticAttempted=true;try{if(bytes()+diagnosticCharge>controlCancellationPolicy.retainedLimit || checks.length+prefixes.length>=controlCancellationPolicy.recordLimit){overflow++;return;}const row=keep(()=>failureDiagnostic(state));if(Buffer.byteLength(JSON.stringify(row))*8+2048>diagnosticCharge){drop(row);overflow++;return;}firstFailure=row;}catch{overflow++;}};
 const observation=stage=>({stage,subreason:"entry",cut:null,cutStage:null,application:null,candidateDiagnostic:null,ownedCuts:new Set(),ownedCandidates:new Set(),ownedAcknowledgments:new Set(),closeFailed:false,predicates:{applicationKnown:null,candidateKnown:null,authorityKnown:null,journalsKnown:null,protocolObservedZero:null,protocolOverflowZero:null,authorityMatches:null,returnJournalsKnown:null}});
 const disposeState=state=>{state.cut=null;state.beginResult=null;state.endResult=null;for(const cut of state.ownedCuts){state.ownedCuts.delete(cut);technicalOwner?.releaseCut(cut);}for(const candidate of state.ownedCandidates){state.ownedCandidates.delete(candidate);drop(candidate);}for(const ack of state.ownedAcknowledgments){state.ownedAcknowledgments.delete(ack);drop(ack);}};
 const seen=(state,key,value)=>{state.predicates[key]=Boolean(value);return value;};
 const live=state=>{
  if(closed)throw Error("Mixed progress observation is closed.");
  state.cut=null;state.cutStage=null;state.application=null;state.candidateDiagnostic=null;for(const key of Object.keys(state.predicates))state.predicates[key]=null;
  state.subreason="application";
  if(failed || overflow || !seen(state,"applicationKnown",progressApplicationKnown(state.application=application()))){state.subreason=failed?"previous-failure":overflow?"previous-overflow":"application";throw Error("Mixed required application observation is not clean.");}
  state.subreason="input";const cut=state.cut=input();if(technicalOwner)state.ownedCuts.add(cut);state.cutStage=state.stage;state.subreason="candidate-evaluation";const candidate=keep(()=>mixedNativePrefixCandidates(cut,record=>{state.candidateDiagnostic=record;}));if(technicalOwner&&candidate)state.ownedCandidates.add(candidate);state.predicates.candidateKnown=Boolean(candidate);
  state.subreason="authority-evaluation";const authority=mixedNativeAuthorityDigest(cut.nativeContext);state.predicates.authorityKnown=Boolean(authority);
  state.subreason="live-predicate";
  if(!seen(state,"journalsKnown",knownMixedOpenJournals(cut.nativeContext)) || !seen(state,"protocolObservedZero",cut.nativeContext?.protocolErrors?.observed===0) || !seen(state,"protocolOverflowZero",cut.nativeContext.protocolErrors.overflow===0) || !candidate || !authority || !seen(state,"authorityMatches",!(authoritySha256!==null && authoritySha256!==authority))){
   state.subreason=state.predicates.journalsKnown===false?"journals":state.predicates.protocolObservedZero===false?"protocol-observed":state.predicates.protocolOverflowZero===false?"protocol-overflow":!candidate?"candidate":!authority?"authority":"authority-changed";
   throw Error("Mixed browser observation lacks request-local evidence.");
  }
  authoritySha256=authority;contextId=cut.nativeContext.contextId;return {cut,candidate};
 };
 const retained=()=>{if(bytes()>controlCancellationPolicy.retainedLimit){overflow++;throw Error("Mixed prefix retention bound exceeded.");}};
 return {
  async check({operationDeadlineMs=null}={}){
   if(closed)throw Error("Mixed progress observation is closed.");
   const state=observation("check-live");
   activeChecks.add(state);
   try{
    state.beginResult=live(state);state.endResult=state.beginResult;
    state.stage="check-record-limit";state.subreason="record-limit";
    if(guardChecks>=controlCancellationPolicy.recordLimit){overflow++;throw Error("Mixed guard bound exceeded.");}
    const ordinal=++guardChecks;let receipt=null;
    if(state.beginResult.candidate.cores.length!==0){
     const checkpointOrdinal=++attempted;
     const observerDeadline=performance.now()+mixedNativeProgressPolicy.observerCeilingMs;
     const deadlineMs=operationDeadlineMs===null?observerDeadline:Math.min(observerDeadline,operationDeadlineMs);
     state.stage="acknowledge";state.subreason="acknowledge";const acknowledgment=await acknowledge({checkpointOrdinal,deadlineMs});if(technicalOwner)state.ownedAcknowledgments.add(acknowledgment);
     state.stage="ack-identity";state.subreason="ack-identity";
     if(acknowledgment?.checkpointOrdinal!==checkpointOrdinal || acknowledgment.deadlineMs!==deadlineMs)throw Error("Mixed acknowledgment used another read or deadline.");
     state.stage="check-after-ack-live";state.endResult=live(state);state.stage="create-prefix";state.subreason="prefix";receipt=keep(()=>createMixedNativePrefix({checkpointOrdinal,begin:state.beginResult.cut,end:state.endResult.cut,acknowledgment,headerPrefix:state.endResult.cut.nativeContext.headerPrefix,operationDeadlineMs,returnedAtMs:performance.now()}));prefixes.push(receipt);
    }
    const check=keep(()=>({ordinal,begin:mixedNativeProgressVector(state.beginResult.cut),returned:null,checkpointOrdinal:receipt?.checkpointOrdinal ?? null,prefixSha256:receipt?.prefixSha256 ?? null}));checks.push(check);state.stage="retain-check";state.subreason="retention";retained();
    state.stage="issue-token";state.subreason="token";const token=keep(()=>Object.freeze({ordinal,contextId,authoritySha256,failureIds:Object.freeze(progressFailureIdsForCollector(state.endResult.cut))}));const tokenBegin=technicalOwner?keep(()=>({nativeContext:state.beginResult.cut.nativeContext})):state.beginResult.cut;tokens.set(token,{check,begin:tokenBegin,receipt});return token;
   }catch(error){if(!state.closeFailed)failed++;diagnose(state);throw error;}
   finally{activeChecks.delete(state);disposeState(state);}
  },
  confirm(token){
   if(closed)throw Error("Mixed progress observation is closed.");
   const state=observation("confirm-live");
   try{
    const {cut,candidate}=live(state),owned=tokens.get(token);let check=owned?.check;
    state.stage="confirm-token";state.subreason="token-or-failure-ids";
    if(!check || check.returned!==null || token.contextId!==contextId || token.authoritySha256!==authoritySha256 || JSON.stringify(token.failureIds)!==JSON.stringify(candidate.failureIds))throw Error("New mixed failed request or wrong acknowledgment at return cut.");
    state.stage="confirm-journals";state.subreason="return-journals";
    if(!seen(state,"returnJournalsKnown",sameMixedReturnJournals(owned.begin.nativeContext,cut.nativeContext)))throw Error("Mixed current authority changed after acknowledgment.");
    if(owned.receipt){state.stage="seal-prefix";state.subreason="prefix";const initial=owned.receipt;const sealed=keep(()=>createMixedNativePrefix({checkpointOrdinal:initial.checkpointOrdinal,begin:initial.begin,end:cut,acknowledgment:initial.acknowledgment,headerPrefix:cut.nativeContext.headerPrefix,operationDeadlineMs:initial.operationDeadlineMs,returnedAtMs:performance.now()}));state.stage="confirm-deadline";state.subreason="deadline";if(performance.now()>initial.acknowledgment.deadlineMs)throw Error("Mixed acknowledgment deadline expired before return.");state.stage="confirm-prefix-index";state.subreason="prefix-index";const index=prefixes.findIndex(row=>row.checkpointOrdinal===initial.checkpointOrdinal);if(index<0)throw Error("Mixed acknowledgment lost its owned prefix.");prefixes[index]=sealed;owned.receipt=sealed;drop(initial);check=replaceCheck(owned,()=>({prefixSha256:sealed.prefixSha256}));}
    const principal=cut.nativeContext?.principalEpoch,census=cut.nativeContext?.headerCensus,errors=cut.nativeContext?.protocolErrors;
    state.stage="confirm-principal";state.subreason="principal-header-protocol";
    if(principal?.observedSetCookieResponses!==0 || principal.unknownResponseHeaders!==0 || principal.readErrors!==0 || principal.observationErrors!==0 || principal.overflow!==0 || errors?.observed!==0 || errors.overflow!==0 || !["unknownHeaders","setCookieResponses","setCookieLines","errors","duplicates","missing","late","overflow"].every(key=>census?.counts?.[key]===0))throw Error("A new principal/header/protocol error invalidated the mixed return cut.");
    check=replaceCheck(owned,()=>({returned:mixedNativeProgressVector(cut)}));tokens.delete(token);drop(token);drop(owned.begin);owned.begin=null;state.stage="retain-return";state.subreason="retention";retained();return true;
   }catch(error){failed++;diagnose(state);throw error;}
   finally{disposeState(state);}
  },
  snapshot(){if(released)throw Error("Mixed progress snapshot was released.");if(closedSnapshot)return closedSnapshot;const value=keep(snapshotValue);if(technicalOwner)exportedSnapshots.add(value);return value;},
  close(){
   if(closed)return;closed=true;for(const state of activeChecks){state.closeFailed=true;failed++;state.stage="close-pending";state.subreason="pending-acknowledgment";diagnose(state);disposeState(state);}
   if(tokens.size){failed++;const state=observation("close-token");state.subreason="unconsumed-token";diagnose(state);}
   let snapshotError=null;try{closedSnapshot=keep(snapshotValue);}catch(error){failed++;snapshotError=error;}
   for(const [token,owned]of tokens){tokens.delete(token);drop(token);drop(owned.begin);owned.begin=null;owned.receipt=null;}
   if(closedSnapshot){while(checks.length)drop(checks.pop());while(prefixes.length)drop(prefixes.pop());const diagnostic=firstFailure;firstFailure=null;drop(diagnostic);}
   if(snapshotError)throw snapshotError;
  },
  releaseSnapshot(value=null){
   if(value){if(exportedSnapshots.delete(value))drop(value);return;}
   released=true;const saved=closedSnapshot;closedSnapshot=null;drop(saved);for(const snapshot of exportedSnapshots){exportedSnapshots.delete(snapshot);drop(snapshot);}tokens.clear();checks.length=prefixes.length=0;firstFailure=null;technicalOwner?.close();
  },
 };
 function snapshotValue(){const value=structuredClone({protocol:"mixed-native-progress-observations-v1",candidateRepresentationProtocol:mixedNativeProgressPolicy.candidateRepresentationProtocol,contextId,authoritySha256,guardChecks,attempted,failed,overflow,retainedBytes:bytes(),checks:mixedOwnedArray(checks.length,()=>[...checks].sort((a,b)=>a.ordinal-b.ordinal),{bytesPerEntry:16}),prefixes:mixedOwnedArray(prefixes.length,()=>[...prefixes].sort((a,b)=>a.checkpointOrdinal-b.checkpointOrdinal),{bytesPerEntry:16}),...(firstFailure?{firstFailure}: {})});return technicalOwner?mixedOwnedFreeze(value):value;}
}
const progressFailureIdsForCollector=input=>mixedOwnedArray(input.failures.length,()=>input.failures.map(row=>row.requestId).sort(),{bytesPerEntry:16});
import {mixedOwnedClone as structuredClone,mixedOwnedRows,mixedOwnedArray,mixedOwnedJSONString,mixedOwnedUTF8,mixedOwnedHashInput,mixedOwnedFreeze,createMixedTechnicalOwner} from "./mixed-technical-gzip.mjs";
