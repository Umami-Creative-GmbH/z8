import type { CanonicalInboxRead } from "./canonical-inbox-read";
import {
	countOrdinaryCanonicalApprovals,
	loadOrdinaryCanonicalApprovals,
} from "./ordinary-canonical-read";
import { periodSubmissionInboxRead } from "./period-submission-read";

/** Manual time submissions and policy clock-outs, listed as time entries. */
export const ordinaryWorkPeriodInboxRead: CanonicalInboxRead = {
	type: "time_entry",
	workflowTypes: ["manual_time_submission", "policy_clock_out"],
	// Decided by the time-entry legacy handler, which owns the canonical decision too.
	load: loadOrdinaryCanonicalApprovals,
	count: countOrdinaryCanonicalApprovals,
};

/**
 * Every canonical kind's inbox read (#1058). A kind decided by canonical
 * workflows adds its read here; the inbox lists, counts, opens and (with
 * `decide`) decides its approvals next to the legacy sources, with no legacy
 * request behind them.
 */
export const CANONICAL_INBOX_READS: readonly CanonicalInboxRead[] = [
	ordinaryWorkPeriodInboxRead,
	periodSubmissionInboxRead,
];
