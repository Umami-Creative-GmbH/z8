import type { CanonicalInboxRead } from "./canonical-inbox-read";
import {
	countOrdinaryCanonicalApprovals,
	loadOrdinaryCanonicalApprovals,
} from "./ordinary-canonical-read";

/** Manual time submissions and policy clock-outs, listed as time entries. */
export const ordinaryWorkPeriodInboxRead: CanonicalInboxRead = {
	type: "time_entry",
	load: loadOrdinaryCanonicalApprovals,
	count: countOrdinaryCanonicalApprovals,
};

/**
 * Every canonical kind's inbox read (#1058). A kind decided by canonical
 * workflows adds its read here; the inbox lists, counts and opens its
 * approvals next to the legacy sources, with no legacy request behind them.
 */
export const CANONICAL_INBOX_READS: readonly CanonicalInboxRead[] = [ordinaryWorkPeriodInboxRead];
