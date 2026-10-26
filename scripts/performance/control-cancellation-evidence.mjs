/** Proofs are prospective; a canceled request is never a successful payload. */
import { createHash } from "node:crypto";
export const controlCancellationPolicy = Object.freeze({
	version: 1,
	protocol: "positively-proven-protocol-controls-v1",
	encodedLimit: 4 * 1024 * 1024,
	decodedLimit: 8 * 1024 * 1024,
	retainedLimit: 32 * 1024 * 1024,
	recordLimit: 10000,
});
export const chromiumSWRRevision = "1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775";
export const bodySha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const binaryByteWidths = Object.freeze({ A: 1, O: 1, o: 1, b: 1, U: 1, S: 2, s: 2, L: 4, l: 4, G: 4, g: 8, M: 8, m: 8, V: 1 });
const canonicalFlightId = id => /^(0|[1-9a-f][a-f0-9]{0,12})$/.test(id) && Number.isSafeInteger(Number.parseInt(id,16));

export function knownBrowserControlMetadata(metadata) {
	return Boolean(metadata && JSON.stringify(metadata.policy) === JSON.stringify(controlCancellationPolicy) &&
		metadata.browserRevision === chromiumSWRRevision && typeof metadata.compiledCachedNavigations === "boolean" &&
		typeof metadata.compiledManifestSha256 === "string" && /^[a-f0-9]{64}$/.test(metadata.compiledManifestSha256));
}

export function matchingBrowserControlBinding(runtime, binding) {
	const expected = runtime?.browserControl;
	return knownBrowserControlMetadata(expected) && knownBrowserControlMetadata(binding) &&
		["browserRevision", "compiledCachedNavigations", "compiledManifestSha256"].every((key) => binding[key] === expected[key]) &&
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
		requestKind = action ? "action" : "navigation",
	} = {}, budget, depth,
) {
	const modelBudgetAtStart = budget.models;
	const unknown = (reason, diagnostic = {}) => ({
		complete: false,
		reason,
		...diagnostic,
	});
	const supportedContract = ["action", "navigation", "route-tree", "runtime-shell", "embedded-runtime-prefetch"].includes(requestKind) &&
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
					: typeof cachedNavigations === "boolean"
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
	const notePathFailure = reason => { pathFailure ??= reason; return false; };
	const unknownPath = reason => { notePathFailure(reason); return {known:false}; };
	const pathStep = (depth, phase, context = {}) => {
		for (const scope of parentCheckDepths) scope.maxDepth = Math.max(scope.maxDepth,depth);
		const guard = depth > 64 ? "existing-recursion-depth" : ++budget.models > 100000 ? "shared-model-work" : null;
		if (guard) {
			pathLimit = true;
			pathLimitObservation ??= {guard,phase,observedDepth:depth,depthCap:64,sharedModelSteps:budget.models,modelCap:100000,
				localModelSteps:budget.models-modelBudgetAtStart,eagerParentCalls,outlinedCalls,eagerUniqueObjects,repeatedEagerObjects,
				activeOutlinedPaths:activePaths.size,...context};
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
		if (binaryValues.has(value) || opaqueText.has(value)) return notePathFailure("eager-binary-or-text-value");
		if (elementTuple(value) && !forceElement) return true;
		if (elementTuple(value) && value.length !== 4) return notePathFailure("malformed-eager-element");
		if (seen.has(value)) return true;
		const containers = new Set([...seen,value]);
		return Object.keys(value).filter(key=>key!=="__proto__").every(key=> {
			const descriptor=Object.getOwnPropertyDescriptor(value,key);
			return descriptor && Object.hasOwn(descriptor,"value") && eagerParent(descriptor.value,false,containers,depth + 1,referenceEdges,jsonDepth + 1);
		});
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
				const completed = standalone && completedParentChecks.get(parent.value)?.get(parent.originId);
				if (completed?.forceElement === true && entryDepth + completed.depthSpan <= 64)
					return pathStep(entryDepth,"completed-parent");
				// Reuse only a SAME-model materialized parent's active traversal. Its enclosing
				// validation still has to finish every sibling before this result can escape.
				// Cross-model/alias contexts keep their independent validation and cycle guards.
				const inherited = [...trail].every(item=>typeof item !== "string" || item === parent.originId) ? trail : [];
				const scope = {maxDepth:entryDepth}; parentCheckDepths.push(scope);
				let ready;
				try { ready = eagerParent(parent.value,true,new Set([...inherited,parent.originId]),entryDepth); }
				finally { parentCheckDepths.pop(); }
				if (ready && standalone) pendingParentChecks.push({parent,depthSpan:scope.maxDepth-entryDepth});
				return ready;
			})) return {known:false};
			for (const {parent,depthSpan} of pendingParentChecks) {
				let byOrigin = completedParentChecks.get(parent.value);
				if (!byOrigin) completedParentChecks.set(parent.value,byOrigin = new Map());
				byOrigin.set(parent.originId,{forceElement:true,depthSpan});
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
	const shellScope = requestKind === "runtime-shell" || (requestKind === "embedded-runtime-prefetch" && isPartial);
	const embeddedPartialScope = requestKind === "embedded-runtime-prefetch" && marker === "partial";
	const partialCacheScope = embeddedPartialScope || (requestKind === "runtime-shell" && marker === "partial");
	if (requestKind === "runtime-shell" && (marker !== "partial" || Object.hasOwn(root, "l") || Object.hasOwn(root, "a")))
		return unknown("unsupported-runtime-shell-metadata");
	// Roles follow exact transport edges; another required path to the same model stays required.
	const queue = [{ value: root, role: "root" }],
		visited = new Set();
	let inspected = 0, postponedOutputReferences = 0, knownSuspenseBoundaries = 0, knownEmptyFallbacks = 0, postponedComponentReferences = 0, representedComponentFallbacks = 0, postponedDirectOutputs = 0, postponedArrayOutputs = 0;
	while (queue.length) {
		if (++inspected > 100000 || ++budget.models > 100000) return unknown("model-limit");
		const { value, role, fallbackReferences, directEmbeddedOutput, fromTypedOutput, outputArrival, rArrayOutput, insideRArray } = queue.pop();
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
			if (!visited.has(`${modelRole}:${id}`)) {
				visited.add(`${modelRole}:${id}`);
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
			// The partial p cache stores a direct lazy r wrapper without forcing it.
			// This flag is set only on the exact data.r edge, never on its descendants.
			if (!records.has(id) && embeddedPartialScope && directEmbeddedOutput === true && role === "output" && value[1] === "L" && canonicalFlightId(id)) {
				postponedDirectOutputs++;
				continue;
			}
			if (!records.has(id) && partialCacheScope && rArrayOutput === true && insideRArray === true && role === "output" && value[1] === "L" && canonicalFlightId(id)) {
				postponedArrayOutputs++;
				continue;
			}
			if (!records.has(id)) return unknown("unresolved-model-reference", {
				modelReference: { prefix: value[1] === "L" ? "L" : value[1] === "@" ? "@" : "plain",
					form: value[1] === "L" ? "lazy-reference" : value[1] === "@" ? "promise-reference" : "model-reference", length: value.length },
				semanticRole: role,
				outputEdgeObservation:{walkPathOnly:true,fromTypedOutput:fromTypedOutput===true,directEmbeddedOutput:directEmbeddedOutput===true,arrival:outputArrival ?? "root-or-required"},
				marker, isPartial, requestKind, decodedBytes: bytes.length, bodySha256: bodySha256(bytes),
			});
			if (!visited.has(`${role}:${id}`)) {
				visited.add(`${role}:${id}`);
				const record = records.get(id);
				if (shellScope && role === "fallback-output" && record.tag !== null && record.tag !== "T")
					return unknown("unsupported-runtime-shell-fallback-kind");
				if (record.tag !== "T") queue.push({ value: record.value, role, fromTypedOutput, outputArrival:"model-reference",
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
			const output = ["output", "suspended-output", "fallback-output"].includes(role) || (embeddedPartialScope && role === "component-data");
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
						{ value: value[3], role: role === "fallback-output" ? "fallback-host-props" : suspense ? "suspense-props" : role === "suspended-output" ? "suspended-host-props" : "host-props", fallbackReferences, fromTypedOutput, outputArrival:"element-props" });
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
				else if (shellScope && role === "data" && key === "r") nextRole = "output";
				else if (shellScope && key === "fallback" && role === "suspense-props") nextRole = "fallback-output";
				else if (shellScope && ["children", "fallback"].includes(key) && role === "fallback-host-props") nextRole = "fallback-output";
				else if (shellScope && key === "children" && ["suspense-props", "suspended-host-props"].includes(role)) nextRole = "suspended-output";
				else if (shellScope && key === "children" && role === "host-props") nextRole = "output";
				else if (shellScope && output && Array.isArray(value)) nextRole = role;
				else if (shellScope && role === "component-data") nextRole = role;
				queue.push({ value: item, role: nextRole, fallbackReferences, directEmbeddedOutput: embeddedPartialScope && role === "data" && key === "r",
					rArrayOutput:(partialCacheScope && role==="data" && key==="r") || (rArrayOutput===true && role==="output" && Array.isArray(value) && !elementTuple(value)),
					insideRArray:rArrayOutput===true && role==="output" && Array.isArray(value) && !elementTuple(value),
					fromTypedOutput:fromTypedOutput===true || (role==="data" && key==="r"),
					outputArrival:role==="data" && key==="r" ? "typed-data-r" : Array.isArray(value) && output ? "array-output" : key==="children" && ["host-props","suspense-props","suspended-host-props","fallback-host-props"].includes(role) ? "element-children" : key==="fallback" && role==="suspense-props" ? "element-fallback" : "own-field" });
			}
		}
	}
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
			const directLazy = typeof data.r === "string" && /^\$L([a-f0-9]+)$/.exec(data.r);
			const postponedDirect = embeddedPartialScope && directLazy && canonicalFlightId(directLazy[1]) && !records.has(directLazy[1]);
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
		if (representedOutputs === 0 && postponedDirectOutputs === 0)
			return unknown("missing-represented-navigation-output");
		patchClaims = { representedOutputs, treeNodes: seen.size,
			...(shellScope ? { postponedOutputReferences, knownSuspenseBoundaries, knownEmptyFallbacks } : {}),
			...(postponedComponentReferences || representedComponentFallbacks || postponedDirectOutputs || postponedArrayOutputs ? { postponedComponentReferences, representedComponentFallbacks, postponedDirectOutputs, postponedArrayOutputs, renderableOutputClaim: false } : {}) };
		requiredStage = postponedComponentReferences || representedComponentFallbacks || postponedDirectOutputs || postponedArrayOutputs ? requestKind === "runtime-shell" ? "runtime-shell-cache-representation" : "embedded-partial-prefetch-representation" : requestKind === "embedded-runtime-prefetch" ? "embedded-runtime-prefetch-output" : shellScope ? "runtime-shell-output" : "navigation-patch";
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
	if ((Object.hasOwn(proof, "postponedComponentReferences") || Object.hasOwn(proof, "representedComponentFallbacks") || Object.hasOwn(proof, "postponedDirectOutputs") || Object.hasOwn(proof, "postponedArrayOutputs") || Object.hasOwn(proof, "renderableOutputClaim")) &&
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
			Number.isSafeInteger(proof.representedOutputs) && proof.representedOutputs >= (proof.requiredStage === "embedded-partial-prefetch-representation" ? 0 : 1) && proof.representedOutputs <= proof.treeNodes + 1 &&
			Number.isSafeInteger(proof.postponedOutputReferences) && proof.postponedOutputReferences >= 0 && proof.postponedOutputReferences <= 100000 &&
			Number.isSafeInteger(proof.knownSuspenseBoundaries) && proof.knownSuspenseBoundaries >= 0 && proof.knownSuspenseBoundaries <= 100000 &&
			Number.isSafeInteger(proof.knownEmptyFallbacks) && proof.knownEmptyFallbacks >= 0 && proof.knownEmptyFallbacks <= proof.knownSuspenseBoundaries &&
			(proof.postponedOutputReferences === 0 || proof.knownSuspenseBoundaries > 0) &&
			(!["embedded-partial-prefetch-representation","runtime-shell-cache-representation"].includes(proof.requiredStage) ||
				(proof.renderableOutputClaim === false && Number.isSafeInteger(proof.postponedComponentReferences) && proof.postponedComponentReferences >= 0 && proof.postponedComponentReferences <= 100000 &&
				Number.isSafeInteger(proof.representedComponentFallbacks) && proof.representedComponentFallbacks >= 0 && proof.representedComponentFallbacks <= 100000 &&
				Number.isSafeInteger(proof.postponedDirectOutputs) && proof.postponedDirectOutputs >= 0 && proof.postponedDirectOutputs <= proof.treeNodes + 1 &&
				Number.isSafeInteger(proof.postponedArrayOutputs) && proof.postponedArrayOutputs >= 0 && proof.postponedArrayOutputs <= 100000 &&
				(proof.requiredStage !== "runtime-shell-cache-representation" || (proof.postponedComponentReferences === 0 && proof.postponedDirectOutputs === 0)) &&
				proof.postponedDirectOutputs + proof.representedOutputs > 0 && proof.postponedDirectOutputs + proof.representedOutputs <= proof.treeNodes + 1 &&
				proof.postponedComponentReferences + proof.representedComponentFallbacks + proof.postponedDirectOutputs + proof.postponedArrayOutputs > 0 &&
				proof.postponedComponentReferences + proof.representedComponentFallbacks + proof.postponedDirectOutputs + proof.postponedArrayOutputs <= proof.modelSteps));
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
		"representedOutputs",
		"postponedOutputReferences",
		"postponedComponentReferences",
		"representedComponentFallbacks",
		"postponedDirectOutputs",
		"postponedArrayOutputs",
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
		"requestHeadersSha256",
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

/** Input records are emitted by the owned passive collector, never inferred from labels alone. */
export function classifyControlCancellations({
	failures = [],
	responses = [],
	proxy = [],
	coverage,
	browserRevision,
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
					"complete-cached-flight-native-revalidation",
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
			(row.reason === "complete-cached-flight-native-revalidation" &&
				proof.cachedCandidates !== 1)
		)
			return false;
		const verified = classifyControlCancellations({
			failures: [proof.failure],
			proxy: [proof.packet],
			responses: proof.cached ? [proof.cached] : [],
			browserRevision: proof.browserRevision,
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

/** Coverage is distinct from acceptance: unproven optional all-phase failures stay visible. */
export function completeAllPhaseBrowserObservation(evidence) {
	return browserFailureEvidenceMatches(evidence, evidence?.rawFailedRequests, "all-phase-semantic-correlation", false);
}
