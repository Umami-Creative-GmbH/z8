import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";

/** Work with findings an explicit repair could address. */
export interface RepairTarget {
	workPeriodId: string;
	employeeId: string;
	findingKinds: string[];
}

/** An employee whose history needs review before appends, with the entries nothing follows. */
export interface ContinuationTarget {
	employeeId: string;
	candidates: { entryId: string; hash: string }[];
}

/**
 * Employees whose append history needs review and has no position yet, with each
 * entry no other entry follows (by stored ID, or by hash when no ID is stored).
 */
export function continuationTargetsOf(
	reports: readonly { employeeId: string; report: AppendAssuranceReport }[],
): ContinuationTarget[] {
	return reports.flatMap(({ employeeId, report }) => {
		if (report.lineage.status !== "review_required" || report.continuity.status !== "not_adopted") {
			return [];
		}
		const followed = (entry: AppendAssuranceReport["entries"][number]) =>
			report.entries.some(
				(other) =>
					other.entryId !== entry.entryId &&
					(other.stored.previousEntryId === entry.entryId ||
						(other.stored.previousEntryId === null &&
							other.stored.previousHash === entry.stored.hash)),
			);
		const candidates = report.entries
			.filter((entry) => !followed(entry))
			.map((entry) => ({ entryId: entry.entryId, hash: entry.stored.hash }));
		return candidates.length > 0 ? [{ employeeId, candidates }] : [];
	});
}
