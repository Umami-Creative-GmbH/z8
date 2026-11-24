import type { SelfServiceRequestItem } from "./types";

/**
 * A rejected or returned request the employee can correct and resubmit: a "Required fix", listed
 * under "Needs attention". A final rejection without a fix action is a decision, not a fix.
 */
export function needsFix(item: Pick<SelfServiceRequestItem, "status" | "availableActions">) {
	return (
		(item.status === "rejected" || item.status === "returned") &&
		item.availableActions.includes("fix")
	);
}
