/**
 * Audit-pack view of append lineage (#324). Expansion and presentation use the
 * shared append compatibility rules through each employee's assurance report:
 * stored fields are preserved as recorded, resolved links are labeled stored or
 * derived, and unresolved stored IDs are not followed.
 */
import type { AuditPackAppendAssurance } from "@/db/schema/audit-pack";
import type {
	AppendAssuranceLimitationCode,
	AppendAssuranceReport,
	AppendEntryAssessment,
} from "@/lib/time-tracking/append-assurance";
import { predecessorIdOf } from "@/lib/time-tracking/append-lineage";
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

/** Every assessed entry of the given reports, by entry ID. */
export type AssessedEntries = ReadonlyMap<string, AppendEntryAssessment>;

export function indexAssessedEntries(reports: Iterable<AppendAssuranceReport>): AssessedEntries {
	const index = new Map<string, AppendEntryAssessment>();
	for (const report of reports) {
		for (const entry of report.entries) index.set(entry.entryId, entry);
	}
	return index;
}

function assessedEntry(row: AuditEntryRow, assessed: AssessedEntries) {
	const entry = assessed.get(row.id);
	if (!entry) {
		throw new Error(`Append lineage was not assessed for entry ${row.id}`);
	}
	return entry;
}

export function toLineageNode(row: AuditEntryRow, assessed: AssessedEntries): LineageLinkNode {
	return {
		id: row.id,
		previousEntryId: row.previousEntryId,
		appendPredecessorId: predecessorIdOf(assessedEntry(row, assessed).link),
		replacesEntryId: row.replacesEntryId,
		supersededById: row.supersededById,
	};
}

export function toEntryChainEvidenceInput(
	row: AuditEntryRow,
	assessed: AssessedEntries,
	occurredAt: string,
): EntryChainEvidenceInput {
	const { link, hash } = assessedEntry(row, assessed);
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
		appendLink: { resolution: link.kind, predecessorId: predecessorIdOf(link) },
	};
}

/** An employee's claims without per-entry detail; entries.json carries the included entries. */
export type AuditPackAssuranceRecord = Omit<AppendAssuranceReport, "entries">;

export function toPackAssuranceRecord(report: AppendAssuranceReport): AuditPackAssuranceRecord {
	const { entries: _entries, ...claims } = report;
	return claims;
}

export function summarizeAuditPackAssurance(
	reports: Iterable<AppendAssuranceReport>,
): AuditPackAppendAssurance {
	const summary: AuditPackAppendAssurance = {
		employeeCount: 0,
		wholeHistory: 0,
		none: 0,
		limitations: [],
	};
	const limitations = new Set<AppendAssuranceLimitationCode>();
	for (const report of reports) {
		summary.employeeCount += 1;
		if (report.assurance.scope === "whole_history") summary.wholeHistory += 1;
		else summary.none += 1;
		for (const limitation of report.assurance.limitations) limitations.add(limitation.code);
	}
	summary.limitations = [...limitations].toSorted();
	return summary;
}
