import type { ShiftRequestWithRelations } from "@/app/[locale]/(app)/scheduling/types";

/** Who the shift goes to on approval: the requester of a pickup, the named colleague of a swap. */
export function assignedEmployeeIdOf(request: ShiftRequestWithRelations): string | null {
	return request.type === "pickup" ? request.requesterId : request.targetEmployeeId;
}
