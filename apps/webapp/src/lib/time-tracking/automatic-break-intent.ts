/**
 * Stable identities of an automatic break adjustment (#305), the intent an adopted
 * ordinary closure commits with its work, and how a closure replay recognizes the
 * segment an adjustment moved its clock-out to. Kept apart from the operation so the
 * closure owner does not depend on the adjustment itself.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { completedWorkOperation, workBreakAdjustmentIntent, workPeriod } from "@/db/schema";
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

/** Whether the period's automatic break adjustment generated the segment ending in this entry. */
export async function isClosureCarriedByAutomaticBreak(
	tx: Pick<WorkTransactionClient, "select">,
	scope: { organizationId: string; employeeId: string },
	workPeriodId: string,
	clockOutEntryId: string,
): Promise<boolean> {
	const [adjustment] = await tx
		.select({ result: completedWorkOperation.result })
		.from(completedWorkOperation)
		.where(
			and(
				eq(
					completedWorkOperation.id,
					deriveAutomaticBreakOperationId({ organizationId: scope.organizationId, workPeriodId }),
				),
				eq(completedWorkOperation.organizationId, scope.organizationId),
				eq(completedWorkOperation.employeeId, scope.employeeId),
				eq(completedWorkOperation.kind, "automatic_break_adjustment"),
				eq(completedWorkOperation.workPeriodId, workPeriodId),
			),
		)
		.limit(1);
	// The committed segments by value (`AutomaticBreakAdjustmentResult`).
	const segments = (adjustment?.result as { segments?: unknown } | undefined)?.segments;
	const generated = Array.isArray(segments)
		? (
				segments as Array<{ role?: unknown; workPeriodId?: unknown; clockOutEntryId?: unknown }>
			).find((segment) => segment.role === "generated")
		: undefined;
	if (
		typeof generated?.workPeriodId !== "string" ||
		generated.clockOutEntryId !== clockOutEntryId
	) {
		return false;
	}
	const [carrier] = await tx
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, generated.workPeriodId),
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				eq(workPeriod.clockOutId, clockOutEntryId),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	return carrier !== undefined;
}
