import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as globalDb } from "@/db";
import { user } from "@/db/auth-schema";
import { balanceAdjustment } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import {
	comparePlainDates,
	dateFromInstant,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	computeEmployeeWorkBalanceAtEndOfDay,
	loadWorkBalanceEmployee,
	markEmployeeWorkBalanceDirty,
	refreshEmployeeWorkBalanceFromPeriods,
	type WorkBalanceDbClient,
} from "@/lib/work-balance/service";
import { refuseOvertimePayout } from "./rules";
import {
	type BalanceAdjustmentErrorCode,
	BalanceAdjustmentRefusal,
	type BalanceAdjustmentView,
} from "./types";

/**
 * Recording, cancelling and listing balance adjustments (#993, ADR-0008).
 * Every query is filtered by `organizationId`; the database also refuses an
 * adjustment for another organization's employee (composite foreign key) and
 * any edit or delete (trigger). Callers authorize the actor.
 *
 * A write commits the adjustment, its audit entry and the employee's dirty
 * mark (from the adjustment's day) together, then refreshes that employee's
 * stored balance right away, so every balance view shows it without waiting
 * for the balance worker. Employees who have left are refreshed too.
 */

const logger = createLogger("BalanceAdjustments");

export type BalanceAdjustmentDatabase = Pick<typeof globalDb, "transaction" | "select">;

const MAX_REASON_LENGTH = 1000;

const recorder = alias(user, "balance_adjustment_recorder");
const canceller = alias(user, "balance_adjustment_canceller");

function displayName(
	row: { name: string | null; firstName: string | null; lastName: string | null } | null,
) {
	if (!row) return "";
	const structured = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
	return structured || row.name || "";
}

/** The employee's adjustments, cancelled ones included, newest day first. */
export async function listBalanceAdjustments(
	client: Pick<typeof globalDb, "select">,
	input: { organizationId: string; employeeId: string },
): Promise<BalanceAdjustmentView[]> {
	const rows = await client
		.select({
			adjustment: balanceAdjustment,
			recorder: { name: recorder.name, firstName: recorder.firstName, lastName: recorder.lastName },
			canceller: {
				name: canceller.name,
				firstName: canceller.firstName,
				lastName: canceller.lastName,
			},
		})
		.from(balanceAdjustment)
		.leftJoin(recorder, eq(recorder.id, balanceAdjustment.recordedBy))
		.leftJoin(canceller, eq(canceller.id, balanceAdjustment.cancelledBy))
		.where(
			and(
				eq(balanceAdjustment.organizationId, input.organizationId),
				eq(balanceAdjustment.employeeId, input.employeeId),
			),
		)
		.orderBy(desc(balanceAdjustment.day), desc(balanceAdjustment.recordedAt));

	return rows.map(({ adjustment, recorder: recordedBy, canceller: cancelledBy }) => ({
		id: adjustment.id,
		kind: adjustment.kind,
		day: adjustment.day,
		minutes: adjustment.minutes,
		reason: adjustment.reason,
		recordedAt: adjustment.recordedAt.toISOString(),
		recordedBy: { userId: adjustment.recordedBy ?? "", name: displayName(recordedBy) },
		cancellation: adjustment.cancelledAt
			? {
					cancelledAt: adjustment.cancelledAt.toISOString(),
					cancelledBy: { userId: adjustment.cancelledBy ?? "", name: displayName(cancelledBy) },
					reason: adjustment.cancellationReason ?? "",
				}
			: null,
	}));
}

/** Records an overtime payout of `amountMinutes` on `day` for the employee. */
export async function recordOvertimePayout(
	database: BalanceAdjustmentDatabase,
	audit: AuditTrail,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		/** Local date in the employee's effective timezone. */
		day: string;
		amountMinutes: number;
		reason: string;
		now: Instant;
		/** Recorded with the audit entry, e.g. the payroll access grant the actor used (#995). */
		auditMetadata?: Record<string, unknown> | null;
	},
): Promise<{ adjustmentId: string }> {
	const day = parseDay(input.day);
	const reason = requireReason(input.reason);
	const adjustmentId = await database.transaction(async (tx) => {
		const client = tx as unknown as WorkBalanceDbClient;
		await lockEmployeeLedger(client, input);
		const subject = await loadWorkBalanceEmployee(input, client);
		if (!subject) throw refusal("employee_not_found", "Employee not found");

		// Checked under the ledger lock, so two payouts recorded at once cannot
		// together exceed the balance.
		const today = plainDateAt(input.now, subject.timezone);
		const needsBalance = input.amountMinutes > 0 && comparePlainDates(day, today) <= 0;
		const balanceAtEndOfDayMinutes = needsBalance
			? await computeEmployeeWorkBalanceAtEndOfDay(
					{ organizationId: input.organizationId, employee: subject, day: input.day },
					client,
				)
			: 0;
		const refused = refuseOvertimePayout({
			amountMinutes: input.amountMinutes,
			day,
			today,
			balanceAtEndOfDayMinutes,
		});
		if (refused) throw refusal(refused, `Overtime payout refused: ${refused}`);

		const [inserted] = await tx
			.insert(balanceAdjustment)
			.values({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				kind: "overtime_payout",
				day: input.day,
				minutes: -input.amountMinutes,
				reason,
				recordedBy: input.actorUserId,
				recordedAt: dateFromInstant(input.now),
			})
			.returning({ id: balanceAdjustment.id });
		if (!inserted) throw new Error("Balance adjustment insert returned no row");

		await audit.record(tx, {
			organizationId: input.organizationId,
			targetType: "balance_adjustment",
			targetId: inserted.id,
			action: AuditAction.BALANCE_ADJUSTMENT_RECORDED,
			actorUserId: input.actorUserId,
			employeeId: input.employeeId,
			changes: {
				from: null,
				to: { kind: "overtime_payout", day: input.day, minutes: -input.amountMinutes, reason },
			},
			metadata: input.auditMetadata ?? null,
		});
		await markEmployeeWorkBalanceDirty(
			{
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				dirtyFromDate: input.day,
			},
			tx,
		);
		return inserted.id;
	});

	await refreshAfterCommit({ ...input, dirtyFromDate: input.day });
	return { adjustmentId };
}

/** Cancels an uncancelled adjustment of the employee, giving a reason. */
export async function cancelBalanceAdjustment(
	database: BalanceAdjustmentDatabase,
	audit: AuditTrail,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		adjustmentId: string;
		reason: string;
		now: Instant;
		/** Recorded with the audit entry, e.g. the payroll access grant the actor used (#995). */
		auditMetadata?: Record<string, unknown> | null;
	},
): Promise<{ adjustmentId: string }> {
	const reason = requireReason(input.reason);
	const day = await database.transaction(async (tx) => {
		const client = tx as unknown as WorkBalanceDbClient;
		await lockEmployeeLedger(client, input);
		const [current] = await tx
			.select({
				id: balanceAdjustment.id,
				kind: balanceAdjustment.kind,
				day: balanceAdjustment.day,
				minutes: balanceAdjustment.minutes,
				cancelledAt: balanceAdjustment.cancelledAt,
			})
			.from(balanceAdjustment)
			.where(
				and(
					eq(balanceAdjustment.organizationId, input.organizationId),
					eq(balanceAdjustment.employeeId, input.employeeId),
					eq(balanceAdjustment.id, input.adjustmentId),
				),
			)
			.for("update");
		if (!current) throw refusal("adjustment_not_found", "Balance adjustment not found");
		if (current.cancelledAt) throw refusal("already_cancelled", "Already cancelled");

		const cancelledAt = dateFromInstant(input.now);
		await tx
			.update(balanceAdjustment)
			.set({ cancelledAt, cancelledBy: input.actorUserId, cancellationReason: reason })
			.where(
				and(
					eq(balanceAdjustment.organizationId, input.organizationId),
					eq(balanceAdjustment.id, current.id),
				),
			);
		await audit.record(tx, {
			organizationId: input.organizationId,
			targetType: "balance_adjustment",
			targetId: current.id,
			action: AuditAction.BALANCE_ADJUSTMENT_CANCELLED,
			actorUserId: input.actorUserId,
			employeeId: input.employeeId,
			changes: {
				from: { kind: current.kind, day: current.day, minutes: current.minutes, cancelled: false },
				to: { cancelled: true, reason },
			},
			metadata: input.auditMetadata ?? null,
		});
		await markEmployeeWorkBalanceDirty(
			{
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				dirtyFromDate: current.day,
			},
			tx,
		);
		return current.day;
	});

	await refreshAfterCommit({ ...input, dirtyFromDate: day });
	return { adjustmentId: input.adjustmentId };
}

/** Serializes the ledger writes of one employee. */
async function lockEmployeeLedger(
	client: Pick<WorkBalanceDbClient, "execute">,
	input: { organizationId: string; employeeId: string },
) {
	const lockKey = `balance-adjustment:${input.organizationId}:${input.employeeId}`;
	await client.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

/**
 * Brings the stored balance up to date once the adjustment committed. A failure
 * leaves the dirty mark for the balance worker; the adjustment stands.
 */
async function refreshAfterCommit(input: {
	organizationId: string;
	employeeId: string;
	dirtyFromDate: string;
}) {
	try {
		await refreshEmployeeWorkBalanceFromPeriods({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			dirtyFromDate: input.dirtyFromDate,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId, employeeId: input.employeeId },
			"Work balance refresh after a balance adjustment failed; the balance worker retries it",
		);
	}
}

function requireReason(value: string): string {
	const reason = typeof value === "string" ? value.trim() : "";
	if (!reason) throw refusal("reason_required", "A reason is required");
	if (reason.length > MAX_REASON_LENGTH) throw refusal("invalid_input", "Reason is too long");
	return reason;
}

function parseDay(value: string): PlainDate {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw refusal("invalid_input", "Invalid day");
	}
	try {
		return parsePlainDate(value);
	} catch {
		throw refusal("invalid_input", "Invalid day");
	}
}

function refusal(code: BalanceAdjustmentErrorCode, message: string) {
	return new BalanceAdjustmentRefusal(code, message);
}
