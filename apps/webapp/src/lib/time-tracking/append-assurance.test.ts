import { describe, expect, it } from "vitest";
import {
	type AppendPositionEvidence,
	assessAppendAssurance,
	summarizeAppendAssurance,
} from "./append-assurance";
import type { AppendEvidenceEntry } from "./append-lineage";
import { calculateHash } from "./blockchain";

const scope = {
	organizationId: "org-1",
	employeeId: "a0000000-0000-4000-8000-000000000001",
};
const admittedAt = new Date("2026-09-01T00:00:00.000Z");

let sequence = 0;
function nextId() {
	sequence += 1;
	return `e0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function entry(
	previous: Pick<AppendEvidenceEntry, "id" | "hash"> | null,
	options: {
		type?: string;
		timestamp?: string;
		link?: "explicit" | "hash-only";
		organizationId?: string;
	} = {},
): AppendEvidenceEntry {
	const timestamp = new Date(options.timestamp ?? "2026-07-01T08:00:00.000Z");
	const type = options.type ?? "clock_in";
	const previousHash = previous?.hash ?? null;
	return {
		id: nextId(),
		organizationId: options.organizationId ?? scope.organizationId,
		employeeId: scope.employeeId,
		type,
		timestamp,
		previousHash,
		previousEntryId: previous && options.link !== "hash-only" ? previous.id : null,
		hash: calculateHash({
			employeeId: scope.employeeId,
			type,
			timestamp: timestamp.toISOString(),
			previousHash,
		}),
	};
}

function lineage(
	length: number,
	link: "explicit" | "hash-only" = "explicit",
	after: AppendEvidenceEntry | null = null,
) {
	const entries: AppendEvidenceEntry[] = [];
	for (let index = 0; index < length; index += 1) {
		entries.push(
			entry(entries.at(-1) ?? after, {
				type: index % 2 === 0 ? "clock_in" : "clock_out",
				timestamp: new Date(Date.UTC(2026, 6, 1, 8 + index, sequence)).toISOString(),
				link,
			}),
		);
	}
	return entries;
}

/** A position admitted at `anchor` (null for empty history) that has since advanced to `tip`. */
function position(
	anchor: AppendEvidenceEntry | null,
	admittedEntryCount: number,
	tip: AppendEvidenceEntry,
	entryCount: number,
): AppendPositionEvidence {
	return {
		tipEntryId: tip.id,
		tipHash: tip.hash,
		entryCount,
		admission: anchor ? "verified_lineage" : "empty_history",
		admittedTipEntryId: anchor?.id ?? null,
		admittedTipHash: anchor?.hash ?? null,
		admittedEntryCount,
		admittedAt,
	};
}

function codes(report: ReturnType<typeof assessAppendAssurance>) {
	return report.assurance.limitations.map((limitation) => limitation.code).toSorted();
}

const standingLimitations = [
	"hash_commits_event_fields_only",
	"original_actor_and_capture_unproven",
	"payroll_readiness_not_assessed",
];

describe("assessAppendAssurance", () => {
	it("reports genuinely empty history without claiming anything about entries", () => {
		const report = assessAppendAssurance({ scope, entries: [], position: null, hasWork: false });

		expect(report.lineage).toEqual({ status: "empty" });
		expect(report.continuity).toEqual({ status: "not_adopted" });
		expect(report.assurance).toEqual({ scope: "whole_history", limitations: [] });
	});

	it("does not treat absent entries as empty history when scoped work exists", () => {
		const report = assessAppendAssurance({ scope, entries: [], position: null, hasWork: true });

		expect(report.lineage).toEqual({
			status: "review_required",
			issues: [{ kind: "history_without_entries" }],
		});
		expect(report.assurance.scope).toBe("none");
		expect(codes(report)).toContain("lineage_unresolved");
	});

	it("labels stored and derived links separately and preserves the original fields", () => {
		const [first] = lineage(1);
		const [hashOnly] = lineage(1, "hash-only", first);
		const [explicit] = lineage(1, "explicit", hashOnly);
		const report = assessAppendAssurance({
			scope,
			entries: [explicit, hashOnly, first],
			position: null,
			hasWork: true,
		});

		const byId = new Map(report.entries.map((item) => [item.entryId, item]));
		expect(byId.get(first.id)?.link).toEqual({ kind: "root" });
		expect(byId.get(hashOnly.id)).toEqual({
			entryId: hashOnly.id,
			stored: { hash: hashOnly.hash, previousHash: first.hash, previousEntryId: null },
			hash: "reproduced",
			link: { kind: "derived", predecessorId: first.id },
		});
		expect(byId.get(explicit.id)?.link).toEqual({ kind: "stored", predecessorId: hashOnly.id });
		expect(report.links).toEqual({ stored: 1, derived: 1, roots: 1, unresolved: 0 });
		expect(report.lineage).toEqual({
			status: "single",
			rootId: first.id,
			tip: { id: explicit.id, hash: explicit.hash },
		});
		expect(report.assurance.scope).toBe("whole_history");
		expect(report.assurance.limitations).toContainEqual({
			code: "derived_links",
			entryIds: [hashOnly.id],
		});
		expect(codes(report)).toEqual(
			["derived_links", ...standingLimitations, "no_continuity_position"].toSorted(),
		);
	});

	it("never labels a hash that does not reproduce as verified, whatever its format", () => {
		const [root, next] = lineage(2);
		const providerFormat = { ...next, hash: "clockodo-provider-bytes" };
		const report = assessAppendAssurance({
			scope,
			entries: [root, providerFormat],
			position: null,
			hasWork: true,
		});

		expect(report.hashes).toEqual({
			reproduced: 1,
			notReproduced: [next.id],
			inputUnavailable: [],
			duplicates: [],
		});
		expect(report.lineage.status).toBe("review_required");
		expect(report.assurance.scope).toBe("none");
		expect(report.assurance.limitations).toContainEqual({
			code: "hash_not_reproduced",
			entryIds: [next.id],
		});
	});

	it("reports an unserializable timestamp as missing hash input, not a mismatch", () => {
		const [root] = lineage(1);
		const broken = { ...root, timestamp: new Date(Number.NaN) };
		const report = assessAppendAssurance({
			scope,
			entries: [broken],
			position: null,
			hasWork: true,
		});

		expect(report.entries[0]?.hash).toBe("input_unavailable");
		expect(report.hashes.inputUnavailable).toEqual([root.id]);
		expect(report.assurance.limitations).toContainEqual({
			code: "hash_input_unavailable",
			entryIds: [root.id],
		});
	});

	it("discloses duplicate hashes without treating them as corruption", () => {
		const first = entry(null, { timestamp: "2026-07-01T08:00:00.000Z" });
		const twin = { ...entry(null, { timestamp: "2026-07-01T08:00:00.000Z" }) };
		const [afterFirst] = lineage(1, "explicit", first);
		const [afterTwin] = lineage(1, "explicit", twin);
		const report = assessAppendAssurance({
			scope,
			entries: [first, twin, afterFirst, afterTwin],
			position: null,
			hasWork: true,
		});

		expect(first.hash).toBe(twin.hash);
		expect(report.hashes.duplicates).toEqual([[first.id, twin.id].toSorted()]);
		expect(report.hashes.notReproduced).toEqual([]);
		expect(report.links.stored).toBe(2);
		// The structure (two roots), not the duplicate, is the lineage issue.
		expect(report.lineage).toMatchObject({
			status: "review_required",
			issues: [{ kind: "multiple_roots" }],
		});
	});

	it("keeps cross-scope and missing predecessors unresolved instead of following them", () => {
		const [root] = lineage(1);
		const foreignPredecessor = entry(null, { organizationId: "org-2" });
		const crossScope = { ...entry(foreignPredecessor), previousEntryId: foreignPredecessor.id };
		const [orphan] = lineage(1, "hash-only", entry(null, { timestamp: "2026-01-01T00:00:00Z" }));
		const report = assessAppendAssurance({
			scope,
			entries: [root, crossScope, orphan],
			position: null,
			hasWork: true,
		});

		const byId = new Map(report.entries.map((item) => [item.entryId, item]));
		expect(byId.get(crossScope.id)?.link).toEqual({ kind: "unresolved" });
		expect(byId.get(crossScope.id)?.stored.previousEntryId).toBe(foreignPredecessor.id);
		expect(byId.get(orphan.id)?.link).toEqual({ kind: "unresolved" });
		expect(report.lineage).toMatchObject({ status: "review_required" });
		if (report.lineage.status !== "review_required") throw new Error("expected review");
		expect(report.lineage.issues.map((issue) => issue.kind).toSorted()).toEqual([
			"missing_predecessor",
			"predecessor_outside_scope",
		]);
		expect(report.links.unresolved).toBe(2);
	});

	it("does not depend on input order", () => {
		const entries = lineage(5, "hash-only");
		const forward = assessAppendAssurance({ scope, entries, position: null, hasWork: true });
		const reversed = assessAppendAssurance({
			scope,
			entries: entries.toReversed(),
			position: null,
			hasWork: true,
		});

		expect(reversed).toEqual(forward);
	});

	describe("continuity from the append position", () => {
		it("establishes continuity from genesis for an empty-history admission", () => {
			const entries = lineage(3);
			const report = assessAppendAssurance({
				scope,
				entries,
				position: position(null, 0, entries[2], 3),
				hasWork: true,
			});

			expect(report.continuity).toEqual({
				status: "established",
				provenance: {
					admission: "empty_history",
					anchor: null,
					admittedEntryCount: 0,
					admittedAt,
					tip: { id: entries[2].id, hash: entries[2].hash },
					entryCount: 3,
				},
				postAnchorEntryIds: entries.map((item) => item.id),
			});
			expect(report.assurance.scope).toBe("whole_history");
			expect(codes(report)).toEqual(standingLimitations);
		});

		it("names the admission anchor and only the entries appended after it", () => {
			const history = lineage(3, "hash-only");
			const appended = lineage(2, "explicit", history[2]);
			const report = assessAppendAssurance({
				scope,
				entries: [...history, ...appended],
				position: position(history[2], 3, appended[1], 5),
				hasWork: true,
			});

			expect(report.continuity).toMatchObject({
				status: "established",
				provenance: {
					admission: "verified_lineage",
					anchor: { id: history[2].id, hash: history[2].hash },
					admittedEntryCount: 3,
				},
				postAnchorEntryIds: appended.map((item) => item.id).toSorted(),
			});
			// Stored evidence still verifies the whole lineage, so the claim is not narrowed.
			expect(report.assurance.scope).toBe("whole_history");
		});

		it("claims only post-anchor continuity when earlier history no longer verifies", () => {
			const history = lineage(3);
			const appended = lineage(2, "explicit", history[2]);
			const tampered = { ...history[0], type: "clock_out" };
			const report = assessAppendAssurance({
				scope,
				entries: [tampered, history[1], history[2], ...appended],
				position: position(history[2], 3, appended[1], 5),
				hasWork: true,
			});

			expect(report.continuity.status).toBe("established");
			expect(report.lineage.status).toBe("review_required");
			expect(report.assurance.scope).toBe("post_anchor");
			expect(report.assurance.limitations).toContainEqual({
				code: "history_before_anchor_unverified",
				anchorEntryId: history[2].id,
			});
			expect(codes(report)).not.toContain("lineage_unresolved");
		});

		it("interrupts continuity for an entry written after the recorded tip", () => {
			const entries = lineage(2);
			const [bypass] = lineage(1, "hash-only", entries[1]);
			const report = assessAppendAssurance({
				scope,
				entries: [...entries, bypass],
				position: position(null, 0, entries[1], 2),
				hasWork: true,
			});

			expect(report.continuity).toMatchObject({
				status: "interrupted",
				reasons: [
					{ kind: "unexpected_history_change", expectedEntryCount: 2, actualEntryCount: 3 },
					{ kind: "unexpected_successor", predecessorId: entries[1].id, entryIds: [bypass.id] },
				],
			});
			// The stored evidence is still one lineage, but no forward guarantee covers it.
			expect(report.lineage.status).toBe("single");
			expect(report.assurance.scope).toBe("none");
			expect(codes(report)).toContain("continuity_interrupted");
		});

		it("interrupts continuity for a fork from inside the post-anchor segment", () => {
			const history = lineage(2);
			const appended = lineage(2, "explicit", history[1]);
			const [fork] = lineage(1, "explicit", appended[0]);
			const removedHistory = history.slice(1);
			const report = assessAppendAssurance({
				scope,
				// A removal offsets the fork, so the count still matches the position.
				entries: [...removedHistory, ...appended, fork],
				position: position(history[1], 2, appended[1], 4),
				hasWork: true,
			});

			expect(report.continuity).toMatchObject({
				status: "interrupted",
				reasons: [{ kind: "unexpected_successor", predecessorId: appended[0].id }],
			});
		});

		it("interrupts continuity when the recorded tip is missing or changed", () => {
			const entries = lineage(2);
			const missing = assessAppendAssurance({
				scope,
				entries: entries.slice(0, 1),
				position: position(null, 0, entries[1], 2),
				hasWork: true,
			});
			const changed = assessAppendAssurance({
				scope,
				entries: [entries[0], { ...entries[1], hash: "rewritten" }],
				position: position(null, 0, entries[1], 2),
				hasWork: true,
			});

			expect(missing.continuity).toMatchObject({
				status: "interrupted",
				reasons: expect.arrayContaining([
					{ kind: "position_tip_missing", tipEntryId: entries[1].id },
				]),
			});
			expect(changed.continuity).toMatchObject({
				status: "interrupted",
				reasons: expect.arrayContaining([
					{ kind: "position_tip_changed", tipEntryId: entries[1].id },
				]),
			});
		});

		it("interrupts continuity when the segment no longer reaches the recorded anchor", () => {
			const history = lineage(2);
			const appended = lineage(2, "explicit", history[1]);
			const report = assessAppendAssurance({
				scope,
				entries: [...history, ...appended],
				// Three entries back from the tip lead to history[0], not the recorded anchor.
				position: position(history[1], 1, appended[1], 4),
				hasWork: true,
			});

			expect(report.continuity).toMatchObject({
				status: "interrupted",
				reasons: [{ kind: "post_anchor_segment_broken" }],
			});
		});
	});
});

describe("summarizeAppendAssurance", () => {
	it("keeps status and limitation codes but no entry identities", () => {
		const [root, next] = lineage(2);
		const report = assessAppendAssurance({
			scope,
			entries: [root, { ...next, hash: "unknown-format" }],
			position: null,
			hasWork: true,
		});

		const summary = summarizeAppendAssurance(report);

		expect(summary).toEqual({
			entryCount: 2,
			lineage: "review_required",
			continuity: "not_adopted",
			assurance: {
				scope: "none",
				limitations: [
					"hash_commits_event_fields_only",
					"hash_not_reproduced",
					"lineage_unresolved",
					"no_continuity_position",
					"original_actor_and_capture_unproven",
					"payroll_readiness_not_assessed",
				],
			},
			hashes: { reproduced: 1, notReproduced: 1, inputUnavailable: 0, duplicates: 0 },
		});
		expect(JSON.stringify(summary)).not.toContain(root.id);
		expect(JSON.stringify(summary)).not.toContain(scope.employeeId);
	});
});
