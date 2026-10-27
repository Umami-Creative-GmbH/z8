/** Proofs are prospective; a canceled request is never a successful payload. */
import { createHash } from "node:crypto";
import { validateProxyHeaderCensus, validateProxyHeaderPrefix, validateProxyHeaderLifecycle } from "./proxy-header-census.mjs";
import {cachedCdpTextProjectionProtocol,cachedCdpTextSourceRevision,cachedCdpTextMappingSha256} from "./cdp-cached-text-projection.mjs";
export const controlCancellationPolicy = Object.freeze({
	version: 2,
	protocol: "positively-proven-protocol-controls-v2",
	encodedLimit: 4 * 1024 * 1024,
	decodedLimit: 8 * 1024 * 1024,
	retainedLimit: 32 * 1024 * 1024,
	recordLimit: 10000,
});
export const chromiumSWRRevision = "d0c02bfad08ec92a6ffcf989e53cd995e6381a4c";
export const controlIdentityHeaders = Object.freeze(["rsc","next-router-prefetch","next-router-segment-prefetch","next-router-state-tree","next-url","next-action","accept","accept-encoding","accept-language","cookie","authorization","x-z8-fixture-document-generation"]);
export const bodySha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const routePathSourceDigest = facts=>{
	try{const {scalarKeys,...source}=facts;const bytes=Buffer.from(JSON.stringify(source));return bytes.length<=controlCancellationPolicy.encodedLimit?bodySha256(bytes):null;}catch{return null;}
};
/** Immediate callback math; the returned certificate contains no pathname or scalar value. */
export function canonicalRouteScalarFacts(pathname){
	const unknown=reason=>({protocol:"canonical-route-scalar-facts-v1",known:false,reason,partCount:null,pathnameSha256:null,partsSha256:null,parts:[]});
	if(typeof pathname!=="string" || Buffer.byteLength(pathname)>controlCancellationPolicy.encodedLimit)return unknown("unsupported-path-input");
	const parts=pathname.split("/").filter(Boolean);if(parts.length>64)return unknown("bounded-path-part-count");
	try{const facts=parts.map((part,index)=>{const scalar=encodeURIComponent(decodeURIComponent(part));if(!part || !scalar)throw Error("Empty scalar");
		return {index,partPresent:true,canonicalizationKnown:true,partBytes:Buffer.byteLength(part),scalarBytes:Buffer.byteLength(scalar),scalarSha256:bodySha256(Buffer.from(scalar))};});
		return {protocol:"canonical-route-scalar-facts-v1",known:true,reason:null,partCount:parts.length,pathnameSha256:bodySha256(Buffer.from(pathname)),partsSha256:bodySha256(Buffer.from(JSON.stringify(facts))),parts:facts};
	}catch{return unknown("unsupported-scalar-canonicalization");}
}
const knownNullPathSource=(facts,binding)=>{
	try{const route=facts?.compiledRouting,rendered=facts?.rendered,keys=facts?.scalarKeys,url=facts?.url,empty=bodySha256(Buffer.alloc(0));
		if(facts?.protocol!=="rendered-path-source-facts-v1" || facts.sourceKnown!==true || facts.responseOrdinal!==1 || facts.responseStatusKnown!==true || facts.responseStatus!==200 || !digest(facts.observerSourceSha256) ||
			url?.known!==true || !["Network.responseReceived.url","owned-proxy-request-url-no-follow"].includes(url.provenance) || url.originMatches!==true || url.sha256!==binding.requestUrlSha256 || url.originSha256!==binding.requestOriginSha256 || !digest(url.sha256) || !digest(url.originSha256) || binding.ambiguousRedirect!==false ||
			route?.protocol!=="compiled-routing-source-facts-v1" || route.compiledManifestSha256!==binding.compiledManifestSha256 || route.basePathOwnKnown!==true || route.basePathEmpty!==true || route.basePathBytes!==0 || route.basePathSha256!==empty || route.outputKnown!==true ||
			!((route.outputFieldPresent===false && route.output==="absent") || (route.outputFieldPresent===true && route.output==="standalone")) ||
			facts.rewrite?.snapshotKnown!==true || ![facts.rewrite.path,facts.rewrite.query].every(row=>row?.known===true && row.present===false && row.bytes===null && row.sha256===null) ||
			rendered?.known!==true || rendered.reason!==null || !digest(rendered.pathnameSha256) || !Number.isSafeInteger(rendered.pathnameBytes) || rendered.pathnameBytes<=0 || rendered.searchBytes!==0 || rendered.searchSha256!==empty ||
			rendered.pathnameSource!==(url.provenance==="Network.responseReceived.url"?"response-url":"owned-proxy-request-url-no-follow") || rendered.searchSource!==rendered.pathnameSource ||
			keys?.protocol!=="canonical-route-scalar-facts-v1" || keys.known!==true || keys.reason!==null || keys.sourceSha256!==routePathSourceDigest(facts) || keys.pathnameSha256!==rendered.pathnameSha256 ||
			!Number.isSafeInteger(keys.partCount) || keys.partCount<=0 || keys.partCount>64 || keys.partCount!==rendered.partsCount || !Array.isArray(keys.parts) || keys.parts.length!==keys.partCount ||
			keys.parts.some((row,index)=>Object.keys(row).length!==6 || row.index!==index || row.partPresent!==true || row.canonicalizationKnown!==true || !Number.isSafeInteger(row.partBytes) || row.partBytes<=0 || row.partBytes>controlCancellationPolicy.encodedLimit || !Number.isSafeInteger(row.scalarBytes) || row.scalarBytes<=0 || row.scalarBytes>controlCancellationPolicy.encodedLimit || !digest(row.scalarSha256)) ||
			keys.partsSha256!==bodySha256(Buffer.from(JSON.stringify(keys.parts))))return false;
		return true;
	}catch{return false;}
};
const knownRouteReadiness=(readiness,binding,bodyHash,treeNodes,metadataPages)=>{
	try{if(readiness?.protocol!=="null-d-route-readiness-v1" || readiness.bodySha256!==bodyHash || !knownNullPathSource(readiness.pathSourceFacts,binding) || !Number.isSafeInteger(readiness.nullNodes) || readiness.nullNodes<=0 || readiness.metadataPages!==metadataPages ||
		!Array.isArray(readiness.nodes) || readiness.nodes.length!==treeNodes || readiness.nodes.length>4096 || readiness.walkSha256!==bodySha256(Buffer.from(JSON.stringify(readiness.nodes))))return false;
		let nullNodes=0,pages=0;const depth=[];const slots=new Map();
		for(let index=0;index<readiness.nodes.length;index++){
			const row=readiness.nodes[index],parent=readiness.nodes[row.parentOrdinal-1];
			if(row.ordinal!==index+1 || !digest(row.descriptorSha256) || !digest(row.segmentEncodingSha256) || !digest(row.slotEncodingSha256))return false;
			if(index===0){if(row.kind!=="root" || row.parentOrdinal!==0 || row.partIndex!==0 || row.nextIndex!==0 || row.scalar!==null)return false;depth.push(0);continue;}
			if(!parent || row.parentOrdinal>=row.ordinal || !Number.isSafeInteger(row.parentOrdinal) || row.parentOrdinal<=0 || row.partIndex!==parent.nextIndex ||
				!["static-visible","page","group","default","not-found","dynamic-concrete-d","dynamic-null-d"].includes(row.kind))return false;
			depth.push(depth[row.parentOrdinal-1]+1);if(depth[index]>64)return false;
			const visible=["static-visible","dynamic-concrete-d","dynamic-null-d"].includes(row.kind);
			if(row.nextIndex!==row.partIndex+(visible?1:0))return false;
			const seen=slots.get(row.parentOrdinal) ?? new Set();if(seen.has(row.slotEncodingSha256))return false;seen.add(row.slotEncodingSha256);slots.set(row.parentOrdinal,seen);
			if(row.kind==="page")pages++;
			if(row.kind==="dynamic-null-d"){
				const scalar=readiness.pathSourceFacts.scalarKeys.parts[row.partIndex];if(!scalar || row.scalar?.index!==row.partIndex || row.scalar.bytes!==scalar.scalarBytes || row.scalar.sha256!==scalar.scalarSha256)return false;nullNodes++;
			}else if(row.scalar!==null)return false;
		}
		return nullNodes===readiness.nullNodes && pages===metadataPages;
	}catch{return false;}
};
const binaryByteWidths = Object.freeze({ A: 1, O: 1, o: 1, b: 1, U: 1, S: 2, s: 2, L: 4, l: 4, G: 4, g: 8, M: 8, m: 8, V: 1 });
const canonicalFlightId = id => /^(0|[1-9a-f][a-f0-9]{0,12})$/.test(id) && Number.isSafeInteger(Number.parseInt(id,16));

export const nativePublicPaths = Object.freeze(["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"]);
const exactDataKeys = (value, keys) => value && [Object.prototype,null].includes(Object.getPrototypeOf(value)) &&
	Reflect.ownKeys(value).length === keys.length && keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key) ?? {},"value"));
/** Reviewed expected source inputs, never inferred from whichever files happen to be served. */
export function knownNativePublicSources(source, compiledBuild, compiledManifestSha256) {
	try {
		if (!exactDataKeys(source,["protocol","compiledBuild","compiledManifestSha256","files"]) || source.protocol !== "qualified-serving-worker-sources-v1" ||
			!/^[a-f0-9]{40}$/.test(compiledBuild ?? "") || !/^[a-f0-9]{64}$/.test(compiledManifestSha256 ?? "") ||
			source.compiledBuild !== compiledBuild || source.compiledManifestSha256 !== compiledManifestSha256 || !Array.isArray(source.files) || source.files.length !== 4) return false;
		for(let index=0;index<4;index++) {
			const descriptor=Object.getOwnPropertyDescriptor(source.files,String(index));
			if (!descriptor || !Object.hasOwn(descriptor,"value")) return false;
			const row=descriptor.value;
			if (!exactDataKeys(row,["file","bytes","sha256","gitBlob"]) || row.file !== nativePublicPaths[index] ||
				!Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > controlCancellationPolicy.encodedLimit ||
				!/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || !/^[a-f0-9]{40}$/.test(row.gitBlob ?? "")) return false;
		}
		return true;
	} catch {return false;}
}

export function knownBrowserControlMetadata(metadata) {
	return Boolean(metadata && JSON.stringify(metadata.policy) === JSON.stringify(controlCancellationPolicy) &&
		metadata.browserRevision === chromiumSWRRevision && typeof metadata.compiledCachedNavigations === "boolean" &&
		typeof metadata.compiledManifestSha256 === "string" && /^[a-f0-9]{64}$/.test(metadata.compiledManifestSha256) &&
		(!Object.hasOwn(metadata,"nativePublicSources") || knownNativePublicSources(metadata.nativePublicSources,metadata.nativePublicSources?.compiledBuild,metadata.compiledManifestSha256)));
}

export function matchingBrowserControlBinding(runtime, binding) {
	const expected = runtime?.browserControl;
	return knownBrowserControlMetadata(expected) && knownBrowserControlMetadata(binding) &&
		["browserRevision", "compiledCachedNavigations", "compiledManifestSha256"].every((key) => binding[key] === expected[key]) &&
		JSON.stringify(binding.nativePublicSources) === JSON.stringify(expected.nativePublicSources) &&
		(!expected.nativePublicSources || knownNativePublicSources(expected.nativePublicSources,runtime.build,expected.compiledManifestSha256)) &&
		(!binding.nativePublicSources || knownNativePublicSources(binding.nativePublicSources,binding.compiledBuild,binding.compiledManifestSha256)) &&
		binding.compiledBuild === runtime.build && binding.manifestVerified === true && binding.browserVerified === true;
}

export function inspectRequiredFlightBody(
	bytes, options = {},
) {
	return inspectFlightBody(bytes, options, { decoded: 0, rows: 0, models: 0 }, 0);
}

function inspectFlightBody(
	bytes,
	{
		action = false,
		cachedNavigations,
		segmentBinding,
		routeTreeBinding,
		requestKind = action ? "action" : "navigation",
	} = {}, budget, depth,
) {
	const modelBudgetAtStart = budget.models;
	// Observation only: retain fixed aggregates, never the RAM-only dependency keys.
	const costPhases=Object.fromEntries(["eager-parent","outlined-entry","path-alias","completed-parent","segment-tree","route-tree","semantic-loop"].map(site=>[site,{site,work:0,depthWork:Array(65).fill(0),unknownDepthWork:0}]));
	const candidateCosts=new Map(),costCandidates=[],dependencyObjects=new WeakMap(),dependencyOrdinals=new WeakMap(),dependencyOrigins=new Map();
	const dependencyCosts={calls:0,first:0,repeatedSameContext:0,repeatedDifferentContext:0,unknownContext:0,contexts:0,identityOverflow:0,contextOverflow:0,
		activeSameOwner:0,activeDifferentOwner:0,activeOwnerUnknown:0,parentCertificateUses:0,parentCertificateWithSeen:0,parentCertificateWithActive:0,parentCertificateWithoutSeenOrActive:0};
	let dependencyOrdinalCount=0,diagnosticContextCount=0,chargedWork=0;
	const diagnosticLanes={background:{identityLimit:2048,contextLimit:512,identities:0,contexts:0,identityMisses:0,contextMisses:0,crossLaneReuseLookups:0},anchor:{identityLimit:2048,contextLimit:512,identities:0,contexts:0,identityMisses:0,contextMisses:0,crossLaneReuseLookups:0}};
	const semanticValues=new WeakMap(),semanticBuckets=new Map();
	const semanticRoles=new Set(["root","required","transport","tree","data","tree-map","tree-map-model","tree-map-pair","output","cache-output","suspended-output","fallback-output","component-data","element-type","element-key","host-props","cache-host-props","fallback-host-props","suspense-props","suspended-host-props"]);
	const semanticArrivals=new Set(["root-or-required","collection-reference","model-reference","outlined-reference","element-type","element-key","element-props","element-field","typed-data-r","array-output","element-children","element-fallback","own-field"]);
	const semanticCounts={observations:0,contexts:0,first:0,repeatedExact:0,sameValueDifferentObligation:0,unknown:0,overflow:0,committedPopWork:0,committedScheduledChildren:0,selectedAnchorArrivals:0,sourceKnownAnchorArrivals:0,conservativeOutlinedPathDifferences:0};
	let semanticPhase="pre",semanticPreWork=0,semanticPostStart=0,semanticGuardOnlyWork=0,activeSemanticIteration=null;
	const reasonBits={seenId:1,seenContainer:2,activeAnchor:4,elementSkip:8,opaque:16,removedField:32,parentCertificate:64};
	const chargeModel=(site,atDepth=null)=>{const result=++budget.models,row=costPhases[site];chargedWork++;row.work++;if(Number.isInteger(atDepth)&&atDepth>=0&&atDepth<=64)row.depthWork[atDepth]++;else row.unknownDepthWork++;return result;};
	const diagnosticOrdinal=(value,lane)=>{
		if(typeof value!=="string" && (!value || typeof value!=="object"))return null;
		const table=typeof value==="string"?dependencyOrigins:dependencyOrdinals,allocation=diagnosticLanes[lane];
		if(table.has(value)){const stored=table.get(value);if(stored.lane!==lane)allocation.crossLaneReuseLookups++;return stored.ordinal;}
		if(allocation.identities>=allocation.identityLimit || dependencyOrdinalCount>=4096){allocation.identityMisses++;dependencyCosts.identityOverflow++;return null;}
		const ordinal=++dependencyOrdinalCount;allocation.identities++;table.set(value,{ordinal,lane});return ordinal;
	};
	const dependencyOrdinal=value=>diagnosticOrdinal(value,"background");
	const noteDependencyContext=(value,originId,forceElement,seen,atDepth)=>{
		dependencyCosts.calls++;
		if(seen.size>64 || activePaths.size>64 || parentCheckDepths.length>64){dependencyCosts.unknownContext++;return;}
		const valueIdentity=dependencyOrdinal(value),origin=originId===null?0:dependencyOrdinal(originId),seenIds=[...seen].map(dependencyOrdinal),pathIds=[...activePaths.values()].map(dependencyOrdinal),scopeIds=parentCheckDepths.map(dependencyOrdinal);
		if(valueIdentity===null || origin===null || [...seenIds,...pathIds,...scopeIds].includes(null)){dependencyCosts.unknownContext++;return;}
		const key=JSON.stringify([atDepth,seenIds.sort((a,b)=>a-b),pathIds,scopeIds]);
		let origins=dependencyObjects.get(value),forces=origins?.get(origin),contexts=forces?.get(forceElement===true);
		if(contexts?.has(key)){dependencyCosts.repeatedSameContext++;return;}
		if(contexts?.size)dependencyCosts.repeatedDifferentContext++;
		else dependencyCosts.first++;
		if(diagnosticLanes.background.contexts>=512 || diagnosticContextCount>=1024){diagnosticLanes.background.contextMisses++;dependencyCosts.contextOverflow++;dependencyCosts.unknownContext++;return;}
		if(!origins)dependencyObjects.set(value,origins=new Map());if(!forces)origins.set(origin,forces=new Map());if(!contexts)forces.set(forceElement===true,contexts=new Set());
		contexts.add(key);dependencyCosts.contexts++;diagnosticContextCount++;diagnosticLanes.background.contexts++;
	};
	const semanticKind=value=>value===null?"null":Array.isArray(value)?"array":typeof value==="object"?"object":typeof value!=="string"?typeof value:value.startsWith("$$")?"escaped-string":!value.startsWith("$")?"literal-string":plainPath.test(value)?"outlined-reference":/^\$L/.test(value)?"lazy-reference":/^\$@/.test(value)?"promise-reference":/^\$[QWi]/.test(value)?"collection-reference":"other-reference";
	const noteSemantic=(entry,queue,start)=>{
		const {value,role}=entry,kind=semanticKind(value),safeRole=semanticRoles.has(role)?role:"unknown",bucketKey=safeRole+"/"+kind;
		let bucket=semanticBuckets.get(bucketKey);if(!bucket)semanticBuckets.set(bucketKey,bucket={role:safeRole,kind,observations:0,work:0,scheduledChildren:0});
		bucket.observations++;semanticCounts.observations++;activeSemanticIteration={start,queue,queueAtPop:queue.length,bucketKey};
		if(!value || typeof value!=="object")return;
		const anchor=Object.hasOwn(entry,"outputArrival") && ["outlined-reference","model-reference","collection-reference"].includes(entry.outputArrival),lane=anchor?"anchor":"background",allocation=diagnosticLanes[lane];
		if(anchor)semanticCounts.selectedAnchorArrivals++;
		const origin=entry.observationOrigin,flags=[];
		let known=safeRole!=="unknown" && origin && typeof origin==="object";
		const reference=entry.observationReference;if(reference!==undefined && (typeof reference!=="string"||!reference.startsWith("$")))known=false;
		if(anchor && reference===undefined)known=false;
		for(const key of ["directEmbeddedOutput","fromTypedOutput","rArrayOutput","insideRArray"]){const present=Object.hasOwn(entry,key),flag=entry[key];flags.push([present,flag===undefined?0:flag===false?1:flag===true?2:3]);if(present && flag!==undefined && typeof flag!=="boolean")known=false;}
		const ancestry=entry.fallbackReferences,ancestryPresent=Object.hasOwn(entry,"fallbackReferences");
		if(ancestry!==undefined && (!(ancestry instanceof Set)||ancestry.size>64))known=false;
		const arrival=Object.hasOwn(entry,"outputArrival")?[true,entry.outputArrival??null]:[false,null],parentArrival=Object.hasOwn(entry,"outputParentArrival")?[true,entry.outputParentArrival??null]:[false,null];
		if([arrival,parentArrival].some(([present,item])=>present&&item!==null&&!semanticArrivals.has(item)))known=false;
		if(!known){semanticCounts.unknown++;return;}
		if(anchor)semanticCounts.sourceKnownAnchorArrivals++;
		const valueIdentity=diagnosticOrdinal(value,lane),originId=diagnosticOrdinal(origin,lane),referenceId=reference===undefined?0:diagnosticOrdinal(reference,lane),ancestorIds=ancestry===undefined?[]:[...ancestry].map(item=>diagnosticOrdinal(item,lane));
		if(valueIdentity===null || originId===null || referenceId===null || ancestorIds.includes(null)){semanticCounts.unknown++;return;}
		const form=reference===undefined?"none":plainPath.test(reference)?"outlined":"other";
		const tuple=[role,originId,origin.tag,origin.stream,Object.hasOwn(entry,"observationReference"),form,referenceId,flags,ancestryPresent,ancestry===undefined?0:1,ancestorIds.sort((a,b)=>a-b),arrival,parentArrival],key=JSON.stringify(tuple);
		let contexts=semanticValues.get(value);
		if(contexts?.has(key)){semanticCounts.repeatedExact++;return;}
		if(anchor && form==="outlined" && contexts?.size){
			// Compare only bounded numeric diagnostic tuples in existing slots, never body data.
			const projection=JSON.stringify(tuple.filter((_,index)=>index!==6));
			if([...contexts].some(stored=>{const previous=JSON.parse(stored);return previous[5]==="outlined" && previous[6]!==referenceId && JSON.stringify(previous.filter((_,index)=>index!==6))===projection;}))semanticCounts.conservativeOutlinedPathDifferences++;
		}
		if(contexts?.size)semanticCounts.sameValueDifferentObligation++;else semanticCounts.first++;
		if(allocation.contexts>=allocation.contextLimit || diagnosticContextCount>=1024){allocation.contextMisses++;semanticCounts.overflow++;semanticCounts.unknown++;return;}
		if(!contexts)semanticValues.set(value,contexts=new Set());contexts.add(key);semanticCounts.contexts++;diagnosticContextCount++;allocation.contexts++;
	};
	const finishSemantic=()=>{const active=activeSemanticIteration;if(!active)return;const work=chargedWork-active.start,children=active.queue.length-active.queueAtPop,bucket=semanticBuckets.get(active.bucketKey);bucket.work+=work;bucket.scheduledChildren+=children;semanticCounts.committedPopWork+=work;semanticCounts.committedScheduledChildren+=children;activeSemanticIteration=null;};
	const semanticSnapshot=()=>{
		const active=activeSemanticIteration,activePopWork=active?chargedWork-active.start:0,activeScheduledChildren=active?active.queue.length-active.queueAtPop:0;
		const preWork=semanticPhase==="pre"?chargedWork:semanticPreWork,postWork=semanticPhase==="post"?chargedWork-semanticPostStart:0;
		const buckets=[...semanticBuckets.entries()].map(([key,row])=>({...row,work:row.work+(active?.bucketKey===key?activePopWork:0),scheduledChildren:row.scheduledChildren+(active?.bucketKey===key?activeScheduledChildren:0)}));
		return {protocol:"bounded-semantic-obligation-observation-v1",...semanticCounts,preWork,activePopWork,activeScheduledChildren,guardOnlyWork:semanticGuardOnlyWork,postWork,
			accountedWork:preWork+semanticCounts.committedPopWork+activePopWork+semanticGuardOnlyWork+postWork,activeIteration:active!==null,buckets,
			truncated:semanticCounts.unknown>0||semanticCounts.overflow>0};
	};
	const recordCandidateCost=(candidate,ready,span)=>{
		let row=candidateCosts.get(candidate.reasonMask);if(!row)candidateCosts.set(candidate.reasonMask,row={reasonMask:candidate.reasonMask,count:0,ready:0,work:0,maxWork:0,maxSpan:0});
		const work=budget.models-candidate.start;row.count++;row.ready+=ready?1:0;row.work+=work;row.maxWork=Math.max(row.maxWork,work);row.maxSpan=Math.max(row.maxSpan,span);
	};
	const modelCostSnapshot=()=>({protocol:"bounded-model-cost-observation-v1",inspectionDepth:depth,chargedWork,sharedModelSteps:budget.models,localModelSteps:budget.models-modelBudgetAtStart,
		embeddedWork:budget.models-modelBudgetAtStart-chargedWork,phases:structuredClone(Object.values(costPhases)),dependencies:{...dependencyCosts},sharedDiagnosticContexts:diagnosticContextCount,sharedDiagnosticIdentities:dependencyOrdinalCount,diagnosticAllocation:{protocol:"fixed-reference-anchor-reservation-v1",...structuredClone(diagnosticLanes)},semanticObligations:semanticSnapshot(),
		candidates:structuredClone([...candidateCosts.values()].sort((a,b)=>a.reasonMask-b.reasonMask)),
		activeCandidates:costCandidates.map(candidate=>({reasonMask:candidate.reasonMask,work:budget.models-candidate.start,span:candidate.scope.maxDepth-candidate.depth})),
		truncated:dependencyCosts.identityOverflow>0 || dependencyCosts.contextOverflow>0 || dependencyCosts.unknownContext>0});
	const unknown = (reason, diagnostic = {}) => ({
		complete: false,
		reason,
		...diagnostic,
	});
	const segmentContract = requestKind === "segment-prefetch";
	const routeTreeContract = requestKind === "route-tree";
	const supportedContract = ["action", "navigation", "route-tree", "runtime-shell", "embedded-runtime-prefetch", "segment-prefetch"].includes(requestKind) &&
		(requestKind !== "embedded-runtime-prefetch" || depth === 1) && action === (requestKind === "action");
	if (
		!Buffer.isBuffer(bytes) ||
		bytes.length > controlCancellationPolicy.decodedLimit
	)
		return unknown("bounded-body-unavailable");
	budget.decoded += bytes.length;
	if (budget.decoded > controlCancellationPolicy.decodedLimit) return unknown("aggregate-decoded-limit");
	const marker =
		bytes[0] === 35
			? "complete"
			: bytes[0] === 126
				? "partial"
				: action
					? "unmarked-action"
					: segmentContract ? "unmarked-segment-prefetch" : routeTreeContract ? "unmarked-route-tree" : typeof cachedNavigations === "boolean"
						? "unmarked-navigation"
						: null;
	const isPartial =
		marker === "partial" ||
		(marker === "unmarked-navigation" && cachedNavigations);
	const markerBytes = [35, 126].includes(bytes[0]) ? 1 : 0;
	const body = markerBytes ? bytes.subarray(1) : bytes,
		records = new Map();
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	const opaqueText = new WeakSet();
	const binaryValues = new WeakMap();
	let offset = 0,
		serverErrors = 0,
		recordCount = 0, framingStage = "record", framingOffset = 0, framingTagByte = null, binaryAlignmentInvalid = false;
	const decode = (bytes) => { framingStage = "utf8"; return utf8.decode(bytes); };
	const parse = (text) => { framingStage = "json"; return JSON.parse(text); };
	try {
		while (offset < body.length) {
			framingStage = "record";
			framingOffset = offset + markerBytes;
			framingTagByte = null;
			if (++recordCount > 4096 || ++budget.rows > 4096) return unknown("record-limit");
			if (
				body[offset] === 58 &&
				body[offset + 1] === 72 &&
				/[DCLmSXM]/.test(String.fromCharCode(body[offset + 2]))
			) {
				const end = body.indexOf(10, offset);
				if (end < offset) return unknown("incomplete-hint");
				framingTagByte = 72;
				parse(decode(body.subarray(offset + 3, end)));
				offset = end + 1;
				continue;
			}
			const recordOffset = offset + markerBytes;
			const colon = body.indexOf(58, offset);
			const id = body.subarray(offset, colon).toString();
			if (colon < offset || !canonicalFlightId(id))
				return unknown("invalid-record");
			let start = colon + 1,
				end,
				value;
			const tagByte = body[start];
			framingTagByte = tagByte ?? null;
			const tag = (Object.hasOwn(binaryByteWidths, String.fromCharCode(tagByte)) || /^[A-Z#rx]$/.test(String.fromCharCode(tagByte)))
				? String.fromCharCode(body[start++])
				: null;
			const binary = Object.hasOwn(binaryByteWidths, tag);
			if (tag === "T" || binary) {
				const comma = body.indexOf(44, start),
					length = body.subarray(start, comma).toString();
				if (comma < start || !/^[a-f0-9]{1,8}$/.test(length))
					return unknown("invalid-text-length");
				if (Number.parseInt(length, 16) > controlCancellationPolicy.decodedLimit) return unknown("binary-length-limit");
				end = comma + 1 + Number.parseInt(length, 16);
				if (!Number.isSafeInteger(end) || end > body.length)
					return unknown("incomplete-text");
				if (tag === "T") value = decode(body.subarray(comma + 1, end));
				else {
					value = {};
					binaryValues.set(value, { bytes: body.subarray(comma + 1, end), tag });
					if (Number.parseInt(length, 16) % binaryByteWidths[tag] !== 0) binaryAlignmentInvalid = true;
				}
			} else {
				end = body.indexOf(10, start);
				if (
					end < start ||
					![null, "I", "H", "E", "X", "x", "R", "r", "C"].includes(tag)
				)
					return unknown("unsupported-record", { tagByte, recordOffset });
				const text = decode(body.subarray(start, end));
				if (["X", "x", "R", "r"].includes(tag)) {
					if (text !== "") return unknown("invalid-stream-opener");
				} else if (tag === "C" && text === "") value = "$undefined";
				else if (tag === "H") {
					if (!/^[DCLmSXM]/.test(text))
						return unknown("unsupported-record", { tagByte, recordOffset });
					value = parse(text.slice(1));
				} else value = parse(text);
				end++;
				if (tag === "E") serverErrors++;
			}
			if (serverErrors)
				return { complete: false, reason: "flight-server-error", serverErrors };
			if (tag === "H") {
				// React dispatches the hint without creating or fulfilling its numeric chunk.
				offset = end;
				continue;
			}
			const previous = records.get(id);
			if (previous) {
				// React's fulfilled stream chunk accepts repeated model/T rows only until C.
				if (
					!previous.stream ||
					previous.closed ||
					(![null, "T", "C", "E"].includes(tag) && !binary)
				)
					return unknown("invalid-stream-record");
				if (previous.tag === "r" && !["C", "E"].includes(tag) && !binary)
					return unknown("unsupported-byte-stream-value");
				if (tag === "C") {
					previous.closed = true;
					if (["X", "x"].includes(previous.tag)) previous.value.push(value);
				} else if (tag !== "E") {
					if (tag === "T") {
						const text = { textValue: value };
						opaqueText.add(text);
						previous.value.push(text);
					} else previous.value.push(value);
				}
				previous.end = end;
			} else {
				if (tag === "C") return unknown("invalid-stream-record");
				const stream = ["X", "x", "R", "r"].includes(tag);
				records.set(id, {
					value: stream ? [] : value,
					tag,
					end,
					stream,
					closed: false,
				});
			}
			offset = end;
		}
	} catch {
		return unknown("invalid-record", { framingStage, recordOffset: framingOffset, tagByte: framingTagByte });
	}
	if (serverErrors)
		return { complete: false, reason: "flight-server-error", serverErrors };
	if (!supportedContract) return unknown("unsupported-request-contract");
	if (!marker) return unknown("unsupported-marker");
	if (binaryAlignmentInvalid) return unknown("invalid-binary-alignment");
	if ([...records.values()].some((record) => record.stream && !record.closed))
		return unknown("unclosed-stream");
	const root = records.get("0")?.value;
	if (
		!root ||
		typeof root !== "object" ||
		Array.isArray(root) ||
		(Object.hasOwn(root, "b") && typeof root.b !== "string") ||
		(action ? !Object.hasOwn(root, "a") : !Object.hasOwn(root, "t"))
	)
		return unknown("unsupported-root");
	const plainPath = /^\$(0|[1-9a-f][a-f0-9]{0,12}):/;
	let pathLimit = false, pathFailure = null, pathLimitObservation = null, eagerParentCalls = 0, outlinedCalls = 0, eagerUniqueObjects = 0, repeatedEagerObjects = 0;
	const eagerObjectsObserved = new WeakSet();
	const completedParentChecks = new WeakMap(), parentCheckDepths = [];
	const literalParentChecks = new WeakMap();
	let referenceSensitiveEpoch = 0;
	// These body-local certificates prove structural readiness only, never a semantic role.
	const closedEagerChecks = new WeakMap();
	let borrowEpoch = 0, canonicalWrapperEpoch = 0;
	const closedEagerMemo = {candidates:0,closures:0,dependencyFree:0,published:0,hits:0,depthExcluded:0,originExcluded:0,capacityExcluded:0,
		canonicalWrapperChecks:0,wrapperOnlyClosures:0,wrapperBorrowCandidates:0,wrapperOnlyFailedCandidates:0,
		literalHits:0,literalHitsWithClosedCertificate:0,literalHitsWithUsableClosedCertificate:0,
		publishedLiteralEligible:0,publishedNonLiteralEligible:0,publishedWithWrappers:0,nonLiteralHits:0,wrapperHits:0,
		borrowReasons:{seenId:0,seenContainer:0,activeAnchor:0,elementSkip:0,opaque:0,removedField:0,parentCertificate:0}};
	const borrowReadiness = (reason,owner=null) => {
		borrowEpoch++;closedEagerMemo.borrowReasons[reason]++;
		for(const candidate of costCandidates)candidate.reasonMask|=reasonBits[reason];
		if(reason==="seenContainer" || reason==="activeAnchor"){
			const current=[...activePaths.values()].at(-1);
			if(!owner || !current)dependencyCosts.activeOwnerUnknown++;else dependencyCosts[owner===current?"activeSameOwner":"activeDifferentOwner"]++;
		}
	};
	const includeDepth = depth => { for (const scope of parentCheckDepths) scope.maxDepth=Math.max(scope.maxDepth,depth); };
	let parentMemoChecks=0,parentMemoHits=0,parentMemoAbsent=0,parentMemoNonStandalone=0,parentMemoDepthExcluded=0,parentMemoKnownExcluded=0,parentMemoReady=0,parentMemoPublished=0;
	const notePathFailure = reason => { pathFailure ??= reason; return false; };
	const unknownPath = reason => { notePathFailure(reason); return {known:false}; };
	const pathStep = (depth, phase, context = {}) => {
		includeDepth(depth);
		const guard = depth > 64 ? "existing-recursion-depth" : chargeModel(phase,depth) > 100000 ? "shared-model-work" : null;
		if (guard) {
			pathLimit = true;
			pathLimitObservation ??= {guard,phase,observedDepth:depth,depthCap:64,sharedModelSteps:budget.models,modelCap:100000,
				localModelSteps:budget.models-modelBudgetAtStart,eagerParentCalls,outlinedCalls,eagerUniqueObjects,repeatedEagerObjects,
				activeOutlinedPaths:activePaths.size,...context,parentMemoChecks,parentMemoHits,parentMemoAbsent,parentMemoNonStandalone,parentMemoDepthExcluded,parentMemoKnownExcluded,parentMemoReady,parentMemoPublished,closedEagerMemo:structuredClone(closedEagerMemo),modelCostObservation:modelCostSnapshot()};
			return notePathFailure("depth-or-model-limit");
		}
		return true;
	};
	const elementTuple = value => Array.isArray(value) && value[0] === "$";
	// Materialized JSON parents must not be blocked by an eager sibling. Lazy/promise values
	// remain wrappers here; following a path through one is a separate, stricter operation.
	const eagerParent = (value, forceElement, seen = new Set(), depth = 0, referenceEdges = 0, jsonDepth = 0, originId = null) => {
		eagerParentCalls++;
		if (value && typeof value === "object") {
			noteDependencyContext(value,originId,forceElement,seen,depth);
			if (eagerObjectsObserved.has(value)) repeatedEagerObjects++;
			else { eagerObjectsObserved.add(value); eagerUniqueObjects++; }
		}
		if (!pathStep(depth,"eager-parent",{referenceEdgesInParent:referenceEdges,jsonDepthInParent:jsonDepth})) return false;
		if (typeof value === "string") {
			if (value.startsWith("$")) referenceSensitiveEpoch++;
			if (/^\$(?:L|@)[a-f0-9]+$/.test(value)) {
				if (!canonicalFlightId(value.slice(2))) return notePathFailure("noncanonical-eager-reference");
				// This completes the old wrapper-shape predicate, not its target or role.
				canonicalWrapperEpoch++; closedEagerMemo.canonicalWrapperChecks++;
				for(const candidate of costCandidates)candidate.reasonMask|=128;
				return true;
			}
			if (/^\$[QWi][a-f0-9]+$/.test(value)) {
				const id=value.slice(2),record=records.get(id);
				if (!record || record.tag !== null || record.stream || !Array.isArray(record.value) || (value[1] === "Q" && !record.value.every(pair=>Array.isArray(pair)&&pair.length===2))) return notePathFailure("unsupported-eager-collection");
				if (seen.has(id)) { borrowReadiness("seenId"); return true; }
				return eagerParent(record.value,false,new Set([...seen,id]),depth + 1,referenceEdges + 1,0,id);
			}
			if (/^\$[a-f0-9]+$/.test(value)) {
				const id = value.slice(1), record = records.get(id);
				if (!record) return notePathFailure("missing-eager-model");
				if (record.tag === "I") return notePathFailure("eager-import-model");
				if (record.tag === "T" || record.stream) { borrowReadiness("opaque"); return true; }
				if (seen.has(id)) { borrowReadiness("seenId"); return (record.value && typeof record.value === "object" && [...seen].filter(item=>typeof item === "string").length === 1) || notePathFailure("eager-cross-record-or-alias-cycle"); }
				return eagerParent(record.value, forceElement, new Set([...seen,id]), depth + 1,referenceEdges + 1,0,id);
			}
			if (plainPath.test(value)) {
				const selected = outlined(value, depth + 1, seen);
				return selected.known && eagerParent(selected.value,forceElement,seen,depth + 1,referenceEdges + 1,0,selected.originId);
			}
			if (value === "$undefined") borrowReadiness("removedField");
			return !value.startsWith("$") || value.startsWith("$$") || ["$","$undefined","$NaN","$Infinity","$-Infinity","$-0"].includes(value) || /^\$[SD]/.test(value) || notePathFailure("unsupported-eager-reference");
		}
		if (!value || typeof value !== "object") return true;
		if (binaryValues.has(value) || opaqueText.has(value)) { referenceSensitiveEpoch++; borrowReadiness("opaque"); return notePathFailure("eager-binary-or-text-value"); }
		if (elementTuple(value) && !forceElement) { referenceSensitiveEpoch++; borrowReadiness("elementSkip"); return true; }
		if (elementTuple(value) && value.length !== 4) return notePathFailure("malformed-eager-element");
		if (seen.has(value)) { referenceSensitiveEpoch++; borrowReadiness("seenContainer",costCandidates.findLast(candidate=>candidate.value===value)?.owner); return true; }
		const literal = literalParentChecks.get(value)?.get(forceElement===true);
		if (literal && depth + literal.depthSpan <= 64) {
			closedEagerMemo.literalHits++;
			const origin=records.get(originId),closed=typeof originId==="string" && origin?.tag===null && !origin.stream && closedEagerChecks.get(value)?.get(originId)?.get(forceElement===true);
			if(closed)closedEagerMemo.literalHitsWithClosedCertificate++;
			if(closed && depth+closed.depthSpan<=64)closedEagerMemo.literalHitsWithUsableClosedCertificate++;
			// A closed reference-free subtree is context independent, but its full height
			// still belongs to EVERY ancestor certificate that consumes this lookup.
			includeDepth(depth+literal.depthSpan);
			return true;
		}
		const origin = records.get(originId), originKnown = typeof originId === "string" && origin?.tag === null && !origin.stream;
		const certificate = originKnown && closedEagerChecks.get(value)?.get(originId)?.get(forceElement===true);
		if (certificate && depth + certificate.depthSpan <= 64) {
			closedEagerMemo.hits++;
			if(!certificate.literalEligible)closedEagerMemo.nonLiteralHits++;
			if(certificate.containsCanonicalWrappers){canonicalWrapperEpoch++;closedEagerMemo.wrapperHits++;for(const candidate of costCandidates)candidate.reasonMask|=128;}
			// A reference-bearing closed hit must not become a reference-free literal proof.
			referenceSensitiveEpoch++;
			includeDepth(depth+certificate.depthSpan);
			return true;
		}
		if (certificate) closedEagerMemo.depthExcluded++;
		const candidateEpoch = borrowEpoch, candidateWrapperEpoch = canonicalWrapperEpoch;
		closedEagerMemo.candidates++;
		const eligibility = referenceSensitiveEpoch, scope = {maxDepth:depth};
		const costCandidate={value,owner:[...activePaths.values()].at(-1),reasonMask:0,start:budget.models,depth,scope};costCandidates.push(costCandidate);
		if (Object.hasOwn(value,"__proto__")) { referenceSensitiveEpoch++; borrowReadiness("removedField"); }
		const containers = new Set([...seen,value]);
		parentCheckDepths.push(scope);
		let ready;
		try { ready = Object.keys(value).filter(key=>key!=="__proto__").every(key=> {
			const descriptor=Object.getOwnPropertyDescriptor(value,key);
			return descriptor && Object.hasOwn(descriptor,"value") && eagerParent(descriptor.value,false,containers,depth + 1,referenceEdges,jsonDepth + 1,originId);
		}); } finally { parentCheckDepths.pop();costCandidates.pop();recordCandidateCost(costCandidate,ready,scope.maxDepth-depth); }
		if (ready) closedEagerMemo.closures++;
		const containsCanonicalWrappers=canonicalWrapperEpoch!==candidateWrapperEpoch;
		if(containsCanonicalWrappers){
			if(borrowEpoch!==candidateEpoch)closedEagerMemo.wrapperBorrowCandidates++;
			else if(ready)closedEagerMemo.wrapperOnlyClosures++;
			else closedEagerMemo.wrapperOnlyFailedCandidates++;
		}
		if (ready && borrowEpoch === candidateEpoch) {
			closedEagerMemo.dependencyFree++;
			if (!originKnown) closedEagerMemo.originExcluded++;
			else if (closedEagerMemo.published >= 100000) closedEagerMemo.capacityExcluded++;
			else {
				let byOrigin = closedEagerChecks.get(value); if (!byOrigin) closedEagerChecks.set(value,byOrigin=new Map());
				let byForce = byOrigin.get(originId); if (!byForce) byOrigin.set(originId,byForce=new Map());
				const literalEligible=referenceSensitiveEpoch===eligibility;
				if (!byForce.has(forceElement===true)) {
					closedEagerMemo.published++;
					closedEagerMemo[literalEligible?"publishedLiteralEligible":"publishedNonLiteralEligible"]++;
					if(containsCanonicalWrappers)closedEagerMemo.publishedWithWrappers++;
				}
				byForce.set(forceElement===true,{depthSpan:scope.maxDepth-depth,literalEligible,containsCanonicalWrappers});
			}
		}
		if (ready && referenceSensitiveEpoch === eligibility) {
			let byForce = literalParentChecks.get(value);
			if (!byForce) literalParentChecks.set(value,byForce=new Map());
			byForce.set(forceElement===true,{depthSpan:scope.maxDepth-depth});
		}
		return ready;
	};
	const activePaths = new Map();
	const outlined = (reference, depth = 0, trail = new Set()) => {
		outlinedCalls++;
		if (depth === 0) pathFailure = null;
		if (!pathStep(depth,"outlined-entry")) return {known:false};
		if (!plainPath.test(reference) || reference.length > 2048) return unknownPath("unsupported-reference-shape");
		const active = activePaths.get(reference);
		if (active) {
			const ids = [...trail].filter(item=>typeof item === "string");
			if (active.checking && active.anchorKnown && active.modelIds.size === 1 && ids.length > 0 && ids.every(id=>id===active.rootId)) {
				borrowReadiness("activeAnchor",active);
				return {known:true,value:active.target,originId:active.originId,modelIds:active.modelIds};
			}
			return unknownPath(active.checking && active.anchorKnown ? "unsupported-cross-record-cycle" : "outlined-reference-cycle");
		}
		const [id,...keys] = reference.slice(1).split(":");
		if (!Number.isSafeInteger(Number.parseInt(id,16)) || keys.length > 32 || keys.some(key=>key.length>128)) return unknownPath("path-component-limit");
		const state = {rootId:id,modelIds:new Set(),checking:false,anchorKnown:false};
		activePaths.set(reference,state);
		try {
			let value = `$${id}`, originId = id;
			const parents = [];
			for (const key of keys) {
				const aliases = new Set();
				while (typeof value === "string" && /^\$(?:L)?[a-f0-9]+$/.test(value)) {
					if (!pathStep(depth + aliases.size,"path-alias",{referenceEdgesInStep:aliases.size})) return {known:false};
					if (aliases.has(value)) return unknownPath("path-alias-cycle");
					aliases.add(value);
					originId = value.replace(/^\$L?/,""); state.modelIds.add(originId);
					const record = records.get(originId);
					if (!record) return unknownPath("missing-path-model");
					if (record.tag === "I") return unknownPath("path-import-model");
					if (record.tag !== null || record.stream) return unknownPath("unsupported-path-model-kind");
					value = record.value;
				}
				if (typeof value === "string" && plainPath.test(value)) {
					const selected = outlined(value,depth + 1,new Set([...trail,...state.modelIds])); if (!selected.known) return selected; value = selected.value;
					originId = selected.originId; for (const modelId of selected.modelIds) state.modelIds.add(modelId);
				}
				if (typeof value === "string" && /^\$@/.test(value)) return unknownPath("path-promise-not-unwrapped");
				if (!value || typeof value !== "object") return unknownPath("non-object-projection");
				if (binaryValues.has(value) || opaqueText.has(value)) return unknownPath("binary-or-text-projection");
				parents.push({value,originId});
				if (elementTuple(value)) {
					if (!["type","key","props","ref"].includes(key)) return unknownPath("missing-element-own-property");
					value = key === "ref" ? null : value[{type:1,key:2,props:3}[key]];
				} else {
					if (key === "__proto__") return unknownPath("removed-proto-property");
					if (![Object.prototype,Array.prototype].includes(Object.getPrototypeOf(value))) return unknownPath("unsupported-parent-prototype");
					const descriptor = Object.getOwnPropertyDescriptor(value,key);
					if (!descriptor) return unknownPath("missing-own-property");
					if (!Object.hasOwn(descriptor,"value")) return unknownPath("non-data-own-property");
					if (!Array.isArray(value) && descriptor.value === "$undefined") return unknownPath("removed-undefined-property");
					value = descriptor.value;
				}
			}
			// Locate the actual own-data target before validating its parents. Only a materialized
			// same-model target can anchor a self-cycle; a reference string is never an anchor.
			state.checking = true; state.target = value; state.originId = originId;
			state.anchorKnown = value !== undefined && (typeof value !== "string" || !value.startsWith("$") || value.startsWith("$$"));
			// A standalone same-model check has no unfinished enclosing parent to borrow from.
			// Publish its certificates only after the ENTIRE parent list has succeeded.
			const standalone = trail.size === 0 && activePaths.size === 1 && state.modelIds.size === 1 && parents.every(parent=>parent.originId===id);
			const pendingParentChecks = [];
			if (!parents.every(parent=> {
				const entryDepth = depth + 1;
				const available = completedParentChecks.get(parent.value)?.get(parent.originId);
				parentMemoChecks++;
				if (!available) parentMemoAbsent++;
				if (!standalone) { parentMemoNonStandalone++; if(available?.forceElement===true && entryDepth+available.depthSpan<=64)parentMemoKnownExcluded++; }
				const completed = standalone && available;
				if (completed?.forceElement === true && entryDepth + completed.depthSpan <= 64) {
					dependencyCosts.parentCertificateUses++;
					if(completed.observedDependencyMask&3)dependencyCosts.parentCertificateWithSeen++;
					if(completed.observedDependencyMask&4)dependencyCosts.parentCertificateWithActive++;
					if(!(completed.observedDependencyMask&7))dependencyCosts.parentCertificateWithoutSeenOrActive++;
					parentMemoHits++;
					if (!pathStep(entryDepth,"completed-parent")) return false;
					includeDepth(entryDepth+completed.depthSpan);
					borrowReadiness("parentCertificate");
					return true;
				}
				if(completed?.forceElement===true && entryDepth+completed.depthSpan>64)parentMemoDepthExcluded++;
				// Reuse only a SAME-model materialized parent's active traversal. Its enclosing
				// validation still has to finish every sibling before this result can escape.
				// Cross-model/alias contexts keep their independent validation and cycle guards.
				const inherited = [...trail].every(item=>typeof item !== "string" || item === parent.originId) ? trail : [];
				const scope = {maxDepth:entryDepth}; parentCheckDepths.push(scope);
				const dependencyBefore={...closedEagerMemo.borrowReasons};
				let ready;
				try { ready = eagerParent(parent.value,true,new Set([...inherited,parent.originId]),entryDepth,0,0,parent.originId); }
				finally { parentCheckDepths.pop(); }
				if (ready && standalone) { parentMemoReady++;const observedDependencyMask=Object.entries(reasonBits).reduce((mask,[reason,bit])=>mask|(closedEagerMemo.borrowReasons[reason]>dependencyBefore[reason]?bit:0),0);pendingParentChecks.push({parent,depthSpan:scope.maxDepth-entryDepth,observedDependencyMask}); }
				return ready;
			})) return {known:false};
			for (const {parent,depthSpan,observedDependencyMask} of pendingParentChecks) {
				let byOrigin = completedParentChecks.get(parent.value);
				if (!byOrigin) completedParentChecks.set(parent.value,byOrigin = new Map());
				byOrigin.set(parent.originId,{forceElement:true,depthSpan,observedDependencyMask});
				parentMemoPublished++;
			}
			return {known:true,value,originId,modelIds:state.modelIds};
		} finally { activePaths.delete(reference); }
	};
	const resolve = (value) => {
		const seen = new Set();
		while (typeof value === "string" && (/^\$@?[a-f0-9]+$/.test(value) || plainPath.test(value))) {
			if (seen.has(value) || seen.size >= 8) return undefined;
			seen.add(value);
			if (plainPath.test(value)) {
				const selected = outlined(value); if (!selected.known) return undefined; value = selected.value;
			} else {
				const record = records.get(value.replace(/^\$@?/, ""));
				if (record?.tag === "T") return record.value;
				value = record?.value;
			}
		}
		return value;
	};
	let segmentClaims = null, segmentOutputs = [];
		// Required transport models must be ordinary JSON, not the raw metadata of
		// an import/text/binary/stream chunk. Preserve this distinction through
		// aliases and own paths; output module imports are handled separately.
		const ordinary = raw => {
			const seen = new Set();
			while (typeof raw === "string" && (/^\$[a-f0-9]+$/.test(raw) || plainPath.test(raw))) {
				if (seen.has(raw) || seen.size >= 8) return undefined;
				seen.add(raw);
				if (plainPath.test(raw)) {
					const selected = outlined(raw); if (!selected.known) return undefined; raw = selected.value;
				} else {
					const record = records.get(raw.slice(1));
					if (!record || record.tag !== null || record.stream) return undefined;
					raw = record.value;
				}
			}
			return raw && typeof raw === "object" && (opaqueText.has(raw) || binaryValues.has(raw)) ? undefined : raw;
		};
	if (segmentContract) {
		// collect-segment-data's full-buffer contract is not a navigation response.
		// Its staged Promise<void> is local to each bundled node; pending siblings
		// never grant a complete node permission to omit an output dependency.
		const binding = segmentBinding;
		if (records.get("0")?.tag !== null || records.get("0")?.stream || marker !== "unmarked-segment-prefetch" || !binding || binding.method !== "GET" || binding.status !== 200 ||
			!["flight","rsc","prefetch","postponed","manifestVerified"].every(key=>binding[key] === true) ||
			!digest(binding.requestKeySha256) || !digest(binding.requestHeadersSha256) || !digest(binding.compiledManifestSha256) || !/^[a-f0-9]{40}$/.test(binding.compiledBuild ?? ""))
			return unknown("unqualified-segment-request");
		const bodyBuild = Object.hasOwn(root,"b") ? ordinary(root.b) : null;
		if (Object.hasOwn(root,"b") && (typeof bodyBuild !== "string" || bodyBuild.startsWith("$") && !bodyBuild.startsWith("$$"))) return unknown("unsupported-segment-build-model");
		const bodyBuildSha256 = typeof bodyBuild === "string" ? bodySha256(Buffer.from(bodyBuild.startsWith("$$") ? bodyBuild.slice(1) : bodyBuild)) : null;
		const expectedDeployment = bodySha256(Buffer.from(binding.compiledBuild));
		const actualDeployment = binding.responseDeploymentSha256 ?? bodyBuildSha256;
		if (actualDeployment !== expectedDeployment || (binding.responseDeploymentSha256 !== null && !digest(binding.responseDeploymentSha256)))
			return unknown("segment-deployment-mismatch");
		if (Object.keys(root).some(key=>!["b","t","a","u","r","f"].includes(key)) || (Object.hasOwn(root,"f") && root.f !== true))
			return unknown("unsupported-segment-envelope");
		const promiseRecord = raw => typeof raw === "string" && /^\$@(0|[1-9a-f][a-f0-9]{0,12})$/.test(raw) ? records.get(raw.slice(2)) : null;
		const aRecord = promiseRecord(root.a), uRecord = promiseRecord(root.u);
		const boundaryValue = aRecord?.value, upgradeValue = uRecord?.value;
		if (!aRecord || aRecord.tag !== null || aRecord.stream || !(boundaryValue === null || (Number.isSafeInteger(boundaryValue) && boundaryValue >= 0 && boundaryValue <= body.length)) ||
			!uRecord || uRecord.tag !== null || uRecord.stream || typeof upgradeValue !== "boolean") return unknown("unresolved-segment-envelope");
		const iterable = (raw, vary) => {
			const record = typeof raw === "string" && /^\$[a-f0-9]+$/.test(raw) ? records.get(raw.slice(1)) : null;
			return Boolean(record?.stream && record.closed && ["X","x"].includes(record.tag) && record.value.at(-1) === "$undefined" && record.value.slice(0,-1).every(item=>{
				const value = vary && item && typeof item === "object" && opaqueText.has(item) ? item.textValue : ordinary(item);
				return vary ? value === 0 || (typeof value === "string" && (!value.startsWith("$") || value.startsWith("$$")) || (item && typeof item === "object" && opaqueText.has(item) && typeof value === "string")) : typeof value === "number" && Number.isFinite(value) && value >= 0;
			}));
		};
		if (Object.hasOwn(root,"r") && root.r !== null && !iterable(root.r,true)) return unknown("unsupported-segment-root-vary");
		let partialNodes = 0, completeNodes = 0;
		const data = raw => {
			const value = ordinary(raw);
			if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key=>!["r","p","v","s"].includes(key)) ||
				!["r","p","v","s"].every(key=>Object.hasOwn(value,key)) || !/^\$@(0|[1-9a-f][a-f0-9]{0,12})$/.test(value.p ?? "") ||
				(value.v !== null && !iterable(value.v,true)) || !iterable(value.s,false)) return false;
			const record = records.get(value.p.slice(2));
			if (record && (record.tag !== null || record.stream || record.value !== "$undefined")) return false;
			const partial = !record;
			partial ? partialNodes++ : completeNodes++;
			segmentOutputs.push({value:value.r,role:partial?"cache-output":"required",fromTypedOutput:true,outputArrival:"typed-data-r"});
			return true;
		};
		const transport = ordinary(root.t);
		if (!transport || typeof transport !== "object" || Array.isArray(transport) || Object.keys(transport).some(key=>!["t","h"].includes(key))) return unknown("unsupported-segment-transport");
		const seen = new Set();
		const encode = value => /^[a-zA-Z0-9\-_@]+$/.test(value) ? value : "!"+btoa(value).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
		const part = raw => {
			const value = ordinary(raw);
			if (typeof value === "string" && (!value.startsWith("$") || value.startsWith("$$"))) return encode(value === "/_not-found" ? "_not-found" : value.startsWith("$$") ? value.slice(1) : value);
			const literal = item=>typeof item === "string" && (!item.startsWith("$") || item.startsWith("$$"));
			if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key=>!["n","t","k","s"].includes(key)) ||
				!literal(value.n) || !["c","ci(..)(..)","ci(.)","ci(..)","ci(...)","oc","d","di(..)(..)","di(.)","di(..)","di(...)"].includes(value.t) || !(value.k === null || literal(value.k)) ||
				!(value.s === null || Array.isArray(value.s) && value.s.every(literal))) return null;
			return "$"+value.t+"$"+encode(value.n);
		};
		let node = ordinary(transport.t), key = "";
		const isHead = binding.requestKeySha256 === bodySha256(Buffer.from("/_head"));
		try { while (true) {
			if (chargeModel("segment-tree") > 100000 || seen.size >= 4096 || !node || typeof node !== "object" || Array.isArray(node) || seen.has(node) ||
				Object.keys(node).some(field=>!["s","h","c","d"].includes(field)) || part(node.s) === null ||
				(Object.hasOwn(node,"h") && (!Number.isSafeInteger(node.h) || node.h < 0))) return unknown("unsupported-segment-spine");
			if (seen.size === 0 && ordinary(node.s) !== "") return unknown("unanchored-segment-spine");
			seen.add(node);
			if (Object.hasOwn(node,"d") && (isHead || !data(node.d))) return unknown("unsupported-segment-data");
			if (!Object.hasOwn(node,"c")) { if (!isHead && !Object.hasOwn(node,"d")) return unknown("missing-terminal-segment-data"); break; }
			if (isHead || typeof node.c !== "string" || !/^\$Q[a-f0-9]+$/.test(node.c)) return unknown("unsupported-segment-map");
			const childRecord = records.get(node.c.slice(2));
			if (!childRecord || childRecord.tag !== null || childRecord.stream) return unknown("unsupported-segment-map-model");
			const children = ordinary(childRecord.value);
			if (!Array.isArray(children) || children.length !== 1 || !Array.isArray(children[0]) || children[0].length !== 2 || typeof children[0][0] !== "string") return unknown("unsupported-segment-map");
			const child = ordinary(children[0][1]), childPart = child && part(child.s);
			if (childPart === null || childPart === undefined) return unknown("unsupported-segment-identity");
			key += "/"+(children[0][0] === "children" ? childPart : "@"+encode(children[0][0])+"/"+childPart);
			node = child;
		} } catch { return unknown("unsupported-segment-key-encoding"); }
		if (Object.hasOwn(transport,"h") && !data(transport.h)) return unknown("unsupported-segment-head");
		if (isHead && (!Object.hasOwn(transport,"h") || seen.size !== 1)) return unknown("unsupported-standalone-head");
		const derivedRequestKeySha256 = bodySha256(Buffer.from(isHead ? "/_head" : key || "/_index"));
		if (derivedRequestKeySha256 !== binding.requestKeySha256) return unknown("segment-request-key-mismatch");
		segmentClaims = {treeNodes:seen.size,partialNodes,completeNodes,renderableOutputClaim:false,
			segmentBinding:{...Object.fromEntries(["method","status","flight","rsc","prefetch","postponed","manifestVerified","requestHeadersSha256","requestKeySha256","responseDeploymentSha256","compiledBuild","compiledManifestSha256"].filter(key=>Object.hasOwn(binding,key)).map(key=>[key,binding[key]])),
				derivedRequestKeySha256,bodyBuildSha256,expectedDeploymentSha256:expectedDeployment,actualDeploymentSha256:actualDeployment,
				deploymentSource:binding.responseDeploymentSha256 === null ? "body" : "response-header"}};
	}
	if (requestKind === "route-tree") {
		// The exact /_tree consumer buffers the WHOLE response, then reads structure only.
		// Other endpoint contracts and arbitrary pending data are not covered by this branch.
		const binding=routeTreeBinding;
		if(records.get("0")?.tag!==null || records.get("0")?.stream || marker!=="unmarked-route-tree" || !binding || binding.method!=="GET" || binding.status!==200 ||
			!["flight","rsc","prefetch","manifestVerified"].every(key=>binding[key]===true) || typeof binding.postponed!=="boolean" ||
			!digest(binding.requestHeadersSha256) || binding.requestKeySha256!==bodySha256(Buffer.from("/_tree")) || !digest(binding.compiledManifestSha256) || !/^[a-f0-9]{40}$/.test(binding.compiledBuild ?? "")) return unknown("unqualified-route-tree-request");
		const build=Object.hasOwn(root,"b")?ordinary(root.b):null;
		if(Object.hasOwn(root,"b") && (typeof build!=="string" || build.startsWith("$")&&!build.startsWith("$$"))) return unknown("unsupported-tree-build-model");
		const bodyBuildSha256=typeof build==="string"?bodySha256(Buffer.from(build.startsWith("$$")?build.slice(1):build)):null;
		const expectedDeploymentSha256=bodySha256(Buffer.from(binding.compiledBuild)),actualDeploymentSha256=binding.responseDeploymentSha256 ?? bodyBuildSha256;
		if(actualDeploymentSha256!==expectedDeploymentSha256 || binding.responseDeploymentSha256!==null&&!digest(binding.responseDeploymentSha256)) return unknown("route-tree-deployment-mismatch");
		if(Object.keys(root).some(key=>!["b","t"].includes(key))) return unknown("unsupported-tree-metadata");
		const transport = ordinary(root.t);
		if (
			!transport ||
			typeof transport !== "object" ||
			Array.isArray(transport) ||
			Object.keys(transport).some((key) => key !== "t")
		)
			return unknown("unsupported-tree-transport");
		const queue = [{raw:transport.t,parentOrdinal:0,partIndex:0,slotEncodingSha256:bodySha256(Buffer.alloc(0))}],
			visited = new Set();
		let nodes = 0,metadataPages=0,nullNodes=0,unsupportedNullContext=false;
		const walk=[];
		const literal=value=>value.startsWith("$$")?value.slice(1):value;
		const encode=value=>/^[a-zA-Z0-9\-_@]+$/.test(value)?value:"!"+btoa(value).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
		const segmentObservation=(raw,value)=>{
			const kind=item=>item===undefined?"unresolved":item===null?"null":Array.isArray(item)?"array":typeof item;
			const record=typeof raw==="string" && /^\$[a-f0-9]+$/.test(raw)?records.get(raw.slice(1)):null;
			const provenance=record?record.stream?"stream":record.tag==="I"?"import":record.tag==="T"?"framed-text":record.tag===null?"ordinary-model":"tagged-model":typeof raw==="string" && plainPath.test(raw)?"outlined-path":typeof raw==="string" && raw.startsWith("$")&&!raw.startsWith("$$")?"unresolved-reference":"inline";
			const object=value && typeof value==="object" && !Array.isArray(value)?value:null,type=object?ordinary(object.t):undefined;
			return {nodeOrdinal:nodes,rawKind:kind(raw),resolvedKind:kind(value),provenance,paramType:type===undefined?null:["c","ci(..)(..)","ci(.)","ci(..)","ci(...)","oc","d","di(..)(..)","di(.)","di(..)","di(...)"].includes(type)?type:"other",
				nameKind:kind(object?ordinary(object.n):undefined),valueKind:kind(object?ordinary(object.k):undefined),siblingsKind:kind(object?ordinary(object.s):undefined),unknownFields:object?Object.keys(object).filter(key=>!["n","t","k","s"].includes(key)).length:0};
		};
		while (queue.length) {
			if (++nodes > 4096 || chargeModel("route-tree") > 100000) return unknown("tree-limit");
			const entry=queue.pop(),node = ordinary(entry.raw);
			if (
				!node ||
				typeof node !== "object" ||
				Array.isArray(node) ||
				visited.has(node) ||
				Object.keys(node).some((key) => !["s", "h", "c"].includes(key))
			)
				return unknown("unresolved-tree-structure");
			visited.add(node);
			const segment = ordinary(node.s);
			if(nodes===1 && segment!=="") return unknown("unanchored-route-tree");
			if (typeof segment === "string") {
				if (segment.startsWith("$") && !segment.startsWith("$$"))
					return unknown("unsupported-tree-segment",{routeTreeSegmentObservation:segmentObservation(node.s,segment)});
				if(segment==="__PAGE__") metadataPages++;
			} else if (
				!segment ||
				typeof segment !== "object" ||
				Array.isArray(segment) ||
				Object.keys(segment).some(key=>!["n","t","k","s"].includes(key)) ||
				typeof ordinary(segment.n) !== "string" || ordinary(segment.n).startsWith("$")&&!ordinary(segment.n).startsWith("$$") ||
				!["c","ci(..)(..)","ci(.)","ci(..)","ci(...)","oc","d","di(..)(..)","di(.)","di(..)","di(...)"].includes(ordinary(segment.t)) ||
				!((typeof ordinary(segment.k) === "string" && (!ordinary(segment.k).startsWith("$") || ordinary(segment.k).startsWith("$$"))) || ordinary(segment.k)===null && ordinary(segment.t)==="d") ||
				!(
					ordinary(segment.s) === null ||
					(Array.isArray(ordinary(segment.s)) &&
						ordinary(segment.s).every((value) => typeof ordinary(value) === "string" && (!ordinary(value).startsWith("$") || ordinary(value).startsWith("$$"))))
				)
			)
				return unknown("unsupported-tree-segment",{routeTreeSegmentObservation:segmentObservation(node.s,segment)});
			let kind,segmentPart,scalar=null;
			try{
				if(typeof segment==="string"){
					const text=literal(segment);kind=nodes===1?"root":text==="__PAGE__"?"page":text==="__DEFAULT__"?"default":text==="/_not-found"?"not-found":text==="" || text[0]==="("&&text.endsWith(")")?"group":"static-visible";
					if(["(.)","(..)","(...)"].some(prefix=>text.startsWith(prefix)))unsupportedNullContext=true;
					segmentPart=nodes===1?"":encode(text==="/_not-found"?"_not-found":text);
				}else{
					const type=ordinary(segment.t);segmentPart="$"+type+"$"+encode(literal(ordinary(segment.n)));
					if(type!=="d")unsupportedNullContext=true;
					if(ordinary(segment.k)===null){
						if(!knownNullPathSource(binding.pathSourceFacts,binding))return unknown("unqualified-route-scalar-source",{routeTreeSegmentObservation:segmentObservation(node.s,segment)});
						const part=binding.pathSourceFacts.scalarKeys.parts[entry.partIndex];if(!part)return unknown("missing-route-scalar-part",{routeTreeSegmentObservation:segmentObservation(node.s,segment)});
						scalar={index:entry.partIndex,bytes:part.scalarBytes,sha256:part.scalarSha256};nullNodes++;kind="dynamic-null-d";
					}else kind=type==="d"?"dynamic-concrete-d":"dynamic-other";
				}
			}catch{return unknown("unsupported-route-key-encoding");}
			const nextIndex=entry.parentOrdinal===0?0:entry.partIndex+(["static-visible","dynamic-null-d","dynamic-concrete-d","dynamic-other"].includes(kind)?1:0);
			walk.push({ordinal:nodes,parentOrdinal:entry.parentOrdinal,partIndex:entry.partIndex,nextIndex,kind,descriptorSha256:bodySha256(Buffer.from(JSON.stringify(segment))),segmentEncodingSha256:bodySha256(Buffer.from(segmentPart)),slotEncodingSha256:entry.slotEncodingSha256,scalar});
			if (node.h !== undefined && (!Number.isSafeInteger(ordinary(node.h)) || ordinary(node.h) < 0))
				return unknown("unsupported-tree-hints");
			if (node.c !== undefined) {
				if (typeof node.c !== "string" || !/^\$Q[a-f0-9]+$/.test(node.c))
					return unknown("unsupported-tree-map");
				const childRecord=records.get(node.c.slice(2));
				if(!childRecord || childRecord.tag!==null || childRecord.stream) return unknown("unsupported-tree-map-model");
				const children = ordinary(childRecord.value);
				if (!Array.isArray(children) || children.length > 4096)
					return unknown("unresolved-tree-structure");
				const slots = new Set();
				for (const rawPair of children) {
					const pair=ordinary(rawPair);
					if (
						!Array.isArray(pair) ||
						pair.length !== 2 ||
						typeof ordinary(pair[0]) !== "string" || ordinary(pair[0]).startsWith("$")&&!ordinary(pair[0]).startsWith("$$") ||
						slots.has(ordinary(pair[0]))
					)
						return unknown("unsupported-tree-map");
					slots.add(ordinary(pair[0]));
					let slotEncodingSha256;try{const slot=literal(ordinary(pair[0]));slotEncodingSha256=bodySha256(Buffer.from(slot==="children"?"":"@"+encode(slot)+"/"));}catch{return unknown("unsupported-route-key-encoding");}
					queue.push({raw:pair[1],parentOrdinal:nodes,partIndex:nextIndex,slotEncodingSha256});
				}
			}
		}
		if(metadataPages===0) return unknown("missing-route-tree-metadata-page");
		const routeReadiness=nullNodes?{protocol:"null-d-route-readiness-v1",bodySha256:bodySha256(bytes),pathSourceFacts:binding.pathSourceFacts,nullNodes,metadataPages,nodes:walk,walkSha256:bodySha256(Buffer.from(JSON.stringify(walk)))}:null;
		if(routeReadiness && (unsupportedNullContext || !knownRouteReadiness(routeReadiness,binding,bodySha256(bytes),nodes,metadataPages)))return unknown("unsupported-route-null-context");
		return {
			protocol: "bounded-required-flight-v1",
			complete: true,
			requestKind,
			marker,
			isPartial: Boolean(isPartial),
			...(marker === "unmarked-navigation" ? { cachedNavigations } : {}),
			action: false,
			requiredStage: "route-tree-structure",
			treeNodes: nodes,
			metadataPages,renderableOutputClaim:false,routeNullNodes:nullNodes,routeReadiness,
			routeTreeBinding:{...Object.fromEntries(["method","status","flight","rsc","prefetch","postponed","manifestVerified","requestHeadersSha256","requestKeySha256","responseDeploymentSha256","compiledBuild","compiledManifestSha256",...(nullNodes?["requestUrlSha256","requestOriginSha256","ambiguousRedirect"]:[])].map(key=>[key,binding[key]])),
				derivedRequestKeySha256:bodySha256(Buffer.from("/_tree")),bodyBuildSha256,expectedDeploymentSha256,actualDeploymentSha256,deploymentSource:binding.responseDeploymentSha256===null?"body":"response-header"},
			boundaryBytes: body.length,
			decodedBytes: bytes.length,
			bodySha256: bodySha256(bytes),
			serverErrors: 0,
			explicitActionFailure: false,
			protocolRows: recordCount, modelSteps: budget.models - modelBudgetAtStart, embeddedRuntimePrefetch: null,modelCostObservation:modelCostSnapshot(),
		};
	}
	let embeddedRuntimePrefetch = null;
	if (!action && Object.hasOwn(root, "p")) {
		if (depth !== 0 || requestKind !== "navigation") return unknown("embedded-prefetch-depth-or-contract");
		if (typeof root.p !== "string" || !/^\$[a-f0-9]+$/.test(root.p)) return unknown("unsupported-embedded-prefetch-stream");
		const stream = records.get(root.p.slice(1));
		if (!stream?.stream || !stream.closed || !["R", "r"].includes(stream.tag)) return unknown("incomplete-embedded-prefetch-stream");
		const chunks = [];
		let length = 0;
		for (const value of stream.value) {
			const binary = binaryValues.get(value);
			if (!binary || binary.tag !== (stream.tag === "R" ? "o" : "b")) return unknown("unsupported-embedded-prefetch-value");
			length += binary.bytes.length; chunks.push(binary.bytes);
		}
		if (!length || budget.decoded + length > controlCancellationPolicy.decodedLimit) return unknown("aggregate-decoded-limit");
		const inner = Buffer.concat(chunks, length);
		if (![35, 126].includes(inner[0])) return unknown("unsupported-embedded-prefetch-marker");
		embeddedRuntimePrefetch = inspectFlightBody(inner, { cachedNavigations, requestKind: "embedded-runtime-prefetch" }, budget, depth + 1);
		if (!embeddedRuntimePrefetch.complete) return unknown("embedded-runtime-prefetch-incomplete", {
			serverErrors: embeddedRuntimePrefetch.serverErrors ?? 0, explicitActionFailure: embeddedRuntimePrefetch.explicitActionFailure === true,
			embeddedReason: embeddedRuntimePrefetch.reason, embeddedFramingStage: embeddedRuntimePrefetch.framingStage ?? null,
			embeddedRecordOffset: embeddedRuntimePrefetch.recordOffset ?? null, embeddedTagByte: embeddedRuntimePrefetch.tagByte ?? null,
			embeddedModelReference: embeddedRuntimePrefetch.modelReference ?? null,
			embeddedSemanticRole: embeddedRuntimePrefetch.semanticRole ?? null,
			embeddedMarker: embeddedRuntimePrefetch.marker ?? null, embeddedIsPartial: embeddedRuntimePrefetch.isPartial ?? null,
			embeddedRequestKind: embeddedRuntimePrefetch.requestKind ?? null,
			embeddedDecodedBytes: embeddedRuntimePrefetch.decodedBytes ?? null, embeddedBodySha256: embeddedRuntimePrefetch.bodySha256 ?? null,
			embeddedFallbackKind: embeddedRuntimePrefetch.fallbackKind ?? null,
			embeddedFallbackValueKind: embeddedRuntimePrefetch.fallbackValueKind ?? null,
			embeddedFallbackElementTypeKind: embeddedRuntimePrefetch.fallbackElementTypeKind ?? null,
			embeddedFallbackPropsKind: embeddedRuntimePrefetch.fallbackPropsKind ?? null,
			embeddedPathFailure: embeddedRuntimePrefetch.pathFailure ?? null,
			embeddedPathLimitObservation: embeddedRuntimePrefetch.pathLimitObservation ?? null,
			embeddedModelLimitObservation:embeddedRuntimePrefetch.modelLimitObservation ?? null,
			embeddedPatchDataObservation: embeddedRuntimePrefetch.patchDataObservation ?? null,
			embeddedOutputEdgeObservation: embeddedRuntimePrefetch.outputEdgeObservation ?? null,
		});
	}
	const shellScope = segmentContract || requestKind === "runtime-shell" || (requestKind === "embedded-runtime-prefetch" && isPartial);
	const embeddedPartialScope = requestKind === "embedded-runtime-prefetch" && marker === "partial";
	const partialCacheScope = segmentContract || embeddedPartialScope || (requestKind === "runtime-shell" && marker === "partial");
	if (requestKind === "runtime-shell" && (marker !== "partial" || Object.hasOwn(root, "l") || Object.hasOwn(root, "a")))
		return unknown("unsupported-runtime-shell-metadata");
	// Roles follow exact transport edges; another required path to the same model stays required.
	const queue = segmentContract ? segmentOutputs : [{ value: root, role: "root",observationOrigin:records.get("0")?.value===root?records.get("0"):null }],
		visited = new Set();
	// Structural parent readiness is independent; semantic visits must retain every
	// permission bit so a permitted alias cannot discharge a required incoming edge.
	const semanticVisitKey = (role,id,array=false,inside=false,direct=false) => `${role}:${id}:${array===true?1:0}:${inside===true?1:0}:${direct===true?1:0}`;
	let inspected = 0, postponedOutputReferences = 0, knownSuspenseBoundaries = 0, knownEmptyFallbacks = 0, postponedComponentReferences = 0, representedComponentFallbacks = 0, postponedDirectOutputs = 0, postponedArrayOutputs = 0, postponedCacheOutputs = 0;
	const modelLimitObservation=(site,guard,objectKeyCount=null)=>({protocol:"bounded-model-limit-observation-v1",site,guard,modelCap:100000,depthCap:64,
		sharedModelSteps:budget.models,localModelSteps:budget.models-modelBudgetAtStart,inspected,queueLength:queue.length,objectKeyCount,visitedStates:visited.size,recordCount,
		recursionLevel:depth,embeddedModelSteps:embeddedRuntimePrefetch?.modelSteps ?? 0,eagerParentCalls,outlinedCalls,eagerUniqueObjects,repeatedEagerObjects,activeOutlinedPaths:activePaths.size,
		embeddedModelCostObservation:embeddedRuntimePrefetch?.modelCostObservation ?? null,
		parentMemoChecks,parentMemoHits,parentMemoAbsent,parentMemoNonStandalone,parentMemoDepthExcluded,parentMemoKnownExcluded,parentMemoReady,parentMemoPublished,closedEagerMemo:structuredClone(closedEagerMemo),modelCostObservation:modelCostSnapshot()});
	semanticPreWork=chargedWork;semanticPhase="pop";
	while (queue.length) {
		const beforeGuard=chargedWork;
		if (++inspected > 100000 || chargeModel("semantic-loop") > 100000){semanticGuardOnlyWork+=chargedWork-beforeGuard;return unknown("model-limit",{modelLimitObservation:modelLimitObservation("semantic-loop",inspected>100000?"local-inspected-work":"shared-model-work")});}
		const entry=queue.pop();noteSemantic(entry,queue,beforeGuard);
		const { value, role, fallbackReferences, directEmbeddedOutput, fromTypedOutput, outputArrival, outputParentArrival, rArrayOutput, insideRArray,observationOrigin,observationReference } = entry;
		try {
		if (value && typeof value === "object" && binaryValues.has(value)) return unknown("unsupported-binary-role");
		if (shellScope && role === "fallback-output" && (
			(value && typeof value === "object" && !Array.isArray(value)) ||
			(typeof value === "string" && /^\$[SD]/.test(value))))
			return unknown("unknown-runtime-shell-fallback", { fallbackKind: "non-renderable-value",
				fallbackValueKind: typeof value === "object" ? "object" : value[1] === "S" ? "symbol" : "date" });
		if (
			typeof value === "string" &&
			value.startsWith("$S") &&
			value.length > 2
		) {
			// Symbol.for creates a scalar, not an outlined model dependency.
			continue;
		} else if (
			typeof value === "string" &&
			value.startsWith("$D") &&
			Number.isFinite(Date.parse(value.slice(2))) &&
			new Date(value.slice(2)).toISOString() === value.slice(2)
		) {
			// External Flight Date boundary; accept only the canonical serializer form.
			continue;
		} else if (typeof value === "string" && /^\$[QWi][a-f0-9]+$/.test(value)) {
			if (shellScope && role === "fallback-output") return unknown("unsupported-runtime-shell-fallback-kind");
			// The installed decoder constructs these only from an outlined iterable model.
			const id = value.slice(2),
				record = records.get(id);
			const model = resolve(record?.value);
			if (
				!record ||
				record.stream ||
				record.tag !== null ||
				!Array.isArray(model) ||
				(value[1] === "Q" &&
					!model.every((pair) => Array.isArray(pair) && pair.length === 2))
			)
				return unknown("unsupported-outlined-collection");
			const modelRole = shellScope && role === "tree-map" && value[1] === "Q" ? "tree-map-model" : "required";
			const visit = semanticVisitKey(modelRole,id);
			if (!visited.has(visit)) {
				visited.add(visit);
				queue.push({ value: model, role: modelRole, fallbackReferences, fromTypedOutput, outputArrival:"collection-reference",observationOrigin:model===record.value?record:null,observationReference:value });
			}
		} else if (
			typeof value === "string" &&
			/^\$(?:@|L)?[a-f0-9]+$/.test(value)
		) {
			const id = value.replace(/^\$(?:@|L)?/, "");
			if (role === "fallback-output" && (fallbackReferences?.has(id) || fallbackReferences?.size >= 64))
				return unknown("cyclic-runtime-shell-fallback");
			if (!records.has(id) && shellScope && role === "suspended-output" && value[1] === "L") {
				postponedOutputReferences++;
				continue;
			}
			// The detached partial p cache representation stores component props without rendering them.
			// This never grants the main graph, component type, fallback, or eager references a missing dependency.
			if (!records.has(id) && embeddedPartialScope && role === "component-data" && value[1] === "L") {
				postponedComponentReferences++;
				continue;
			}
			// The cache stores this PARTIAL ReactNode representation without forcing it.
			// Only typed r, arrays, and known host/Fragment children carry this role.
			if (!records.has(id) && partialCacheScope && role === "cache-output" && value[1] === "L" && canonicalFlightId(id)) {
				postponedCacheOutputs++;
				if (embeddedPartialScope && directEmbeddedOutput === true) postponedDirectOutputs++;
				if (insideRArray === true) postponedArrayOutputs++;
				continue;
			}
			if (!records.has(id)) return unknown("unresolved-model-reference", {
				modelReference: { prefix: value[1] === "L" ? "L" : value[1] === "@" ? "@" : "plain",
					form: value[1] === "L" ? "lazy-reference" : value[1] === "@" ? "promise-reference" : "model-reference", length: value.length },
				semanticRole: role,
				outputEdgeObservation:{walkPathOnly:true,fromTypedOutput:fromTypedOutput===true,directEmbeddedOutput:directEmbeddedOutput===true,rArrayOutput:rArrayOutput===true,insideRArray:insideRArray===true,arrival:outputArrival ?? "root-or-required",parentArrival:outputParentArrival ?? null},
				marker, isPartial, requestKind, decodedBytes: bytes.length, bodySha256: bodySha256(bytes),
			});
			const visit = semanticVisitKey(role,id,rArrayOutput,insideRArray,directEmbeddedOutput);
			if (!visited.has(visit)) {
				visited.add(visit);
				const record = records.get(id);
				if (shellScope && role === "fallback-output" && record.tag !== null && record.tag !== "T")
					return unknown("unsupported-runtime-shell-fallback-kind");
				if (record.tag !== "T") queue.push({ value: record.value, role:role==="cache-output" && (value[1]==="@" || record.tag!==null || record.stream) ? "required" : role, fromTypedOutput, outputArrival:"model-reference",observationOrigin:record,observationReference:value,
					rArrayOutput:rArrayOutput===true && value[1]!=="@" && record.tag===null && !record.stream,insideRArray,
					fallbackReferences: role === "fallback-output" ? new Set([...(fallbackReferences ?? []), id]) : fallbackReferences });
			}
		} else if (typeof value === "string" && plainPath.test(value)) {
			const selected = outlined(value);
			if (!selected.known) return unknown("unsupported-model-reference", {
				modelReference:{prefix:"plain",length:value.length,form:"outlined-path",pathKeyKinds:value.slice(1).split(":").slice(1,33).map(key=>["props","children","fallback","type","key","ref"].includes(key)?key:key===""?"empty":/^(0|[1-9][0-9]*)$/.test(key)?"index":"other")},
				semanticRole:role,pathFailure:pathFailure ?? (pathLimit?"depth-or-model-limit":"unavailable-own-data"),marker,isPartial,requestKind,
				...(pathLimitObservation ? {pathLimitObservation} : {}),
			});
			queue.push({value:selected.value,role,fallbackReferences,fromTypedOutput,outputArrival:"outlined-reference",rArrayOutput,insideRArray,observationOrigin:selected.modelIds?.has(selected.originId)?records.get(selected.originId):null,observationReference:value});
		} else if (
			typeof value === "string" &&
			value.startsWith("$") &&
			!value.startsWith("$$") &&
			!["$", "$undefined", "$NaN", "$Infinity", "$-Infinity", "$-0"].includes(
				value,
			)
		) {
			return unknown("unsupported-model-reference", {
				modelReference: {
					prefix: "QWiKBDnShTL@FINuZwH-".includes(value[1])
						? value[1]
						: "other",
					length: value.length,
					form: /^\$[a-f0-9]+:/.test(value)
						? "outlined-path"
						: /^\$[A-Za-z@-][a-f0-9]+:/.test(value)
							? "typed-outlined-path"
							: "other",
				},
			});
		} else if (value && typeof value === "object" && !opaqueText.has(value)) {
			if (Object.keys(value).length + queue.length > 100000) return unknown("model-limit",{modelLimitObservation:modelLimitObservation("semantic-queue-size","queue-width",Object.keys(value).length)});
			const output = ["output", "cache-output", "suspended-output", "fallback-output"].includes(role) || (embeddedPartialScope && role === "component-data");
			if (shellScope && output && Array.isArray(value) && value[0] === "$" && value.length !== 4)
				return unknown("unsupported-runtime-shell-output");
			if (shellScope && output && Array.isArray(value) && value.length === 4 && value[0] === "$") {
				const type = resolve(value[1]), props = resolve(value[3]);
				const suspense = type === "$Sreact.suspense";
				const known = suspense || type === "$Sreact.fragment" || (typeof type === "string" && type.length > 0 && !type.startsWith("$"));
				if (known) {
					if (!props || typeof props !== "object" || Array.isArray(props))
						return unknown("unknown-runtime-shell-fallback", { fallbackKind: "invalid-element-props",
							fallbackPropsKind: props === null ? "null" : props === undefined ? "unresolved" : Array.isArray(props) ? "array" : typeof props === "object" ? "object" : "scalar" });
					if (suspense) {
						knownSuspenseBoundaries++;
						// React's optional fallback prop is a known empty fallback, never a missing model row.
						if (!Object.hasOwn(props, "fallback") || props.fallback === null || props.fallback === "$undefined") knownEmptyFallbacks++;
					}
					queue.push({ value: value[1], role: "element-type", fallbackReferences, fromTypedOutput, outputArrival:"element-type",observationOrigin,observationReference }, { value: value[2], role: "element-key", fallbackReferences, fromTypedOutput, outputArrival:"element-key",observationOrigin,observationReference },
						{ value: value[3], role: role === "fallback-output" ? "fallback-host-props" : suspense ? "suspense-props" : role === "suspended-output" ? "suspended-host-props" : role === "cache-output" ? "cache-host-props" : "host-props", fallbackReferences, fromTypedOutput, outputArrival:"element-props",observationOrigin,observationReference });
					continue;
				}
				if (role === "fallback-output") {
					const id = typeof value[1] === "string" ? /^\$(?:L)?([a-f0-9]+)$/.exec(value[1])?.[1] : null;
					const module = id && records.get(id), metadata = module?.value;
					const knownModule = module?.tag === "I" && Array.isArray(metadata) && [3,4].includes(metadata.length) &&
						(typeof metadata[0] === "string" || (Number.isSafeInteger(metadata[0]) && metadata[0] >= 0)) &&
						Array.isArray(metadata[1]) && metadata[1].every(chunk=>typeof chunk === "string") && typeof metadata[2] === "string" && (metadata.length === 3 || metadata[3] === 1);
					if (partialCacheScope && knownModule && props && typeof props === "object" && !Array.isArray(props)) {
						// The cache stores this fulfilled element/props representation; it does not render the imported component.
						representedComponentFallbacks++;
						queue.push({value:value[1],role:"element-type",fromTypedOutput,outputArrival:"element-type",observationOrigin,observationReference},{value:value[2],role:"element-key",fromTypedOutput,outputArrival:"element-key",observationOrigin,observationReference},{value:value[3],role:"required",fromTypedOutput,outputArrival:"element-props",observationOrigin,observationReference});
						continue;
					}
					return unknown("unknown-runtime-shell-fallback", { fallbackKind: "component-element",
						fallbackElementTypeKind: id && records.get(id)?.tag === "I" ? "module-record" : type === undefined ? "unresolved" : Array.isArray(type) ? "array" : type && typeof type === "object" ? "object" : "other",
						fallbackPropsKind: props === null ? "null" : props === undefined ? "unresolved" : Array.isArray(props) ? "array" : typeof props === "object" ? "object" : "scalar" });
				}
				// Unknown component props may interpret children as ordinary required data.
				for (let index = value.length - 1; index >= 0; index--)
					queue.push({ value: value[index], role: index === 1 ? "element-type" : index === 3 ? "component-data" : "required", fallbackReferences,fromTypedOutput,outputArrival:index===1?"element-type":index===3?"element-props":"element-field",observationOrigin,observationReference });
				continue;
			}
			for (const [key, item] of Object.entries(value)) {
				if (role === "root" && key === "p" && embeddedRuntimePrefetch) continue;
				let nextRole = "required";
				if (shellScope && role === "root" && key === "t") nextRole = "transport";
				else if (shellScope && role === "transport" && key === "t") nextRole = "tree";
				else if (shellScope && role === "transport" && key === "h") nextRole = "data";
				else if (shellScope && role === "tree" && key === "d") nextRole = "data";
				else if (shellScope && role === "tree" && key === "c") nextRole = "tree-map";
				else if (shellScope && role === "tree-map-model" && Array.isArray(value)) nextRole = "tree-map-pair";
				else if (shellScope && role === "tree-map-pair" && Array.isArray(value) && key === "1") nextRole = "tree";
				else if (shellScope && role === "data" && key === "r") nextRole = partialCacheScope ? "cache-output" : "output";
				else if (shellScope && role === "cache-host-props" && key === "children") nextRole = "cache-output";
				else if (shellScope && key === "fallback" && role === "suspense-props") nextRole = "fallback-output";
				else if (shellScope && ["children", "fallback"].includes(key) && role === "fallback-host-props") nextRole = "fallback-output";
				else if (shellScope && key === "children" && ["suspense-props", "suspended-host-props"].includes(role)) nextRole = "suspended-output";
				else if (shellScope && key === "children" && role === "host-props") nextRole = "output";
				else if (shellScope && output && Array.isArray(value)) nextRole = role;
				else if (shellScope && role === "component-data") nextRole = role;
				queue.push({ value: item, role: nextRole, fallbackReferences, directEmbeddedOutput: embeddedPartialScope && role === "data" && key === "r",observationOrigin,observationReference,
					rArrayOutput:(partialCacheScope && role==="data" && key==="r") || (rArrayOutput===true && role==="cache-output" && Array.isArray(value) && !elementTuple(value)),
					insideRArray:role==="cache-output" && Array.isArray(value) && !elementTuple(value),
					fromTypedOutput:fromTypedOutput===true || (role==="data" && key==="r"),
					outputParentArrival:outputArrival ?? "root-or-required",
					outputArrival:role==="data" && key==="r" ? "typed-data-r" : Array.isArray(value) && output ? "array-output" : key==="children" && ["host-props","cache-host-props","suspense-props","suspended-host-props","fallback-host-props"].includes(role) ? "element-children" : key==="fallback" && role==="suspense-props" ? "element-fallback" : "own-field" });
			}
		}
		} finally {finishSemantic();}
	}
	semanticPhase="post";semanticPostStart=chargedWork;
	if (segmentContract) return {
		protocol:"bounded-required-flight-v1",complete:true,requestKind,marker,isPartial:segmentClaims.partialNodes > 0,action:false,
		requiredStage:"segment-prefetch-representation",...segmentClaims,
		postponedCacheOutputs,postponedOutputReferences,knownSuspenseBoundaries,knownEmptyFallbacks,representedComponentFallbacks,
		boundaryBytes:body.length,decodedBytes:bytes.length,bodySha256:bodySha256(bytes),serverErrors:0,explicitActionFailure:false,
		protocolRows:recordCount,modelSteps:budget.models-modelBudgetAtStart,embeddedRuntimePrefetch:null,modelCostObservation:modelCostSnapshot(),
	};
	if (!action) {
		const transport = resolve(root.t),
			tree = resolve(transport?.t);
		if (
			!transport ||
			typeof transport !== "object" ||
			!tree ||
			typeof tree !== "object" ||
			!(
				(typeof resolve(tree.s) === "string" &&
					(!resolve(tree.s).startsWith("$") ||
						resolve(tree.s).startsWith("$$"))) ||
				(resolve(tree.s) && typeof resolve(tree.s) === "object")
			)
		)
			return unknown("unsupported-navigation-transport");
	}
	if (action) {
		const result = resolve(root.a);
		if (result === undefined) return unknown("unresolved-action-result");
		if (result?.success === false && typeof result.error === "string")
		{
			let value=result.error,text=null;const seen=new Set();
			while(typeof value==="string" && /^\$[a-f0-9]+$/.test(value) && !seen.has(value) && seen.size<8){
				seen.add(value);const record=records.get(value.slice(1));
				if(record?.tag==="T" && !record.stream && typeof record.value==="string"){text=record.value;break;}
				if(!record || record.tag!==null || record.stream){value=null;break;}value=record.value;
			}
			if(text===null && typeof value==="string" && (!value.startsWith("$") || value.startsWith("$$")))text=value.startsWith("$$")?value.slice(1):value;
			const bytes=typeof text==="string"?Buffer.from(text):null;
			return {
				complete: false,
				reason: "explicit-root-action-failure",
				explicitActionFailure: true,
				returnedError:bytes && bytes.length<=controlCancellationPolicy.decodedLimit?{known:true,utf8Bytes:bytes.length,sha256:bodySha256(bytes)}:{known:false,utf8Bytes:null,sha256:null},
			};
		}
	}
	const boundary = (value) => {
		const seen = new Set();
		while (typeof value === "string" && /^\$@?[a-f0-9]+$/.test(value)) {
			const id = value.replace(/^\$@?/, "");
			if (seen.has(id) || seen.size >= 8 || !records.has(id)) return null;
			seen.add(id);
			value = records.get(id).value;
		}
		return Number.isSafeInteger(value) && value >= 0 ? value : null;
	};
	if (!action)
		for (const key of ["l", "a"]) {
			if (
				Object.hasOwn(root, key) &&
				!(key === "a" && resolve(root[key]) === null) &&
				boundary(root[key]) === null
			)
				return unknown("unsupported-boundary-metadata");
		}
	let requiredStage = "full",
		boundaryBytes = body.length,
		patchClaims = null;
	if (
		isPartial &&
		((requestKind === "embedded-runtime-prefetch") ||
			(["navigation", "runtime-shell"].includes(requestKind) && !Object.hasOwn(root, "l") && !Object.hasOwn(root, "a")))
	) {
		// Main Flight consumption is independent of the optional static/shell cache clones.
		// This proves only the represented SPA patch, retaining response-level partiality.
		let iterableFailure = null;
		const valueKind = value => value === undefined ? "absent" : value === null ? "null" : value && typeof value === "object" && opaqueText.has(value) ? "framed-text" : Array.isArray(value) ? "array" :
			value === "$undefined" ? "undefined-sentinel" : typeof value === "string" && /^\$@/.test(value) ? "promise-reference" :
			typeof value === "string" && /^\$L/.test(value) ? "lazy-reference" : typeof value === "string" && /^\$(?!\$)/.test(value) ? "reference" : typeof value;
		const patchObservation = (location,failure,raw,...resolved) => {
			const value = resolved.length ? resolved[0] : raw;
			const fields = ["r","p","v","s","t","h","q","i","S","n"];
			const descriptors = Object.fromEntries(fields.map(key=>[key,value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value,key) : undefined]));
			return {location,failure,rawKind:valueKind(raw),valueKind:valueKind(value),
				present:Object.fromEntries(fields.map(key=>[key,descriptors[key] !== undefined])),
				fieldKinds:Object.fromEntries(fields.map(key=>[key,valueKind(descriptors[key]?.value)])),
				...(["vary-stream","stale-stream"].includes(failure) && iterableFailure ? {iterable:iterableFailure} : {})};
		};
		if (
			typeof root.q !== "string" ||
			typeof root.i !== "boolean" ||
			(Object.hasOwn(root, "S") && typeof root.S !== "boolean") ||
			Object.hasOwn(root, "n")
		)
			return unknown("unsupported-navigation-patch-root", {patchDataObservation:patchObservation("root",typeof root.q !== "string" ? "query-type" : typeof root.i !== "boolean" ? "interception-type" : Object.hasOwn(root,"S") && typeof root.S !== "boolean" ? "static-flag-type" : "disallowed-root-field",root)});
		const transport = resolve(root.t),
			nodes = [transport.t],
			seen = new Set();
		let representedOutputs = 0;
		const iterableHasType = (raw, accepts) => {
			iterableFailure = null;
			const direct = typeof raw === "string" && /^\$[a-f0-9]+$/.test(raw);
			const record = direct ? records.get(raw.slice(1)) : undefined;
			const observation = {referenceForm:direct ? "model-reference" : typeof raw === "string" && plainPath.test(raw) ? "outlined-path" : "other",
				targetKnown:record !== undefined,targetTag:record?.tag ?? null,stream:record ? record.stream : null,closed:record ? record.closed : null,
				yieldCount:record?.stream && ["X","x"].includes(record.tag) ? record.value.length-(record.closed?1:0) : null,firstRejectedYield:null};
			if (!direct || !record?.stream || !record.closed || !["X","x"].includes(record.tag)) { iterableFailure=observation; return false; }
			for (const item of record.value.slice(0,-1)) {
				// React emits stream strings as T rows. Only this branded, literal Vary-param
				// yield is a string here; never resolve its contents or coerce stale-time data.
				if (accepts === varyId && item && typeof item === "object" && opaqueText.has(item) && typeof item.textValue === "string") continue;
				const value = resolve(item);
				if (!accepts(value)) { observation.firstRejectedYield={rawKind:valueKind(item),resolvedKind:valueKind(value)}; iterableFailure=observation; return false; }
			}
			return true;
		};
		const varyId = (value) =>
			value === 0 ||
			(typeof value === "string" &&
				(!value.startsWith("$") || value.startsWith("$$")));
		const staleTime = (value) =>
			typeof value === "number" && Number.isFinite(value) && value >= 0;
		let dataFailure = null;
		const dataIsTyped = (raw) => {
			const data = resolve(raw);
			const failure = !data || typeof data !== "object" || Array.isArray(data) ? "data-shape" :
				!Object.hasOwn(data,"r") ? "missing-output" : typeof data.p !== "boolean" ? "partiality-type" :
				!Object.hasOwn(data,"v") ? "missing-vary" : Object.keys(data).some(key=>!["r","p","v","s"].includes(key)) ? "data-fields" :
				data.v !== null && !iterableHasType(data.v,varyId) ? "vary-stream" : Object.hasOwn(data,"s") && !iterableHasType(data.s,staleTime) ? "stale-stream" : null;
			if (failure) { dataFailure = {failure,raw,data}; return false; }
			const output = resolve(data.r);
			const textOutput =
				typeof data.r === "string" &&
				/^\$@?[a-f0-9]+$/.test(data.r) &&
				records.get(data.r.replace(/^\$@?/, ""))?.tag === "T";
			const directLazy = typeof output === "string" && /^\$L([a-f0-9]+)$/.exec(output);
			const postponedDirect = partialCacheScope && directLazy && canonicalFlightId(directLazy[1]) && !records.has(directLazy[1]);
			if (
				!postponedDirect && (textOutput ||
				(output !== null && output !== undefined && output !== "$undefined"))
			)
				representedOutputs++;
			return true;
		};
		if (Object.keys(transport).some(key=>!["t","h"].includes(key)))
			return unknown("unsupported-navigation-patch-data", {patchDataObservation:patchObservation("transport","transport-fields",transport)});
		if (Object.hasOwn(transport,"h") && !dataIsTyped(transport.h))
			return unknown("unsupported-navigation-patch-data", {patchDataObservation:patchObservation("head-data",dataFailure.failure,dataFailure.raw,dataFailure.data)});
		if (Object.hasOwn(root,"r") && root.r !== null && !iterableHasType(root.r,varyId))
			return unknown("unsupported-navigation-patch-data", {patchDataObservation:patchObservation("root-vary","vary-stream",root.r)});
		if (Object.hasOwn(root,"s") && !iterableHasType(root.s,staleTime))
			return unknown("unsupported-navigation-patch-data", {patchDataObservation:patchObservation("root-stale","stale-stream",root.s)});
		while (nodes.length) {
			const node = resolve(nodes.pop());
			if (
				!node ||
				typeof node !== "object" ||
				Array.isArray(node) ||
				seen.has(node) ||
				seen.size >= 4096 ||
				Object.keys(node).some((key) => !["s", "h", "c", "d"].includes(key))
			)
				return unknown("unsupported-navigation-patch-tree");
			seen.add(node);
			const segment = resolve(node.s);
			if (
				typeof segment === "string"
					? segment.startsWith("$") && !segment.startsWith("$$")
					: !segment ||
						typeof segment !== "object" ||
						Array.isArray(segment) ||
						Object.keys(segment).some(
							(key) => !["n", "t", "k", "s"].includes(key),
						) ||
						typeof segment.n !== "string" ||
						typeof segment.t !== "string" ||
						!(segment.k === null || typeof segment.k === "string") ||
						!(
							segment.s === null ||
							(Array.isArray(segment.s) &&
								segment.s.every((part) => typeof part === "string"))
						)
			)
				return unknown("unsupported-navigation-patch-segment");
			if (node.h !== undefined && (!Number.isSafeInteger(node.h) || node.h < 0))
				return unknown("unsupported-navigation-patch-data", {patchDataObservation:patchObservation("node-hints","hints-integer",node.h)});
			if (Object.hasOwn(node,"d") && !dataIsTyped(node.d))
				return unknown("unsupported-navigation-patch-data", {patchDataObservation:patchObservation("node-data",dataFailure.failure,dataFailure.raw,dataFailure.data)});
			if (node.c !== undefined) {
				if (typeof node.c !== "string" || !/^\$Q[a-f0-9]+$/.test(node.c))
					return unknown("unsupported-navigation-patch-map");
				const children = resolve(records.get(node.c.slice(2))?.value);
				if (!Array.isArray(children))
					return unknown("unresolved-navigation-patch-map");
				const slots = new Set();
				for (const pair of children) {
					if (
						!Array.isArray(pair) ||
						pair.length !== 2 ||
						typeof pair[0] !== "string" ||
						slots.has(pair[0])
					)
						return unknown("unsupported-navigation-patch-map");
					slots.add(pair[0]);
					nodes.push(pair[1]);
				}
			}
		}
		if (representedOutputs === 0 && postponedCacheOutputs === 0)
			return unknown("missing-represented-navigation-output");
		patchClaims = { representedOutputs, treeNodes: seen.size,
			...(shellScope ? { postponedOutputReferences, knownSuspenseBoundaries, knownEmptyFallbacks } : {}),
			...(postponedComponentReferences || representedComponentFallbacks || postponedCacheOutputs ? { postponedComponentReferences, representedComponentFallbacks, postponedDirectOutputs, postponedArrayOutputs, postponedCacheOutputs, renderableOutputClaim: false } : {}) };
		requiredStage = postponedComponentReferences || representedComponentFallbacks || postponedCacheOutputs ? requestKind === "runtime-shell" ? "runtime-shell-cache-representation" : "embedded-partial-prefetch-representation" : requestKind === "embedded-runtime-prefetch" ? "embedded-runtime-prefetch-output" : shellScope ? "runtime-shell-output" : "navigation-patch";
	} else if (isPartial) {
		const staticBytes = boundary(root.l),
			shellBytes = boundary(root.a);
		if (staticBytes === null && shellBytes === null)
			return unknown("unresolved-required-boundary");
		boundaryBytes = staticBytes > 0 ? staticBytes : shellBytes;
		requiredStage = staticBytes > 0 ? "static" : "shell";
		if (
			!Number.isSafeInteger(boundaryBytes) ||
			boundaryBytes <= 0 ||
			boundaryBytes > body.length ||
			![...records.values()].some((record) => record.end === boundaryBytes)
		)
			return unknown("incomplete-required-boundary");
	}
	return {
		protocol: "bounded-required-flight-v1",
		complete: true,
		requestKind,
		marker,
		isPartial: Boolean(isPartial),
		...(marker === "unmarked-navigation" ? { cachedNavigations } : {}),
		action,
		requiredStage,
		...(patchClaims ?? {}),
		boundaryBytes,
		decodedBytes: bytes.length,
		bodySha256: bodySha256(bytes),
		serverErrors: 0,
		explicitActionFailure: false,
		protocolRows: recordCount, modelSteps: budget.models - modelBudgetAtStart - (embeddedRuntimePrefetch?.modelSteps ?? 0), embeddedRuntimePrefetch,closedEagerMemo:structuredClone(closedEagerMemo),modelCostObservation:modelCostSnapshot(),
	};
}

const digest = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sameRequest = (a, b) =>
	digest(a.fullUrlSha256) &&
	digest(a.requestHeadersSha256) &&
	[
		"contextId",
		"fullUrlSha256",
		"requestHeadersSha256",
		"documentGeneration",
		"method",
		"requestKind",
	].every(
		(key) =>
			typeof a[key] === "string" && a[key].length > 0 && a[key] === b[key],
	);
const goodBody = (proof, depth = 0,allowNullRoute=false) => {
	if (
		proof?.complete !== true ||
		!digest(proof.bodySha256) ||
		proof.protocol !== "bounded-required-flight-v1" ||
		typeof proof.action !== "boolean" ||
		typeof proof.isPartial !== "boolean" ||
		proof.serverErrors !== 0 ||
		proof.explicitActionFailure !== false ||
		!Number.isSafeInteger(proof.decodedBytes) ||
		proof.decodedBytes <= 0 ||
		proof.decodedBytes > controlCancellationPolicy.decodedLimit ||
		!Number.isSafeInteger(proof.boundaryBytes) ||
		proof.boundaryBytes <= 0 ||
		proof.boundaryBytes > proof.decodedBytes
	)
		return false;
	if (!Number.isSafeInteger(proof.protocolRows) || proof.protocolRows <= 0 || proof.protocolRows > 4096 ||
		!Number.isSafeInteger(proof.modelSteps) || proof.modelSteps <= 0 || proof.modelSteps > 100000 ||
		!Object.hasOwn(proof, "embeddedRuntimePrefetch") || depth > 1 || (proof.requestKind === "embedded-runtime-prefetch" && depth !== 1)) return false;
	if ((Object.hasOwn(proof, "postponedComponentReferences") || Object.hasOwn(proof, "representedComponentFallbacks") || Object.hasOwn(proof, "postponedDirectOutputs") || Object.hasOwn(proof, "postponedArrayOutputs") || Object.hasOwn(proof, "postponedCacheOutputs") || Object.hasOwn(proof, "renderableOutputClaim")) &&
		!["embedded-partial-prefetch-representation","runtime-shell-cache-representation"].includes(proof.requiredStage) &&
		!(proof.requiredStage==="route-tree-structure" && proof.renderableOutputClaim===false && !["postponedComponentReferences","representedComponentFallbacks","postponedDirectOutputs","postponedArrayOutputs","postponedCacheOutputs"].some(key=>Object.hasOwn(proof,key)))) return false;
	const embedded = proof.embeddedRuntimePrefetch;
	if (embedded !== null && (depth !== 0 || proof.requestKind !== "navigation" || embedded?.requestKind !== "embedded-runtime-prefetch" || !goodBody(embedded, depth + 1) ||
		proof.decodedBytes + embedded.decodedBytes > controlCancellationPolicy.decodedLimit || proof.protocolRows + embedded.protocolRows > 4096 ||
		proof.modelSteps + embedded.modelSteps > 100000)) return false;
	if (proof.marker === "complete") {
		if (proof.isPartial) return false;
	} else if (proof.marker === "partial") {
		if (!proof.isPartial) return false;
	} else if (proof.marker === "unmarked-action") {
		if (!proof.action || proof.isPartial) return false;
	} else if (proof.marker === "unmarked-route-tree") {
		if(proof.action || proof.isPartial || proof.requestKind!=="route-tree") return false;
	} else if (proof.marker === "unmarked-navigation") {
		if (
			proof.action ||
			typeof proof.cachedNavigations !== "boolean" ||
			proof.isPartial !== proof.cachedNavigations
		)
			return false;
	} else return false;
	if (proof.requiredStage === "route-tree-structure") {
		const binding=proof.routeTreeBinding;
		if(!Number.isSafeInteger(proof.routeNullNodes) || proof.routeNullNodes<0 || proof.routeNullNodes>proof.treeNodes || !Object.hasOwn(proof,"routeReadiness"))return false;
		if(proof.routeNullNodes>0){
			if(!allowNullRoute || proof.routeReadiness?.nullNodes!==proof.routeNullNodes || !knownRouteReadiness(proof.routeReadiness,binding,proof.bodySha256,proof.treeNodes,proof.metadataPages))return false;
		}else if(proof.routeReadiness!==null || ["requestUrlSha256","requestOriginSha256","ambiguousRedirect"].some(key=>Object.hasOwn(binding ?? {},key)))return false;
		return (
			proof.requestKind === "route-tree" &&
			!proof.action && proof.marker==="unmarked-route-tree" && proof.isPartial===false && proof.renderableOutputClaim===false &&
			Number.isSafeInteger(proof.metadataPages) && proof.metadataPages>0 && proof.metadataPages<=proof.treeNodes &&
			binding?.method==="GET" && binding.status===200 && ["flight","rsc","prefetch","manifestVerified"].every(key=>binding[key]===true) && typeof binding.postponed==="boolean" &&
			digest(binding.requestHeadersSha256) && digest(binding.compiledManifestSha256) && /^[a-f0-9]{40}$/.test(binding.compiledBuild ?? "") &&
			binding.requestKeySha256===bodySha256(Buffer.from("/_tree")) && binding.derivedRequestKeySha256===binding.requestKeySha256 &&
			binding.expectedDeploymentSha256===bodySha256(Buffer.from(binding.compiledBuild)) && binding.actualDeploymentSha256===binding.expectedDeploymentSha256 &&
			(binding.responseDeploymentSha256===null || digest(binding.responseDeploymentSha256)) && binding.actualDeploymentSha256===(binding.responseDeploymentSha256 ?? binding.bodyBuildSha256) && binding.deploymentSource===(binding.responseDeploymentSha256===null?"body":"response-header") &&
			Number.isSafeInteger(proof.treeNodes) &&
			proof.treeNodes > 0 &&
			proof.treeNodes <= 4096
		);
	}
	if (["runtime-shell-output", "runtime-shell-cache-representation", "embedded-runtime-prefetch-output", "embedded-partial-prefetch-representation"].includes(proof.requiredStage))
		return proof.requestKind === (["runtime-shell-output","runtime-shell-cache-representation"].includes(proof.requiredStage) ? "runtime-shell" : "embedded-runtime-prefetch") &&
			!proof.action && proof.marker === "partial" && proof.isPartial &&
			Number.isSafeInteger(proof.treeNodes) && proof.treeNodes > 0 && proof.treeNodes <= 4096 &&
			Number.isSafeInteger(proof.representedOutputs) && proof.representedOutputs >= (["embedded-partial-prefetch-representation","runtime-shell-cache-representation"].includes(proof.requiredStage) ? 0 : 1) && proof.representedOutputs <= proof.treeNodes + 1 &&
			Number.isSafeInteger(proof.postponedOutputReferences) && proof.postponedOutputReferences >= 0 && proof.postponedOutputReferences <= 100000 &&
			Number.isSafeInteger(proof.knownSuspenseBoundaries) && proof.knownSuspenseBoundaries >= 0 && proof.knownSuspenseBoundaries <= 100000 &&
			Number.isSafeInteger(proof.knownEmptyFallbacks) && proof.knownEmptyFallbacks >= 0 && proof.knownEmptyFallbacks <= proof.knownSuspenseBoundaries &&
			(proof.postponedOutputReferences === 0 || proof.knownSuspenseBoundaries > 0) &&
			(!["embedded-partial-prefetch-representation","runtime-shell-cache-representation"].includes(proof.requiredStage) ||
				(proof.renderableOutputClaim === false && Number.isSafeInteger(proof.postponedComponentReferences) && proof.postponedComponentReferences >= 0 && proof.postponedComponentReferences <= 100000 &&
				Number.isSafeInteger(proof.representedComponentFallbacks) && proof.representedComponentFallbacks >= 0 && proof.representedComponentFallbacks <= 100000 &&
				Number.isSafeInteger(proof.postponedDirectOutputs) && proof.postponedDirectOutputs >= 0 && proof.postponedDirectOutputs <= proof.treeNodes + 1 &&
				Number.isSafeInteger(proof.postponedArrayOutputs) && proof.postponedArrayOutputs >= 0 && proof.postponedArrayOutputs <= 100000 &&
				Number.isSafeInteger(proof.postponedCacheOutputs) && proof.postponedCacheOutputs >= 0 && proof.postponedCacheOutputs <= 100000 &&
				proof.postponedDirectOutputs + proof.postponedArrayOutputs <= proof.postponedCacheOutputs &&
				(proof.requiredStage !== "runtime-shell-cache-representation" || (proof.postponedComponentReferences === 0 && proof.postponedDirectOutputs === 0)) &&
				proof.postponedCacheOutputs + proof.representedOutputs > 0 && proof.postponedDirectOutputs + proof.representedOutputs <= proof.treeNodes + 1 &&
				proof.postponedComponentReferences + proof.representedComponentFallbacks + proof.postponedCacheOutputs > 0 &&
				proof.postponedComponentReferences + proof.representedComponentFallbacks + proof.postponedCacheOutputs <= proof.modelSteps));
	if (
		proof.action !== (proof.requestKind === "action") ||
		!["action", "navigation", "embedded-runtime-prefetch"].includes(proof.requestKind)
	)
		return false;
	if (proof.requiredStage === "navigation-patch")
		return (
			proof.requestKind === "navigation" &&
			!proof.action &&
			proof.isPartial &&
			Number.isSafeInteger(proof.treeNodes) &&
			proof.treeNodes > 0 &&
			proof.treeNodes <= 4096 &&
			Number.isSafeInteger(proof.representedOutputs) &&
			proof.representedOutputs > 0 &&
			proof.representedOutputs <= proof.treeNodes + 1
		);
	if (proof.requestKind === "embedded-runtime-prefetch") return proof.requiredStage === "full" && !proof.isPartial;
	return proof.requiredStage === "full"
		? !proof.isPartial
		: ["static", "shell"].includes(proof.requiredStage) && proof.isPartial;
};
const pick = (row, keys) =>
	Object.fromEntries(
		keys
			.filter((key) => row?.[key] !== undefined)
			.map((key) => [key, row[key]]),
	);
const bodyReceipt = (row) => {
	const proof = pick(row, [
		"protocol",
		"complete",
		"reason",
		"requestKind",
		"marker",
		"isPartial",
		"cachedNavigations",
		"action",
		"requiredStage",
		"treeNodes",
		"metadataPages",
		"routeTreeBinding",
		"routeNullNodes",
		"routeReadiness",
		"partialNodes",
		"completeNodes",
		"segmentBinding",
		"representedOutputs",
		"postponedOutputReferences",
		"postponedComponentReferences",
		"representedComponentFallbacks",
		"postponedDirectOutputs",
		"postponedArrayOutputs",
		"postponedCacheOutputs",
		"renderableOutputClaim",
		"knownSuspenseBoundaries",
		"knownEmptyFallbacks",
		"protocolRows",
		"modelSteps",
		"boundaryBytes",
		"decodedBytes",
		"bodySha256",
		"serverErrors",
		"explicitActionFailure",
	]);
	if (Object.hasOwn(row, "embeddedRuntimePrefetch")) proof.embeddedRuntimePrefetch = row.embeddedRuntimePrefetch === null ? null : bodyReceipt(row.embeddedRuntimePrefetch);
	return proof;
};
const receivedBody = (row) =>
	row.bodyReadbackComplete === true ||
	(row.streamReceipt?.protocol === "passive-network-copy-v1" &&
		row.streamReceipt.sourceRevision === chromiumSWRRevision &&
		row.streamReceipt.captureComplete === true &&
		["failed", "finished"].includes(row.streamReceipt.terminal) &&
		Number.isSafeInteger(row.streamReceipt.capturedBytes) &&
		row.streamReceipt.capturedBytes > 0 &&
		row.streamReceipt.capturedBytes === row.streamReceipt.observedDataLength &&
		row.streamReceipt.capturedBytes === row.bodyProof?.decodedBytes &&
		row.streamReceipt.reason === null);
const requestReceipt = (row) => ({
	...pick(row, [
		"contextId",
		"requestId",
		"failedEventOrdinal",
		"id",
		"traceId",
		"loaderId",
		"fullUrlSha256",
		"requestOriginSha256",
		"requestHeadersSha256",
		"headerFieldSha256",
		"initialHeaderIdentity",
		"extraHeaderIdentity",
		"requestHeadersKnown",
		"requestHeaderSnapshotKnown",
		"responseHeaderSnapshotKnown",
		"responseContentType",
		"pathSourceFacts",
		"initialSegmentResponse",
		"responseDeploymentSha256",
		"postponed",
		"vary",
		"transportBodyReceipt",
		"bodyReadbackReceipt",
		"browserDataLedger",
		"rsc",
		"purposeHeaderPresent",
		"secPurposeHeaderPresent",
		"documentGeneration",
		"method",
		"requestKind",
		"status",
		"action",
		"flight",
		"prefetch",
		"type",
		"initiator",
		"initiatorStackKnownAbsent",
		"priority",
		"startedAt",
		"finishedAt",
		"canceled",
		"error",
		"proxyResponseId",
		"bodyReadbackComplete",
		"ambiguousRedirect",
		"httpErrorObserved",
		"observedProtocolError",
		"upstreamError",
		"complete",
		"staleWhileRevalidateSeconds",
		"fromDiskCache",
		"fromServiceWorker",
		"loadingFinished",
		"failed",
	]),
	...(row?.bodyProof ? { bodyProof: bodyReceipt(row.bodyProof) } : {}),
	...(row?.streamReceipt
		? {
				streamReceipt: pick(row.streamReceipt, [
					"protocol",
					"sourceRevision",
					"captureComplete",
					"terminal",
					"capturedBytes",
					"observedDataLength",
					"reason",
				]),
			}
		: {}),
});

const knownNativeContext = context => {
	try {
		const binding=context?.binding,env=context?.environment,principal=context?.principalEpoch,census=context?.headerCensus,lifetime=context?.headerLifetime;
		if(context?.protocol !== "qualified-known-extra-native-context-v1" || typeof context.contextId !== "string" || !context.contextId || !digest(context.originSha256) ||
			!knownBrowserControlMetadata(binding) || binding.browserVerified !== true || binding.manifestVerified !== true ||
			!knownNativePublicSources(binding.nativePublicSources,binding.compiledBuild,binding.compiledManifestSha256) ||
			!context.protocolSources || Object.keys(context.protocolSources).length > 64 || Object.entries(context.protocolSources).some(([file,sha])=>file.length > 256 || !digest(sha)) ||
			!["run-baseline.mjs","settled-resources.mjs","mixed-load-probe.mjs"].includes(context.operatorFile) ||
			![context.operatorFile,"control-cancellation-evidence.mjs","browser-control-collector.mjs","fixture-browser.mjs","trace-transport.mjs","action-result-observer.mjs","proxy-header-census.mjs","cdp-cached-text-projection.mjs"].every(file=>digest(context.protocolSources?.[file]))) return false;
		const errors=context.protocolErrors;
		if(errors?.protocol !== "positive-flight-error-observations-v1" || errors.contextId !== context.contextId || errors.installed !== true || errors.scopeClosed !== true ||
			errors.observed !== 0 || errors.overflow !== 0 || !Array.isArray(errors.records) || errors.records.length !== 0) return false;
		const actualFiles = value => value?.protocol === "serving-public-worker-source-metadata-v1" && value.servingRootKnown === true && Array.isArray(value.files) && value.files.length === 4 &&
			value.files.every((row,index)=>row.known === true && row.reason === null && row.file === binding.nativePublicSources.files[index].file && row.bytes === binding.nativePublicSources.files[index].bytes && row.sha256 === binding.nativePublicSources.files[index].sha256);
		if(env?.protocol !== "native-cache-environment-metadata-v1" || env.contextId !== context.contextId || !actualFiles(env.servingPublicSources)) return false;
		const launch=env.nativeLaunchMetadata;
		if(launch?.protocol !== "owned-native-launch-metadata-v1" || launch.processKnown !== true || launch.fixturePolicy !== "isolated-profile-no-prediction-v1" || launch.argumentsKnown !== true ||
			!digest(launch.argumentsSha256) || launch.argumentsSha256 !== launch.recordedArgumentsSha256 || launch.argumentsMatchRecorded !== true ||
			!Array.isArray(launch.argumentKeys) || launch.argumentKeys.length > 1024 || launch.argumentKeys.some(value=>typeof value!=="string" || value.length>128) || !launch.argumentKeys.includes("--disable-extensions") ||
			launch.profileArgumentCount !== 1 || !digest(launch.profileArgumentSha256) || launch.profileArgumentSha256 !== launch.recordedProfileDirectorySha256 || launch.profileArgumentMatchesRecorded !== true ||
			launch.executable?.known !== true || !digest(launch.executable.sha256) || !Number.isSafeInteger(launch.executable.bytes) || launch.executable.bytes <= 0 || launch.executable.bytes > 1024*1024*1024 ||
			!Array.isArray(launch.observerSources) || launch.observerSources.length !== 2 || !["browser-control-collector.mjs","fixture-browser.mjs"].every(file=>{
				const rows=launch.observerSources.filter(row=>row.file===file);return rows.length===1 && rows[0].known===true && rows[0].sha256===context.protocolSources[file];})) return false;
		const workers=env.workerTargets;
		if(workers?.protocol !== "owned-context-worker-target-metadata-v1" || workers.contextId !== context.contextId || workers.contextJoinKnown !== true || !digest(workers.contextIdentitySha256) ||
			workers.installed !== true || workers.scopeClosed !== true || workers.errors !== 0 || workers.overflow !== 0 || !Array.isArray(workers.events) || workers.events.length === 0 || workers.events.length > 256 ||
			workers.events.some(row=>!["page","service_worker"].includes(row.type) || row.urlKnown !== true || !digest(row.urlSha256) ||
				(row.type === "service_worker" ? row.ownedWorkerScript !== true || row.originMatches !== true : row.originMatches !== true && row.urlSha256 !== bodySha256(Buffer.from("about:blank"))))) return false;
		const end=env.endRead,controller=end?.controller;
		const ownedWorker = value=>value?.present === true && value.known === true && value.ownedScript === true && value.state === "activated" && digest(value.scriptUrlSha256);
		if(end?.protocol !== "native-environment-end-readonly-v1" || end.timedOut !== false || end.pendingOperations !== 0 || end.readErrors !== 0 || !actualFiles(end.publicSourceRecheck) ||
			controller?.available !== true || controller.secureContext !== true || controller.originMatches !== true || controller.controllerIdentityStable !== true ||
			!ownedWorker(controller.controllerBefore) || !ownedWorker(controller.controllerAfter) || controller.controllerBefore.scriptUrlSha256 !== controller.controllerAfter.scriptUrlSha256 ||
			controller.registrationCount !== 1 || controller.registrationOverflow !== 0 || !Array.isArray(controller.registrations) || controller.registrations.length !== 1) return false;
		const registration=controller.registrations[0];
		if(registration.scopeKnown !== true || !digest(registration.scopeSha256) || registration.ownedRootScope !== true || !ownedWorker(registration.active) ||
			registration.active.scriptUrlSha256 !== controller.controllerAfter.scriptUrlSha256 || ![registration.waiting,registration.installing].every(value=>value?.present === false && value.known === true)) return false;
		if(!digest(context.workerScriptSha256) || !digest(context.rootScopeSha256) || registration.scopeSha256!==context.rootScopeSha256 || controller.controllerBefore.scriptUrlSha256!==context.workerScriptSha256 ||
			workers.events.some(row=>!["initial","created","changed","destroyed"].includes(row.event) || !Number.isSafeInteger(row.targetOrdinal) || row.targetOrdinal<=0 || row.type==="service_worker" && row.urlSha256!==context.workerScriptSha256)) return false;
		if(principal?.protocol !== "actual-browser-cookie-boundaries-v1" || principal.contextId !== context.contextId || principal.scopeClosed !== true ||
			!["observedSetCookieResponses","unknownResponseHeaders","readErrors","pendingReads","observationErrors","overflow"].every(key=>principal[key]===0) ||
			![principal.before,principal.after].every(row=>row?.known === true && row.cookieCount===1 && digest(row.sha256) && row.cookieAttributes?.originKnown === true &&
				row.cookieAttributes.httpOnlyKnown === true && row.cookieAttributes.allHttpOnly === true && row.cookieAttributes.singleOwnedRootHttpOnlyCookie === true && digest(row.cookieAttributes.singleCookieHeaderSha256)) ||
			principal.before.sha256 !== principal.after.sha256 || principal.before.cookieAttributes.singleCookieHeaderSha256 !== principal.after.cookieAttributes.singleCookieHeaderSha256) return false;
		if(!validateProxyHeaderCensus(census,{contextId:context.contextId}) || census.closed !== true || census.counts.accepted <= 0 || census.counts.knownHeaders !== census.counts.accepted ||
			census.requests.map(row=>Number(row.requestId.split(".")[1])).sort((a,b)=>a-b).some((id,index)=>id !== index+1) ||
			!["pending","unknownHeaders","terminalBeforeHeaders","setCookieResponses","setCookieLines","errors","duplicates","missing","late","overflow"].every(key=>census.counts[key]===0) ||
			lifetime?.protocol !== "owned-context-upstream-header-lifetime-v1" || lifetime.contextId !== context.contextId) return false;
		const installation=lifetime.installation,closure=lifetime.closure;
		return installation?.protocol === lifetime.protocol && /^[a-f0-9]{32}$/.test(installation.proxyInstanceId ?? "") && installation.originSha256 === context.originSha256 &&
			installation.acceptedRequestsAtInstall === 0 && Array.isArray(installation.allowedOriginSha256) && installation.allowedOriginSha256.length > 0 && installation.allowedOriginSha256.length <= 32 &&
			installation.allowedOriginSha256.every(digest) && new Set(installation.allowedOriginSha256).size === installation.allowedOriginSha256.length && installation.allowedOriginSha256.includes(context.originSha256) &&
			closure?.serverClosed === true && closure.acceptedRequests === census.counts.accepted && closure.upstreamRequests === census.counts.accepted && closure.closedUpstreams === census.counts.accepted && closure.pendingUpstreams === 0;
	}catch{return false;}
};

/** Open authority is independently checked; no closed/end-read fields are manufactured. */
const knownProgressReadHistory=principal=>{
 const reads=principal?.progressReads;
 if(!Number.isSafeInteger(principal?.pendingReads) || principal.pendingReads<0 || reads?.protocol!=="owned-read-only-principal-operations-v1" || !Number.isSafeInteger(reads.started) || reads.started<0 || reads.started>controlCancellationPolicy.recordLimit || !Number.isSafeInteger(reads.finished) || reads.finished<0 || reads.finished>reads.started || !Array.isArray(reads.records) || reads.records.length!==reads.started || !Array.isArray(reads.pending) || reads.pending.length!==principal.pendingReads || reads.started-reads.finished!==principal.pendingReads)return false;
 const ids=new Set(),starts=[],ends=[],pending=[];
 for(const row of reads.records){
  if(Object.keys(row).length!==6 || !Number.isSafeInteger(row.acknowledgmentOrdinal) || row.acknowledgmentOrdinal<1 || row.acknowledgmentOrdinal>controlCancellationPolicy.recordLimit || ids.has(row.acknowledgmentOrdinal) || row.kind!=="read-only-context-cookies-v1" || !Number.isSafeInteger(row.startedOrdinal) || row.startedOrdinal<1 || row.error!==false)return false;
  ids.add(row.acknowledgmentOrdinal);starts.push(row.startedOrdinal);
  if(row.finishedOrdinal===null){if(row.snapshotSha256!==null)return false;pending.push({acknowledgmentOrdinal:row.acknowledgmentOrdinal,kind:row.kind});}
  else{if(!Number.isSafeInteger(row.finishedOrdinal) || row.finishedOrdinal<1 || !digest(row.snapshotSha256))return false;ends.push(row.finishedOrdinal);}
 }
 return starts.sort((a,b)=>a-b).every((n,i)=>n===i+1) && ends.length===reads.finished && ends.sort((a,b)=>a-b).every((n,i)=>n===i+1) && JSON.stringify(pending.sort((a,b)=>a.acknowledgmentOrdinal-b.acknowledgmentOrdinal))===JSON.stringify(reads.pending);
};
export const knownMixedOpenJournals = context => {
 const headerPrefix=context?.headerPrefix;
	try {
		const binding=context?.binding,env=context?.environment,principal=context?.principalEpoch,census=context?.headerCensus,lifetime=context?.headerLifetime;
		if(context?.protocol !== "qualified-known-extra-native-context-v1" || typeof context.contextId !== "string" || !context.contextId || !digest(context.originSha256) ||
			!knownBrowserControlMetadata(binding) || binding.browserVerified !== true || binding.manifestVerified !== true ||
			!knownNativePublicSources(binding.nativePublicSources,binding.compiledBuild,binding.compiledManifestSha256) ||
			!context.protocolSources || Object.keys(context.protocolSources).length > 64 || Object.entries(context.protocolSources).some(([file,sha])=>file.length > 256 || !digest(sha)) ||
			context.operatorFile!=="mixed-load-probe.mjs" ||
			![context.operatorFile,"control-cancellation-evidence.mjs","browser-control-collector.mjs","fixture-browser.mjs","trace-transport.mjs","action-result-observer.mjs","proxy-header-census.mjs","cdp-cached-text-projection.mjs"].every(file=>digest(context.protocolSources?.[file]))) return false;
		const errors=context.protocolErrors;
		if(errors?.protocol !== "positive-flight-error-observations-v1" || errors.contextId !== context.contextId || errors.installed !== true || errors.scopeClosed !== false ||
			errors.observed !== 0 || errors.overflow !== 0 || !Array.isArray(errors.records) || errors.records.length !== 0) return false;
		const actualFiles = value => value?.protocol === "serving-public-worker-source-metadata-v1" && value.servingRootKnown === true && Array.isArray(value.files) && value.files.length === 4 &&
			value.files.every((row,index)=>row.known === true && row.reason === null && row.file === binding.nativePublicSources.files[index].file && row.bytes === binding.nativePublicSources.files[index].bytes && row.sha256 === binding.nativePublicSources.files[index].sha256);
		if(env?.protocol !== "native-cache-environment-metadata-v1" || env.contextId !== context.contextId || !actualFiles(env.servingPublicSources)) return false;
		const launch=env.nativeLaunchMetadata;
		if(launch?.protocol !== "owned-native-launch-metadata-v1" || launch.processKnown !== true || launch.fixturePolicy !== "isolated-profile-no-prediction-v1" || launch.argumentsKnown !== true ||
			!digest(launch.argumentsSha256) || launch.argumentsSha256 !== launch.recordedArgumentsSha256 || launch.argumentsMatchRecorded !== true ||
			!Array.isArray(launch.argumentKeys) || launch.argumentKeys.length > 1024 || launch.argumentKeys.some(value=>typeof value!=="string" || value.length>128) || !launch.argumentKeys.includes("--disable-extensions") ||
			launch.profileArgumentCount !== 1 || !digest(launch.profileArgumentSha256) || launch.profileArgumentSha256 !== launch.recordedProfileDirectorySha256 || launch.profileArgumentMatchesRecorded !== true ||
			launch.executable?.known !== true || !digest(launch.executable.sha256) || !Number.isSafeInteger(launch.executable.bytes) || launch.executable.bytes <= 0 || launch.executable.bytes > 1024*1024*1024 ||
			!Array.isArray(launch.observerSources) || launch.observerSources.length !== 2 || !["browser-control-collector.mjs","fixture-browser.mjs"].every(file=>{
				const rows=launch.observerSources.filter(row=>row.file===file);return rows.length===1 && rows[0].known===true && rows[0].sha256===context.protocolSources[file];})) return false;
		const workers=env.workerTargets;
		if(workers?.protocol !== "owned-context-worker-target-metadata-v1" || workers.contextId !== context.contextId || workers.contextJoinKnown !== true || !digest(workers.contextIdentitySha256) ||
			workers.installed !== true || workers.scopeClosed !== false || workers.errors !== 0 || workers.overflow !== 0 || !Array.isArray(workers.events) || workers.events.length === 0 || workers.events.length > 256 ||
			workers.events.some(row=>!["page","service_worker"].includes(row.type) || row.urlKnown !== true || !digest(row.urlSha256) ||
				(row.type === "service_worker" ? row.ownedWorkerScript !== true || row.originMatches !== true : row.originMatches !== true && row.urlSha256 !== bodySha256(Buffer.from("about:blank"))))) return false;
  if(!digest(context.workerScriptSha256) || !digest(context.rootScopeSha256) || workers.events.some(row=>!["initial","created","changed","destroyed"].includes(row.event) || !Number.isSafeInteger(row.targetOrdinal) || row.targetOrdinal<=0 || row.type==="service_worker" && row.urlSha256!==context.workerScriptSha256) || !knownMixedDocumentJournal(context.documentJournal) || context.documentJournal.closed!==false || context.documentJournal.contextId!==context.contextId)return false;
  if(principal?.protocol!=="actual-browser-cookie-boundaries-v1" || principal.contextId!==context.contextId || principal.scopeClosed!==false || !["observedSetCookieResponses","unknownResponseHeaders","readErrors","observationErrors","overflow"].every(key=>principal[key]===0) || !knownProgressReadHistory(principal))return false;
  if(!validateProxyHeaderPrefix(headerPrefix,{contextId:context.contextId}) || JSON.stringify(census)!==JSON.stringify(headerPrefix.census) || !["unknownHeaders","setCookieResponses","setCookieLines","errors","duplicates","missing","late","overflow"].every(key=>census.counts[key]===0) || headerPrefix.lifecycle.errors!==0 || headerPrefix.lifecycle.overflow!==0 || headerPrefix.lifecycle.upstreamRequests!==census.counts.accepted || lifetime?.protocol!=="owned-context-upstream-header-lifetime-v1" || lifetime.contextId!==context.contextId || lifetime.closure!==null)return false;
  const installation=lifetime.installation,life=headerPrefix.lifecycle;
  return installation?.protocol===lifetime.protocol && installation.proxyInstanceId===life.proxyInstanceId && installation.originSha256===context.originSha256 && life.originSha256===context.originSha256 && installation.acceptedRequestsAtInstall===0 && JSON.stringify(installation.allowedOriginSha256)===JSON.stringify(life.allowedOriginSha256);
 }catch{return false;}
};
export const sameMixedReturnJournals=(begin,current)=>knownMixedOpenJournals(current) && sameHeaderJournalPrefix(begin.headerPrefix.lifecycle,current.headerPrefix.lifecycle) && samePrincipalJournalPrefix(begin.principalEpoch,current.principalEpoch) && JSON.stringify(current.documentJournal)===JSON.stringify(begin.documentJournal) && Array.isArray(begin.environment?.workerTargets?.events) && JSON.stringify(current.environment.workerTargets.events.slice(0,begin.environment.workerTargets.events.length))===JSON.stringify(begin.environment.workerTargets.events);

const knownMixedPrefixAuthority = (context,ack,headerPrefix) => {
	try {
		const binding=context?.binding,env=context?.environment,principal=context?.principalEpoch,census=context?.headerCensus,lifetime=context?.headerLifetime;
		if(context?.protocol !== "qualified-known-extra-native-context-v1" || typeof context.contextId !== "string" || !context.contextId || !digest(context.originSha256) ||
			!knownBrowserControlMetadata(binding) || binding.browserVerified !== true || binding.manifestVerified !== true ||
			!knownNativePublicSources(binding.nativePublicSources,binding.compiledBuild,binding.compiledManifestSha256) ||
			!context.protocolSources || Object.keys(context.protocolSources).length > 64 || Object.entries(context.protocolSources).some(([file,sha])=>file.length > 256 || !digest(sha)) ||
			context.operatorFile!=="mixed-load-probe.mjs" ||
			![context.operatorFile,"control-cancellation-evidence.mjs","browser-control-collector.mjs","fixture-browser.mjs","trace-transport.mjs","action-result-observer.mjs","proxy-header-census.mjs","cdp-cached-text-projection.mjs"].every(file=>digest(context.protocolSources?.[file]))) return false;
		const errors=context.protocolErrors;
		if(errors?.protocol !== "positive-flight-error-observations-v1" || errors.contextId !== context.contextId || errors.installed !== true || errors.scopeClosed !== false ||
			errors.observed !== 0 || errors.overflow !== 0 || !Array.isArray(errors.records) || errors.records.length !== 0) return false;
		const actualFiles = value => value?.protocol === "serving-public-worker-source-metadata-v1" && value.servingRootKnown === true && Array.isArray(value.files) && value.files.length === 4 &&
			value.files.every((row,index)=>row.known === true && row.reason === null && row.file === binding.nativePublicSources.files[index].file && row.bytes === binding.nativePublicSources.files[index].bytes && row.sha256 === binding.nativePublicSources.files[index].sha256);
		if(env?.protocol !== "native-cache-environment-metadata-v1" || env.contextId !== context.contextId || !actualFiles(env.servingPublicSources)) return false;
		const launch=env.nativeLaunchMetadata;
		if(launch?.protocol !== "owned-native-launch-metadata-v1" || launch.processKnown !== true || launch.fixturePolicy !== "isolated-profile-no-prediction-v1" || launch.argumentsKnown !== true ||
			!digest(launch.argumentsSha256) || launch.argumentsSha256 !== launch.recordedArgumentsSha256 || launch.argumentsMatchRecorded !== true ||
			!Array.isArray(launch.argumentKeys) || launch.argumentKeys.length > 1024 || launch.argumentKeys.some(value=>typeof value!=="string" || value.length>128) || !launch.argumentKeys.includes("--disable-extensions") ||
			launch.profileArgumentCount !== 1 || !digest(launch.profileArgumentSha256) || launch.profileArgumentSha256 !== launch.recordedProfileDirectorySha256 || launch.profileArgumentMatchesRecorded !== true ||
			launch.executable?.known !== true || !digest(launch.executable.sha256) || !Number.isSafeInteger(launch.executable.bytes) || launch.executable.bytes <= 0 || launch.executable.bytes > 1024*1024*1024 ||
			!Array.isArray(launch.observerSources) || launch.observerSources.length !== 2 || !["browser-control-collector.mjs","fixture-browser.mjs"].every(file=>{
				const rows=launch.observerSources.filter(row=>row.file===file);return rows.length===1 && rows[0].known===true && rows[0].sha256===context.protocolSources[file];})) return false;
		const workers=env.workerTargets;
		if(workers?.protocol !== "owned-context-worker-target-metadata-v1" || workers.contextId !== context.contextId || workers.contextJoinKnown !== true || !digest(workers.contextIdentitySha256) ||
			workers.installed !== true || workers.scopeClosed !== false || workers.errors !== 0 || workers.overflow !== 0 || !Array.isArray(workers.events) || workers.events.length === 0 || workers.events.length > 256 ||
			workers.events.some(row=>!["page","service_worker"].includes(row.type) || row.urlKnown !== true || !digest(row.urlSha256) ||
				(row.type === "service_worker" ? row.ownedWorkerScript !== true || row.originMatches !== true : row.originMatches !== true && row.urlSha256 !== bodySha256(Buffer.from("about:blank"))))) return false;
		const end=ack,controller=end?.controller;
		const ownedWorker = value=>value?.present === true && value.known === true && value.ownedScript === true && value.state === "activated" && digest(value.scriptUrlSha256);
		if(end?.protocol !== "native-environment-progress-readonly-v1" || end.timedOut !== false || end.pendingOperations !== 0 || end.readErrors !== 0 || !actualFiles(end.publicSourceRecheck) ||
			controller?.available !== true || controller.secureContext !== true || controller.originMatches !== true || controller.controllerIdentityStable !== true ||
			!ownedWorker(controller.controllerBefore) || !ownedWorker(controller.controllerAfter) || controller.controllerBefore.scriptUrlSha256 !== controller.controllerAfter.scriptUrlSha256 ||
			controller.registrationCount !== 1 || controller.registrationOverflow !== 0 || !Array.isArray(controller.registrations) || controller.registrations.length !== 1) return false;
		const registration=controller.registrations[0];
		if(registration.scopeKnown !== true || !digest(registration.scopeSha256) || registration.ownedRootScope !== true || !ownedWorker(registration.active) ||
			registration.active.scriptUrlSha256 !== controller.controllerAfter.scriptUrlSha256 || ![registration.waiting,registration.installing].every(value=>value?.present === false && value.known === true)) return false;
		if(!digest(context.workerScriptSha256) || !digest(context.rootScopeSha256) || registration.scopeSha256!==context.rootScopeSha256 || controller.controllerBefore.scriptUrlSha256!==context.workerScriptSha256 ||
			workers.events.some(row=>!["initial","created","changed","destroyed"].includes(row.event) || !Number.isSafeInteger(row.targetOrdinal) || row.targetOrdinal<=0 || row.type==="service_worker" && row.urlSha256!==context.workerScriptSha256)) return false;
		if(principal?.protocol !== "actual-browser-cookie-boundaries-v1" || principal.contextId !== context.contextId || principal.scopeClosed !== false ||
			!["observedSetCookieResponses","unknownResponseHeaders","readErrors","observationErrors","overflow"].every(key=>principal[key]===0) ||
			!knownProgressReadHistory(principal) ||
			![principal.before,ack.principalRead].every(row=>row?.known === true && row.cookieCount===1 && digest(row.sha256) && row.cookieAttributes?.originKnown === true &&
				row.cookieAttributes.httpOnlyKnown === true && row.cookieAttributes.allHttpOnly === true && row.cookieAttributes.singleOwnedRootHttpOnlyCookie === true && digest(row.cookieAttributes.singleCookieHeaderSha256)) ||
			principal.before.sha256 !== ack.principalRead.sha256 || principal.before.cookieAttributes.singleCookieHeaderSha256 !== ack.principalRead.cookieAttributes.singleCookieHeaderSha256) return false;
		if(!validateProxyHeaderPrefix(headerPrefix,{contextId:context.contextId}) || JSON.stringify(census)!==JSON.stringify(headerPrefix.census) || census.counts.accepted<=0 ||
   !["unknownHeaders","setCookieResponses","setCookieLines","errors","duplicates","missing","late","overflow"].every(key=>census.counts[key]===0) ||
   headerPrefix.lifecycle.errors!==0 || headerPrefix.lifecycle.overflow!==0 || headerPrefix.lifecycle.upstreamRequests!==census.counts.accepted ||
   lifetime?.protocol!=="owned-context-upstream-header-lifetime-v1" || lifetime.contextId!==context.contextId || lifetime.closure!==null)return false;
  const installation=lifetime.installation,life=headerPrefix.lifecycle;
  return installation?.protocol===lifetime.protocol && installation.proxyInstanceId===life.proxyInstanceId && installation.originSha256===context.originSha256 && life.originSha256===context.originSha256 &&
   installation.acceptedRequestsAtInstall===0 && JSON.stringify(installation.allowedOriginSha256)===JSON.stringify(life.allowedOriginSha256);
 }catch{return false;}
};

const nativeContextDigest = context => {
	try {const bytes=Buffer.from(JSON.stringify(context));return bytes.length<=controlCancellationPolicy.encodedLimit ? bodySha256(bytes) : null;}
	catch{return null;}
};

const goodNativePrefetchBody = (row,context) => {
	const proof=row?.bodyProof,binding=proof?.segmentBinding,compiled=context.binding;
	const response=row.initialSegmentResponse ?? row;
	if(proof?.requestKind==="route-tree"){
		const route=proof.routeTreeBinding;
		if(proof.routeReadiness!==null){
			const facts=proof.routeReadiness?.pathSourceFacts;
			if(!facts || JSON.stringify(facts)!==JSON.stringify(row.pathSourceFacts) || facts.observerSourceSha256!==context.protocolSources["browser-control-collector.mjs"] || route?.requestUrlSha256!==row.fullUrlSha256 || route.requestOriginSha256!==context.originSha256 || route.ambiguousRedirect!==false)return false;
			if(row.id){if(facts.url.provenance!=="owned-proxy-request-url-no-follow")return false;}
			else{const ledger=row.browserDataLedger;if(facts.url.provenance!=="Network.responseReceived.url" || row.ambiguousRedirect!==false || row.failed!==false || ledger?.protocol!=="cached-browser-data-ledger-v1" || ledger.requestObserved!==true || ledger.responseEvents!==1 || ledger.finishedEvents!==1 || ledger.failedEvents!==0 || ledger.invalidData!==false || ledger.dataAfterTerminal!==0 || ledger.dataBeforeResponse!==0 || ledger.responseAfterTerminal!==0 || ledger.terminalBeforeResponse!==0)return false;}
		}
		return goodBody(proof,0,true) && route?.method==="GET" && route.status===200 && ["flight","rsc","prefetch","manifestVerified"].every(key=>route[key]===true) && typeof route.postponed==="boolean" &&
			row.requestKind==="route-tree" && row.requestHeaderSnapshotKnown===true && row.method==="GET" && row.status===200 && row.rsc===true && row.prefetch===true && row.action===false &&
			response.responseHeaderSnapshotKnown===true && response.status===200 && response.flight===true && response.postponed===route.postponed &&
			route.requestHeadersSha256===row.requestHeadersSha256 && route.requestKeySha256===row.headerFieldSha256?.["next-router-segment-prefetch"] &&
			route.compiledBuild===compiled.compiledBuild && route.compiledManifestSha256===compiled.compiledManifestSha256 && route.expectedDeploymentSha256===bodySha256(Buffer.from(compiled.compiledBuild)) &&
			route.responseDeploymentSha256===response.responseDeploymentSha256 && route.actualDeploymentSha256===(route.responseDeploymentSha256 ?? route.bodyBuildSha256) && route.actualDeploymentSha256===route.expectedDeploymentSha256 &&
			route.deploymentSource===(route.responseDeploymentSha256===null?"body":"response-header");
	}
	return proof?.protocol === "bounded-required-flight-v1" && proof.complete === true && proof.requiredStage === "segment-prefetch-representation" && proof.requestKind === "segment-prefetch" &&
		proof.action === false && proof.marker === "unmarked-segment-prefetch" && proof.renderableOutputClaim === false && proof.serverErrors === 0 && proof.explicitActionFailure === false && proof.embeddedRuntimePrefetch === null &&
		Number.isSafeInteger(proof.decodedBytes) && proof.decodedBytes > 0 && proof.decodedBytes <= controlCancellationPolicy.decodedLimit && proof.boundaryBytes === proof.decodedBytes && digest(proof.bodySha256) &&
		Number.isSafeInteger(proof.treeNodes) && proof.treeNodes > 0 && proof.treeNodes <= 4096 && Number.isSafeInteger(proof.partialNodes) && proof.partialNodes >= 0 && Number.isSafeInteger(proof.completeNodes) && proof.completeNodes >= 0 &&
		proof.partialNodes + proof.completeNodes > 0 && proof.partialNodes + proof.completeNodes <= proof.treeNodes+1 && proof.isPartial === (proof.partialNodes > 0) &&
		proof.knownEmptyFallbacks <= proof.knownSuspenseBoundaries && (proof.postponedOutputReferences === 0 || proof.knownSuspenseBoundaries > 0) &&
		(proof.partialNodes > 0 || proof.postponedCacheOutputs + proof.postponedOutputReferences + proof.representedComponentFallbacks === 0) &&
		Number.isSafeInteger(proof.protocolRows) && proof.protocolRows > 0 && proof.protocolRows <= 4096 && Number.isSafeInteger(proof.modelSteps) && proof.modelSteps > 0 && proof.modelSteps <= 100000 &&
		["postponedCacheOutputs","postponedOutputReferences","knownSuspenseBoundaries","knownEmptyFallbacks","representedComponentFallbacks"].every(key=>Number.isSafeInteger(proof[key]) && proof[key] >= 0 && proof[key] <= 100000) &&
		binding?.method === "GET" && binding.status === 200 && ["flight","rsc","prefetch","postponed","manifestVerified"].every(key=>binding[key]===true) &&
		row.requestHeaderSnapshotKnown === true && row.method === "GET" && row.rsc === true && row.prefetch === true && row.action === false && response.responseHeaderSnapshotKnown === true && response.flight === true && response.postponed === true && response.status === 200 && row.status === 200 &&
		binding.requestHeadersSha256 === row.requestHeadersSha256 && digest(binding.requestKeySha256) && binding.requestKeySha256 === row.headerFieldSha256?.["next-router-segment-prefetch"] && binding.derivedRequestKeySha256 === binding.requestKeySha256 &&
		binding.compiledBuild === compiled.compiledBuild && binding.compiledManifestSha256 === compiled.compiledManifestSha256 && binding.expectedDeploymentSha256 === bodySha256(Buffer.from(compiled.compiledBuild)) &&
		binding.responseDeploymentSha256 === response.responseDeploymentSha256 && binding.actualDeploymentSha256 === (binding.responseDeploymentSha256 ?? binding.bodyBuildSha256) && binding.actualDeploymentSha256 === binding.expectedDeploymentSha256 &&
		binding.deploymentSource === (binding.responseDeploymentSha256 === null ? "body" : "response-header");
};

const nativeCachedBytes = (cached,origin,packet,context) => {
	const read=cached.bodyReadbackReceipt,proof=origin.bodyProof,bytes=proof.decodedBytes,hash=proof.bodySha256;
	if(cached.bodyReadbackComplete!==true || read?.available!==true || ![true,false].includes(read.base64Encoded) ||
		!Number.isSafeInteger(read.decodedBytes) || read.decodedBytes<=0 || read.decodedBytes>controlCancellationPolicy.decodedLimit || !digest(read.bodySha256)) return null;
	if((cached.bodyProof?.bodySha256!==undefined && cached.bodyProof.bodySha256!==read.bodySha256) ||
		(cached.bodyProof?.decodedBytes!==undefined && cached.bodyProof.decodedBytes!==read.decodedBytes)) return null;
	for(const row of [origin,packet]) if(row.transportBodyReceipt?.protocol!=="proxy-natural-eof-decoded-bytes-v1" || row.transportBodyReceipt.naturalEOF!==true ||
		row.transportBodyReceipt.bodySha256!==hash || row.transportBodyReceipt.decodedBytes!==bytes || row.bodyProof.bodySha256!==hash || row.bodyProof.decodedBytes!==bytes) return null;
	const base={protocol:"cached-native-byte-correspondence-v1",originalBytes:bytes,originalSha256:hash,readbackBytes:read.decodedBytes,readbackSha256:read.bodySha256};
	if(goodNativePrefetchBody(cached,context) && read.decodedBytes===cached.bodyProof.decodedBytes && read.bodySha256===cached.bodyProof.bodySha256 && read.decodedBytes===bytes && read.bodySha256===hash &&
		(read.base64Encoded===true || (read.utf16CodeUnitLength===read.decodedBytes && read.observedDataLengthAtReadback===read.decodedBytes && read.responseContentType?.headerKnown===true && read.responseContentType.mime==="text/x-component" && read.responseContentType.charset==="absent"))) return {...base,kind:"exact"};
	const ledger=cached.browserDataLedger,effective=read.effectiveCdpResponse,response=cached.initialSegmentResponse ?? cached;
	if(cached.requestKind!=="segment-prefetch" || read.base64Encoded!==false || read.terminal!=="finished" || cached.failed!==false || cached.ambiguousRedirect!==false ||
		ledger?.protocol!=="cached-browser-data-ledger-v1" || ledger.requestObserved!==true || ledger.responseEvents!==1 || ledger.finishedEvents!==1 || ledger.failedEvents!==0 ||
		!Number.isSafeInteger(ledger.dataEvents) || ledger.dataEvents<=0 || ledger.dataAfterTerminal!==0 || ledger.dataBeforeResponse!==0 || ledger.responseAfterTerminal!==0 || ledger.terminalBeforeResponse!==0 || ledger.invalidData!==false || ledger.observedDataLength!==bytes ||
		read.observedDataLengthAtReadback!==bytes || read.utf16CodeUnitLength!==bytes ||
		effective?.protocol!=="cdp-effective-response-decoder-metadata-v1" || effective.provenance!=="Network.responseReceived" || effective.mimeKnown!==true || effective.mime!=="text/x-component" || effective.charsetKnown!==true || effective.charset!=="empty" ||
		![response.responseContentType,read.responseContentType].every(row=>row?.headerKnown===true && row.mime==="text/x-component" && row.charset==="absent") ||
		cached.requestHeaderSnapshotKnown!==true || response.responseHeaderSnapshotKnown!==true || response.status!==200 || cached.status!==200 || response.flight!==true || response.postponed!==true ||
		cached.method!=="GET" || cached.action!==false || cached.rsc!==true || cached.prefetch!==true ||
		cached.headerFieldSha256?.["next-router-segment-prefetch"]!==proof.segmentBinding.requestKeySha256 || response.responseDeploymentSha256!==bodySha256(Buffer.from(context.binding.compiledBuild))) return null;
	const keys=["protocol","sourceRevision","mappingSha256","originalBytes","originalSha256","outputCodeUnits","utf8Bytes","utf8Sha256"];
	const projected=origin.transportBodyReceipt.cdpTextProjection,current=packet.transportBodyReceipt.cdpTextProjection;
	if(![projected,current].every(row=>row?.available===true && Object.keys(row).length===keys.length+1 && row.protocol===cachedCdpTextProjectionProtocol && row.sourceRevision===cachedCdpTextSourceRevision && row.sourceRevision===chromiumSWRRevision &&
		row.mappingSha256===cachedCdpTextMappingSha256 && row.originalBytes===bytes && row.originalSha256===hash && row.outputCodeUnits===bytes && row.utf8Bytes===read.decodedBytes && row.utf8Sha256===read.bodySha256)) return null;
	return {...base,kind:"windows-1252-forward-image",projection:Object.fromEntries(keys.map(key=>[key,projected[key]]))};
};

function nativeKnownExtraRequestCore(failure,packet,responses,proxy,context,browserRevision) {
	try {
	if(browserRevision !== chromiumSWRRevision || failure.contextId !== context.contextId || failure.requestHeadersKnown !== true ||
		failure.type !== "Other" || failure.initiator !== "other" || failure.initiatorStackKnownAbsent !== true || failure.priority !== "VeryLow" ||
		!["segment-prefetch","route-tree"].includes(failure.requestKind) || failure.method !== "GET" || failure.status !== 200 || failure.action !== false || failure.rsc !== true || failure.prefetch !== true ||
		failure.purposeHeaderPresent !== false || failure.secPurposeHeaderPresent !== false || failure.requestOriginSha256 !== context.originSha256 ||
		!packet || failure.proxyResponseId !== packet.id || !sameRequest(failure,packet) || packet.requestOriginSha256 !== context.originSha256 || packet.complete !== true || packet.canceled !== false || packet.upstreamError !== false ||
		!goodNativePrefetchBody(packet,context)) return null;
	const initial=failure.initialHeaderIdentity,extra=failure.extraHeaderIdentity;
	if(initial?.requestHeaderSnapshotKnown !== true || extra?.requestHeaderSnapshotKnown !== true || extra.requestHeadersSha256 !== failure.requestHeadersSha256 ||
		initial.purposeHeaderPresent !== false || initial.secPurposeHeaderPresent !== false || extra.purposeHeaderPresent !== false || extra.secPurposeHeaderPresent !== false || initial.documentGeneration !== failure.documentGeneration) return null;
	const knownHeaders = row=>row?.requestHeaderSnapshotKnown === true && row.rsc === true && row.prefetch === true && row.action === false && row.purposeHeaderPresent === false && row.secPurposeHeaderPresent === false && row.headerFieldSha256 && Object.keys(row.headerFieldSha256).length === controlIdentityHeaders.length &&
		controlIdentityHeaders.every(key=>Object.hasOwn(row.headerFieldSha256,key) && (row.headerFieldSha256[key]===null || digest(row.headerFieldSha256[key])));
	if(![initial,extra,failure,packet].every(knownHeaders) || !controlIdentityHeaders.every(key=>extra.headerFieldSha256[key]===failure.headerFieldSha256[key] && extra.headerFieldSha256[key]===packet.headerFieldSha256[key]) ||
		failure.headerFieldSha256.rsc!==bodySha256(Buffer.from("1")) || failure.headerFieldSha256["next-router-prefetch"]!==bodySha256(Buffer.from("1")) || failure.headerFieldSha256["next-action"]!==null ||
		controlIdentityHeaders.filter(key=>!["accept","accept-encoding","cookie"].includes(key)).some(key=>initial.headerFieldSha256[key]!==extra.headerFieldSha256[key]) ||
		extra.headerFieldSha256.accept !== (initial.headerFieldSha256.accept ?? bodySha256(Buffer.from("*/*")))) return null;
	const cachedMatches=responses.filter(row=>row.contextId===failure.contextId && row.method==="GET" && row.requestKind===failure.requestKind && row.fullUrlSha256===failure.fullUrlSha256 &&
		row.loaderId===failure.loaderId && typeof row.loaderId==="string" && row.loaderId.length>0 && row.type==="Fetch" && row.fromDiskCache===true && row.fromServiceWorker===false && row.loadingFinished===true &&
		Number.isFinite(row.finishedAt) && Number.isFinite(failure.startedAt) && row.finishedAt < failure.startedAt && row.initialHeaderIdentity?.requestHeaderSnapshotKnown===true &&
		row.initialHeaderIdentity.requestHeadersSha256===initial.requestHeadersSha256 && row.initialHeaderIdentity.documentGeneration===initial.documentGeneration);
	if(cachedMatches.length!==1) return null;
	const cached=cachedMatches[0];
	if(!knownHeaders(cached.initialHeaderIdentity) || !controlIdentityHeaders.every(key=>cached.initialHeaderIdentity.headerFieldSha256[key]===initial.headerFieldSha256[key])) return null;
	const origins=proxy.filter(row=>row.id===cached.proxyResponseId && row.contextId===failure.contextId && row.fullUrlSha256===cached.fullUrlSha256 && row.method==="GET" && row.requestKind===failure.requestKind);
	if(origins.length!==1) return null;
	const origin=origins[0];
	if(!knownHeaders(origin)) return null;
	if(![cached,origin,packet].every(row=>Number.isSafeInteger(row.staleWhileRevalidateSeconds) && row.staleWhileRevalidateSeconds>0)) return null;
	if(origin.id===packet.id || origin.requestOriginSha256 !== context.originSha256 || origin.complete!==true || origin.canceled!==false || origin.upstreamError!==false || !goodNativePrefetchBody(origin,context) || cached.requestOriginSha256!==context.originSha256) return null;
	const byteCorrespondence=nativeCachedBytes(cached,origin,packet,context);
	if(!byteCorrespondence) return null;
	const fields=origin.vary?.fields;
	if(!Array.isArray(fields) || !["rsc","next-router-prefetch","next-router-segment-prefetch"].every(field=>fields.includes(field)) || new Set(fields).size!==fields.length ||
		![cached,origin,packet].every(row=>row.vary?.known===true && row.vary.star===false && row.vary.unknownFields===0 && JSON.stringify(row.vary.fields)===JSON.stringify(fields))) return null;
	for(const field of [...fields,"cookie","authorization"]){
		if(![origin,packet].every(row=>row.requestHeaderSnapshotKnown===true && Object.hasOwn(row.headerFieldSha256 ?? {},field)) || origin.headerFieldSha256[field]!==packet.headerFieldSha256[field]) return null;
	}
	if(origin.headerFieldSha256.cookie!==context.principalEpoch.before.cookieAttributes.singleCookieHeaderSha256 || origin.headerFieldSha256.authorization!==null ||
		Number(origin.id.split(".")[1]) >= Number(packet.id.split(".")[1]) ||
		![origin,packet].every(row=>context.headerCensus.requests.filter(entry=>entry.requestId===row.id && entry.observation==="headers").length===1) ||
		[cached,origin,packet,failure].some(row=>row.observedProtocolError?.serverErrors>0 || row.observedProtocolError?.explicitActionFailure===true || row.bodyProof?.serverErrors>0 || row.bodyProof?.explicitActionFailure===true || row.httpErrorObserved===true || row.status>=400)) return null;
	return {failure:requestReceipt(failure),packet:requestReceipt(packet),cached:requestReceipt(cached),origin:requestReceipt(origin),browserRevision,proxyCandidates:1,cachedCandidates:1,originCandidates:1,
		byteCorrespondence};
	}catch{return null;}
}

function nativeKnownExtraProof(failure,packet,responses,proxy,context,browserRevision) {
 if(!knownNativeContext(context) || !nativeContextDigest(context))return null;
 const core=nativeKnownExtraRequestCore(failure,packet,responses,proxy,context,browserRevision);
 if(!core)return null;
 const {byteCorrespondence,...facts}=core;
 return {...facts,nativeContextSha256:nativeContextDigest(context),byteCorrespondence};
}

/** Bounded technical inputs only; payload chunks and raw header values never enter a prefix. */
export function mixedNativeProgressInput({failures,responses,proxy,nativeContext,coverage,browserRevision,browserEventOrdinal}) {
 return structuredClone({failures:failures.map(requestReceipt),responses:(failures.length?responses:[]).map(requestReceipt),proxy:(failures.length?proxy:[]).map(requestReceipt),nativeContext,coverage,browserRevision,browserEventOrdinal});
}

/** Input records are emitted by the owned passive collector, never inferred from labels alone. */
export function classifyControlCancellations({
	failures = [],
	responses = [],
	proxy = [],
	coverage,
	browserRevision,
	nativeContext,
	scope = "measured",
}) {
	const records = [],
		seen = new Set();
	let realFailures = 0,
		unknownFailures = 0,
		provenControls = 0;
	let complete =
		coverage?.installed === true &&
		coverage?.scopeClosed === true &&
		["missing", "overflow", "errors", "pendingBodies"].every(
			(key) => coverage[key] === 0,
		) &&
		failures.length <= controlCancellationPolicy.recordLimit;
	for (const failure of failures) {
		const key = `${failure.contextId}:${failure.requestId}`;
		if (!failure.requestId || seen.has(key)) complete = false;
		seen.add(key);
		let outcome = "unknown",
			reason = "unproven-cancellation",
			proof;
		if (
			(typeof failure.error === "string" &&
				/^net::ERR_[A-Z_]+$/.test(failure.error) &&
				failure.error !== "net::ERR_ABORTED") ||
			failure.status >= 400
		) {
			outcome = "real-failure";
			reason = "browser-or-http-error";
		} else if (
			failure.error === "net::ERR_ABORTED" &&
			failure.canceled === true
		) {
			const matches = proxy.filter(
				(row) =>
					sameRequest(failure, row) &&
					(!failure.proxyResponseId || failure.proxyResponseId === row.id),
			);
			const packet = matches.length === 1 ? matches[0] : null;
			if (
				failure.bodyProof?.explicitActionFailure === true ||
				failure.bodyProof?.serverErrors > 0 ||
			failure.observedProtocolError?.explicitActionFailure === true || failure.observedProtocolError?.serverErrors > 0 ||
				(packet &&
					(packet.status >= 400 ||
						packet.upstreamError === true ||
						packet.bodyProof?.explicitActionFailure === true ||
					packet.bodyProof?.serverErrors > 0 || packet.observedProtocolError?.explicitActionFailure === true || packet.observedProtocolError?.serverErrors > 0))
			) {
				outcome = "real-failure";
				reason = "server-or-application-error";
			} else if (
				packet &&
				failure.ambiguousRedirect !== true &&
				failure.httpErrorObserved !== true &&
				packet.status === 200 &&
				packet.upstreamError === false
			) {
				if (
					packet.complete === true &&
					packet.canceled === false &&
					packet.flight === true &&
					goodBody(failure.bodyProof) &&
					goodBody(packet.bodyProof) &&
					receivedBody(failure) &&
					failure.action === packet.action &&
					failure.bodyProof.action === failure.action &&
					packet.bodyProof.action === packet.action &&
					failure.bodyProof.requestKind === failure.requestKind &&
					packet.bodyProof.requestKind === packet.requestKind &&
					failure.bodyProof.bodySha256 === packet.bodyProof.bodySha256
				) {
					outcome = "protocol-control";
					reason = "completed-flight-late-terminal-cancel";
					proof = {
						failure: requestReceipt(failure),
						packet: requestReceipt(packet),
						cached: null,
						browserRevision,
						proxyCandidates: 1,
					};
				}
				if(outcome==="unknown"){
					const nativeProof=nativeKnownExtraProof(failure,packet,responses,proxy,nativeContext,browserRevision);
					if(nativeProof){outcome="protocol-control";reason="qualified-cached-flight-native-revalidation";proof=nativeProof;}
				}
			}
		}
		if (outcome === "real-failure") realFailures++;
		else if (outcome === "protocol-control") provenControls++;
		else unknownFailures++;
		records.push({
			requestId: failure.requestId ?? null,
			outcome,
			reason,
			...(proof ? { proof } : {}),
		});
	}
	return {
		protocol: controlCancellationPolicy.protocol,
		policy: controlCancellationPolicy,
		scope,
		rawFailedRequests: failures.length,
		realFailures,
		unknownFailures,
		provenControls,
		complete,
		coverage: { ...coverage },
		...(nativeContext ? {nativeContext} : {}),
		records,
	};
}

/** Serialized receipts do not default missing counts/coverage to a successful zero. */
function browserFailureEvidenceMatches(evidence, rawFailedRequests, scope, requireClean) {
	if (
		!evidence ||
		evidence.protocol !== controlCancellationPolicy.protocol ||
		JSON.stringify(evidence.policy) !==
			JSON.stringify(controlCancellationPolicy) ||
		evidence.scope !== scope ||
		evidence.complete !== true ||
		!Number.isSafeInteger(rawFailedRequests) ||
		rawFailedRequests < 0 ||
		evidence.rawFailedRequests !== rawFailedRequests ||
		["realFailures", "unknownFailures", "provenControls"].some(
			(key) => !Number.isSafeInteger(evidence[key]) || evidence[key] < 0,
		) ||
		(requireClean && (evidence.realFailures !== 0 || evidence.unknownFailures !== 0)) ||
		evidence.rawFailedRequests !==
			evidence.realFailures +
				evidence.unknownFailures +
				evidence.provenControls ||
		!Array.isArray(evidence.records) ||
		evidence.records.length !== rawFailedRequests ||
		new Set(evidence.records.map((row) => row.requestId)).size !==
			rawFailedRequests ||
		evidence.records.some(
			(row) =>
				!row.requestId ||
				(requireClean && row.outcome !== "protocol-control") ||
				!["protocol-control", "real-failure", "unknown"].includes(row.outcome) ||
				(row.outcome === "protocol-control" && ![
					"qualified-cached-flight-native-revalidation",
					"completed-flight-late-terminal-cancel",
				].includes(row.reason)),
		)
	)
		return false;
	if (evidence.provenControls !== evidence.records.filter((row) => row.outcome === "protocol-control").length ||
		evidence.unknownFailures !== evidence.records.filter((row) => row.outcome === "unknown").length ||
		evidence.realFailures !== evidence.records.filter((row) => row.outcome === "real-failure").length) return false;
	for (const row of evidence.records) {
		if (row.outcome !== "protocol-control") continue;
		const proof = row.proof;
		if (
			!proof ||
			proof.proxyCandidates !== 1 ||
			proof.failure?.requestId !== row.requestId ||
			(row.reason === "qualified-cached-flight-native-revalidation" &&
				(proof.cachedCandidates !== 1 || proof.originCandidates !== 1 || !evidence.nativeContext ||
					proof.nativeContextSha256 !== nativeContextDigest(evidence.nativeContext)))
		)
			return false;
		const verified = classifyControlCancellations({
			failures: [proof.failure],
			proxy: proof.origin ? [proof.origin,proof.packet] : [proof.packet],
			responses: proof.cached ? [proof.cached] : [],
			browserRevision: proof.browserRevision,
			nativeContext:evidence.nativeContext,
			coverage: evidence.coverage,
		});
		if (
			verified.provenControls !== 1 ||
			verified.records[0].reason !== row.reason || (row.reason === "qualified-cached-flight-native-revalidation" && JSON.stringify(verified.records[0].proof.byteCorrespondence)!==JSON.stringify(proof.byteCorrespondence))
		)
			return false;
	}
	return (
		evidence.coverage?.installed === true &&
		evidence.coverage.scopeClosed === true &&
		["missing", "overflow", "errors", "pendingBodies"].every(
			(key) => evidence.coverage[key] === 0,
		)
	);
}

export function cleanBrowserFailureEvidence(evidence, rawFailedRequests) {
	return browserFailureEvidenceMatches(evidence, rawFailedRequests, "measured", true);
}

/** Native source authority comes from the registered runtime and operator closure, not the receipt itself. */
export function nativeEvidenceAuthorityMatches(evidence,runtime,protocolSources,origin) {
	for(const classified of [evidence?.measured,evidence?.allPhase]) {
		if(!Array.isArray(classified?.records) || !classified.records.some(row=>row.reason === "qualified-cached-flight-native-revalidation" && row.outcome === "protocol-control")) continue;
		const context=classified.nativeContext;
		if(typeof origin!=="string" || !knownNativeContext(context) || context.originSha256!==bodySha256(Buffer.from(origin)) || !matchingBrowserControlBinding(runtime,context.binding) || !protocolSources ||
			Object.keys(protocolSources).length !== Object.keys(context.protocolSources).length ||
			Object.entries(protocolSources).some(([file,sha])=>!digest(sha) || context.protocolSources[file] !== sha)) return false;
		const scriptSha=bodySha256(Buffer.from(origin+"/sw.js")),controller=context.environment.endRead.controller;
		if(context.workerScriptSha256!==scriptSha || context.rootScopeSha256!==bodySha256(Buffer.from(origin+"/")) || [controller.controllerBefore,controller.controllerAfter,...controller.registrations.map(row=>row.active)].some(row=>row.scriptUrlSha256!==scriptSha) ||
			controller.registrations.some(row=>row.scopeSha256!==bodySha256(Buffer.from(origin+"/"))) ||
			context.environment.workerTargets.events.some(row=>row.type==="service_worker" && row.urlSha256!==scriptSha)) return false;
	}
	return true;
}

/** Coverage is distinct from acceptance: unproven optional all-phase failures stay visible. */
export function completeAllPhaseBrowserObservation(evidence) {
	return browserFailureEvidenceMatches(evidence, evidence?.rawFailedRequests, "all-phase-semantic-correlation", false);
}

export const mixedNativeProgressPolicy=Object.freeze({version:1,prefixProtocol:"acknowledged-mixed-native-prefix-v1",ledgerProtocol:"mixed-native-progress-observations-v1",failureOccurrenceProtocol:"actual-browser-failed-occurrence-census-v1",observerCeilingMs:10000,guardScope:"existing-mixed-stop-guards-only"});
const mixedPrefixProtocol=mixedNativeProgressPolicy.prefixProtocol;
const safeTechnicalId=value=>typeof value==="string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
const progressFailureIds=input=>input.failures.map(row=>row.requestId).sort();
/** Cheap request-local prerequisite. It grants no Native authority and never admits incomplete current packets. */
export function mixedNativePrefixCandidates(input) {
 try {
  if(!input || Object.keys(input).length!==7 || !["failures","responses","proxy","nativeContext","coverage","browserRevision","browserEventOrdinal"].every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(input,key) ?? {},"value")) || ![input.failures,input.responses,input.proxy].every(rows=>Array.isArray(rows) && rows.length<=controlCancellationPolicy.recordLimit) || input.coverage?.installed!==true || input.coverage.scopeClosed!==false || !["missing","errors","overflow"].every(key=>input.coverage[key]===0) || !Number.isSafeInteger(input.browserEventOrdinal) || input.browserEventOrdinal<0 || input.failures.length>0 && !nativeContextDigest(input))return null;
  const ids=progressFailureIds(input);if(input.failures.some(row=>!Number.isSafeInteger(row.failedEventOrdinal) || row.failedEventOrdinal<1 || row.failedEventOrdinal>input.browserEventOrdinal) || !ids.every(safeTechnicalId) || new Set(ids).size!==ids.length)return null;
  const ordinary=classifyControlCancellations(input),cores=[];
  for(let i=0;i<input.failures.length;i++){
   const failure=input.failures[i],record=ordinary.records[i];
   if(record.outcome==="real-failure")return null;
   if(record.outcome==="protocol-control")continue;
   if(failure.error!=="net::ERR_ABORTED" || failure.canceled!==true || failure.ambiguousRedirect===true || failure.httpErrorObserved===true)return null;
   const matches=input.proxy.filter(row=>sameRequest(failure,row) && failure.proxyResponseId===row.id);
   if(matches.length!==1)return null;
   const core=nativeKnownExtraRequestCore(failure,matches[0],input.responses,input.proxy,input.nativeContext,input.browserRevision);
   if(!core)return null;cores.push(core);
  }
  return {failureIds:ids,cores};
 }catch{return null;}
}

/** A positive acknowledged prefix stays separately typed; the final closed validator never consumes it. */
export function createMixedNativePrefix({checkpointOrdinal,begin,end,acknowledgment,headerPrefix,operationDeadlineMs=null,returnedAtMs}) {
 const facts=structuredClone({protocol:mixedPrefixProtocol,checkpointOrdinal,operationDeadlineMs,begin,end,acknowledgment,headerPrefix,returnedAtMs});
 const receipt={...facts,prefixSha256:bodySha256(Buffer.from(JSON.stringify(facts)))};
 if(!validateMixedNativePrefix(receipt))throw Error("Mixed Native prefix is not positively acknowledged.");
 return receipt;
}
export function validateMixedNativePrefix(receipt) {
 try {
  const names=["protocol","checkpointOrdinal","operationDeadlineMs","begin","end","acknowledgment","headerPrefix","returnedAtMs","prefixSha256"];
  if(!receipt || Reflect.ownKeys(receipt).length!==names.length || !names.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(receipt,key) ?? {},"value")) || receipt.protocol!==mixedPrefixProtocol || !Number.isSafeInteger(receipt.checkpointOrdinal) || receipt.checkpointOrdinal<1 || receipt.checkpointOrdinal>controlCancellationPolicy.recordLimit || !digest(receipt.prefixSha256) || !nativeContextDigest(receipt))return false;
  const {begin,end,acknowledgment:ack,headerPrefix,operationDeadlineMs,returnedAtMs}=receipt;
  const first=mixedNativePrefixCandidates(begin),last=mixedNativePrefixCandidates(end);
  if(!first || !last || first.cores.length===0 || JSON.stringify(first)!==JSON.stringify(last) || begin.nativeContext.contextId!==end.nativeContext.contextId || end.browserEventOrdinal<begin.browserEventOrdinal)return false;
  const start=begin.nativeContext,finish=end.nativeContext;
  if(start.protocol!==finish.protocol || start.contextId!==finish.contextId || start.originSha256!==finish.originSha256 || start.workerScriptSha256!==finish.workerScriptSha256 || start.rootScopeSha256!==finish.rootScopeSha256 || start.operatorFile!==finish.operatorFile || JSON.stringify(start.binding)!==JSON.stringify(finish.binding) || JSON.stringify(start.protocolSources)!==JSON.stringify(finish.protocolSources) || JSON.stringify(start.principalEpoch.before)!==JSON.stringify(finish.principalEpoch.before))return false;
  const beforeWorkers=start.environment?.workerTargets,afterWorkers=finish.environment?.workerTargets;
  if(!Array.isArray(beforeWorkers?.events) || !Array.isArray(afterWorkers?.events) || afterWorkers.events.length<beforeWorkers.events.length || JSON.stringify(afterWorkers.events.slice(0,beforeWorkers.events.length))!==JSON.stringify(beforeWorkers.events))return false;
  if(ack?.protocol!=="native-environment-progress-readonly-v1" || ack.contextId!==finish.contextId || ack.checkpointOrdinal!==receipt.checkpointOrdinal || ack.timedOut!==false || ack.pendingOperations!==0 || ack.readErrors!==0 || !Number.isFinite(ack.startedAtMs) || !Number.isFinite(ack.finishedAtMs) || ack.finishedAtMs<ack.startedAtMs || ack.elapsedMs!==ack.finishedAtMs-ack.startedAtMs || !Number.isFinite(ack.deadlineMs) || !Number.isFinite(ack.deadlineBudgetMs) || ack.deadlineBudgetMs<=0 || ack.deadlineBudgetMs>10000 || ack.deadlineMs-ack.startedAtMs!==ack.deadlineBudgetMs || ack.finishedAtMs>ack.deadlineMs || operationDeadlineMs!==null && (!Number.isFinite(operationDeadlineMs) || ack.deadlineMs>operationDeadlineMs))return false;
  const beforeReads=start.principalEpoch?.progressReads,afterReads=finish.principalEpoch?.progressReads,ownRead=ack.principalReadOperation;
  if(!knownProgressReadHistory(start.principalEpoch) || !knownProgressReadHistory(finish.principalEpoch) || beforeReads.records.some(row=>row.acknowledgmentOrdinal===receipt.checkpointOrdinal) || !ownRead || ownRead.acknowledgmentOrdinal!==receipt.checkpointOrdinal || ownRead.snapshotSha256!==ack.principalRead?.sha256 || ownRead.error!==false || ownRead.finishedOrdinal===null || afterReads.records.filter(row=>JSON.stringify(row)===JSON.stringify(ownRead)).length!==1 || beforeReads.started>afterReads.started || beforeReads.finished>afterReads.finished || beforeReads.records.some(row=>{const match=afterReads.records.find(next=>next.acknowledgmentOrdinal===row.acknowledgmentOrdinal);return !match || row.startedOrdinal!==match.startedOrdinal || row.kind!==match.kind || row.finishedOrdinal!==null && JSON.stringify(row)!==JSON.stringify(match);}))return false;
  if(!Number.isFinite(returnedAtMs) || returnedAtMs<ack.finishedAtMs || returnedAtMs>ack.deadlineMs || !sameMixedReturnJournals(start,finish))return false;
  const document=ack.document;
  if(document?.protocol!=="actual-cdp-document-acknowledgment-v1" || document.contextId!==finish.contextId || !knownMixedDocumentJournal(document.sourceJournal,document) || ![document.frameId,document.loaderId,document.executionContextUniqueId].every(safeTechnicalId) || !Number.isSafeInteger(document.documentGeneration) || document.documentGeneration<1 || document.actualDocumentIdentityStable!==true || document.originSha256!==finish.originSha256 || !["executionEventOrdinalBefore","executionEventOrdinalAfter","documentEventOrdinalBefore","documentEventOrdinalAfter"].every(key=>Number.isSafeInteger(document[key]) && document[key]>=0) || document.executionEventOrdinalBefore!==document.executionEventOrdinalAfter || document.documentEventOrdinalBefore!==document.documentEventOrdinalAfter)return false;
  if(JSON.stringify(document.sourceJournal)!==JSON.stringify(start.documentJournal) || JSON.stringify(document.sourceJournal)!==JSON.stringify(finish.documentJournal))return false;
  if(!knownMixedPrefixAuthority(start,ack,start.headerPrefix) || !knownMixedPrefixAuthority(finish,ack,headerPrefix) || !sameHeaderJournalPrefix(start.headerPrefix.lifecycle,headerPrefix.lifecycle))return false;
  const {prefixSha256,...facts}=receipt;
  return prefixSha256===bodySha256(Buffer.from(JSON.stringify(facts)));
 }catch{return false;}
}
/** Stable external authority digest; closure/cursor facts are deliberately separate. */
export const mixedNativeAuthorityDigest=context=>nativeContextDigest(context && Object.fromEntries(["contextId","originSha256","workerScriptSha256","rootScopeSha256","binding","protocolSources","operatorFile"].map(key=>[key,context[key]])));
export function mixedNativeProgressVector(input){
 const c=input.nativeContext,p=c.principalEpoch,w=c.environment?.workerTargets,h=c.headerPrefix?.lifecycle;
 return {browserEventOrdinal:input.browserEventOrdinal,headerEventOrdinal:h?.eventOrdinal,workerEventCount:w?.events?.length,principalProgressStarted:p.progressReads?.started ?? 0,principalProgressFinished:p.progressReads?.finished ?? 0,failureIds:progressFailureIds(input)};
}
const sameHeaderJournalPrefix=(prefix,final)=>{
 if(!final || final.errors!==0 || final.overflow!==0 || prefix.proxyInstanceId!==final.proxyInstanceId || prefix.originSha256!==final.originSha256 || JSON.stringify(prefix.allowedOriginSha256)!==JSON.stringify(final.allowedOriginSha256) || prefix.eventOrdinal>final.eventOrdinal)return false;
 const expected=final.requests.filter(row=>row.acceptedOrdinal<=prefix.eventOrdinal).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key.endsWith("Ordinal") && value>prefix.eventOrdinal?null:value])));
 return JSON.stringify(prefix.requests)===JSON.stringify(expected);
};
const samePrincipalJournalPrefix=(past,final)=>knownProgressReadHistory(past) && knownProgressReadHistory(final) && past.contextId===final.contextId && JSON.stringify(past.before)===JSON.stringify(final.before) && past.progressReads.started<=final.progressReads.started && past.progressReads.finished<=final.progressReads.finished && past.progressReads.records.every(row=>{
 const match=final.progressReads.records.find(value=>value.acknowledgmentOrdinal===row.acknowledgmentOrdinal);
 return match && match.startedOrdinal===row.startedOrdinal && match.kind===row.kind && (row.finishedOrdinal!==null?JSON.stringify(row)===JSON.stringify(match):match.finishedOrdinal===null || match.finishedOrdinal>past.progressReads.finished);
});
/** Prefix replay is additional evidence. Final lifetime/browser/native checks remain independently required. */
export function validateMixedProgressObservations(progress,context,finalInputs) {
 try {
  const names=["protocol","contextId","authoritySha256","guardChecks","attempted","failed","overflow","retainedBytes","checks","prefixes"];
  if(!progress || Object.keys(progress).length!==names.length || !names.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(progress,key) ?? {},"value")) || progress.protocol!=="mixed-native-progress-observations-v1" || progress.contextId!==context?.contextId || progress.authoritySha256!==mixedNativeAuthorityDigest(context) || !Number.isSafeInteger(progress.guardChecks) || progress.guardChecks<1 || progress.guardChecks>controlCancellationPolicy.recordLimit || !Number.isSafeInteger(progress.attempted) || progress.attempted<0 || progress.attempted>progress.guardChecks || progress.failed!==0 || progress.overflow!==0 || !Number.isSafeInteger(progress.retainedBytes) || progress.retainedBytes<0 || progress.retainedBytes>controlCancellationPolicy.retainedLimit || !Array.isArray(progress.prefixes) || progress.prefixes.length!==progress.attempted || !Array.isArray(progress.checks) || progress.checks.length!==progress.guardChecks || !Array.isArray(finalInputs?.failureIds) || !knownMixedDocumentJournal(finalInputs.documentJournal) || finalInputs.documentJournal.closed!==true || finalInputs.documentJournal.contextId!==context.contextId || !Array.isArray(finalInputs.nativeFailureIds) || !Number.isSafeInteger(finalInputs.browserEventOrdinal) || !validateProxyHeaderLifecycle(finalInputs.headerLifecycle) || finalInputs.headerLifecycle.closed!==true || finalInputs.headerLifecycle.pendingUpstreams!==0 || finalInputs.headerLifecycle.acceptedRequests!==finalInputs.headerLifecycle.upstreamRequests || finalInputs.headerLifecycle.closedUpstreams!==finalInputs.headerLifecycle.upstreamRequests || context.principalEpoch?.scopeClosed!==true || context.principalEpoch.pendingReads!==0 || context.environment?.workerTargets?.scopeClosed!==true || finalInputs.headerLifecycle.errors!==0 || finalInputs.headerLifecycle.overflow!==0)return false;
  if(!knownMixedFailureOccurrences(finalInputs.failureOccurrences,context.contextId,finalInputs.browserEventOrdinal,finalInputs.failureIds))return false;
  const finalIds=new Set(finalInputs.failureIds),used=new Set();let previousStart=-1;
  const vector=(v)=>v && Object.keys(v).length===6 && ["browserEventOrdinal","headerEventOrdinal","workerEventCount","principalProgressStarted","principalProgressFinished"].every(key=>Number.isSafeInteger(v[key]) && v[key]>=0) && v.principalProgressFinished<=v.principalProgressStarted && v.browserEventOrdinal<=finalInputs.browserEventOrdinal && v.headerEventOrdinal<=finalInputs.headerLifecycle.eventOrdinal && v.workerEventCount<=context.environment.workerTargets.events.length && Array.isArray(v.failureIds) && new Set(v.failureIds).size===v.failureIds.length && v.failureIds.every(id=>safeTechnicalId(id) && finalIds.has(id)) && JSON.stringify(v.failureIds)===JSON.stringify(finalInputs.failureOccurrences.records.filter(row=>row.eventOrdinal<=v.browserEventOrdinal).map(row=>row.requestId).sort());
  for(let index=0;index<progress.checks.length;index++){
   const check=progress.checks[index];
   if(Object.keys(check).length!==5 || check.ordinal!==index+1 || !vector(check.begin) || !vector(check.returned) || check.begin.browserEventOrdinal<previousStart || ["browserEventOrdinal","headerEventOrdinal","workerEventCount","principalProgressStarted","principalProgressFinished"].some(key=>check.returned[key]<check.begin[key]) || JSON.stringify(check.begin.failureIds)!==JSON.stringify(check.returned.failureIds))return false;
   previousStart=check.begin.browserEventOrdinal;
   if(check.prefixSha256===null){if(check.checkpointOrdinal!==null || check.returned.failureIds.some(id=>finalInputs.nativeFailureIds.includes(id)))return false;}
   else{const matches=progress.prefixes.filter(row=>row.prefixSha256===check.prefixSha256 && row.checkpointOrdinal===check.checkpointOrdinal);if(matches.length!==1 || used.has(check.prefixSha256))return false;used.add(check.prefixSha256);const prefix=matches[0];if(JSON.stringify(check.begin)!==JSON.stringify(mixedNativeProgressVector(prefix.begin)) || check.returned.browserEventOrdinal<prefix.end.browserEventOrdinal)return false;}
  }
  for(let index=0;index<progress.prefixes.length;index++){
   const prefix=progress.prefixes[index];if(prefix.checkpointOrdinal!==index+1 || !validateMixedNativePrefix(prefix) || mixedNativeAuthorityDigest(prefix.end.nativeContext)!==progress.authoritySha256 || !sameHeaderJournalPrefix(prefix.headerPrefix.lifecycle,finalInputs.headerLifecycle) || !sameHeaderJournalPrefix(prefix.begin.nativeContext.headerPrefix.lifecycle,finalInputs.headerLifecycle) || !samePrincipalJournalPrefix(prefix.begin.nativeContext.principalEpoch,context.principalEpoch) || !samePrincipalJournalPrefix(prefix.end.nativeContext.principalEpoch,context.principalEpoch) || !used.has(prefix.prefixSha256))return false;
   const source=prefix.acknowledgment.document.sourceJournal,final=finalInputs.documentJournal;
   if(JSON.stringify(final.executionEvents.slice(0,source.executionEventOrdinal))!==JSON.stringify(source.executionEvents) || JSON.stringify(final.documents.slice(0,source.documentEventOrdinal))!==JSON.stringify(source.documents))return false;
   const past=prefix.end.nativeContext.environment.workerTargets.events;
   if(JSON.stringify(context.environment.workerTargets.events.slice(0,past.length))!==JSON.stringify(past))return false;
  }
  return progress.retainedBytes===Buffer.byteLength(JSON.stringify(progress.checks))+progress.prefixes.reduce((n,prefix)=>n+Buffer.byteLength(JSON.stringify(prefix)),0);
 }catch{return false;}
}

/** Replays only observed technical Runtime/Document facts; no payload, time-nearness or private page identity. */
export function knownMixedDocumentJournal(journal,document) {
 try{
  if(!journal || Object.keys(journal).length!==11 || journal.protocol!=="actual-cdp-document-journal-v1" || !safeTechnicalId(journal.contextId) || journal.installed!==true || !Number.isSafeInteger(journal.currentGeneration) || journal.currentGeneration<0 || typeof journal.closed!=="boolean" || journal.errors!==0 || journal.overflow!==0 || !Array.isArray(journal.executionEvents) || !Array.isArray(journal.documents) || journal.executionEvents.length+ journal.documents.length>controlCancellationPolicy.recordLimit || journal.executionEventOrdinal!==journal.executionEvents.length || journal.documentEventOrdinal!==journal.documents.length)return false;
  const contexts=new Map(),unique=new Set();
  for(let index=0;index<journal.executionEvents.length;index++){
   const event=journal.executionEvents[index];if(event.ordinal!==index+1)return false;
   if(event.event==="created"){
    if(Object.keys(event).length!==6 || !Number.isSafeInteger(event.executionContextId) || event.executionContextId<=0 || !safeTechnicalId(event.uniqueId) || !safeTechnicalId(event.frameId) || typeof event.isDefault!=="boolean" || contexts.has(event.executionContextId) || unique.has(event.uniqueId))return false;
    contexts.set(event.executionContextId,event);unique.add(event.uniqueId);
   }else if(event.event==="destroyed"){
    if(Object.keys(event).length!==3 || !contexts.delete(event.executionContextId))return false;
   }else if(event.event==="cleared"){
    if(Object.keys(event).length!==2)return false;contexts.clear();
   }else return false;
  }
  for(let index=0;index<journal.documents.length;index++){
   const row=journal.documents[index];if(Object.keys(row).length!==6 || row.ordinal!==index+1 || ![row.requestId,row.frameId,row.loaderId].every(safeTechnicalId) || !digest(row.originSha256) || typeof row.documentGeneration!=="string" || !row.documentGeneration.startsWith(journal.contextId+":"))return false;
   const generation=row.documentGeneration.slice(journal.contextId.length+1);if(!/^[1-9][0-9]*$/.test(generation) || !Number.isSafeInteger(Number(generation)))return false;
  }
  if(!document)return true;
  if(journal.closed!==false || document.contextId!==journal.contextId || document.executionEventOrdinalAfter!==journal.executionEventOrdinal || document.documentEventOrdinalAfter!==journal.documentEventOrdinal || document.documentGeneration!==journal.currentGeneration)return false;
  const execution=contexts.get(document.executionContextId),defaults=[...contexts.values()].filter(row=>row.isDefault && row.frameId===document.frameId),docs=journal.documents.filter(row=>row.frameId===document.frameId && row.loaderId===document.loaderId);
  return execution?.isDefault===true && execution.uniqueId===document.executionContextUniqueId && execution.frameId===document.frameId && defaults.length===1 && docs.length===1 && docs[0].requestId===document.documentRequestId && docs[0].originSha256===document.originSha256 && docs[0].documentGeneration===document.contextId+":"+document.documentGeneration;
 }catch{return false;}
}

/** CORE chronology from actual loadingFailed callbacks, not request start time or nearest-time inference. */
export function mixedFailureOccurrenceCensus({contextId,scopeClosed,browserEventOrdinal,records}){
 const facts={protocol:"actual-browser-failed-occurrence-census-v1",contextId,scopeClosed,browserEventOrdinal,records:records.map(row=>({...row})).sort((a,b)=>a.requestId<b.requestId?-1:a.requestId>b.requestId?1:0)};
 return {...facts,censusSha256:bodySha256(Buffer.from(JSON.stringify(facts)))};
}
const knownMixedFailureOccurrences=(proof,contextId,browserEventOrdinal,ids)=>{
 try{
  if(!proof || Object.keys(proof).length!==6 || proof.protocol!=="actual-browser-failed-occurrence-census-v1" || proof.contextId!==contextId || proof.scopeClosed!==true || proof.browserEventOrdinal!==browserEventOrdinal || !Number.isSafeInteger(browserEventOrdinal) || browserEventOrdinal<0 || !Array.isArray(proof.records) || proof.records.length>controlCancellationPolicy.recordLimit || !digest(proof.censusSha256))return false;
  const seen=new Set(),ordinals=new Set();
  for(const row of proof.records){if(Object.keys(row).length!==3 || !safeTechnicalId(row.requestId) || seen.has(row.requestId) || !Number.isSafeInteger(row.eventOrdinal) || row.eventOrdinal<1 || row.eventOrdinal>browserEventOrdinal || ordinals.has(row.eventOrdinal) || row.failedEvents!==1)return false;seen.add(row.requestId);ordinals.add(row.eventOrdinal);}
  const {censusSha256,...facts}=proof;
  return censusSha256===bodySha256(Buffer.from(JSON.stringify(facts))) && JSON.stringify([...seen].sort())===JSON.stringify([...ids].sort());
 }catch{return false;}
};
