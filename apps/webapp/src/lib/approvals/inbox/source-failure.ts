import type { ApprovalInboxSourceFailure, ApprovalInboxWarning } from "./types";

/**
 * How grave a source's failure is (#1978), gravest first: rows missing from the list, rows
 * missing from a "Covering for" section, rows missing only from the totals, then only a
 * section header's count.
 */
const SOURCE_FAILURE_SEVERITY: Record<ApprovalInboxSourceFailure, number> = {
	list: 0,
	covering: 1,
	count: 2,
	covering_count: 3,
};

/**
 * Whether `failure` is graver than `known`, so it names the source instead. A warning of
 * unknown kind reads as a failed list, the safe reading.
 */
export function isGraverSourceFailure(
	failure: ApprovalInboxWarning["failure"],
	known: ApprovalInboxWarning["failure"],
): boolean {
	return SOURCE_FAILURE_SEVERITY[failure ?? "list"] < SOURCE_FAILURE_SEVERITY[known ?? "list"];
}
