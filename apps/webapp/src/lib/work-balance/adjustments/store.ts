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
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { closedMonthTouchedByDays } from "@/lib/time-tracking/closed-months/rules";
import { closedRangesForEmployee } from "@/lib/time-tracking/closed-months/store";
import { acquireOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction/ranks";
import {
	computeEmployeeWorkBalanceAtEndOfDay,
	loadWorkBalanceEmployee,
	markEmployeeWorkBalanceDirty,
	refreshEmployeeWorkBalanceFromPeriods,
	requestEmployeeWorkBalanceFullRebuild,
	type WorkBalanceDbClient,
} from "@/lib/work-balance/service";
import {
	listUncancelledPayouts,
	type OpeningBalanceInEffect,
	readOpeningBalanceInEffect,
} from "./ledger";
import { type BalanceAdjustmentChange, notifyBalanceAdjustmentChanges } from "./notifications";
import { refuseOpeningBalance, refuseOvertimePayout } from "./rules";
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
 * for the balance worker. Employees who have left are refreshed too. Then the
 * employee is notified of the change (#996).
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
	const adjustmentId = await inLedgerTransaction(database, async (tx) => {
		const client = tx as unknown as WorkBalanceDbClient;
		await lockEmployeeLedger(client, input);
		const subject = await loadWorkBalanceEmployee(input, client);
		if (!subject) throw refusal("employee_not_found", "Employee not found");

		// Checked under the ledger lock, so two payouts recorded at once cannot
		// together exceed the balance, and no opening balance slips in between.
		const today = plainDateAt(input.now, subject.timezone);
		const closedMonth = await closedMonthOfDay(client, input);
		const openingBalance = await readOpeningBalanceInEffect(client, input);
		const openingBalanceDay = openingBalance ? parsePlainDate(openingBalance.day) : null;
		const needsBalance =
			input.amountMinutes > 0 &&
			comparePlainDates(day, today) <= 0 &&
			!closedMonth &&
			(!openingBalanceDay || comparePlainDates(day, openingBalanceDay) > 0);
		const balanceAtEndOf = (balanceDay: string) =>
			computeEmployeeWorkBalanceAtEndOfDay(
				{ organizationId: input.organizationId, employee: subject, day: balanceDay },
				client,
			);
		const balanceAtEndOfDayMinutes = needsBalance ? await balanceAtEndOf(input.day) : 0;
		// The payout lowers the balance on every later day too, so it may not take
		// the balance below zero at the end of any later payout's day (#993).
		const laterPayoutBalancesMinutes: number[] = [];
		if (needsBalance && input.amountMinutes <= balanceAtEndOfDayMinutes) {
			const laterDays = new Set(
				(await listUncancelledPayouts(client, input))
					.map((payout) => payout.day)
					.filter((payoutDay) => payoutDay > input.day),
			);
			for (const laterDay of laterDays) {
				laterPayoutBalancesMinutes.push(await balanceAtEndOf(laterDay));
			}
		}
		const refused = refuseOvertimePayout({
			amountMinutes: input.amountMinutes,
			day,
			today,
			balanceAtEndOfDayMinutes,
			laterPayoutBalancesMinutes,
			openingBalanceDay,
			closedMonth,
		});
		if (refused === "month_closed" && closedMonth) throw monthClosed(closedMonth);
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
	await notifyBalanceAdjustmentChanges(database, {
		organizationId: input.organizationId,
		changes: [
			{
				event: "recorded",
				employeeId: input.employeeId,
				adjustment: {
					id: adjustmentId,
					kind: "overtime_payout",
					day: input.day,
					minutes: -input.amountMinutes,
				},
			},
		],
	});
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
	const cancelled = await inLedgerTransaction(database, async (tx) => {
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
		const closedMonth = await closedMonthOfDay(client, { ...input, day: current.day });
		if (closedMonth) throw monthClosed(closedMonth);

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
		if (current.kind === "opening_balance") {
			// The months before its day were computed as replaced (zero); only a
			// full rebuild brings back the calculation from the employee's start.
			await requestEmployeeWorkBalanceFullRebuild(input, { dbClient: client });
		} else {
			await markEmployeeWorkBalanceDirty(
				{
					employeeId: input.employeeId,
					organizationId: input.organizationId,
					dirtyFromDate: current.day,
				},
				tx,
			);
		}
		return current;
	});

	if (cancelled.kind === "opening_balance") {
		await refreshAfterCommit({ ...input, fullRebuild: true });
	} else {
		await refreshAfterCommit({ ...input, dirtyFromDate: cancelled.day });
	}
	await notifyBalanceAdjustmentChanges(database, {
		organizationId: input.organizationId,
		changes: [
			{
				event: "cancelled",
				employeeId: input.employeeId,
				adjustment: { ...cancelled, cancellationReason: reason },
			},
		],
	});
	return { adjustmentId: input.adjustmentId };
}

/**
 * Checks a single opening balance for the employee without writing anything
 * (#997): the employee is in the organization, the day is a valid local date
 * no later than today in the employee's timezone and not in a closed month,
 * no uncancelled overtime payout is dated on or before it (the refusal lists
 * them), and the reason is given. Throws a `BalanceAdjustmentRefusal`.
 *
 * The bulk upload (#999) runs it per row to report row errors; it gives the
 * authoritative answer only inside the writing transaction, which
 * `writeOpeningBalance` runs it in, under the employee's ledger lock.
 */
export async function checkOpeningBalance(
	client: WorkBalanceDbClient,
	input: {
		organizationId: string;
		employeeId: string;
		/** Local date in the employee's effective timezone. */
		day: string;
		/** Signed minutes: positive, negative or zero. */
		minutes: number;
		reason: string;
		now: Instant;
	},
): Promise<{
	day: string;
	minutes: number;
	reason: string;
	/** The opening balance in effect, which setting this one cancels. */
	replaces: OpeningBalanceInEffect | null;
}> {
	const day = parseDay(input.day);
	const reason = requireReason(input.reason);
	if (!Number.isInteger(input.minutes)) throw refusal("invalid_input", "Invalid minutes");
	const subject = await loadWorkBalanceEmployee(input, client);
	if (!subject) throw refusal("employee_not_found", "Employee not found");
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	// One after another: the client may be a transaction.
	const uncancelledPayouts = await listUncancelledPayouts(client, scope);
	const replaces = await readOpeningBalanceInEffect(client, scope);
	// Setting it cancels the one in effect, which a closed month refuses too.
	const closedMonth =
		(await closedMonthOfDay(client, { ...scope, day: input.day })) ??
		(replaces ? await closedMonthOfDay(client, { ...scope, day: replaces.day }) : null);
	const refused = refuseOpeningBalance({
		day,
		today: plainDateAt(input.now, subject.timezone),
		uncancelledPayouts,
		closedMonth,
	});
	if (refused?.code === "conflicting_payouts") {
		throw new BalanceAdjustmentRefusal(
			"conflicting_payouts",
			"Uncancelled overtime payouts are dated on or before the opening balance's day",
			{ conflictingPayouts: refused.conflictingPayouts },
		);
	}
	if (refused?.code === "month_closed") throw monthClosed(refused.closedMonth);
	if (refused) throw refusal(refused.code, `Opening balance refused: ${refused.code}`);
	return { day: input.day, minutes: input.minutes, reason, replaces };
}

/**
 * Sets the employee's opening balance inside the caller's transaction (#997,
 * ADR-0008): checks it under the employee's ledger lock, cancels the opening
 * balance in effect with the new one's reason, records the new one, audits
 * both, and requests a full rebuild of the employee's work balance (any
 * opening balance write can move where the calculation starts, earlier or
 * later). The caller refreshes the balance after the commit; see
 * `setOpeningBalance`. The bulk upload (#999) can write many rows in one
 * transaction this way, then pass every result's `changes` to
 * `notifyBalanceAdjustmentChanges` after the commit (#996).
 */
export async function writeOpeningBalance(
	tx: WorkBalanceDbClient & Pick<typeof globalDb, "update">,
	audit: AuditTrail,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		day: string;
		minutes: number;
		reason: string;
		now: Instant;
		/** Written to both audit entries, e.g. the payroll grant that authorized it (#995). */
		auditMetadata?: Record<string, unknown> | null;
	},
): Promise<OpeningBalanceWritten> {
	await lockEmployeeLedger(tx, input);
	const checked = await checkOpeningBalance(tx, input);
	const at = dateFromInstant(input.now);

	if (checked.replaces) {
		const previous = checked.replaces;
		await tx
			.update(balanceAdjustment)
			.set({ cancelledAt: at, cancelledBy: input.actorUserId, cancellationReason: checked.reason })
			.where(
				and(
					eq(balanceAdjustment.organizationId, input.organizationId),
					eq(balanceAdjustment.id, previous.id),
				),
			);
		await audit.record(tx, {
			organizationId: input.organizationId,
			targetType: "balance_adjustment",
			targetId: previous.id,
			action: AuditAction.BALANCE_ADJUSTMENT_CANCELLED,
			actorUserId: input.actorUserId,
			employeeId: input.employeeId,
			changes: {
				from: {
					kind: "opening_balance",
					day: previous.day,
					minutes: previous.minutes,
					cancelled: false,
				},
				to: { cancelled: true, reason: checked.reason },
			},
			metadata: input.auditMetadata ?? null,
		});
	}

	const [inserted] = await tx
		.insert(balanceAdjustment)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			kind: "opening_balance",
			day: checked.day,
			minutes: checked.minutes,
			reason: checked.reason,
			recordedBy: input.actorUserId,
			recordedAt: at,
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
			to: {
				kind: "opening_balance",
				day: checked.day,
				minutes: checked.minutes,
				reason: checked.reason,
				...(checked.replaces ? { replaces: checked.replaces.id } : {}),
			},
		},
		metadata: input.auditMetadata ?? null,
	});
	await requestEmployeeWorkBalanceFullRebuild(input, { dbClient: tx });
	// The employee is told about both after the commit: the replaced one as
	// cancelled with the new reason, then the new one as recorded (#996).
	const changes: BalanceAdjustmentChange[] = [];
	if (checked.replaces) {
		changes.push({
			event: "cancelled",
			employeeId: input.employeeId,
			adjustment: {
				id: checked.replaces.id,
				kind: "opening_balance",
				day: checked.replaces.day,
				minutes: checked.replaces.minutes,
				cancellationReason: checked.reason,
			},
		});
	}
	changes.push({
		event: "recorded",
		employeeId: input.employeeId,
		adjustment: {
			id: inserted.id,
			kind: "opening_balance",
			day: checked.day,
			minutes: checked.minutes,
		},
	});
	return {
		adjustmentId: inserted.id,
		cancelledAdjustmentId: checked.replaces?.id ?? null,
		changes,
	};
}

export type OpeningBalanceWritten = {
	adjustmentId: string;
	cancelledAdjustmentId: string | null;
	/** What to notify the employee of once the transaction committed (#996). */
	changes: BalanceAdjustmentChange[];
};

/**
 * Sets the employee's opening balance in its own transaction (see
 * `writeOpeningBalance`), then rebuilds the stored work balance right away, so
 * every balance view shows it, employees who have left included, and notifies
 * the employee (#996).
 */
export async function setOpeningBalance(
	database: BalanceAdjustmentDatabase,
	audit: AuditTrail,
	input: Parameters<typeof writeOpeningBalance>[2],
): Promise<{ adjustmentId: string; cancelledAdjustmentId: string | null }> {
	const { changes, ...result } = await inLedgerTransaction(database, (tx) =>
		writeOpeningBalance(tx as unknown as Parameters<typeof writeOpeningBalance>[0], audit, input),
	);
	await refreshAfterCommit({ ...input, fullRebuild: true });
	await notifyBalanceAdjustmentChanges(database, { organizationId: input.organizationId, changes });
	return result;
}

/**
 * The closed month (`YYYY-MM`, #762, Time Tracking ADR-0004) of the employee
 * that an adjustment's day lies in, or null. The day is a local date in the
 * employee's timezone, so it is matched by calendar month, as absence days
 * are; the database refuses the same (migration 0197).
 */
async function closedMonthOfDay(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeId: string; day: string },
): Promise<string | null> {
	const ranges = await closedRangesForEmployee(client, input);
	return closedMonthTouchedByDays(
		{ startDate: input.day, endDate: input.day },
		ranges.map((range) => range.month),
	);
}

/**
 * Serializes the ledger writes of one employee. It first takes the
 * organization configuration guard shared, as absence writers do: a close or
 * reopening in flight finishes before the closed-month check, and none starts
 * until this write commits (ADR-0004).
 */
async function lockEmployeeLedger(
	client: Pick<WorkBalanceDbClient, "execute">,
	input: { organizationId: string; employeeId: string },
) {
	await acquireOrganizationConfigurationGuard(client, input.organizationId);
	const lockKey = `balance-adjustment:${input.organizationId}:${input.employeeId}`;
	await client.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

/**
 * Runs a ledger write in its own transaction. The database's closed-month
 * refusal (SQLSTATE Z8M01), should a write get past the store's own check,
 * comes back as the same typed refusal.
 */
async function inLedgerTransaction<T>(
	database: BalanceAdjustmentDatabase,
	write: (tx: Parameters<Parameters<BalanceAdjustmentDatabase["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
	try {
		return await database.transaction(write);
	} catch (error) {
		throw asMonthClosedRefusal(error);
	}
}

/** A month-closed refusal of the database as the typed refusal; any other error unchanged. */
export function asMonthClosedRefusal(error: unknown): unknown {
	if (error instanceof BalanceAdjustmentRefusal) return error;
	const closed = monthClosedRefusalOf(error);
	return closed ? monthClosed(closed.month) : error;
}

function monthClosed(closedMonth: string) {
	return new BalanceAdjustmentRefusal("month_closed", `${closedMonth} is closed`, { closedMonth });
}

/**
 * Brings the stored balance up to date once the adjustment committed. A failure
 * leaves the dirty mark for the balance worker; the adjustment stands. The
 * bulk opening balance upload (#999) calls it per written employee.
 */
export async function refreshAfterCommit(
	input: { organizationId: string; employeeId: string } & (
		| { dirtyFromDate: string }
		| { fullRebuild: true }
	),
) {
	try {
		await refreshEmployeeWorkBalanceFromPeriods({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			...("fullRebuild" in input
				? { forceFullRebuild: true }
				: { dirtyFromDate: input.dirtyFromDate }),
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
