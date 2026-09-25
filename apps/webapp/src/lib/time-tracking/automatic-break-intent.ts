/**
 * Stable identities of an automatic break adjustment (#305) and the intent an
 * adopted ordinary closure commits with its work. Kept apart from the operation so
 * the closure can commit the intent without depending on the adjustment itself.
 */
import { createHash } from "node:crypto";
import { workBreakAdjustmentIntent } from "@/db/schema";
import type { WorkTransactionClient } from "./work-transaction";

const INTENT_NAMESPACE = "z8:automatic-break-adjustment-intent:v1";
const OPERATION_NAMESPACE = "z8:automatic-break-adjustment:v1";

type PeriodIdentity = { organizationId: string; workPeriodId: string };

function uuidFromDigest(value: string): string {
	const bytes = new Uint8Array(createHash("sha1").update(value).digest().subarray(0, 16));
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable identity of a period's adjustment intent: one per organization and period. */
export function deriveAutomaticBreakIntentId(input: PeriodIdentity): string {
	return uuidFromDigest(`${INTENT_NAMESPACE}\0${input.organizationId}\0${input.workPeriodId}`);
}

/**
 * Stable receipt identity of a period's adjustment. A period is adjusted at most
 * once, so a second fresh adjustment would be a key collision.
 */
export function deriveAutomaticBreakOperationId(input: PeriodIdentity): string {
	return uuidFromDigest(`${OPERATION_NAMESPACE}\0${input.organizationId}\0${input.workPeriodId}`);
}

/**
 * Commits the adjustment intent of an ordinary adopted closure, with the closure.
 * Returns the intent ID the closure's receipt names as its follow-up.
 */
export async function commitAutomaticBreakIntent(
	tx: Pick<WorkTransactionClient, "insert">,
	input: PeriodIdentity & {
		employeeId: string;
		closureEntryId: string;
		triggeredByUserId: string;
	},
): Promise<string> {
	const id = deriveAutomaticBreakIntentId(input);
	await tx.insert(workBreakAdjustmentIntent).values({
		id,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		workPeriodId: input.workPeriodId,
		closureEntryId: input.closureEntryId,
		triggeredByUserId: input.triggeredByUserId,
		status: "pending",
		requestedAt: new Date(),
	});
	return id;
}
