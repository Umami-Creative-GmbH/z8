/** Pure observations of one owned proxy's upstream response headers; no cookie/native eligibility claim. */
import { createHash } from "node:crypto";
import {mixedOwnedOperation,mixedOwnedClone as structuredClone,mixedOwnedRows,mixedOwnedArray,mixedOwnedJSONString,mixedOwnedHashInput} from "./mixed-technical-gzip.mjs";

export const proxyHeaderCensusProtocol =
	"owned-proxy-upstream-header-census-v1";
export const proxyHeaderCensusLimit = 10000;
export const proxyHeaderSnapshotByteLimit = 65536;
const digest = (value) => createHash("sha256").update(mixedOwnedHashInput(value)).digest("hex");
const contextKnown = (value) =>
	typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const requestKnown = (value) =>
	typeof value === "string" && /^[a-f0-9]{32}\.[1-9][0-9]{0,9}$/.test(value);
const faultKinds = ["error", "duplicate", "missing", "late", "overflow"];
const emptyFaultCounts = () =>
	Object.fromEntries(faultKinds.map((kind) => [kind, 0]));
const summarize = (requests, faults, unretainedFaults) => mixedOwnedOperation(()=>{
 mixedOwnedArray(Math.max(requests.length,faults.length),()=>null,{bytesPerEntry:128});
	const count = (kind) =>
		faults.filter((fault) => fault.kind === kind).length +
		unretainedFaults[kind];
	return {
		accepted: requests.length,
		knownHeaders: requests.filter((row) => row.observation === "headers")
			.length,
		pending: requests.filter((row) => row.observation === "pending").length,
		unknownHeaders: requests.filter(
			(row) => row.observation === "unknown-headers",
		).length,
		terminalBeforeHeaders: requests.filter(
			(row) => row.observation === "terminal-before-headers",
		).length,
		setCookieResponses: requests.filter((row) => row.setCookieLines > 0).length,
		setCookieLines: requests.reduce(
			(sum, row) => sum + (row.setCookieLines ?? 0),
			0,
		),
		errors: count("error"),
		duplicates: count("duplicate"),
		missing: count("missing"),
		late: count("late"),
		overflow:
			count("overflow") +
			Object.values(unretainedFaults).reduce((sum, value) => sum + value, 0),
	};
},{retainResult:true});
const inspectHeaders = (headers) => {
	try {
		if (
			!headers ||
			Array.isArray(headers) ||
			![Object.prototype, null].includes(Object.getPrototypeOf(headers))
		)
			return null;
		const keys = Reflect.ownKeys(headers),
			lines = [];
		if (keys.length > proxyHeaderCensusLimit) return null;
		let bytes = 0,
			valueCount = 0;
		for (const key of keys) {
			if (
				typeof key !== "string" ||
				!/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(key)
			)
				return null;
			const descriptor = Object.getOwnPropertyDescriptor(headers, key);
			if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
			const values = descriptor.value;
			if (
				typeof values !== "string" &&
				(!Array.isArray(values) ||
					values.length === 0 ||
					values.length > proxyHeaderCensusLimit)
			)
				return null;
			bytes += Buffer.byteLength(key);
			if (bytes > proxyHeaderSnapshotByteLimit) return null;
			for (
				let index = 0;
				index < (typeof values === "string" ? 1 : values.length);
				index++
			) {
				if (++valueCount > proxyHeaderCensusLimit) return null;
				const item =
					typeof values === "string"
						? { value: values }
						: Object.getOwnPropertyDescriptor(values, String(index));
				if (
					!item ||
					!Object.hasOwn(item, "value") ||
					typeof item.value !== "string"
				)
					return null;
				bytes += Buffer.byteLength(item.value);
				if (bytes > proxyHeaderSnapshotByteLimit) return null;
				if (key.toLowerCase() === "set-cookie") lines.push(item.value);
			}
		}
		return {
			setCookieLines: lines.length,
			setCookieSha256: lines.length ? digest(mixedOwnedJSONString(lines)) : null,
		};
	} catch {
		return null;
	}
};
const snapshot = (contextId, closed, requests, faults, unretainedFaults) => {
	const facts = {
		protocol: proxyHeaderCensusProtocol,
		contextId,
		limit: proxyHeaderCensusLimit,
		closed,
		requests: mixedOwnedRows(()=>requests,(row) => ({ ...row }))
			.sort((a, b) =>
				a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0,
			),
		faults: mixedOwnedRows(()=>faults,(fault) => ({ ...fault })),
		unretainedFaults: { ...unretainedFaults },
	};
	return {
		...facts,
		counts: summarize(facts.requests, facts.faults, facts.unretainedFaults),
		censusSha256: digest(mixedOwnedJSONString(facts)),
	};
};

export function createProxyHeaderCensus({ contextId }) {
	if (!contextKnown(contextId))
		throw Error("A technical context identity is required.");
	const requests = new Map();
	const faults = [];
	const unretainedFaults = emptyFaultCounts();
	let closed = false;
	const fault = (kind, event) => {
		if (faults.length === proxyHeaderCensusLimit) unretainedFaults[kind]++;
		else faults.push({ kind, event });
	};
	const active = (requestId, event) => {
		if (closed) {
			fault("late", event);
			return false;
		}
		if (!requestKnown(requestId)) {
			fault("error", event);
			return false;
		}
		return true;
	};
	const pending = (requestId, event) => {
		if (!active(requestId, event)) return null;
		const row = requests.get(requestId);
		if (!row) {
			fault("missing", event);
			return null;
		}
		if (row.observation !== "pending") {
			fault("duplicate", event);
			return null;
		}
		return row;
	};
	return {
		accepted(requestId) {
			if (!active(requestId, "accepted")) return;
			if (requests.has(requestId)) {
				fault("duplicate", "accepted");
				return;
			}
			if (requests.size === proxyHeaderCensusLimit) {
				fault("overflow", "accepted");
				return;
			}
			requests.set(requestId, {
				requestId,
				observation: "pending",
				setCookieLines: null,
				setCookieSha256: null,
			});
		},
		headers(requestId, headers) {
			const row = pending(requestId, "headers");
			if (!row) return;
			const facts = inspectHeaders(headers);
			Object.assign(
				row,
				facts
					? { observation: "headers", ...facts }
					: {
							observation: "unknown-headers",
							setCookieLines: null,
							setCookieSha256: null,
						},
			);
		},
		terminalBeforeHeaders(requestId, fact) {
			const row = pending(requestId, "terminal-before-headers");
			if (!row) return;
			if (fact?.upstreamClosed !== true || fact.headersReceived !== false) {
				fault("error", "terminal-before-headers");
				return;
			}
			row.observation = "terminal-before-headers";
		},
		observerError() {
			if (closed) fault("late", "observer-error");
			fault("error", "observer-error");
		},
		close() {
			if (closed) fault("duplicate", "close");
			else closed = true;
		},
		snapshot() {
			return snapshot(
				contextId,
				closed,
				[...requests.values()],
				faults,
				unretainedFaults,
			);
		},
	};
}

/** Checks serialized facts, not whether the observation is clean or sufficient for any Native proof. */
export function validateProxyHeaderCensus(proof, { contextId } = {}) {
	try {
		const keys = (value, expected) =>
			value &&
			[Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
			Reflect.ownKeys(value).length === expected.length &&
			expected.every((key) => {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				return descriptor && Object.hasOwn(descriptor, "value");
			});
		const count = (value) => Number.isSafeInteger(value) && value >= 0;
		if (
			!keys(proof, [
				"protocol",
				"contextId",
				"limit",
				"closed",
				"requests",
				"faults",
				"unretainedFaults",
				"counts",
				"censusSha256",
			]) ||
			!contextKnown(contextId) ||
			proof.contextId !== contextId ||
			proof.protocol !== proxyHeaderCensusProtocol ||
			proof.limit !== proxyHeaderCensusLimit ||
			typeof proof.closed !== "boolean" ||
			!/^[a-f0-9]{64}$/.test(proof.censusSha256) ||
			!Array.isArray(proof.requests) ||
			proof.requests.length > proxyHeaderCensusLimit ||
			!Array.isArray(proof.faults) ||
			proof.faults.length > proxyHeaderCensusLimit ||
			!keys(proof.unretainedFaults, faultKinds) ||
			!Object.values(proof.unretainedFaults).every(count) ||
			(Object.values(proof.unretainedFaults).some((value) => value > 0) &&
				proof.faults.length !== proxyHeaderCensusLimit)
		)
			return false;
		if (
			proof.requests.some(
				(row) =>
					!keys(row, [
						"requestId",
						"observation",
						"setCookieLines",
						"setCookieSha256",
					]) ||
					!requestKnown(row.requestId) ||
					![
						"pending",
						"headers",
						"unknown-headers",
						"terminal-before-headers",
					].includes(row.observation) ||
					(row.observation === "headers"
						? !count(row.setCookieLines) ||
							row.setCookieLines > proxyHeaderCensusLimit ||
							(row.setCookieLines === 0
								? row.setCookieSha256 !== null
								: !/^[a-f0-9]{64}$/.test(row.setCookieSha256))
						: row.setCookieLines !== null || row.setCookieSha256 !== null),
			) ||
			new Set(mixedOwnedArray(proof.requests.length,()=>proof.requests.map((row) => row.requestId),{bytesPerEntry:80})).size !==
				proof.requests.length
		)
			return false;
		const events = {
			error: [
				"accepted",
				"headers",
				"terminal-before-headers",
				"observer-error",
			],
			duplicate: ["accepted", "headers", "terminal-before-headers", "close"],
			missing: ["headers", "terminal-before-headers"],
			late: [
				"accepted",
				"headers",
				"terminal-before-headers",
				"observer-error",
			],
			overflow: ["accepted"],
		};
		if (
			proof.faults.some(
				(fault) =>
					!keys(fault, ["kind", "event"]) ||
					!Object.hasOwn(events, fault.kind) ||
					!events[fault.kind].includes(fault.event) ||
					(!proof.closed && (fault.kind === "late" || fault.event === "close")),
			)
		)
			return false;
		const expected = snapshot(
			contextId,
			proof.closed,
			proof.requests,
			proof.faults,
			proof.unretainedFaults,
		);
		if (
			!keys(proof.counts, Object.keys(expected.counts)) ||
			!Object.values(proof.counts).every(count) ||
			!Object.values(expected.counts).every(count)
		)
			return false;
		return mixedOwnedJSONString(proof) === mixedOwnedJSONString(expected);
	} catch {
		return false;
	}
}

export const proxyHeaderPrefixProtocol = "owned-proxy-open-header-prefix-v1";
const lifecycleProtocol = "owned-proxy-upstream-header-cut-v1";
const shaKnown = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const exactDataKeys = (value, names) => value && [Object.prototype,null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length===names.length && names.every(name=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,name) ?? {},"value"));
const lifecycleFields = ["acceptedOrdinal","upstreamCreatedOrdinal","headersReceivedOrdinal","headersForwardedOrdinal","upstreamClosedOrdinal"];
const lifecycleFacts = state => {
 const requests=mixedOwnedRows(()=>state.requests.values(),row=>({...row})).sort((a,b)=>a.requestId<b.requestId?-1:1);
 const facts={protocol:lifecycleProtocol,proxyInstanceId:state.proxyInstanceId,originSha256:state.originSha256,allowedOriginSha256:mixedOwnedArray(state.allowedOriginSha256.length,()=>[...state.allowedOriginSha256],{bytesPerEntry:80}),closed:state.closed,eventOrdinal:state.eventOrdinal,errors:state.errors,overflow:state.overflow,requests,
 acceptedRequests:requests.length,upstreamRequests:mixedOwnedArray(requests.length,()=>requests.filter(row=>row.upstreamCreatedOrdinal!==null)).length,closedUpstreams:mixedOwnedArray(requests.length,()=>requests.filter(row=>row.upstreamClosedOrdinal!==null)).length};
 return {...facts,pendingUpstreams:facts.upstreamRequests-facts.closedUpstreams};
};
/** Source-adjacent lifecycle facts only. An open upstream is never represented as a finished request. */
export function createProxyHeaderLifecycle({proxyInstanceId,originSha256,allowedOriginSha256}) {
 if(!/^[a-f0-9]{32}$/.test(proxyInstanceId ?? "") || !shaKnown(originSha256) || !Array.isArray(allowedOriginSha256) || allowedOriginSha256.length<1 || allowedOriginSha256.length>32 || !allowedOriginSha256.every(shaKnown) || new Set(allowedOriginSha256).size!==allowedOriginSha256.length || !allowedOriginSha256.includes(originSha256))throw Error("Known owned proxy origins are required.");
 const state={proxyInstanceId,originSha256,allowedOriginSha256:[...allowedOriginSha256].sort(),closed:false,eventOrdinal:0,errors:0,overflow:0,requests:new Map()};
 const record=(id,key)=>{
  const row=state.requests.get(id);
  if(state.closed || !requestKnown(id) || !row || row[key]!==null || key!=="upstreamCreatedOrdinal" && row.upstreamCreatedOrdinal===null || key==="headersForwardedOrdinal" && (row.headersReceivedOrdinal===null || row.upstreamClosedOrdinal!==null) || key==="headersReceivedOrdinal" && row.upstreamClosedOrdinal!==null){state.errors++;return;}
  row[key]=++state.eventOrdinal;
 };
 return {
  accepted(requestId,requestOriginSha256){
   if(state.closed || !requestKnown(requestId) || state.requests.has(requestId) || !state.allowedOriginSha256.includes(requestOriginSha256)){state.errors++;return;}
   if(state.requests.size===proxyHeaderCensusLimit){state.overflow++;return;}
   state.requests.set(requestId,{requestId,originSha256:requestOriginSha256,acceptedOrdinal:++state.eventOrdinal,upstreamCreatedOrdinal:null,headersReceivedOrdinal:null,headersForwardedOrdinal:null,upstreamClosedOrdinal:null});
  },
  upstreamCreated:id=>record(id,"upstreamCreatedOrdinal"),
  headersReceived:id=>record(id,"headersReceivedOrdinal"),
  headersForwarded:id=>record(id,"headersForwardedOrdinal"),
  upstreamClosed:id=>record(id,"upstreamClosedOrdinal"),
  observerError(){state.errors++;},
  close(){if(state.closed)state.errors++;state.closed=true;},
  snapshot(){return lifecycleFacts(state);},
 };
}
/** Immutable vector cut; this neither closes the census nor promises future headers are clean. */
export function proxyHeaderPrefix(census,lifecycle) {
 const facts={protocol:proxyHeaderPrefixProtocol,census:structuredClone(census),lifecycle:structuredClone(lifecycle)};
 return {...facts,prefixSha256:digest(mixedOwnedJSONString(facts))};
}
/** Recomputes open facts and their membership/order; callers separately require zero error/Set-Cookie counts. */
export function validateProxyHeaderPrefix(proof,{contextId}={}) {
 try {
  if(!exactDataKeys(proof,["protocol","census","lifecycle","prefixSha256"]) || proof.protocol!==proxyHeaderPrefixProtocol || !shaKnown(proof.prefixSha256) || !validateProxyHeaderCensus(proof.census,{contextId}) || proof.census.closed!==false)return false;
  const life=proof.lifecycle;
  if(!validateProxyHeaderLifecycle(life) || life.closed!==false || life.requests.length!==proof.census.requests.length)return false;
  const requests=new Map(mixedOwnedArray(life.requests.length,()=>life.requests.map(row=>[row.requestId,row]),{bytesPerEntry:96}));
  for(const row of proof.census.requests){
   const source=requests.get(row.requestId);if(!source)return false;
   if(row.observation==="pending" && (source.headersReceivedOrdinal!==null || source.headersForwardedOrdinal!==null || source.upstreamClosedOrdinal!==null) || ["headers","unknown-headers"].includes(row.observation) && source.headersReceivedOrdinal===null || row.observation==="terminal-before-headers" && (source.headersReceivedOrdinal!==null || source.headersForwardedOrdinal!==null || source.upstreamClosedOrdinal===null))return false;
  }
  return proof.prefixSha256===digest(mixedOwnedJSONString({protocol:proof.protocol,census:proof.census,lifecycle:life}));
 }catch{return false;}
}

/** Validates technical lifecycle facts, independently of an open-prefix or Native authority claim. */
export function validateProxyHeaderLifecycle(life){
 try{
  if(!exactDataKeys(life,["protocol","proxyInstanceId","originSha256","allowedOriginSha256","closed","eventOrdinal","errors","overflow","requests","acceptedRequests","upstreamRequests","closedUpstreams","pendingUpstreams"]) || life.protocol!==lifecycleProtocol || !/^[a-f0-9]{32}$/.test(life.proxyInstanceId ?? "") || !shaKnown(life.originSha256) || typeof life.closed!=="boolean" || !["eventOrdinal","errors","overflow","acceptedRequests","upstreamRequests","closedUpstreams","pendingUpstreams"].every(key=>whole(life[key])) || !Array.isArray(life.requests) || life.requests.length>proxyHeaderCensusLimit || !Array.isArray(life.allowedOriginSha256) || life.allowedOriginSha256.length<1 || life.allowedOriginSha256.length>32 || !life.allowedOriginSha256.every(shaKnown) || new Set(life.allowedOriginSha256).size!==life.allowedOriginSha256.length || !life.allowedOriginSha256.includes(life.originSha256))return false;
  const events=mixedOwnedArray(life.requests.length,()=>[],{bytesPerEntry:192}), requests=new Map();
  for(const row of life.requests){
   if(!exactDataKeys(row,["requestId","originSha256",...lifecycleFields]) || !requestKnown(row.requestId) || requests.has(row.requestId) || !life.allowedOriginSha256.includes(row.originSha256) || !Number.isSafeInteger(row.acceptedOrdinal) || row.acceptedOrdinal<1)return false;
   for(const field of lifecycleFields){const n=row[field];if(n!==null){if(!Number.isSafeInteger(n)||n<1||n>life.eventOrdinal)return false;events.push(n);}}
   if(row.upstreamCreatedOrdinal!==null && row.upstreamCreatedOrdinal<=row.acceptedOrdinal || [row.headersReceivedOrdinal,row.headersForwardedOrdinal,row.upstreamClosedOrdinal].some(n=>n!==null && (row.upstreamCreatedOrdinal===null || n<=row.upstreamCreatedOrdinal)) || row.headersForwardedOrdinal!==null && (row.headersReceivedOrdinal===null || row.headersForwardedOrdinal<=row.headersReceivedOrdinal) || row.upstreamClosedOrdinal!==null && row.headersReceivedOrdinal!==null && row.upstreamClosedOrdinal<=row.headersReceivedOrdinal || row.upstreamClosedOrdinal!==null && row.headersForwardedOrdinal!==null && row.upstreamClosedOrdinal<=row.headersForwardedOrdinal)return false;
   requests.set(row.requestId,row);
  }
  if(events.length!==life.eventOrdinal || events.sort((a,b)=>a-b).some((n,i)=>n!==i+1) || mixedOwnedArray(life.requests.length,()=>life.requests.map(row=>Number(row.requestId.split(".")[1]))).sort((a,b)=>a-b).some((n,i)=>n!==i+1))return false;
  const expected=lifecycleFacts({...life,requests});
  if(mixedOwnedJSONString(expected)!==mixedOwnedJSONString(life))return false;
  return true;
 }catch{return false;}
}
