"use server";

import { z } from "zod";
import { withAuditTrail } from "@/lib/audit-trail";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { refusalStep } from "@/lib/organization-action/action-refusal";
import {
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import {
	type BalanceAdjustmentCaller,
	balanceAdjustmentAuditMetadata,
	balanceAdjustmentViewerAccess,
	balanceAdjustmentWriterAuthority,
} from "@/lib/work-balance/adjustments/authorization";
import { openingBalanceMinutes, payoutMinutes } from "@/lib/work-balance/adjustments/rules";
import {
	cancelBalanceAdjustment,
	listBalanceAdjustments,
	recordOvertimePayout,
	setOpeningBalance,
} from "@/lib/work-balance/adjustments/store";
import {
	BalanceAdjustmentRefusal,
	type BalanceAdjustmentView,
} from "@/lib/work-balance/adjustments/types";
import { getEmployeeWorkBalance, loadWorkBalanceEmployee } from "@/lib/work-balance/service";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { revalidateWorkBalancePaths } from "./work-balance-paths";

/**
 * The Work balance section of an employee's settings page (#993): the current
 * work balance, the history of balance adjustments, and recording and
 * cancelling overtime payouts. Any org member reaches the actions (#1613);
 * who may do what is the balance adjustment authority: writes for owners and
 * admins, and payroll grant holders for the employees their grant covers
 * (#995); reads also for the employee themself and their managers, read-only
 * (#996). The payroll area's Work balances page uses them too.
 */

export type EmployeeWorkBalanceSectionData = {
	balance: EmployeeWorkBalancePayload | null;
	adjustments: BalanceAdjustmentView[];
	/** Today in the employee's effective timezone; adjustments may not be dated later. */
	today: string;
	timezone: string;
	/** Whether the viewer may record and cancel adjustments; employees and managers only see them (#996). */
	canManage: boolean;
};

const employeeId = z.uuid("Invalid selection.");

const sectionSchema = z.strictObject({ employeeId });

const recordOvertimePayoutSchema = z.strictObject({
	employeeId,
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: z.string(),
	hours: z.number(),
	minutes: z.number(),
	reason: z.string(),
});

const setOpeningBalanceSchema = z.strictObject({
	employeeId,
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: z.string(),
	/** True for a negative opening balance. */
	negative: z.boolean(),
	hours: z.number(),
	minutes: z.number(),
	reason: z.string(),
});

const cancelBalanceAdjustmentSchema = z.strictObject({
	employeeId,
	adjustmentId: z.uuid("Invalid selection."),
	reason: z.string(),
});

export type RecordOvertimePayoutInput = z.input<typeof recordOvertimePayoutSchema>;
export type SetOpeningBalanceInput = z.input<typeof setOpeningBalanceSchema>;
export type CancelBalanceAdjustmentInput = z.input<typeof cancelBalanceAdjustmentSchema>;

function callerOf(actor: OrganizationActor, organizationId: string): BalanceAdjustmentCaller {
	return {
		organizationId,
		userId: actor.userId,
		isOrgAdmin: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
	};
}

export const getEmployeeWorkBalanceSectionAction = organizationAction(
	{ name: "balanceAdjustments.section", requires: "member", schema: sectionSchema },
	({ actor, organizationId, input }) =>
		refusalStep(
			"balanceAdjustments.section",
			BalanceAdjustmentRefusal,
			async (db): Promise<EmployeeWorkBalanceSectionData> => {
				const { canManage } = await balanceAdjustmentViewerAccess(
					db,
					callerOf(actor, organizationId),
					{ employeeId: input.employeeId },
				);
				const scope = { employeeId: input.employeeId, organizationId };
				const subject = await loadWorkBalanceEmployee(scope, db);
				if (!subject) {
					throw new BalanceAdjustmentRefusal("employee_not_found", "Employee not found");
				}
				const [balance, adjustments] = await Promise.all([
					getEmployeeWorkBalance(scope, db),
					listBalanceAdjustments(db, scope),
				]);
				return {
					balance,
					adjustments,
					today: plainDateAt(systemClock.nowInstant(), subject.timezone).toString(),
					timezone: subject.timezone,
					canManage,
				};
			},
		),
);

export const recordOvertimePayoutAction = organizationAction(
	{
		name: "balanceAdjustments.recordPayout",
		requires: "member",
		schema: recordOvertimePayoutSchema,
	},
	({ actor, organizationId, input }) =>
		refusalStep("balanceAdjustments.recordPayout", BalanceAdjustmentRefusal, async (db) => {
			const authority = await balanceAdjustmentWriterAuthority(
				db,
				callerOf(actor, organizationId),
				{ employeeId: input.employeeId },
			);
			const amountMinutes = payoutMinutes({ hours: input.hours, minutes: input.minutes });
			if (amountMinutes === null) {
				throw new BalanceAdjustmentRefusal("invalid_input", "Invalid hours or minutes");
			}
			const result = await withAuditTrail((audit) =>
				recordOvertimePayout(db, audit, {
					organizationId,
					actorUserId: actor.userId,
					employeeId: input.employeeId,
					day: input.day,
					amountMinutes,
					reason: input.reason,
					now: systemClock.nowInstant(),
					auditMetadata: balanceAdjustmentAuditMetadata(authority),
				}),
			);
			revalidateWorkBalancePaths([input.employeeId]);
			return result;
		}),
);

/**
 * Sets the employee's opening balance (#997), cancelling the one in effect with
 * this one's reason. A refusal for payouts dated on or before its day lists them.
 */
export const setOpeningBalanceAction = organizationAction(
	{
		name: "balanceAdjustments.setOpeningBalance",
		requires: "member",
		schema: setOpeningBalanceSchema,
	},
	({ actor, organizationId, input }) =>
		refusalStep("balanceAdjustments.setOpeningBalance", BalanceAdjustmentRefusal, async (db) => {
			const authority = await balanceAdjustmentWriterAuthority(
				db,
				callerOf(actor, organizationId),
				{ employeeId: input.employeeId },
			);
			const minutes = openingBalanceMinutes({
				negative: input.negative,
				hours: input.hours,
				minutes: input.minutes,
			});
			if (minutes === null) {
				throw new BalanceAdjustmentRefusal("invalid_input", "Invalid hours or minutes");
			}
			const written = await withAuditTrail((audit) =>
				setOpeningBalance(db, audit, {
					organizationId,
					actorUserId: actor.userId,
					employeeId: input.employeeId,
					day: input.day,
					minutes,
					reason: input.reason,
					now: systemClock.nowInstant(),
					auditMetadata: balanceAdjustmentAuditMetadata(authority),
				}),
			);
			revalidateWorkBalancePaths([input.employeeId]);
			return written;
		}),
);

export const cancelBalanceAdjustmentAction = organizationAction(
	{
		name: "balanceAdjustments.cancel",
		requires: "member",
		schema: cancelBalanceAdjustmentSchema,
	},
	({ actor, organizationId, input }) =>
		refusalStep("balanceAdjustments.cancel", BalanceAdjustmentRefusal, async (db) => {
			const authority = await balanceAdjustmentWriterAuthority(
				db,
				callerOf(actor, organizationId),
				{ employeeId: input.employeeId },
			);
			const result = await withAuditTrail((audit) =>
				cancelBalanceAdjustment(db, audit, {
					organizationId,
					actorUserId: actor.userId,
					employeeId: input.employeeId,
					adjustmentId: input.adjustmentId,
					reason: input.reason,
					now: systemClock.nowInstant(),
					auditMetadata: balanceAdjustmentAuditMetadata(authority),
				}),
			);
			revalidateWorkBalancePaths([input.employeeId]);
			return result;
		}),
);
