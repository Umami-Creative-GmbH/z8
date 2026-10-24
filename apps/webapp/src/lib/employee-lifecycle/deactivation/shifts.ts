import "server-only";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { member, user } from "@/db/auth-schema";
import { employee, shift } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { compareInstants, dateFromInstant } from "@/lib/datetime/temporal-core";
import { currentRosterManagerRecipients } from "@/lib/notifications/manager-notice-recipients";
import { onDeactivationShiftsOpened } from "@/lib/notifications/triggers";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { memberIsAccessibleOwnerOrAdmin } from "../authority-sql";
import {
	type AreaApplyResult,
	type DeactivationAfterCommit,
	type DeactivationApplyContext,
	type DeactivationPlanContext,
	type DeactivationReader,
	type DeactivationWriter,
	deactivationAuditMetadata,
	type ShiftsApplied,
	type ShiftsPlan,
} from "./types";

/**
 * Shifts at a deactivation (#1440, D7). Every shift of the person that starts
 * after the instant (drafts too) is unassigned and stays as an open shift;
 * past shifts and one already running stay assigned. The start is the shift's
 * wall-clock time in the organization's zone, not its stored day. The
 * planners hear about it once: the person's current managers, captured in the
 * plan before the manager links end, or the organization's owners and admins
 * when the person had no current manager.
 */

/** No zone is more than a day from UTC, so a shift starting after `at` is stored after this. */
const STORED_DATE_LOOKBACK_HOURS = 48;

/** Reads only; the apply runs the same plan inside the deactivation transaction. */
export async function planShiftsToOpen(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<ShiftsPlan> {
	const rows = await reader
		.select({
			shiftId: shift.id,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
		})
		.from(shift)
		.where(
			and(
				eq(shift.organizationId, ctx.organizationId),
				eq(shift.employeeId, ctx.employeeId),
				gte(shift.date, dateFromInstant(ctx.at.subtract({ hours: STORED_DATE_LOOKBACK_HOURS }))),
			),
		)
		.orderBy(asc(shift.date), asc(shift.startTime), asc(shift.id));
	const shiftsToOpen = rows.flatMap((row) => {
		const date = shiftCalendarDate(row.date, ctx.organizationTimeZone);
		const { start } = shiftInterval(
			{ date, startTime: row.startTime, endTime: row.endTime },
			ctx.organizationTimeZone,
		);
		return compareInstants(start, ctx.at) > 0
			? [
					{
						shiftId: row.shiftId,
						date: date.toString(),
						startTime: row.startTime,
						endTime: row.endTime,
					},
				]
			: [];
	});
	const plannerRecipientUserIds =
		shiftsToOpen.length === 0 ? [] : await plannerRecipients(reader, ctx);
	return { shiftsToOpen, plannerRecipientUserIds };
}

/** The person's current managers, else the organization's accessible owners and admins. */
async function plannerRecipients(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<string[]> {
	const [person] = await reader
		.select({ userId: employee.userId })
		.from(employee)
		.where(and(eq(employee.id, ctx.employeeId), eq(employee.organizationId, ctx.organizationId)))
		.limit(1);
	const excludeUserIds = person ? [person.userId] : [];
	const managers = await currentRosterManagerRecipients(reader, {
		organizationId: ctx.organizationId,
		employeeIds: [ctx.employeeId],
		notice: "actionable",
		excludeUserIds,
		now: ctx.at,
	});
	if (managers.reason !== "none") return managers.userIds;

	// The alias `m` is what `memberIsAccessibleOwnerOrAdmin` reads.
	const m = alias(member, "m");
	const admins = await reader
		.select({ userId: m.userId, email: user.email })
		.from(m)
		.innerJoin(user, eq(user.id, m.userId))
		.where(
			and(
				eq(m.organizationId, ctx.organizationId),
				memberIsAccessibleOwnerOrAdmin(sql`${dateFromInstant(ctx.at)}::timestamptz`),
			),
		);
	return [
		...new Set(
			admins
				.filter((row) => !excludeUserIds.includes(row.userId) && !isReservedEmail(row.email))
				.map((row) => row.userId),
		),
	].toSorted();
}

/**
 * Unassigns exactly the shifts the plan lists that are still the person's,
 * inside the deactivation transaction, and audits each under the acting
 * admin. The planner notice is an after-commit step; it is keyed by the
 * deactivation, so running it again sends nothing new.
 */
export async function applyShiftsToOpen(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
	plan: ShiftsPlan,
): Promise<AreaApplyResult<ShiftsApplied>> {
	if (plan.shiftsToOpen.length === 0) return { applied: { openedShiftIds: [] }, afterCommit: [] };
	const opened = await tx
		.update(shift)
		.set({ employeeId: null, updatedAt: currentTimestamp() })
		.where(
			and(
				eq(shift.organizationId, ctx.organizationId),
				eq(shift.employeeId, ctx.employeeId),
				inArray(
					shift.id,
					plan.shiftsToOpen.map((item) => item.shiftId),
				),
			),
		)
		.returning({ id: shift.id });
	const openedIds = new Set(opened.map((row) => row.id));
	const openedShiftIds: string[] = [];
	for (const item of plan.shiftsToOpen) {
		if (!openedIds.has(item.shiftId)) continue;
		openedShiftIds.push(item.shiftId);
		await ctx.audit.record(tx, {
			organizationId: ctx.organizationId,
			action: AuditAction.SHIFT_UNASSIGNED,
			actorUserId: ctx.actorUserId,
			targetType: "shift",
			targetId: item.shiftId,
			employeeId: ctx.employeeId,
			metadata: {
				...deactivationAuditMetadata(ctx),
				date: item.date,
				startTime: item.startTime,
				endTime: item.endTime,
			},
		});
	}
	const notice = await loadPlannerNotice(tx, ctx, {
		openedShiftIds,
		recipientUserIds: plan.plannerRecipientUserIds,
	});
	return {
		applied: { openedShiftIds },
		afterCommit: notice ? [sendPlannerNotice(ctx.organizationId, ctx.deactivationId, notice)] : [],
	};
}

/** The planners' notice of a deactivation, as its ledger stores it for a replay. */
export type DeactivationPlannerNotice = {
	employeeName: string;
	shiftCount: number;
	recipientUserIds: string[];
};

/** The notice about the opened shifts, or null when none opened or nobody is told. */
export async function loadPlannerNotice(
	reader: Pick<DeactivationReader, "select">,
	ctx: Pick<DeactivationPlanContext, "organizationId" | "employeeId">,
	input: { openedShiftIds: readonly string[]; recipientUserIds: readonly string[] },
): Promise<DeactivationPlannerNotice | null> {
	if (input.openedShiftIds.length === 0 || input.recipientUserIds.length === 0) return null;
	const [person] = await reader
		.select({ name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.id, ctx.employeeId), eq(employee.organizationId, ctx.organizationId)))
		.limit(1);
	return {
		employeeName: person?.name ?? "",
		shiftCount: input.openedShiftIds.length,
		recipientUserIds: [...input.recipientUserIds],
	};
}

/** Sends the notice after the commit; keyed by the deactivation, so a repeat sends nothing new. */
export function sendPlannerNotice(
	organizationId: string,
	deactivationId: string,
	notice: DeactivationPlannerNotice,
): DeactivationAfterCommit {
	return () => onDeactivationShiftsOpened({ organizationId, deactivationId, ...notice });
}
