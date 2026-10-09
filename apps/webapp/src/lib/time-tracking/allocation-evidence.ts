/**
 * A canonical allocation as committed evidence in a work receipt (split,
 * automatic break, policy clock-out break): by value, not a pointer to current
 * rows. Client-safe type only.
 */
export type AllocationEvidence<Kind extends string = string> = {
	allocationKind: Kind;
	projectId: string | null;
	/** Present only on an allocation booked to a task (#873). */
	taskId?: string;
	costCenterId: string | null;
	weightPercent: number;
	/** Absent on receipts committed before billability (#900), which were non-billable. */
	isBillable?: boolean;
};
