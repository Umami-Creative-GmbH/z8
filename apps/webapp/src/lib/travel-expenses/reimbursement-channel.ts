import "server-only";

import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import { auditLog, travelExpenseSettings } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
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

/** The audit log keys entities by uuid; the settings row is keyed by the organization. */
const SETTINGS_AUDIT_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

/** The organization's channel; one that never chose reads as bank transfer. */
export async function getReimbursementChannel(
	organizationId: string,
	options: { database?: Executor; lock?: "share" } = {},
): Promise<ReimbursementChannel> {
	const query = (options.database ?? appDb)
		.select({ channel: travelExpenseSettings.reimbursementChannel })
		.from(travelExpenseSettings)
		.where(eq(travelExpenseSettings.organizationId, organizationId))
		.limit(1);
	// Shared lock: a reader that acts on the channel serializes with a change of it.
	const [row] = await (options.lock === "share" ? query.for("share") : query);
	return row?.channel ?? DEFAULT_REIMBURSEMENT_CHANNEL;
}

/**
 * The organization's payroll runs that no expense officer has confirmed yet.
 * They can still be confirmed or discarded after a switch to bank transfer.
 * Always 0 until payroll runs exist (#852, #853).
 */
export async function countUnconfirmedPayrollRuns(
	_organizationId: string,
	_options: { database?: Executor } = {},
): Promise<number> {
	return 0;
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
	deps: {
		database?: Database;
		payrollRunPreviewOpen?: (organizationId: string) => Promise<boolean>;
	} = {},
): Promise<SaveReimbursementChannelResult> {
	const { organizationId, actorUserId, channel } = input;
	if (!isReimbursementChannel(channel)) return { kind: "invalid" };
	const database = deps.database ?? appDb;
	const previewOpen =
		deps.payrollRunPreviewOpen ?? ((id: string) => isPayrollRunPreviewOpen(id, { database }));
	if (channel === "payroll_run" && !(await previewOpen(organizationId))) {
		return { kind: "preview_closed" };
	}
	return database.transaction(async (tx) => {
		const previous = await lockChannel(tx, organizationId);
		if (previous === channel) return { kind: "unchanged", channel };
		const now = new Date();
		await tx
			.update(travelExpenseSettings)
			.set({ reimbursementChannel: channel, updatedAt: now, updatedBy: actorUserId })
			.where(eq(travelExpenseSettings.organizationId, organizationId));
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "travel_expense_settings",
			entityId: SETTINGS_AUDIT_ENTITY_ID,
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
async function lockChannel(tx: Transaction, organizationId: string): Promise<ReimbursementChannel> {
	await tx.insert(travelExpenseSettings).values({ organizationId }).onConflictDoNothing();
	const [row] = await tx
		.select({ channel: travelExpenseSettings.reimbursementChannel })
		.from(travelExpenseSettings)
		.where(eq(travelExpenseSettings.organizationId, organizationId))
		.for("update");
	return row.channel;
}
