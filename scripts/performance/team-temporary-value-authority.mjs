/** Original-only source and request-value authority. No payload is serialized. */
import { createHash, randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { readInertDateRangeRequestValue, forgetInertDateRangeRequestValue } from "./inert-date-range-request.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const rangeFields = Object.freeze(["start", "end", "startDate", "endDate", "timezone"]);
export const teamReplayHeader = "x-z8-fixture-replay-id";
export const temporaryValueObservation = Object.freeze({ protocol: "original-team-temporary-value-observation-v1", replayHeader: teamReplayHeader, documentJournal: "actual-cdp-document-journal-v1" });
const deepFreeze = value => {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
};
// New original builds require an explicit additional reviewed profile, never a descendant override.
export const originalTeamTemporaryProfiles = deepFreeze([
  {
    "id": "original-team-bfdf-v1",
    "binarySource": "bfdf2d573052eb485d2a6b9bd75896f98882baeb",
    "manifestSha256": "8cd0fc10a5288431c5b7afbc4f3d36273f965d6ff4d5b4a54bebe33a21201e64",
    "buildRecordSha256": "34acb938396ed571886c66933415dd7cede4dda6aaf4ccb82a5048ddf68be147",
    "registrySha256": "301a1afee35124ef83695e842e4d1fe2402d06da38964e0f0def9c4c66741f30",
    "actionHeaderSha256": "355ec2d858094c87d7c3ef4b72d291185893ee976b865ce2916bd10922204884",
    "appFiles": [
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/page.tsx",
        "gitBlob": "b081db8a3018bdcb34932d8eab0d7b9f380c02b8",
        "canonicalLfSha256": "54253fff67a4e10b1b9eb4b43e11ddfdd746de51224e4fa472b7b88d3d759793"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx",
        "gitBlob": "f7458cf92f0ef2db6304439088ea9173dcb61985",
        "canonicalLfSha256": "69edc9b5a312b33906d6d606f947fb0d03647db64359ac0e42a4acb79b0bed91"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts",
        "gitBlob": "9f281b436e86d9555f4562990d87b98ad7519407",
        "canonicalLfSha256": "ca8984fd0f173866eed151ecd037d1b36ee7ed869cd328bcea8689f976099472"
      },
      {
        "path": "apps/webapp/src/lib/effect/services/analytics.service.ts",
        "gitBlob": "aa5bb31705ecb9ac423f729fcc79b57efa045573",
        "canonicalLfSha256": "a2b868807eb10691dcd4b7f90583ed7076ed5e2312e3cdac8fea6df11bd8ef38"
      },
      {
        "path": "apps/webapp/src/lib/effect/result.ts",
        "gitBlob": "5c8cc57d829d33f0019ddb76820632c0dcde6e28",
        "canonicalLfSha256": "ac91c4720ac557fae05a5555df97b65a92af8b25c9750a0f5f4617ce6cb6f57a"
      },
      {
        "path": "apps/webapp/src/lib/analytics/date-ranges.ts",
        "gitBlob": "930365fe7bd9ce19530dfe1b702a048dfd0fca7c",
        "canonicalLfSha256": "095a81ae8f4e87f2f640baa489d487d6dff6465613444d192dffdfe2c2190c1f"
      },
      {
        "path": "apps/webapp/src/lib/analytics/types.ts",
        "gitBlob": "67644543cb2527464c9a4d788917c7286e5a9ef2",
        "canonicalLfSha256": "dad4e4d3c3d23d22f23132ff9b6b8abd4456df8d52310ba0f6d89e795ab9a34d"
      },
      {
        "path": "apps/webapp/src/components/analytics/date-range-picker.tsx",
        "gitBlob": "423d198408a8f68fb8fc771f862b18824be9d8d3",
        "canonicalLfSha256": "9863f2737fef10ce71ee6b0f4bfcbe5b4677ed1fbc244fee95433e83b0d70bf0"
      },
      {
        "path": "apps/webapp/src/components/reports/date-range-picker.tsx",
        "gitBlob": "18c2db57eb55af1e990fda2a8c84afa2c0645317",
        "canonicalLfSha256": "a344338209c40c0bade3fb8b55314c36815ccf547278b2bab584c0ee528d7d7b"
      },
      {
        "path": "apps/webapp/src/lib/reports/date-ranges.ts",
        "gitBlob": "14c82432031f4a1bc2cf98b89151e959433501ba",
        "canonicalLfSha256": "0ab5c18bfa3e6a9c221875c90c5481c96108579c33f552a741a5a624e06f00a4"
      },
      {
        "path": "apps/webapp/src/lib/reports/report-date-range.ts",
        "gitBlob": "7be5b52e66e4e7b2969e49c01d776baf5ea4ab8e",
        "canonicalLfSha256": "a35fa98350fb716ef89d9b726af28bf4e330cd29cff8e222dbe11eb7e999187e"
      },
      {
        "path": "apps/webapp/src/lib/reports/types.ts",
        "gitBlob": "535752e061571025d8121116627bb539f66eb2db",
        "canonicalLfSha256": "2d5c79753dab7987ff92ba70cbb09f557998bc25c80574d03cb188ad49e9f651"
      },
      {
        "path": "apps/webapp/src/lib/datetime/temporal-core.ts",
        "gitBlob": "965c40a9034a3643e185bcaf5d631d530186dd25",
        "canonicalLfSha256": "340864dae1f59706b4d3eb59227e0f83136b3f8bb22a8bb84f15b3ef38608226"
      },
      {
        "path": "apps/webapp/src/lib/timezone/validation.ts",
        "gitBlob": "cc66071cd8d223cb7feea53edb1288636f5847b3",
        "canonicalLfSha256": "630dd41244f4bcf5c2833d9cc7a2c1dec0811c2bc5ebbbbe1b02d26c28b54b7d"
      }
    ],
    "frameworkFiles": [
      {
        "path": "next/package.json",
        "bytes": 3188,
        "sha256": "440efba874450dc997b2c3bf9efa4c3c4835abbc40d65442e94a7c69f4bad031"
      },
      {
        "path": "next/dist/client/app-call-server.js",
        "bytes": 1538,
        "sha256": "f0e9fc00ebb81a3b264c9a4e34b4e6d984dae3055cbea15e2e10f7e3f55997fe"
      },
      {
        "path": "next/dist/client/sequential-call-server.js",
        "bytes": 1859,
        "sha256": "fb04a49cedc4706c7449c7087255b2027fc7893e79d70c709e14d67e516e95e2"
      },
      {
        "path": "next/dist/client/components/use-action-queue.js",
        "bytes": 5940,
        "sha256": "b0495a960d3312966950b78399676dedece7c646ba84fa2543142a3744e1e2ba"
      },
      {
        "path": "next/dist/client/components/app-router-instance.js",
        "bytes": 11229,
        "sha256": "679a2c335d4a849eb14c997d80ddd356fbd7789f50c0777ceabd0525d1e77807"
      },
      {
        "path": "next/dist/client/components/router-reducer/router-reducer.js",
        "bytes": 2630,
        "sha256": "22b9b831dbaeda84ae94020ad23ff298435a936132136925b6f0a5a3062b6d4d"
      },
      {
        "path": "next/dist/client/components/router-reducer/reducers/server-action-reducer.js",
        "bytes": 20696,
        "sha256": "45d9f7de636d847174881f3005082d5bce90399c745fba2dc3fd4ea402832950"
      },
      {
        "path": "next/dist/shared/lib/server-reference-info.js",
        "bytes": 2130,
        "sha256": "f2d96534f7dcf77c1f951112f3b4bde9728e36a1a6425928cf8b7f4b4a5cf9de"
      },
      {
        "path": "next/dist/server/app-render/action-handler.js",
        "bytes": 60411,
        "sha256": "f60960b2a15f7ec07e37e9d745ffd185763519d1693e41f39010782ccaf910cc"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.browser.js",
        "bytes": 254,
        "sha256": "4225884493381174db42ea47deef8b52ec41e358e63b49acd4929fe2f97f7a69"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.node.js",
        "bytes": 248,
        "sha256": "704a07592993924515710e08c9365e8d6b49d96df54166b869f0210d004b8685"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/server.node.js",
        "bytes": 849,
        "sha256": "218c48074fc0737329d0db31603fa0194d659f980b12c1920c88aa644e07d906"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
        "bytes": 66327,
        "sha256": "538d7566cd8471ce95b60c3204131e862c92e76f663d16e079b1b559a0b99fd7"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js",
        "bytes": 78295,
        "sha256": "163f82ee5a33e3616f6e3561ee932baaa8240a97e37470aa8ac6d18dd37b3255"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js",
        "bytes": 134763,
        "sha256": "5f7c1756783d12f6145dd368ae29a2d4831b4f0b3727786cb4fe3a00e7c121e1"
      }
    ]
  }
]);
export function knownTemporaryValueObservation(value) {
	try { return ownData(value, ["protocol", "replayHeader", "documentJournal"]) && Object.entries(temporaryValueObservation).every(([key, expected]) => value[key] === expected); }
	catch { return false; }
}
/** Null explicitly declares unsupported T authority. A configured Original is exact, not a descendant exception. */
export function knownOriginalTeamSourceConfiguration(value, compiledBuild, compiledManifestSha256) {
	try {
		if (value === null) return true;
		if (!ownData(value, ["protocol", "profileId", "phase", "compiledBuild", "compiledManifestSha256", "buildRecordPath", "buildRecordSha256"]) ||
			value.protocol !== "original-team-source-configuration-v1" || value.phase !== "baseline" ||
			typeof value.buildRecordPath !== "string" || value.buildRecordPath.length < 1 || value.buildRecordPath.length > 4096) return false;
		const profile = originalTeamTemporaryProfiles.find(row => row.id === value.profileId);
		return Boolean(profile && value.compiledBuild === profile.binarySource && value.compiledManifestSha256 === profile.manifestSha256 &&
			value.buildRecordSha256 === profile.buildRecordSha256 && (compiledBuild === undefined || compiledBuild === profile.binarySource) &&
			(compiledManifestSha256 === undefined || compiledManifestSha256 === profile.manifestSha256));
	} catch { return false; }
}
const qualifications = new WeakMap();
const factKeys = ["protocol", "profileId", "phase", "binarySource", "manifestSha256", "buildRecordSha256", "registrySha256", "actionHeaderSha256", "selectedActionMatches", "concurrentRouterQueue", "cachedNavigations", "appFiles", "frameworkFiles"];
const ownData = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
	Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"));
const sameRows = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((row, index) =>
	ownData(row, Object.keys(expected[index])) && Object.entries(expected[index]).every(([key, value]) => row[key] === value));

/** Closed factual receipt validation never mints a live source capability. */
export function knownOriginalTeamSourceFacts(facts) {
	try {
		if (!ownData(facts, factKeys)) return false;
		const profile = originalTeamTemporaryProfiles.find(value => value.id === facts.profileId);
		return Boolean(profile && facts.protocol === "original-team-temporary-source-facts-v1" && facts.phase === "baseline" &&
			["binarySource", "manifestSha256", "buildRecordSha256", "registrySha256", "actionHeaderSha256"].every(key => facts[key] === profile[key]) &&
			facts.selectedActionMatches === 1 && facts.concurrentRouterQueue === false && facts.cachedNavigations === true &&
			sameRows(facts.appFiles, profile.appFiles) && sameRows(facts.frameworkFiles, profile.frameworkFiles));
	} catch { return false; }
}
export const isOriginalTeamSourceQualification = value => value !== null && typeof value === "object" && qualifications.has(value);
export function originalTeamSourceFacts(qualification) {
	const facts = isOriginalTeamSourceQualification(qualification) ? qualifications.get(qualification) : null;
	return facts ? deepFreeze(structuredClone(facts)) : null;
}

/** RAM-only data projection, never a request, source, temporary-map or semantic permission. */
export function projectInertDateRangeRequest(descriptor) {
	const inert = readInertDateRangeRequestValue(descriptor);
	if (!inert) return null;
	const projected = {}, fields = [];
	for (const field of rangeFields) {
		const item = inert[field], date = item.kind === "react-date", text = date ? item.iso : item.text;
		projected[field] = date ? "$D" + text : text.startsWith("$") ? "$" + text : text;
		fields.push({ field, kind: item.kind, ...(date ? { canonical: true } : {}), utf16Units: text.length, utf8Bytes: Buffer.byteLength(text), sha256: sha(text), protocolEdges: false });
	}
	return deepFreeze({ value: projected, facts: { protocol: "closed-inert-date-range-type-facts-v1", rootKind: "own-object", fieldCount: 5, nodes: 6, depth: 2,
		fields, projectionSha256: sha(JSON.stringify(projected)) } });
}
export function knownClosedDateRangeTypeFacts(facts) {
	try {
		if (!ownData(facts, ["protocol", "rootKind", "fieldCount", "nodes", "depth", "fields", "projectionSha256"]) ||
			facts.protocol !== "closed-inert-date-range-type-facts-v1" || facts.rootKind !== "own-object" || facts.fieldCount !== 5 || facts.nodes !== 6 || facts.depth !== 2 ||
			!digest(facts.projectionSha256) || !Array.isArray(facts.fields) || facts.fields.length !== 5) return false;
		return facts.fields.every((row, index) => {
			const date = index < 2;
			return ownData(row, ["field", "kind", ...(date ? ["canonical"] : []), "utf16Units", "utf8Bytes", "sha256", "protocolEdges"]) &&
				row.field === rangeFields[index] && row.kind === (date ? "react-date" : "literal-string") && row.protocolEdges === false && digest(row.sha256) &&
				Number.isSafeInteger(row.utf16Units) && row.utf16Units >= 0 && Number.isSafeInteger(row.utf8Bytes) && row.utf8Bytes >= row.utf16Units && row.utf8Bytes <= 16384 &&
				(date ? row.canonical === true && [24, 27].includes(row.utf16Units) && row.utf8Bytes === row.utf16Units : row.utf8Bytes !== 0 || row.sha256 === sha(""));
		});
	} catch { return false; }
}

export const teamTemporaryValueStoreLimits = Object.freeze({ records: 10000, retainedBytes: 32 * 1024 * 1024, payloadReservation: 262144, metadataReservation: 2048 });
const valueStores = new WeakMap(), valueHandles = new WeakMap(), inspectionOwners = new WeakMap(), descriptorOwners = new WeakMap();

/** Bounded RAM ownership only. This store and its handles supply NO source or producer authority. */
export function createTeamTemporaryValueStore({ contextId, reserve, release }) {
	if (typeof contextId !== "string" || !/^[A-Za-z0-9:_.-]{1,256}$/.test(contextId) || typeof reserve !== "function" || typeof release !== "function")
		throw Error("Known bounded temporary-value storage ownership is required.");
	const limits = teamTemporaryValueStoreLimits, records = new Map(), owner = {};
	let closed = false, errors = 0, overflow = 0, unavailable = 0, payloadBytes = 0, metadataBytes = 0, pendingConsumers = 0, budgetKnown = true;
	const forgetUnowned = descriptor => { if (!descriptorOwners.has(descriptor)) forgetInertDateRangeRequestValue(descriptor); };
	const releaseRecord = record => {
		if (record.releaseAttempted || record.pending) { errors++; return false; }
		record.releaseAttempted = true;
		if (!forgetInertDateRangeRequestValue(record.descriptor)) errors++;
		descriptorOwners.delete(record.descriptor);
		record.descriptor = null; record.projection = null; record.valueForgotten = true;
		try { release(limits.payloadReservation); payloadBytes -= limits.payloadReservation; record.released = true; return true; }
		catch { errors++; budgetKnown = false; record.releaseUnknown = true; return false; }
	};
	const recordFor = handle => {
		const held = handle !== null && typeof handle === "object" ? valueHandles.get(handle) : null;
		return held?.owner === owner ? held.record : null;
	};
	const api = Object.freeze({
		retain({ id, descriptor }) {
			if (closed || !budgetKnown || typeof id !== "string" || !/^[a-f0-9]{32}\.[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id.slice(33))) ||
				records.has(id) || descriptor === null || typeof descriptor !== "object" || descriptorOwners.has(descriptor) || !readInertDateRangeRequestValue(descriptor)) {
				errors++; unavailable++; forgetUnowned(descriptor); return null;
			}
			const bytes = limits.payloadReservation + limits.metadataReservation;
			if (records.size >= limits.records || payloadBytes + metadataBytes + bytes > limits.retainedBytes) {
				overflow++; unavailable++; forgetUnowned(descriptor); return null;
			}
			let reserved;
			try { reserved = reserve(bytes); } catch { errors++; budgetKnown = false; unavailable++; forgetUnowned(descriptor); return null; }
			if (reserved !== true) {
				if (reserved === false) overflow++;
				else { errors++; budgetKnown = false; }
				unavailable++; forgetUnowned(descriptor); return null;
			}
			payloadBytes += limits.payloadReservation; metadataBytes += limits.metadataReservation;
			const projection = projectInertDateRangeRequest(descriptor), requestFacts = deepFreeze(structuredClone(descriptor));
			if (!projection || Buffer.byteLength(JSON.stringify({ id, contextId, requestFacts, typeFacts: projection?.facts })) > limits.metadataReservation) {
				errors++; unavailable++; forgetUnowned(descriptor);
				try { release(bytes); payloadBytes -= limits.payloadReservation; metadataBytes -= limits.metadataReservation; } catch { errors++; budgetKnown = false; }
				return null;
			}
			const record = { id, contextId, descriptor, projection, requestFacts, typeFacts: projection.facts, pending: 0, released: false, releaseAttempted: false, valueForgotten: false, releaseUnknown: false };
			const handle = Object.freeze({ protocol: "private-unqualified-team-request-value-v1", contextId, id });
			records.set(id, record); descriptorOwners.set(descriptor, owner); valueHandles.set(handle, { owner, record });
			return handle;
		},
		beginInspection(handle) {
			const record = recordFor(handle);
			if (closed || !record || record.releaseAttempted) { errors++; return null; }
			const token = Object.freeze({ protocol: "private-team-value-inspection-v1", contextId, id: record.id });
			inspectionOwners.set(token, { owner, record }); record.pending++; pendingConsumers++;
			return token;
		},
		finishInspection(token) {
			const held = token !== null && typeof token === "object" ? inspectionOwners.get(token) : null;
			if (held?.owner !== owner || held.record.pending < 1) { errors++; return false; }
			inspectionOwners.delete(token); held.record.pending--; pendingConsumers--;
			if (closed && held.record.pending === 0 && !held.record.releaseAttempted) releaseRecord(held.record);
			return true;
		},
		release(handle) { const record = recordFor(handle); if (!record) { errors++; return false; } return releaseRecord(record); },
		close() {
			if (closed) return;
			closed = true;
			for (const record of records.values()) {
				if (record.releaseAttempted) continue;
				if (record.pending) errors++;
				else releaseRecord(record);
			}
		},
		snapshot() { return {
			protocol: "bounded-unqualified-team-values-v1", contextId, sourceBound: false, acceptanceClaim: "none", closed, budgetKnown,
			errors, overflow, unavailable, pendingConsumers, payloadRetainedBytes: budgetKnown ? payloadBytes : null, metadataRetainedBytes: budgetKnown ? metadataBytes : null,
			rows: [...records.values()].map(({ id, requestFacts, typeFacts, pending, released, valueForgotten, releaseUnknown }) => ({ id, requestFacts, typeFacts, pendingConsumers: pending, released, valueForgotten, releaseUnknown })),
		}; },
	});
	valueStores.set(api, { owner, contextId, recordFor });
	return api;
}

const dispatchJournals = new WeakMap(), dispatchHandles = new WeakMap();
const bodyInspections = new WeakMap();
/** Observer-only capability. It never grants source/request authority or resolves a T value. */
export function openOriginalTeamBodyInspection(input) {
	try {
		if (!ownData(input, ["bodySha256", "decodedBytes"]) || !digest(input.bodySha256) ||
			!Number.isSafeInteger(input.decodedBytes) || input.decodedBytes <= 0 || input.decodedBytes > 8 * 1024 * 1024) return null;
		const inspection = Object.freeze({ protocol: "private-original-team-body-inspection-v1" });
		bodyInspections.set(inspection, { bodySha256: input.bodySha256, decodedBytes: input.decodedBytes, closed: false,
			lookupAttempted: false, valueUsed: false, bindingSha256: null, qualification: null, resolved: null, store: null, consumer: null });
		return inspection;
	} catch { return null; }
}
/** Missing source/request issuance, copied capabilities, and every token except exact T0:0 fail closed. */
export function resolveOriginalTeamTemporaryReference(inspection, token, boundary) {
	try {
		const held = inspection !== null && typeof inspection === "object" ? bodyInspections.get(inspection) : null;
		if (!held || held.closed || boundary?.action !== true || boundary.requestKind !== "action" ||
			boundary.bodySha256 !== held.bodySha256 || boundary.decodedBytes !== held.decodedBytes) return null;
		held.lookupAttempted = true;
		if (!isOriginalTeamSourceQualification(held.qualification) || token !== "$T0:0" || held.resolved === null) return null;
		held.valueUsed = true; held.bindingSha256 = sha(JSON.stringify(held.resolved.receipt));
		return held.resolved;
	} catch { return null; }
}
export function closeOriginalTeamBodyInspection(inspection) {
	const held = inspection !== null && typeof inspection === "object" ? bodyInspections.get(inspection) : null;
	if (!held || held.closed) return false;
	held.closed = true;
	return held.store === null ? true : held.store.finishInspection(held.consumer);
}
/** Available only after this actual capability closes; contains no private value or token. */
export function originalTeamBodyObservation(inspection) {
	const held = inspection !== null && typeof inspection === "object" ? bodyInspections.get(inspection) : null;
	return held?.closed ? Object.freeze({ protocol: "original-team-body-value-observation-v1", bodySha256: held.bodySha256,
		decodedBytes: held.decodedBytes, lookupAttempted: held.lookupAttempted, valueUsed: held.valueUsed,
		bindingSha256: held.bindingSha256, closed: true }) : null;
}
/** Closed replay starts with strict zero-use sections. Positive issuance remains unsupported in this checkpoint. */
export function validateOriginalTeamTemporaryValues(section, boundary) {
	try {
		if (!ownData(section, ["protocol", "referenceCount", "binding", "obligations"]) || section.protocol !== "original-team-temporary-values-v1" ||
			!digest(boundary?.bodySha256) || !Number.isSafeInteger(boundary.decodedBytes) || boundary.decodedBytes <= 0 || boundary.decodedBytes > 8 * 1024 * 1024 ||
			section.referenceCount !== 0 || section.binding !== null || !Array.isArray(section.obligations) || section.obligations.length !== 0) return false;
		if (boundary.request !== undefined) {
			const observed = boundary.request?.temporaryValueObservation;
			if (!ownData(observed, ["protocol", "bodySha256", "decodedBytes", "lookupAttempted", "valueUsed", "bindingSha256", "closed"]) ||
				observed.protocol !== "original-team-body-value-observation-v1" || observed.bodySha256 !== boundary.bodySha256 || observed.decodedBytes !== boundary.decodedBytes ||
				typeof observed.lookupAttempted !== "boolean" || observed.valueUsed !== false || observed.bindingSha256 !== null || observed.closed !== true) return false;
		}
		return true;
	} catch { return false; }
}
/** Actual dispatch/HTTP/CDP identity observations only; never source or value authority by themselves. */
export function createTeamReplayDispatchJournal({ contextId, origin, reserve, release }) {
	let target;
	try { target = new URL(origin); } catch {}
	if (!target || target.origin !== origin || target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.username || target.password ||
		typeof contextId !== "string" || !/^[A-Za-z0-9:_.-]{1,256}$/.test(contextId) || typeof reserve !== "function" || typeof release !== "function")
		throw Error("Known owned team replay observation is required.");
	const owner = {}, rows = [], nonces = new Map(), proxies = new Map();
	let closed = false, errors = 0, overflow = 0, unretainedArms = 0, retained = 0, budgetKnown = true;
	const rowFor = handle => { const held = handle !== null && typeof handle === "object" ? dispatchHandles.get(handle) : null; return held?.owner === owner ? held.row : null; };
	const safeRow = row => ({ ordinal: row.ordinal, traceId: row.traceId, nonceSha256: row.nonceSha256, urlSha256: row.urlSha256, actionHeaderSha256: row.actionHeaderSha256,
		encodedBytes: row.encodedBytes, bodySha256: row.bodySha256, proxyId: row.proxyId, requestEOF: row.requestEOF, browser: row.browser, returned: row.returned, returnedError: row.returnedError });
	const api = Object.freeze({
		arm(input = {}) {
			try {
				const { traceId, action, body, url } = input, requestURL = typeof url === "string" && url.length <= 4096 ? new URL(url) : null;
				if (closed || !budgetKnown || !/^[a-f0-9]{32}$/.test(traceId ?? "") || typeof action !== "string" || !/^[a-f0-9]{40,64}$/.test(action) ||
					typeof body !== "string" || body.length > 16384 || Buffer.byteLength(body) > 16384 || requestURL?.origin !== origin || requestURL.username || requestURL.password) throw Error();
				if (rows.length >= 10000 || retained + 18432 > 32 * 1024 * 1024) { overflow++; unretainedArms++; return null; }
				let answer;
				try { answer = reserve(18432); } catch { errors++; budgetKnown = false; unretainedArms++; return null; }
				if (answer !== true) { if (answer === false) overflow++; else { errors++; budgetKnown = false; } unretainedArms++; return null; }
				retained += 18432;
				const nonce = randomBytes(16).toString("hex");
				const row = { ordinal: rows.length + 1, traceId, nonceSha256: sha(nonce), urlSha256: sha(requestURL.href), actionHeaderSha256: sha(action), encodedBytes: Buffer.byteLength(body), bodySha256: sha(body),
					proxyId: null, requestEOF: null, browser: null, returned: false, returnedError: null };
				try { release(16384); retained -= 16384; } catch { errors++; budgetKnown = false; unretainedArms++; return null; }
				if (nonces.has(nonce)) { errors++; unretainedArms++; return null; }
				const handle = Object.freeze({ protocol: "private-team-manual-dispatch-v1", contextId, ordinal: row.ordinal });
				rows.push(row); nonces.set(nonce, row); dispatchHandles.set(handle, { owner, row, nonce });
				return handle;
			} catch { errors++; unretainedArms++; return null; }
		},
		headers(handle) {
			const held = handle !== null && typeof handle === "object" ? dispatchHandles.get(handle) : null;
			if (closed || held?.owner !== owner || held.row.returned) { errors++; return null; }
			return Object.freeze({ [teamReplayHeader]: held.nonce });
		},
		proxyRequest({ id, traceId, method, url, action, nonce }) {
			const row = typeof nonce === "string" && /^[a-f0-9]{32}$/.test(nonce) ? nonces.get(nonce) : null;
			if (closed || !budgetKnown || !row || row.proxyId !== null || proxies.has(id) || typeof id !== "string" || !/^[a-f0-9]{32}\.[1-9][0-9]{0,15}$/.test(id) ||
				traceId !== row.traceId || method !== "POST" || typeof url !== "string" || url.length > 4096 || sha(url) !== row.urlSha256 || typeof action !== "string" || sha(action) !== row.actionHeaderSha256) { errors++; return false; }
			row.proxyId = id; proxies.set(id, row); return true;
		},
		requestEOF(id, facts) {
			const row = proxies.get(id);
			if (closed || !row || row.requestEOF !== null || facts?.encodedBytes !== row.encodedBytes || facts?.bodySha256 !== row.bodySha256) { errors++; return false; }
			row.requestEOF = Object.freeze({ encodedBytes: facts.encodedBytes, bodySha256: facts.bodySha256, actualEOF: true }); return true;
		},
		browserRequest(facts) {
			const row = proxies.get(facts?.proxyId);
			if (closed || !row || facts.contextId !== contextId || typeof facts.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(facts.requestId) || facts.method !== "POST" || facts.traceId !== row.traceId ||
				facts.urlSha256 !== row.urlSha256 || facts.actionHeaderSha256 !== row.actionHeaderSha256 || facts.initialHeadersKnown !== true || facts.extraHeadersKnown !== true ||
				facts.initialReplaySha256 !== row.nonceSha256 || facts.extraReplaySha256 !== row.nonceSha256 ||
				![facts.frameId, facts.loaderId, facts.documentGeneration].every(value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value))) { errors++; return false; }
			const browser = Object.freeze({ requestId: facts.requestId, frameId: facts.frameId, loaderId: facts.loaderId, documentGeneration: facts.documentGeneration,
				initialReplaySha256: facts.initialReplaySha256, extraReplaySha256: facts.extraReplaySha256 });
			if (row.browser !== null && JSON.stringify(row.browser) !== JSON.stringify(browser)) { errors++; return false; }
			row.browser = browser; return true;
		},
		finished(handle, { error }) {
			const row = rowFor(handle);
			if (!row || row.returned || typeof error !== "boolean") { errors++; return false; }
			row.returned = true; row.returnedError = error; return true;
		},
		factsFor(id) {
			const row = proxies.get(id);
			return row?.requestEOF && row.browser ? deepFreeze({ protocol: "observed-team-manual-dispatch-v1", contextId, sourceBound: false, ...safeRow(row) }) : null;
		},
		close() { if (closed) return; closed = true; if (rows.some(row => !row.returned)) errors++; },
		snapshot() { return { protocol: "team-replay-dispatch-observations-v1", contextId, sourceBound: false, acceptanceClaim: "none", closed, errors, overflow, unretainedArms, budgetKnown,
			retainedBytes: budgetKnown ? retained : null, pendingDispatches: rows.filter(row => !row.returned).length, rows: rows.map(row => deepFreeze(structuredClone(safeRow(row)))) }; },
	});
	dispatchJournals.set(api, { owner, contextId, proxies });
	return api;
}

async function readSource(path) {
	const handle = await open(path, "r");
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile() || before.size > 4194304n) throw Error();
		const bytes = Buffer.alloc(Number(before.size));
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
			if (!bytesRead) throw Error();
			offset += bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		if (["dev", "ino", "size", "mtimeNs"].some(key => before[key] !== after[key])) throw Error();
		return bytes;
	} finally { await handle.close(); }
}
const json = bytes => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { throw Error(); } };
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export function originalTeamSourceFileFacts(bytes) {
	try {
		if (!Buffer.isBuffer(bytes) || bytes.length > 4194304 || bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return null;
		const canonical = Buffer.from(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, "\n"));
		return Object.freeze({ gitBlob: gitBlob(canonical), canonicalLfSha256: sha(canonical) });
	} catch { return null; }
}

/** Actual bounded file reads are the only live source issuer; public receipt copies cannot qualify. */
export async function readOriginalTeamSourceQualification(input) {
	try {
		if (!ownData(input, ["profileId", "phase", "compiledManifestPath", "buildRecordPath"])) throw Error();
		const { profileId, phase, compiledManifestPath, buildRecordPath } = input;
		const profile = originalTeamTemporaryProfiles.find(value => value.id === profileId);
		if (!profile || phase !== "baseline" || typeof compiledManifestPath !== "string" || typeof buildRecordPath !== "string" ||
			compiledManifestPath.length > 4096 || buildRecordPath.length > 4096 || basename(compiledManifestPath) !== "required-server-files.json") throw Error();
		const appRoot = dirname(dirname(resolve(compiledManifestPath))), sourceRoot = resolve(appRoot, "../..");
		if (basename(appRoot) !== "webapp" || basename(dirname(appRoot)) !== "apps") throw Error();
		const manifestBytes = await readSource(compiledManifestPath), recordBytes = await readSource(buildRecordPath);
		if (sha(manifestBytes) !== profile.manifestSha256 || sha(recordBytes) !== profile.buildRecordSha256) throw Error();
		const manifest = json(manifestBytes), record = json(recordBytes);
		if (manifest.config?.deploymentId !== profile.binarySource || manifest.config?.experimental?.concurrentRouterQueue !== false ||
			manifest.config?.experimental?.cachedNavigations !== true || record.source !== profile.binarySource || record.ci !== true || record.exitCode !== 0 || record.workers !== 2) throw Error();
		const registryBytes = await readSource(join(dirname(compiledManifestPath), "server/server-reference-manifest.json"));
		if (sha(registryBytes) !== profile.registrySha256) throw Error();
		const registry = json(registryBytes), actions = Object.entries(registry.node ?? {}).filter(([, value]) => value.exportedName === "getTeamPerformanceData");
		if (actions.length !== 1 || sha(actions[0][0]) !== profile.actionHeaderSha256 || actions[0][1].filename !== "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts" ||
			JSON.stringify(Object.keys(actions[0][1].workers).sort()) !== JSON.stringify(["app/[locale]/(app)/analytics/page", "app/[locale]/(app)/analytics/team-performance/page"])) throw Error();
		const appFiles = [];
		for (const pin of profile.appFiles) {
			const file = originalTeamSourceFileFacts(await readSource(join(sourceRoot, pin.path)));
			if (!file) throw Error();
			appFiles.push({ path: pin.path, ...file });
		}
		const require = createRequire(join(appRoot, "package.json")), frameworkFiles = [];
		for (const pin of profile.frameworkFiles) {
			const bytes = await readSource(require.resolve(pin.path));
			frameworkFiles.push({ path: pin.path, bytes: bytes.length, sha256: sha(bytes) });
		}
		const facts = deepFreeze({ protocol: "original-team-temporary-source-facts-v1", profileId, phase,
			binarySource: profile.binarySource, manifestSha256: sha(manifestBytes), buildRecordSha256: sha(recordBytes), registrySha256: sha(registryBytes), actionHeaderSha256: sha(actions[0][0]),
			selectedActionMatches: actions.length, concurrentRouterQueue: manifest.config.experimental.concurrentRouterQueue, cachedNavigations: manifest.config.experimental.cachedNavigations, appFiles, frameworkFiles });
		if (!knownOriginalTeamSourceFacts(facts)) throw Error();
		const qualification = Object.freeze({ protocol: "private-original-team-source-v1", profileId, sourceFactsSha256: sha(JSON.stringify(facts)) });
		qualifications.set(qualification, facts);
		return qualification;
	} catch { throw Error("Original team temporary source qualification unavailable."); }
}
