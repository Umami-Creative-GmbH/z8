import type { AbsenceChangeSummary } from "@/lib/absences/change-request-types";

/** A pending change request holds back further change requests on its absence. */
export function hasPendingChangeRequest(
	changeRequests: readonly Pick<AbsenceChangeSummary, "absenceId" | "status">[] | undefined,
	absenceId: string,
): boolean {
	return (
		changeRequests?.some(
			(request) => request.absenceId === absenceId && request.status === "pending",
		) ?? false
	);
}
