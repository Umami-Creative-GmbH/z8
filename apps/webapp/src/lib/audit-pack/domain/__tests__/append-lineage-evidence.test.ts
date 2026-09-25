import { describe, expect, it } from "vitest";
import { assessAppendAssurance } from "@/lib/time-tracking/append-assurance";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import {
	type AuditEntryRow,
	indexAssessedEntries,
	summarizeAuditPackAssurance,
	toEntryChainEvidenceInput,
	toLineageNode,
	toPackAssuranceRecord,
} from "../append-lineage-evidence";
import { buildEntryChainEvidence } from "../entry-chain-builder";

const organizationId = "org-1";
const employeeId = "a0000000-0000-4000-8000-000000000001";

function row(
	id: string,
	previous: AuditEntryRow | null,
	options: { link?: "explicit" | "hash-only"; timestamp?: string } = {},
): AuditEntryRow {
	const timestamp = new Date(options.timestamp ?? "2026-07-01T08:00:00.000Z");
	const previousHash = previous?.hash ?? null;
	return {
		id,
		organizationId,
		employeeId,
		type: "clock_in",
		timestamp,
		hash: calculateHash({
			employeeId,
			type: "clock_in",
			timestamp: timestamp.toISOString(),
			previousHash,
		}),
		previousHash,
		previousEntryId: previous && options.link !== "hash-only" ? previous.id : null,
		replacesEntryId: null,
		supersededById: null,
	};
}

function reportFor(rows: AuditEntryRow[]) {
	return assessAppendAssurance({
		scope: { organizationId, employeeId },
		entries: rows,
		position: null,
		hasWork: true,
	});
}

function assessedFor(rows: AuditEntryRow[]) {
	return indexAssessedEntries([reportFor(rows)]);
}

describe("audit pack append lineage evidence", () => {
	const root = row("e1", null);
	const hashOnly = row("e2", root, { link: "hash-only", timestamp: "2026-07-01T09:00:00.000Z" });
	const explicit = row("e3", hashOnly, { timestamp: "2026-07-01T10:00:00.000Z" });
	const rows = [root, hashOnly, explicit];

	it("expands through the resolved predecessor while keeping the stored ID", () => {
		expect(toLineageNode(hashOnly, assessedFor(rows))).toEqual({
			id: "e2",
			previousEntryId: null,
			appendPredecessorId: "e1",
			replacesEntryId: null,
			supersededById: null,
		});
	});

	it("does not follow a stored predecessor ID that does not resolve in the employee's scope", () => {
		const foreign = { ...row("e9", null), previousEntryId: "other-employee-entry" };
		const assessed = assessedFor([...rows, foreign]);

		expect(toLineageNode(foreign, assessed).appendPredecessorId).toBeNull();
		expect(toLineageNode(foreign, assessed).previousEntryId).toBe("other-employee-entry");
	});

	it("preserves original stored fields and labels derived links and hash status", () => {
		const [evidence] = buildEntryChainEvidence(
			[toEntryChainEvidenceInput(hashOnly, assessedFor(rows), "2026-07-01T09:00:00.000Z")],
			organizationId,
		);

		expect(evidence).toEqual({
			id: "e2",
			organizationId,
			employeeId,
			type: "clock_in",
			occurredAt: "2026-07-01T09:00:00.000Z",
			lineage: { previousEntryId: null, replacesEntryId: null, supersededById: null },
			hash: { stored: hashOnly.hash, previousHash: root.hash, status: "reproduced" },
			appendLink: { resolution: "derived", predecessorId: "e1" },
		});
	});

	it("fails rather than presenting an entry that was not assessed", () => {
		expect(() => toLineageNode(root, new Map())).toThrow(/not assessed/);
	});

	it("omits per-entry detail from the pack record but keeps claims and provenance", () => {
		const record = toPackAssuranceRecord(reportFor(rows));

		expect(record).not.toHaveProperty("entries");
		expect(record).toMatchObject({
			organizationId,
			employeeId,
			entryCount: 3,
			lineage: { status: "single" },
			continuity: { status: "not_adopted" },
			assurance: { scope: "whole_history" },
		});
	});

	it("summarizes assurance scopes and limitation codes across employees", () => {
		const verified = reportFor(rows);
		const unresolved = assessAppendAssurance({
			scope: { organizationId, employeeId: "a0000000-0000-4000-8000-000000000002" },
			entries: [],
			position: null,
			hasWork: true,
		});

		expect(summarizeAuditPackAssurance([verified, unresolved])).toEqual({
			employeeCount: 2,
			wholeHistory: 1,
			none: 1,
			limitations: [
				"derived_links",
				"hash_commits_event_fields_only",
				"lineage_unresolved",
				"no_continuity_position",
				"original_actor_and_capture_unproven",
				"payroll_readiness_not_assessed",
			],
		});
	});
});
