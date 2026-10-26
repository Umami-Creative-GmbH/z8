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
	bytes,
	{
		action = false,
		cachedNavigations,
		requestKind = action ? "action" : "navigation",
	} = {},
) {
	const unknown = (reason, diagnostic = {}) => ({
		complete: false,
		reason,
		...diagnostic,
	});
	if (
		!["action", "navigation", "route-tree", "runtime-shell"].includes(requestKind) ||
		action !== (requestKind === "action")
	)
		return unknown("unsupported-request-contract");
	if (
		!Buffer.isBuffer(bytes) ||
		bytes.length > controlCancellationPolicy.decodedLimit
	)
		return unknown("bounded-body-unavailable");
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
	if (!marker) return unknown("unsupported-marker");
	const isPartial =
		marker === "partial" ||
		(marker === "unmarked-navigation" && cachedNavigations);
	const body = marker.startsWith("unmarked-") ? bytes : bytes.subarray(1),
		records = new Map();
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	const opaqueText = new WeakSet();
	let offset = 0,
		serverErrors = 0,
		recordCount = 0;
	try {
		while (offset < body.length) {
			if (++recordCount > 4096) return unknown("record-limit");
			if (
				body[offset] === 58 &&
				body[offset + 1] === 72 &&
				/[DCLmSXM]/.test(String.fromCharCode(body[offset + 2]))
			) {
				const end = body.indexOf(10, offset);
				if (end < offset) return unknown("incomplete-hint");
				JSON.parse(utf8.decode(body.subarray(offset + 3, end)));
				offset = end + 1;
				continue;
			}
			const recordOffset = offset + (marker.startsWith("unmarked-") ? 0 : 1);
			const colon = body.indexOf(58, offset);
			const id = body.subarray(offset, colon).toString();
			if (colon < offset || !/^[a-f0-9]+$/.test(id))
				return unknown("invalid-record");
			let start = colon + 1,
				end,
				value;
			const tagByte = body[start];
			const tag = /^[A-Z#rx]$/.test(String.fromCharCode(tagByte))
				? String.fromCharCode(body[start++])
				: null;
			if (tag === "T") {
				const comma = body.indexOf(44, start),
					length = body.subarray(start, comma).toString();
				if (comma < start || !/^[a-f0-9]+$/.test(length))
					return unknown("invalid-text-length");
				end = comma + 1 + Number.parseInt(length, 16);
				if (!Number.isSafeInteger(end) || end > body.length)
					return unknown("incomplete-text");
				value = utf8.decode(body.subarray(comma + 1, end));
			} else {
				end = body.indexOf(10, start);
				if (
					end < start ||
					![null, "I", "H", "E", "X", "x", "R", "r", "C"].includes(tag)
				)
					return unknown("unsupported-record", { tagByte, recordOffset });
				const text = utf8.decode(body.subarray(start, end));
				if (["X", "x", "R", "r"].includes(tag)) {
					if (text !== "") return unknown("invalid-stream-opener");
				} else if (tag === "C" && text === "") value = "$undefined";
				else if (tag === "H") {
					if (!/^[DCLmSXM]/.test(text))
						return unknown("unsupported-record", { tagByte, recordOffset });
					value = JSON.parse(text.slice(1));
				} else value = JSON.parse(text);
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
					![null, "T", "C", "E"].includes(tag)
				)
					return unknown("invalid-stream-record");
				if (previous.tag === "r" && tag !== "C" && tag !== "E")
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
		return unknown("invalid-record");
	}
	if (serverErrors)
		return { complete: false, reason: "flight-server-error", serverErrors };
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
	const resolve = (value) => {
		const seen = new Set();
		while (typeof value === "string" && /^\$@?[a-f0-9]+$/.test(value)) {
			const id = value.replace(/^\$@?/, "");
			if (seen.has(id) || seen.size >= 8) return undefined;
			seen.add(id);
			value = records.get(id)?.value;
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
			if (++nodes > 4096) return unknown("tree-limit");
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
		};
	}
	const shellScope = requestKind === "runtime-shell";
	if (shellScope && (marker !== "partial" || Object.hasOwn(root, "l") || Object.hasOwn(root, "a")))
		return unknown("unsupported-runtime-shell-metadata");
	// Roles follow exact transport edges; another required path to the same model stays required.
	const queue = [{ value: root, role: "root" }],
		visited = new Set();
	let inspected = 0, postponedOutputReferences = 0, knownSuspenseBoundaries = 0;
	while (queue.length) {
		if (++inspected > 100000) return unknown("model-limit");
		const { value, role, fallbackReferences } = queue.pop();
		if (shellScope && role === "fallback-output" && (
			(value && typeof value === "object" && !Array.isArray(value)) ||
			(typeof value === "string" && /^\$[SD]/.test(value))))
			return unknown("unknown-runtime-shell-fallback");
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
				queue.push({ value: model, role: modelRole, fallbackReferences });
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
			if (!records.has(id)) return unknown("unresolved-model-reference", {
				modelReference: { prefix: value[1] === "L" ? "L" : value[1] === "@" ? "@" : "plain",
					form: value[1] === "L" ? "lazy-reference" : value[1] === "@" ? "promise-reference" : "model-reference", length: value.length },
				semanticRole: role,
				marker, isPartial, requestKind, decodedBytes: bytes.length, bodySha256: bodySha256(bytes),
			});
			if (!visited.has(`${role}:${id}`)) {
				visited.add(`${role}:${id}`);
				const record = records.get(id);
				if (shellScope && role === "fallback-output" && record.tag !== null && record.tag !== "T")
					return unknown("unsupported-runtime-shell-fallback-kind");
				if (record.tag !== "T") queue.push({ value: record.value, role,
					fallbackReferences: role === "fallback-output" ? new Set([...(fallbackReferences ?? []), id]) : fallbackReferences });
			}
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
			const output = ["output", "suspended-output", "fallback-output"].includes(role);
			if (shellScope && output && Array.isArray(value) && value[0] === "$" && value.length !== 4)
				return unknown("unsupported-runtime-shell-output");
			if (shellScope && output && Array.isArray(value) && value.length === 4 && value[0] === "$") {
				const type = resolve(value[1]), props = resolve(value[3]);
				const suspense = type === "$Sreact.suspense";
				const known = suspense || type === "$Sreact.fragment" || (typeof type === "string" && type.length > 0 && !type.startsWith("$"));
				if (known) {
					if (!props || typeof props !== "object" || Array.isArray(props) || (suspense && !Object.hasOwn(props, "fallback")))
						return unknown("unknown-runtime-shell-fallback");
					if (suspense) knownSuspenseBoundaries++;
					queue.push({ value: value[1], role: "element-type", fallbackReferences }, { value: value[2], role: "element-key", fallbackReferences },
						{ value: value[3], role: role === "fallback-output" ? "fallback-host-props" : suspense ? "suspense-props" : role === "suspended-output" ? "suspended-host-props" : "host-props", fallbackReferences });
					continue;
				}
				if (role === "fallback-output") return unknown("unknown-runtime-shell-fallback");
				// Unknown component props may interpret children as ordinary required data.
				for (let index = value.length - 1; index >= 0; index--)
					queue.push({ value: value[index], role: index === 1 ? "element-type" : index === 3 ? "component-data" : "required", fallbackReferences });
				continue;
			}
			for (const [key, item] of Object.entries(value)) {
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
				queue.push({ value: item, role: nextRole, fallbackReferences });
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
		let result = root.a;
		const seen = new Set();
		while (typeof result === "string" && /^\$@?[a-f0-9]+$/.test(result)) {
			const id = result.replace(/^\$@?/, "");
			if (seen.has(id) || seen.size >= 8)
				return unknown("unresolved-action-result");
			seen.add(id);
			result = records.get(id)?.value;
		}
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
				!(key === "a" && root[key] === null) &&
				boundary(root[key]) === null
			)
				return unknown("unsupported-boundary-metadata");
		}
	let requiredStage = "full",
		boundaryBytes = body.length,
		patchClaims = null;
	if (
		isPartial &&
		["navigation", "runtime-shell"].includes(requestKind) &&
		!Object.hasOwn(root, "l") &&
		!Object.hasOwn(root, "a")
	) {
		// Main Flight consumption is independent of the optional static/shell cache clones.
		// This proves only the represented SPA patch, retaining response-level partiality.
		if (
			typeof root.q !== "string" ||
			typeof root.i !== "boolean" ||
			(Object.hasOwn(root, "S") && typeof root.S !== "boolean") ||
			Object.hasOwn(root, "n")
		)
			return unknown("unsupported-navigation-patch-root");
		const transport = resolve(root.t),
			nodes = [transport.t],
			seen = new Set();
		let representedOutputs = 0;
		const iterableHasType = (raw, accepts) => {
			if (typeof raw !== "string" || !/^\$[a-f0-9]+$/.test(raw)) return false;
			const record = records.get(raw.slice(1));
			return (
				record?.stream &&
				record.closed &&
				["X", "x"].includes(record.tag) &&
				record.value.slice(0, -1).every((item) => accepts(resolve(item)))
			);
		};
		const varyId = (value) =>
			value === 0 ||
			(typeof value === "string" &&
				(!value.startsWith("$") || value.startsWith("$$")));
		const staleTime = (value) =>
			typeof value === "number" && Number.isFinite(value) && value >= 0;
		const dataIsTyped = (raw) => {
			const data = resolve(raw);
			if (
				!data ||
				typeof data !== "object" ||
				Array.isArray(data) ||
				!Object.hasOwn(data, "r") ||
				typeof data.p !== "boolean" ||
				!Object.hasOwn(data, "v") ||
				Object.keys(data).some((key) => !["r", "p", "v", "s"].includes(key)) ||
				(data.v !== null && !iterableHasType(data.v, varyId)) ||
				(Object.hasOwn(data, "s") && !iterableHasType(data.s, staleTime))
			)
				return false;
			const output = resolve(data.r);
			const textOutput =
				typeof data.r === "string" &&
				/^\$@?[a-f0-9]+$/.test(data.r) &&
				records.get(data.r.replace(/^\$@?/, ""))?.tag === "T";
			if (
				textOutput ||
				(output !== null && output !== undefined && output !== "$undefined")
			)
				representedOutputs++;
			return true;
		};
		if (
			Object.keys(transport).some((key) => !["t", "h"].includes(key)) ||
			(Object.hasOwn(transport, "h") && !dataIsTyped(transport.h)) ||
			(Object.hasOwn(root, "r") &&
				root.r !== null &&
				!iterableHasType(root.r, varyId)) ||
			(Object.hasOwn(root, "s") && !iterableHasType(root.s, staleTime))
		)
			return unknown("unsupported-navigation-patch-data");
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
			if (
				(node.h !== undefined &&
					(!Number.isSafeInteger(node.h) || node.h < 0)) ||
				(Object.hasOwn(node, "d") && !dataIsTyped(node.d))
			)
				return unknown("unsupported-navigation-patch-data");
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
		if (representedOutputs === 0)
			return unknown("missing-represented-navigation-output");
		patchClaims = { representedOutputs, treeNodes: seen.size,
			...(shellScope ? { postponedOutputReferences, knownSuspenseBoundaries } : {}) };
		requiredStage = shellScope ? "runtime-shell-output" : "navigation-patch";
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
const goodBody = (proof) => {
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
	if (proof.requiredStage === "runtime-shell-output")
		return proof.requestKind === "runtime-shell" && !proof.action && proof.marker === "partial" && proof.isPartial &&
			Number.isSafeInteger(proof.treeNodes) && proof.treeNodes > 0 && proof.treeNodes <= 4096 &&
			Number.isSafeInteger(proof.representedOutputs) && proof.representedOutputs > 0 && proof.representedOutputs <= proof.treeNodes + 1 &&
			Number.isSafeInteger(proof.postponedOutputReferences) && proof.postponedOutputReferences >= 0 && proof.postponedOutputReferences <= 100000 &&
			Number.isSafeInteger(proof.knownSuspenseBoundaries) && proof.knownSuspenseBoundaries >= 0 && proof.knownSuspenseBoundaries <= 100000 &&
			(proof.postponedOutputReferences === 0 || proof.knownSuspenseBoundaries > 0);
	if (
		proof.action !== (proof.requestKind === "action") ||
		!["action", "navigation"].includes(proof.requestKind)
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
const bodyReceipt = (row) =>
	pick(row, [
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
		"knownSuspenseBoundaries",
		"boundaryBytes",
		"decodedBytes",
		"bodySha256",
		"serverErrors",
		"explicitActionFailure",
	]);
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
				(packet &&
					(packet.status >= 400 ||
						packet.upstreamError === true ||
						packet.bodyProof?.explicitActionFailure === true ||
						packet.bodyProof?.serverErrors > 0))
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
