import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
	createOriginalTeamUIProducerCut, originalTeamSourceFacts, originalTeamUIProducerCutFacts,
	readOriginalTeamOperatorQualification, readOriginalTeamSourceQualification, temporaryValueObservation,
} from "./team-temporary-value-authority.mjs";

// This file-qualified seam needs the existing immutable Original build, never a fabricated capability.
const sourceRoot = process.env.Z8_ORIGINAL_TEAM_SOURCE_ROOT;
const buildRecordPath = process.env.Z8_ORIGINAL_TEAM_BUILD_RECORD;
const skip = !sourceRoot || !buildRecordPath ? "Set both Original file-qualification fixture paths." : false;
const sha = value => createHash("sha256").update(value).digest("hex");
const historical = [
	["sw.js", 26047, "4eb0acd7bfb93d668e073baf69304af8f91f54f9dc82664ded7530866ae8bc7a"],
	["lib/offline-queue-db.js", 18409, "a285a69270bb8c65b96b102277a24c49da8ede440ab009b7ecff5495de7bfbc1"],
	["lib/sync-service.js", 1385, "f8bfd4a69ebaf3f43e33ffeb4858523d0afd3f3988c52fc82cda6cae7f810a05"],
	["lib/clock-command-dispatch.js", 13604, "663be8d36271e9c6c0c1efd5e4188994e1e49e40bcd70f7f432526ede7014c07"],
];
const approved = historical.map(row => [...row]);
approved[0] = ["sw.js", 26569, "721215e68848d0494616c684fa7f2f43873893412a558f84864ba35d6c1dadcd"];

async function producerFixture(vector) {
	const qualification = await readOriginalTeamSourceQualification({
		profileId: "original-team-web-clock-status-2ef-v1", phase: "baseline",
		compiledManifestPath: join(sourceRoot, "apps/webapp/.next/required-server-files.json"), buildRecordPath,
	});
	const source = originalTeamSourceFacts(qualification);
	const protocolSources = {};
	for (const file of ["run-baseline.mjs", "browser-control-collector.mjs", "team-temporary-value-authority.mjs", "inert-date-range-request.mjs", "journey-steps.mjs", "trace-transport.mjs"])
		protocolSources[file] = sha(await readFile(new URL(file, import.meta.url)));
	const origin = "http://localhost:58792", originSha256 = sha(origin), contextId = "source-pin-context";
	const operatorQualification = await readOriginalTeamOperatorQualification({ qualification,
		operatorFile: "run-baseline.mjs", protocolSources,
		plan: { origin, conditions: [{ locale: "en" }], routes: [{ path: "/{locale}/analytics/team-performance", awayPath: "/{locale}" }] },
	});
	const documentJournal = { protocol: "actual-cdp-document-journal-v1", contextId, installed: true, closed: false,
		errors: 0, overflow: 0, currentGeneration: 1, documentEventOrdinal: 1, executionEventOrdinal: 1,
		documents: [{ ordinal: 1, requestId: "doc-request", frameId: "frame", loaderId: "loader", originSha256, documentGeneration: `${contextId}:1` }],
		executionEvents: [{ ordinal: 1, event: "created", executionContextId: 1, uniqueId: "execution", frameId: "frame", isDefault: true }],
	};
	const principalRead = { known: true, cookieCount: 1, sha256: sha("principal"), cookieAttributes: {
		originKnown: true, httpOnlyKnown: true, allHttpOnly: true, singleOwnedRootHttpOnlyCookie: true, singleCookieHeaderSha256: sha("cookie"),
	} };
	const principalReadOperation = { acknowledgmentOrdinal: 1, kind: "read-only-context-cookies-v1", startedOrdinal: 1, finishedOrdinal: 1, snapshotSha256: principalRead.sha256, error: false };
	const principal = { protocol: "actual-browser-cookie-boundaries-v1", contextId, scopeClosed: false, before: principalRead,
		observedSetCookieResponses: 0, unknownResponseHeaders: 0, readErrors: 0, pendingReads: 0, observationErrors: 0, overflow: 0,
		progressReads: { protocol: "owned-read-only-principal-operations-v1", started: 1, finished: 1, records: [principalReadOperation], pending: [] },
	};
	const workers = { protocol: "owned-context-worker-target-metadata-v1", contextId, contextJoinKnown: true, contextIdentitySha256: sha(contextId), installed: true,
		scopeClosed: false, errors: 0, overflow: 0, enumerationBasis: "existing-puppeteer-target-manager", controllerObservation: "not-collected",
		events: [{ targetOrdinal: 1, event: "initial", type: "page", urlKnown: true, urlSha256: sha(`${origin}/en`), originMatches: true, ownedWorkerScript: null }],
	};
	const files = vector.map(([file, bytes, sha256]) => ({ file, bytes, sha256 }));
	const binding = { temporaryValueObservation, manifestVerified: true, browserVerified: true, compiledBuild: source.binarySource, compiledManifestSha256: source.manifestSha256,
		originalTeamSource: { protocol: "original-team-source-configuration-v1", profileId: source.profileId, phase: "baseline", compiledBuild: source.binarySource,
			compiledManifestSha256: source.manifestSha256, buildRecordPath, buildRecordSha256: source.buildRecordSha256 },
		nativePublicSources: { protocol: "qualified-serving-worker-sources-v1", files },
	};
	const acknowledgment = { protocol: "native-environment-progress-readonly-v1", sourceSubsetExceeded: false, timedOut: false, pendingOperations: 0, readErrors: 0,
		checkpointOrdinal: 1, startedAtMs: 1, finishedAtMs: 2, deadlineMs: 10001, deadlineBudgetMs: 10000, elapsedMs: 1, principalRead, principalReadOperation,
		document: { protocol: "actual-cdp-document-acknowledgment-v1", actualDocumentIdentityStable: true, contextId, frameId: "frame", loaderId: "loader",
			executionContextId: 1, executionContextUniqueId: "execution", documentRequestId: "doc-request", documentGeneration: 1, originSha256, sourceJournal: documentJournal,
			executionEventOrdinalBefore: 1, executionEventOrdinalAfter: 1, documentEventOrdinalBefore: 1, documentEventOrdinalAfter: 1 },
		controller: { available: true, secureContext: true, originMatches: true, controllerIdentityStable: true, registrationOverflow: 0,
			controllerBefore: { present: false, known: true }, controllerAfter: { present: false, known: true }, registrationCount: 0, registrations: [] },
		publicSourceRecheck: { protocol: "serving-public-worker-source-metadata-v1", servingRootKnown: true, files: files.map(row => ({ ...row, known: true, reason: null })) },
	};
	return { qualification, operatorQualification, acknowledgment, principal, workers, binding, documentJournal };
}

test("public producer cut accepts the historical whole public revision", { skip }, async () => {
	assert.notEqual(originalTeamUIProducerCutFacts(createOriginalTeamUIProducerCut(await producerFixture(historical))), null);
});

test("public producer cut accepts the exact approved empty-queue SW revision", { skip }, async () => {
	const input = await producerFixture(approved);
	const cut = originalTeamUIProducerCutFacts(createOriginalTeamUIProducerCut(input));
	assert.notEqual(cut, null);
	assert.equal(cut.publicSourceSha256, sha(JSON.stringify(input.acknowledgment.publicSourceRecheck)));
});

test("public producer cut rejects altered SW, other public files and mixed recheck metadata", { skip }, async () => {
	for (const index of [0, 1, 2, 3]) {
		const altered = approved.map(row => [...row]); altered[index][2] = sha(`altered-${index}`);
		assert.equal(createOriginalTeamUIProducerCut(await producerFixture(altered)), null);
	}
	const mixed = await producerFixture(approved);
	mixed.acknowledgment.publicSourceRecheck.files[0] = { ...mixed.acknowledgment.publicSourceRecheck.files[0], bytes: historical[0][1], sha256: historical[0][2] };
	assert.equal(createOriginalTeamUIProducerCut(mixed), null);
	const wrongSize = await producerFixture(approved); wrongSize.binding.nativePublicSources.files[0].bytes++;
	assert.equal(createOriginalTeamUIProducerCut(wrongSize), null);
});
