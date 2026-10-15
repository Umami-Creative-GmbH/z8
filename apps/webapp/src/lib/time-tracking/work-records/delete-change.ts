/**
 * The delete change of work records (ADR 0010, #1227): the soft delete of
 * completed work that an approved business deletion (a time correction of
 * action `delete`) makes. No I/O and no server-only imports.
 *
 * Deleted work keeps both records. The work period is marked deleted and both
 * records shrink to a zero-length sentinel at the instant of the deletion's two
 * recorded markers: correction entries that replace the clock-in and the
 * clock-out, so the hashed ledger records the deletion too. Readers exclude the
 * canonical work record of a deleted work period.
 */
import type { Instant } from "@/lib/datetime/temporal-core";
import type { AdoptedEndpoint, ToleratedDrift } from "./amend-change";
import type { WorkRecordExpected } from "./change";

export type DeleteWorkRecord = {
	kind: "delete";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	/**
	 * The recorded deletion markers, adopted by reference like an amendment's
	 * adopted endpoints: pending corrections replacing the current clock-in and
	 * clock-out, both at one instant.
	 */
	markers: { clockIn: AdoptedEndpoint; clockOut: AdoptedEndpoint };
	deletion: {
		/** When the deletion was decided. */
		at: Instant;
		reason: string | null;
		/** The legacy approval request that decided it, if any. */
		approvalRequestId: string | null;
	};
	toleratedDrift?: readonly ToleratedDrift[];
	/** The user deleting the work; null for a job or the system. */
	actorUserId: string | null;
};
