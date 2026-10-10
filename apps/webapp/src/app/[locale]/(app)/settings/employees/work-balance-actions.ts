"use server";

import { revalidatePath } from "next/cache";
import { withAuditTrail } from "@/lib/audit-trail";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import { isUuid } from "@/lib/validations/uuid";
import {
	balanceAdjustmentAuditMetadata,
	requireBalanceAdjustmentWriter,
} from "@/lib/work-balance/adjustments/authorization";
import { openingBalanceMinutes, payoutMinutes } from "@/lib/work-balance/adjustments/rules";
import {
	cancelBalanceAdjustment,
	listBalanceAdjustments,
	recordOvertimePayout,
	setOpeningBalance,
} from "@/lib/work-balance/adjustments/store";
import {
	type BalanceAdjustmentActionResult,
	BalanceAdjustmentRefusal,
	type BalanceAdjustmentView,
} from "@/lib/work-balance/adjustments/types";
import { getEmployeeWorkBalance, loadWorkBalanceEmployee } from "@/lib/work-balance/service";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

/**
 * The Work balance section of an employee's settings page (#993): the current
 * work balance, the history of balance adjustments, and recording and
 * cancelling overtime payouts. Authorization: `requireBalanceAdjustmentWriter`
 * (owners and admins; payroll grant holders for the employees their grant
 * covers, #995). The payroll area's Work balances page uses them too.
 */

export type EmployeeWorkBalanceSectionData = {
	balance: EmployeeWorkBalancePayload | null;
	adjustments: BalanceAdjustmentView[];
	/** Today in the employee's effective timezone; adjustments may not be dated later. */
	today: string;
	timezone: string;
};

export type RecordOvertimePayoutInput = {
	employeeId: string;
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: string;
	hours: number;
	minutes: number;
	reason: string;
};

export type SetOpeningBalanceInput = {
	employeeId: string;
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: string;
	/** True for a negative opening balance. */
	negative: boolean;
	hours: number;
	minutes: number;
	reason: string;
};

export type CancelBalanceAdjustmentInput = {
	employeeId: string;
	adjustmentId: string;
	reason: string;
};

export async function getEmployeeWorkBalanceSectionAction(input: {
	employeeId: string;
}): Promise<BalanceAdjustmentActionResult<EmployeeWorkBalanceSectionData>> {
	return runRefusalAction("balanceAdjustments.section", BalanceAdjustmentRefusal, async (db) => {
		const { organizationId } = await requireWriterFor(input?.employeeId);
		const employeeId = parseUuid(input?.employeeId);
		const subject = await loadWorkBalanceEmployee({ employeeId, organizationId }, db);
		if (!subject) throw new BalanceAdjustmentRefusal("employee_not_found", "Employee not found");
		const [balance, adjustments] = await Promise.all([
			getEmployeeWorkBalance({ employeeId, organizationId }),
			listBalanceAdjustments(db, { organizationId, employeeId }),
		]);
		return {
			balance,
			adjustments,
			today: plainDateAt(systemClock.nowInstant(), subject.timezone).toString(),
			timezone: subject.timezone,
		};
	});
}

export async function recordOvertimePayoutAction(
	input: RecordOvertimePayoutInput,
): Promise<BalanceAdjustmentActionResult<{ adjustmentId: string }>> {
	return runRefusalAction(
		"balanceAdjustments.recordPayout",
		BalanceAdjustmentRefusal,
		async (db) => {
			const { organizationId, userId, authority } = await requireWriterFor(input?.employeeId);
			const employeeId = parseUuid(input?.employeeId);
			const amountMinutes = payoutMinutes({
				hours: Number(input?.hours),
				minutes: Number(input?.minutes),
			});
			if (amountMinutes === null) {
				throw new BalanceAdjustmentRefusal("invalid_input", "Invalid hours or minutes");
			}
			const result = await withAuditTrail((audit) =>
				recordOvertimePayout(db, audit, {
					organizationId,
					actorUserId: userId,
					employeeId,
					day: input.day,
					amountMinutes,
					reason: input.reason,
					now: systemClock.nowInstant(),
					auditMetadata: balanceAdjustmentAuditMetadata(authority),
				}),
			);
			revalidateEmployeePaths(employeeId);
			return result;
		},
	);
}

/**
 * Sets the employee's opening balance (#997), cancelling the one in effect with
 * this one's reason. A refusal for payouts dated on or before its day lists them.
 */
export async function setOpeningBalanceAction(
	input: SetOpeningBalanceInput,
): Promise<
	BalanceAdjustmentActionResult<{ adjustmentId: string; cancelledAdjustmentId: string | null }>
> {
	let refusal: BalanceAdjustmentRefusal | null = null;
	const result = await runRefusalAction(
		"balanceAdjustments.setOpeningBalance",
		BalanceAdjustmentRefusal,
		async (db) => {
			try {
				const { organizationId, userId, authority } = await requireWriterFor(input?.employeeId);
				const employeeId = parseUuid(input?.employeeId);
				const minutes = openingBalanceMinutes({
					negative: input?.negative === true,
					hours: Number(input?.hours),
					minutes: Number(input?.minutes),
				});
				if (minutes === null) {
					throw new BalanceAdjustmentRefusal("invalid_input", "Invalid hours or minutes");
				}
				const written = await withAuditTrail((audit) =>
					setOpeningBalance(db, audit, {
						organizationId,
						actorUserId: userId,
						employeeId,
						day: input.day,
						minutes,
						reason: input.reason,
						now: systemClock.nowInstant(),
						auditMetadata: balanceAdjustmentAuditMetadata(authority),
					}),
				);
				revalidateEmployeePaths(employeeId);
				return written;
			} catch (error) {
				if (error instanceof BalanceAdjustmentRefusal) refusal = error;
				throw error;
			}
		},
	);
	const conflictingPayouts = (refusal as BalanceAdjustmentRefusal | null)?.conflictingPayouts;
	if (!result.success && conflictingPayouts) return { ...result, conflictingPayouts };
	return result;
}

export async function cancelBalanceAdjustmentAction(
	input: CancelBalanceAdjustmentInput,
): Promise<BalanceAdjustmentActionResult<{ adjustmentId: string }>> {
	return runRefusalAction("balanceAdjustments.cancel", BalanceAdjustmentRefusal, async (db) => {
		const { organizationId, userId, authority } = await requireWriterFor(input?.employeeId);
		const employeeId = parseUuid(input?.employeeId);
		const adjustmentId = parseUuid(input?.adjustmentId);
		const result = await withAuditTrail((audit) =>
			cancelBalanceAdjustment(db, audit, {
				organizationId,
				actorUserId: userId,
				employeeId,
				adjustmentId,
				reason: input.reason,
				now: systemClock.nowInstant(),
				auditMetadata: balanceAdjustmentAuditMetadata(authority),
			}),
		);
		revalidateEmployeePaths(employeeId);
		return result;
	});
}

/**
 * Authorizes the actor for the employee. An id that is not a UUID is checked
 * without a target, so only owners and admins learn that it is invalid.
 */
function requireWriterFor(employeeId: unknown) {
	return requireBalanceAdjustmentWriter(isUuid(employeeId) ? { employeeId } : undefined);
}

function revalidateEmployeePaths(employeeId: string) {
	revalidatePath(`/settings/employees/${employeeId}`);
	revalidatePath(`/payroll/work-balances/${employeeId}`);
	revalidatePath("/team");
}

function parseUuid(value: unknown): string {
	if (!isUuid(value)) throw new BalanceAdjustmentRefusal("invalid_input", "Invalid selection.");
	return value;
}
