/**
 * Audit-pack view of append lineage (#324). Expansion and presentation use the
 * shared append compatibility rules through each employee's assurance report:
 * stored fields are preserved as recorded, resolved links are labeled stored or
 * derived, and unresolved stored IDs are not followed.
 */
import type { AuditPackAppendAssurance } from "@/db/schema/audit-pack";
import type {
	AppendAssuranceLimitation,
	AppendAssuranceReport,
	AppendContinuity,
	AppendEntryAssessment,
} from "@/lib/time-tracking/append-assurance";
import type { EntryChainEvidenceInput, LineageLinkNode } from "./types";

export interface AuditEntryRow {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	hash: string;
	previousHash: string | null;
	previousEntryId: string | null;
	replacesEntryId: string | null;
	supersededById: string | null;
}

type AssuranceReports = ReadonlyMap<string, AppendAssuranceReport>;

const entryIndexes = new WeakMap<AppendAssuranceReport, Map<string, AppendEntryAssessment>>();

function assessedEntry(row: AuditEntryRow, reports: AssuranceReports) {
	const report = reports.get(row.employeeId);
	let index = report ? entryIndexes.get(report) : undefined;
	if (report && !index) {
		index = new Map(report.entries.map((entry) => [entry.entryId, entry]));
		entryIndexes.set(report, index);
	}
	const entry = index?.get(row.id);
	if (!entry) {
		throw new Error(`Append lineage was not assessed for entry ${row.id}`);
	}
	return entry;
}

export function toLineageNode(row: AuditEntryRow, reports: AssuranceReports): LineageLinkNode {
	const { link } = assessedEntry(row, reports);
	return {
		id: row.id,
		previousEntryId: row.previousEntryId,
		appendPredecessorId:
			link.kind === "stored" || link.kind === "derived" ? link.predecessorId : null,
		replacesEntryId: row.replacesEntryId,
		supersededById: row.supersededById,
	};
}

export function toEntryChainEvidenceInput(
	row: AuditEntryRow,
	reports: AssuranceReports,
	occurredAt: string,
): EntryChainEvidenceInput {
	const { link, hash } = assessedEntry(row, reports);
	return {
		id: row.id,
		organizationId: row.organizationId,
		employeeId: row.employeeId,
		type: row.type,
		occurredAt,
		previousEntryId: row.previousEntryId,
		replacesEntryId: row.replacesEntryId,
		supersededById: row.supersededById,
		hash: { stored: row.hash, previousHash: row.previousHash, status: hash },
		appendLink: {
			resolution: link.kind,
			predecessorId: link.kind === "stored" || link.kind === "derived" ? link.predecessorId : null,
		},
	};
}

type SerializedContinuity =
	| Extract<AppendContinuity, { status: "not_adopted" }>
	| (Omit<Exclude<AppendContinuity, { status: "not_adopted" }>, "provenance"> & {
			provenance: Omit<
				Exclude<AppendContinuity, { status: "not_adopted" }>["provenance"],
				"admittedAt"
			> & { admittedAt: string };
	  });

/** An employee's claims without per-entry detail; entries.json carries the included entries. */
export type AuditPackAssuranceRecord = Omit<AppendAssuranceReport, "entries" | "continuity"> & {
	continuity: SerializedContinuity;
};

export function toPackAssuranceRecord(report: AppendAssuranceReport): AuditPackAssuranceRecord {
	const { entries: _entries, continuity, ...claims } = report;
	return {
		...claims,
		continuity:
			continuity.status === "not_adopted"
				? continuity
				: {
						...continuity,
						provenance: {
							...continuity.provenance,
							admittedAt: continuity.provenance.admittedAt.toISOString(),
						},
					},
	};
}

export type { AuditPackAppendAssurance };

export function summarizeAuditPackAssurance(
	reports: Iterable<AppendAssuranceReport>,
): AuditPackAppendAssurance {
	const summary: AuditPackAppendAssurance = {
		employeeCount: 0,
		wholeHistory: 0,
		postAnchor: 0,
		none: 0,
		limitations: [],
	};
	const limitations = new Set<AppendAssuranceLimitation["code"]>();
	for (const report of reports) {
		summary.employeeCount += 1;
		if (report.assurance.scope === "whole_history") summary.wholeHistory += 1;
		if (report.assurance.scope === "post_anchor") summary.postAnchor += 1;
		if (report.assurance.scope === "none") summary.none += 1;
		for (const limitation of report.assurance.limitations) limitations.add(limitation.code);
	}
	summary.limitations = [...limitations].toSorted();
	return summary;
}
