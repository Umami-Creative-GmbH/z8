/** Proofs are prospective; a canceled request is never a successful payload. */
import { createHash } from "node:crypto";
import { validateProxyHeaderCensus } from "./proxy-header-census.mjs";
export const controlCancellationPolicy = Object.freeze({
	version: 2,
	protocol: "positively-proven-protocol-controls-v2",
	encodedLimit: 4 * 1024 * 1024,
	decodedLimit: 8 * 1024 * 1024,
	retainedLimit: 32 * 1024 * 1024,
	recordLimit: 10000,
});
export const chromiumSWRRevision = "1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775";
export const controlIdentityHeaders = Object.freeze(["rsc","next-router-prefetch","next-router-segment-prefetch","next-router-state-tree","next-url","next-action","accept","accept-encoding","accept-language","cookie","authorization","x-z8-fixture-document-generation"]);
export const bodySha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
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
		requestKind = action ? "action" : "navigation",
	} = {}, budget, depth,
) {
	const modelBudgetAtStart = budget.models;
	const unknown = (reason, diagnostic = {}) => ({
		complete: false,
		reason,
		...diagnostic,
	});
	const segmentContract = requestKind === "segment-prefetch";
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
					: segmentContract ? "unmarked-segment-prefetch" : typeof cachedNavigations === "boolean"
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
	let parentMemoChecks=0,parentMemoHits=0,parentMemoAbsent=0,parentMemoNonStandalone=0,parentMemoDepthExcluded=0,parentMemoKnownExcluded=0,parentMemoReady=0,parentMemoPublished=0;
	const notePathFailure = reason => { pathFailure ??= reason; return false; };
	const unknownPath = reason => { notePathFailure(reason); return {known:false}; };
	const pathStep = (depth, phase, context = {}) => {
		for (const scope of parentCheckDepths) scope.maxDepth = Math.max(scope.maxDepth,depth);
		const guard = depth > 64 ? "existing-recursion-depth" : ++budget.models > 100000 ? "shared-model-work" : null;
		if (guard) {
			pathLimit = true;
			pathLimitObservation ??= {guard,phase,observedDepth:depth,depthCap:64,sharedModelSteps:budget.models,modelCap:100000,
				localModelSteps:budget.models-modelBudgetAtStart,eagerParentCalls,outlinedCalls,eagerUniqueObjects,repeatedEagerObjects,
				activeOutlinedPaths:activePaths.size,...context,parentMemoChecks,parentMemoHits,parentMemoAbsent,parentMemoNonStandalone,parentMemoDepthExcluded,parentMemoKnownExcluded,parentMemoReady,parentMemoPublished};
			return notePathFailure("depth-or-model-limit");
		}
		return true;
	};
	const elementTuple = value => Array.isArray(value) && value[0] === "$";
	// Materialized JSON parents must not be blocked by an eager sibling. Lazy/promise values
	// remain wrappers here; following a path through one is a separate, stricter operation.
	const eagerParent = (value, forceElement, seen = new Set(), depth = 0, referenceEdges = 0, jsonDepth = 0) => {
		eagerParentCalls++;
		if (value && typeof value === "object") {
			if (eagerObjectsObserved.has(value)) repeatedEagerObjects++;
			else { eagerObjectsObserved.add(value); eagerUniqueObjects++; }
		}
		if (!pathStep(depth,"eager-parent",{referenceEdgesInParent:referenceEdges,jsonDepthInParent:jsonDepth})) return false;
		if (typeof value === "string") {
			if (value.startsWith("$")) referenceSensitiveEpoch++;
			if (/^\$(?:L|@)[a-f0-9]+$/.test(value)) return canonicalFlightId(value.slice(2)) || notePathFailure("noncanonical-eager-reference");
			if (/^\$[QWi][a-f0-9]+$/.test(value)) {
				const id=value.slice(2),record=records.get(id);
				if (!record || record.tag !== null || record.stream || !Array.isArray(record.value) || (value[1] === "Q" && !record.value.every(pair=>Array.isArray(pair)&&pair.length===2))) return notePathFailure("unsupported-eager-collection");
				if (seen.has(id)) return true;
				return eagerParent(record.value,false,new Set([...seen,id]),depth + 1,referenceEdges + 1,0);
			}
			if (/^\$[a-f0-9]+$/.test(value)) {
				const id = value.slice(1), record = records.get(id);
				if (!record) return notePathFailure("missing-eager-model");
				if (record.tag === "I") return notePathFailure("eager-import-model");
				if (record.tag === "T" || record.stream) return true;
				if (seen.has(id)) return (record.value && typeof record.value === "object" && [...seen].filter(item=>typeof item === "string").length === 1) || notePathFailure("eager-cross-record-or-alias-cycle");
				return eagerParent(record.value, forceElement, new Set([...seen,id]), depth + 1,referenceEdges + 1,0);
			}
			if (plainPath.test(value)) {
				const selected = outlined(value, depth + 1, seen);
				return selected.known && eagerParent(selected.value,forceElement,seen,depth + 1,referenceEdges + 1,0);
			}
			return !value.startsWith("$") || value.startsWith("$$") || ["$","$undefined","$NaN","$Infinity","$-Infinity","$-0"].includes(value) || /^\$[SD]/.test(value) || notePathFailure("unsupported-eager-reference");
		}
		if (!value || typeof value !== "object") return true;
		if (binaryValues.has(value) || opaqueText.has(value)) { referenceSensitiveEpoch++; return notePathFailure("eager-binary-or-text-value"); }
		if (elementTuple(value) && !forceElement) { referenceSensitiveEpoch++; return true; }
		if (elementTuple(value) && value.length !== 4) return notePathFailure("malformed-eager-element");
		if (seen.has(value)) { referenceSensitiveEpoch++; return true; }
		const literal = literalParentChecks.get(value)?.get(forceElement===true);
		if (literal && depth + literal.depthSpan <= 64) {
			// A closed reference-free subtree is context independent, but its full height
			// still belongs to EVERY ancestor certificate that consumes this lookup.
			for (const scope of parentCheckDepths) scope.maxDepth=Math.max(scope.maxDepth,depth+literal.depthSpan);
			return true;
		}
		const eligibility = referenceSensitiveEpoch, scope = {maxDepth:depth};
		if (Object.hasOwn(value,"__proto__")) referenceSensitiveEpoch++;
		const containers = new Set([...seen,value]);
		parentCheckDepths.push(scope);
		let ready;
		try { ready = Object.keys(value).filter(key=>key!=="__proto__").every(key=> {
			const descriptor=Object.getOwnPropertyDescriptor(value,key);
			return descriptor && Object.hasOwn(descriptor,"value") && eagerParent(descriptor.value,false,containers,depth + 1,referenceEdges,jsonDepth + 1);
		}); } finally { parentCheckDepths.pop(); }
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
			if (active.checking && active.anchorKnown && active.modelIds.size === 1 && ids.length > 0 && ids.every(id=>id===active.rootId))
				return {known:true,value:active.target,originId:active.originId,modelIds:active.modelIds};
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
					parentMemoHits++;
					return pathStep(entryDepth,"completed-parent");
				}
				if(completed?.forceElement===true && entryDepth+completed.depthSpan>64)parentMemoDepthExcluded++;
				// Reuse only a SAME-model materialized parent's active traversal. Its enclosing
				// validation still has to finish every sibling before this result can escape.
				// Cross-model/alias contexts keep their independent validation and cycle guards.
				const inherited = [...trail].every(item=>typeof item !== "string" || item === parent.originId) ? trail : [];
				const scope = {maxDepth:entryDepth}; parentCheckDepths.push(scope);
				let ready;
				try { ready = eagerParent(parent.value,true,new Set([...inherited,parent.originId]),entryDepth); }
				finally { parentCheckDepths.pop(); }
				if (ready && standalone) { parentMemoReady++; pendingParentChecks.push({parent,depthSpan:scope.maxDepth-entryDepth}); }
				return ready;
			})) return {known:false};
			for (const {parent,depthSpan} of pendingParentChecks) {
				let byOrigin = completedParentChecks.get(parent.value);
				if (!byOrigin) completedParentChecks.set(parent.value,byOrigin = new Map());
				byOrigin.set(parent.originId,{forceElement:true,depthSpan});
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
	if (segmentContract) {
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
			if (++budget.models > 100000 || seen.size >= 4096 || !node || typeof node !== "object" || Array.isArray(node) || seen.has(node) ||
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
		if (
			Object.keys(root).some((key) => !["b", "t", "S", "q", "i"].includes(key))
		)
			return unknown("unsupported-tree-metadata");
		const transport = resolve(root.t);
		if (
			!transport ||
			typeof transport !== "object" ||
			Array.isArray(transport) ||
			Object.keys(transport).some((key) => key !== "t")
		)
			return unknown("unsupported-tree-transport");
		const queue = [transport.t],
			visited = new Set();
		let nodes = 0;
		while (queue.length) {
			if (++nodes > 4096 || ++budget.models > 100000) return unknown("tree-limit");
			const node = resolve(queue.pop());
			if (
				!node ||
				typeof node !== "object" ||
				Array.isArray(node) ||
				visited.has(node) ||
				Object.keys(node).some((key) => !["s", "h", "c"].includes(key))
			)
				return unknown("unresolved-tree-structure");
			visited.add(node);
			const segment = resolve(node.s);
			if (typeof segment === "string") {
				if (segment.startsWith("$") && !segment.startsWith("$$"))
					return unknown("unsupported-tree-segment");
			} else if (
				!segment ||
				typeof segment !== "object" ||
				Array.isArray(segment) ||
				typeof segment.n !== "string" ||
				typeof segment.t !== "string" ||
				!(segment.k === null || typeof segment.k === "string") ||
				!(
					segment.s === null ||
					(Array.isArray(segment.s) &&
						segment.s.every((value) => typeof value === "string"))
				)
			)
				return unknown("unsupported-tree-segment");
			if (node.h !== undefined && (!Number.isSafeInteger(node.h) || node.h < 0))
				return unknown("unsupported-tree-hints");
			if (node.c !== undefined) {
				if (typeof node.c !== "string" || !/^\$Q[a-f0-9]+$/.test(node.c))
					return unknown("unsupported-tree-map");
				const children = records.get(node.c.slice(2))?.value;
				if (!Array.isArray(children) || children.length > 4096)
					return unknown("unresolved-tree-structure");
				const slots = new Set();
				for (const pair of children) {
					if (
						!Array.isArray(pair) ||
						pair.length !== 2 ||
						typeof pair[0] !== "string" ||
						slots.has(pair[0])
					)
						return unknown("unsupported-tree-map");
					slots.add(pair[0]);
					queue.push(pair[1]);
				}
			}
		}
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
			boundaryBytes: body.length,
			decodedBytes: bytes.length,
			bodySha256: bodySha256(bytes),
			serverErrors: 0,
			explicitActionFailure: false,
			protocolRows: recordCount, modelSteps: budget.models - modelBudgetAtStart, embeddedRuntimePrefetch: null,
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
	const queue = segmentContract ? segmentOutputs : [{ value: root, role: "root" }],
		visited = new Set();
	// Structural parent readiness is independent; semantic visits must retain every
	// permission bit so a permitted alias cannot discharge a required incoming edge.
	const semanticVisitKey = (role,id,array=false,inside=false,direct=false) => `${role}:${id}:${array===true?1:0}:${inside===true?1:0}:${direct===true?1:0}`;
	let inspected = 0, postponedOutputReferences = 0, knownSuspenseBoundaries = 0, knownEmptyFallbacks = 0, postponedComponentReferences = 0, representedComponentFallbacks = 0, postponedDirectOutputs = 0, postponedArrayOutputs = 0, postponedCacheOutputs = 0;
	while (queue.length) {
		if (++inspected > 100000 || ++budget.models > 100000) return unknown("model-limit");
		const { value, role, fallbackReferences, directEmbeddedOutput, fromTypedOutput, outputArrival, outputParentArrival, rArrayOutput, insideRArray } = queue.pop();
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
				queue.push({ value: model, role: modelRole, fallbackReferences, fromTypedOutput, outputArrival:"collection-reference" });
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
				if (record.tag !== "T") queue.push({ value: record.value, role:role==="cache-output" && (value[1]==="@" || record.tag!==null || record.stream) ? "required" : role, fromTypedOutput, outputArrival:"model-reference",
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
			queue.push({value:selected.value,role,fallbackReferences,fromTypedOutput,outputArrival:"outlined-reference",rArrayOutput,insideRArray});
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
			if (Object.keys(value).length + queue.length > 100000) return unknown("model-limit");
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
					queue.push({ value: value[1], role: "element-type", fallbackReferences, fromTypedOutput, outputArrival:"element-type" }, { value: value[2], role: "element-key", fallbackReferences, fromTypedOutput, outputArrival:"element-key" },
						{ value: value[3], role: role === "fallback-output" ? "fallback-host-props" : suspense ? "suspense-props" : role === "suspended-output" ? "suspended-host-props" : role === "cache-output" ? "cache-host-props" : "host-props", fallbackReferences, fromTypedOutput, outputArrival:"element-props" });
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
						queue.push({value:value[1],role:"element-type",fromTypedOutput,outputArrival:"element-type"},{value:value[2],role:"element-key",fromTypedOutput,outputArrival:"element-key"},{value:value[3],role:"required",fromTypedOutput,outputArrival:"element-props"});
						continue;
					}
					return unknown("unknown-runtime-shell-fallback", { fallbackKind: "component-element",
						fallbackElementTypeKind: id && records.get(id)?.tag === "I" ? "module-record" : type === undefined ? "unresolved" : Array.isArray(type) ? "array" : type && typeof type === "object" ? "object" : "other",
						fallbackPropsKind: props === null ? "null" : props === undefined ? "unresolved" : Array.isArray(props) ? "array" : typeof props === "object" ? "object" : "scalar" });
				}
				// Unknown component props may interpret children as ordinary required data.
				for (let index = value.length - 1; index >= 0; index--)
					queue.push({ value: value[index], role: index === 1 ? "element-type" : index === 3 ? "component-data" : "required", fallbackReferences,fromTypedOutput,outputArrival:index===1?"element-type":index===3?"element-props":"element-field" });
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
				queue.push({ value: item, role: nextRole, fallbackReferences, directEmbeddedOutput: embeddedPartialScope && role === "data" && key === "r",
					rArrayOutput:(partialCacheScope && role==="data" && key==="r") || (rArrayOutput===true && role==="cache-output" && Array.isArray(value) && !elementTuple(value)),
					insideRArray:role==="cache-output" && Array.isArray(value) && !elementTuple(value),
					fromTypedOutput:fromTypedOutput===true || (role==="data" && key==="r"),
					outputParentArrival:outputArrival ?? "root-or-required",
					outputArrival:role==="data" && key==="r" ? "typed-data-r" : Array.isArray(value) && output ? "array-output" : key==="children" && ["host-props","cache-host-props","suspense-props","suspended-host-props","fallback-host-props"].includes(role) ? "element-children" : key==="fallback" && role==="suspense-props" ? "element-fallback" : "own-field" });
			}
		}
	}
	if (segmentContract) return {
		protocol:"bounded-required-flight-v1",complete:true,requestKind,marker,isPartial:segmentClaims.partialNodes > 0,action:false,
		requiredStage:"segment-prefetch-representation",...segmentClaims,
		postponedCacheOutputs,postponedOutputReferences,knownSuspenseBoundaries,knownEmptyFallbacks,representedComponentFallbacks,
		boundaryBytes:body.length,decodedBytes:bytes.length,bodySha256:bodySha256(bytes),serverErrors:0,explicitActionFailure:false,
		protocolRows:recordCount,modelSteps:budget.models-modelBudgetAtStart,embeddedRuntimePrefetch:null,
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
			return {
				complete: false,
				reason: "explicit-root-action-failure",
				explicitActionFailure: true,
			};
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
		protocolRows: recordCount, modelSteps: budget.models - modelBudgetAtStart - (embeddedRuntimePrefetch?.modelSteps ?? 0), embeddedRuntimePrefetch,
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
const goodBody = (proof, depth = 0) => {
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
		!["embedded-partial-prefetch-representation","runtime-shell-cache-representation"].includes(proof.requiredStage)) return false;
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
	} else if (proof.marker === "unmarked-navigation") {
		if (
			proof.action ||
			typeof proof.cachedNavigations !== "boolean" ||
			proof.isPartial !== proof.cachedNavigations
		)
			return false;
	} else return false;
	if (proof.requiredStage === "route-tree-structure")
		return (
			proof.requestKind === "route-tree" &&
			!proof.action &&
			Number.isSafeInteger(proof.treeNodes) &&
			proof.treeNodes > 0 &&
			proof.treeNodes <= 4096
		);
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
		"requestKind",
		"marker",
		"isPartial",
		"cachedNavigations",
		"action",
		"requiredStage",
		"treeNodes",
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
		"initialSegmentResponse",
		"responseDeploymentSha256",
		"postponed",
		"vary",
		"transportBodyReceipt",
		"bodyReadbackReceipt",
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
			![context.operatorFile,"browser-control-collector.mjs","fixture-browser.mjs","trace-transport.mjs","action-result-observer.mjs","proxy-header-census.mjs"].every(file=>digest(context.protocolSources?.[file]))) return false;
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

const nativeContextDigest = context => {
	try {const bytes=Buffer.from(JSON.stringify(context));return bytes.length<=controlCancellationPolicy.encodedLimit ? bodySha256(bytes) : null;}
	catch{return null;}
};

const goodNativeSegmentBody = (row,context) => {
	const proof=row?.bodyProof,binding=proof?.segmentBinding,compiled=context.binding;
	const response=row.initialSegmentResponse ?? row;
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
		row.method === "GET" && row.rsc === true && row.prefetch === true && row.action === false && response.flight === true && response.postponed === true && row.status === 200 &&
		binding.requestHeadersSha256 === row.requestHeadersSha256 && digest(binding.requestKeySha256) && binding.requestKeySha256 === row.headerFieldSha256?.["next-router-segment-prefetch"] && binding.derivedRequestKeySha256 === binding.requestKeySha256 &&
		binding.compiledBuild === compiled.compiledBuild && binding.compiledManifestSha256 === compiled.compiledManifestSha256 && binding.expectedDeploymentSha256 === bodySha256(Buffer.from(compiled.compiledBuild)) &&
		binding.responseDeploymentSha256 === response.responseDeploymentSha256 && binding.actualDeploymentSha256 === (binding.responseDeploymentSha256 ?? binding.bodyBuildSha256) && binding.actualDeploymentSha256 === binding.expectedDeploymentSha256 &&
		binding.deploymentSource === (binding.responseDeploymentSha256 === null ? "body" : "response-header");
};

function nativeKnownExtraProof(failure,packet,responses,proxy,context,browserRevision) {
	try {
	if(browserRevision !== chromiumSWRRevision || !knownNativeContext(context) || !nativeContextDigest(context) || failure.contextId !== context.contextId || failure.requestHeadersKnown !== true ||
		failure.type !== "Other" || failure.initiator !== "other" || failure.initiatorStackKnownAbsent !== true || failure.priority !== "VeryLow" ||
		failure.requestKind !== "segment-prefetch" || failure.method !== "GET" || failure.status !== 200 || failure.action !== false || failure.rsc !== true || failure.prefetch !== true ||
		failure.purposeHeaderPresent !== false || failure.secPurposeHeaderPresent !== false || failure.requestOriginSha256 !== context.originSha256 ||
		!packet || failure.proxyResponseId !== packet.id || !sameRequest(failure,packet) || packet.requestOriginSha256 !== context.originSha256 || packet.complete !== true || packet.canceled !== false || packet.upstreamError !== false ||
		!goodNativeSegmentBody(packet,context)) return null;
	const initial=failure.initialHeaderIdentity,extra=failure.extraHeaderIdentity;
	if(initial?.requestHeaderSnapshotKnown !== true || extra?.requestHeaderSnapshotKnown !== true || extra.requestHeadersSha256 !== failure.requestHeadersSha256 ||
		initial.purposeHeaderPresent !== false || initial.secPurposeHeaderPresent !== false || initial.documentGeneration !== failure.documentGeneration) return null;
	const knownHeaders = row=>row?.requestHeaderSnapshotKnown === true && row.headerFieldSha256 && Object.keys(row.headerFieldSha256).length === controlIdentityHeaders.length &&
		controlIdentityHeaders.every(key=>Object.hasOwn(row.headerFieldSha256,key) && (row.headerFieldSha256[key]===null || digest(row.headerFieldSha256[key])));
	if(![initial,extra,failure,packet].every(knownHeaders) || !controlIdentityHeaders.every(key=>extra.headerFieldSha256[key]===failure.headerFieldSha256[key] && extra.headerFieldSha256[key]===packet.headerFieldSha256[key]) ||
		failure.headerFieldSha256.rsc!==bodySha256(Buffer.from("1")) || failure.headerFieldSha256["next-router-prefetch"]!==bodySha256(Buffer.from("1")) || failure.headerFieldSha256["next-action"]!==null ||
		controlIdentityHeaders.filter(key=>!["accept","accept-encoding","cookie"].includes(key)).some(key=>initial.headerFieldSha256[key]!==extra.headerFieldSha256[key]) ||
		extra.headerFieldSha256.accept !== (initial.headerFieldSha256.accept ?? bodySha256(Buffer.from("*/*")))) return null;
	const cachedMatches=responses.filter(row=>row.contextId===failure.contextId && row.method==="GET" && row.requestKind==="segment-prefetch" && row.fullUrlSha256===failure.fullUrlSha256 &&
		row.loaderId===failure.loaderId && typeof row.loaderId==="string" && row.loaderId.length>0 && row.type==="Fetch" && row.fromDiskCache===true && row.fromServiceWorker===false && row.loadingFinished===true &&
		Number.isFinite(row.finishedAt) && Number.isFinite(failure.startedAt) && row.finishedAt < failure.startedAt && row.initialHeaderIdentity?.requestHeaderSnapshotKnown===true &&
		row.initialHeaderIdentity.requestHeadersSha256===initial.requestHeadersSha256 && row.initialHeaderIdentity.documentGeneration===initial.documentGeneration);
	if(cachedMatches.length!==1) return null;
	const cached=cachedMatches[0];
	if(!knownHeaders(cached.initialHeaderIdentity) || !controlIdentityHeaders.every(key=>cached.initialHeaderIdentity.headerFieldSha256[key]===initial.headerFieldSha256[key])) return null;
	const origins=proxy.filter(row=>row.id===cached.proxyResponseId && row.contextId===failure.contextId && row.fullUrlSha256===cached.fullUrlSha256 && row.method==="GET" && row.requestKind==="segment-prefetch");
	if(origins.length!==1) return null;
	const origin=origins[0],read=cached.bodyReadbackReceipt;
	if(!knownHeaders(origin)) return null;
	if(![cached,origin,packet].every(row=>Number.isSafeInteger(row.staleWhileRevalidateSeconds) && row.staleWhileRevalidateSeconds>0)) return null;
	if(origin.id===packet.id || origin.requestOriginSha256 !== context.originSha256 || origin.complete!==true || origin.canceled!==false || origin.upstreamError!==false || !goodNativeSegmentBody(origin,context) || !goodNativeSegmentBody(cached,context) ||
		cached.requestOriginSha256!==context.originSha256 || cached.bodyReadbackComplete!==true || read?.available!==true || ![true,false].includes(read.base64Encoded) ||
		read.decodedBytes!==cached.bodyProof.decodedBytes || read.bodySha256!==cached.bodyProof.bodySha256 ||
		(read.base64Encoded===false && (read.utf16CodeUnitLength!==read.decodedBytes || read.observedDataLengthAtReadback!==read.decodedBytes || read.responseContentType?.headerKnown!==true || read.responseContentType.mime!=="text/x-component" || read.responseContentType.charset!=="absent"))) return null;
	for(const row of [origin,packet]) if(row.transportBodyReceipt?.protocol!=="proxy-natural-eof-decoded-bytes-v1" || row.transportBodyReceipt.naturalEOF!==true ||
		row.transportBodyReceipt.bodySha256!==cached.bodyProof.bodySha256 || row.transportBodyReceipt.decodedBytes!==cached.bodyProof.decodedBytes || row.bodyProof.bodySha256!==cached.bodyProof.bodySha256 || row.bodyProof.decodedBytes!==cached.bodyProof.decodedBytes) return null;
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
		nativeContextSha256:nativeContextDigest(context)};
	}catch{return null;}
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
			verified.records[0].reason !== row.reason
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
