import type { TimeApprovalKind } from "../time-request-kind";

/**
 * The kind classified under the work transaction's guards differs from the
 * kind the time approval decision routed by, so the transaction ran under
 * another kind's approval write gate. Nothing was written; the time approval
 * decision rolls the attempt back, classifies again and restarts it. This is
 * a restart of one race, not a dispatch.
 */
export class TimeApprovalKindChanged extends Error {
	constructor(readonly classified: TimeApprovalKind | null) {
		super("Time approval kind changed since routing");
		this.name = "TimeApprovalKindChanged";
	}
}
