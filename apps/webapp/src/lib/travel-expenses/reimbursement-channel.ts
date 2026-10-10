import "server-only";

import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import { auditLog, travelExpenseSettings } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { countRunsIncludingReports } from "./payroll-run-inclusion-read";
import { isPayrollRunPreviewOpen } from "./payroll-run-preview";
import {
	DEFAULT_REIMBURSEMENT_CHANNEL,
	isReimbursementChannel,
	type ReimbursementChannel,
} from "./reimbursement-channel.types";

/**
 * The organization's reimbursement channel (#849): bank transfer, or the payroll
 * run while the organization passes its preview gate. Later slices read it only
 * through `getReimbursementChannel`.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "select">;

/** The settings row is keyed by the organization, not a uuid; as in `logAudit`, the nil uuid stands in. */
const NO_AUDIT_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

/** The organization's channel; one that never chose reads as bank transfer. */
export async function getReimbursementChannel(
	organizationId: string,
	options: { database?: Executor } = {},
): Promise<ReimbursementChannel> {
	const [row] = await (options.database ?? appDb)
		.select({ channel: travelExpenseSettings.reimbursementChannel })
		.from(travelExpenseSettings)
		.where(eq(travelExpenseSettings.organizationId, organizationId))
		.limit(1);
	return row?.channel ?? DEFAULT_REIMBURSEMENT_CHANNEL;
}

/**
 * The organization's payroll runs that are not confirmed yet: those that
 * still include a report (#852). They can still be confirmed or discarded
 * after a switch to bank transfer.
 */
export async function countUnconfirmedPayrollRuns(
	organizationId: string,
	options: { database?: Pick<Database, "selectDistinct"> } = {},
): Promise<number> {
	return countRunsIncludingReports(options.database ?? appDb, organizationId);
}

export type SaveReimbursementChannelResult =
	| { kind: "saved"; channel: ReimbursementChannel; previous: ReimbursementChannel }
	| { kind: "unchanged"; channel: ReimbursementChannel }
	| { kind: "invalid" }
	/** The payroll run is offered only while the organization passes the preview gate. */
	| { kind: "preview_closed" };

/**
 * Sets the organization's channel and audits the change with the old and new
 * value. The caller checks that the actor manages the organization's settings.
 */
export async function saveReimbursementChannel(
	input: { organizationId: string; actorUserId: string; channel: unknown },
	options: { database?: Database } = {},
): Promise<SaveReimbursementChannelResult> {
	const { organizationId, actorUserId, channel } = input;
	if (!isReimbursementChannel(channel)) return { kind: "invalid" };
	return (options.database ?? appDb).transaction(async (tx) => {
		const previous = await createAndLockSettings(tx, organizationId);
		// Keeping the current channel is never refused, even after the gate closed again.
		if (previous === channel) return { kind: "unchanged", channel };
		if (
			channel === "payroll_run" &&
			!(await isPayrollRunPreviewOpen(organizationId, { database: tx }))
		) {
			return { kind: "preview_closed" };
		}
		const now = new Date();
		await tx
			.update(travelExpenseSettings)
			.set({ reimbursementChannel: channel, updatedAt: now, updatedBy: actorUserId })
			.where(eq(travelExpenseSettings.organizationId, organizationId));
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "travel_expense_settings",
			entityId: NO_AUDIT_ENTITY_ID,
			action: AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_CHANNEL_CHANGED,
			performedBy: actorUserId,
			changes: JSON.stringify({
				from: { reimbursementChannel: previous },
				to: { reimbursementChannel: channel },
			}),
			timestamp: now,
		});
		return { kind: "saved", channel, previous };
	});
}

/** Creates the organization's settings row when missing and locks it. */
async function createAndLockSettings(
	tx: Transaction,
	organizationId: string,
): Promise<ReimbursementChannel> {
	await tx.insert(travelExpenseSettings).values({ organizationId }).onConflictDoNothing();
	const [row] = await tx
		.select({ channel: travelExpenseSettings.reimbursementChannel })
		.from(travelExpenseSettings)
		.where(eq(travelExpenseSettings.organizationId, organizationId))
		.for("update");
	return row.channel;
}
