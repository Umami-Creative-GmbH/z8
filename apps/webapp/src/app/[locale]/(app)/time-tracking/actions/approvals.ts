import "server-only";

// Approval notification senders for callers that have already authorized the
// submission (#443): not server actions, so a client cannot trigger them.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employee, timeEntry, workPeriod } from "@/db/schema";
import { type WorkPeriodEntryTimes, workPeriodEntryTimesOf } from "@/lib/notifications/entry-times";
import {
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
	onManualEntryApproved,
} from "@/lib/notifications/triggers";

/**
 * The period's clock-in and clock-out, each at the UTC offset stored on its own time
 * entry (timekeeping rule), for the notification text; null when they cannot be read.
 */
async function loadWorkPeriodEntryTimes(params: {
	workPeriodId: string;
	employeeId: string;
	organizationId: string;
}): Promise<WorkPeriodEntryTimes | null> {
	const period = await db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.id, params.workPeriodId),
			eq(workPeriod.organizationId, params.organizationId),
			eq(workPeriod.employeeId, params.employeeId),
		),
		columns: { clockInId: true, clockOutId: true },
	});
	if (!period) return null;
	const ids = [period.clockInId, period.clockOutId].filter((id): id is string => Boolean(id));
	const entries = await db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, params.organizationId),
			eq(timeEntry.employeeId, params.employeeId),
			inArray(timeEntry.id, ids),
		),
		columns: { id: true, timestamp: true, utcOffsetMinutes: true },
	});
	const entryFor = (id: string | null) =>
		id ? entries.find((candidate) => candidate.id === id) : undefined;
	const clockIn = entryFor(period.clockInId);
	return clockIn ? workPeriodEntryTimesOf(clockIn, entryFor(period.clockOutId)) : null;
}

async function getApprovalNotificationParticipants(
	employeeId: string,
	managerId: string,
	organizationId: string,
) {
	const [employeeData, managerData] = await Promise.all([
		db.query.employee.findFirst({
			where: and(
				eq(employee.id, employeeId),
				eq(employee.organizationId, organizationId),
			),
			with: { user: { columns: { id: true, name: true } } },
		}),
		db.query.employee.findFirst({
			where: and(
				eq(employee.id, managerId),
				eq(employee.organizationId, organizationId),
			),
			columns: { userId: true },
		}),
	]);

	return {
		employeeUserId: employeeData?.userId,
		employeeName: employeeData?.user?.name || "Employee",
		managerUserId: managerData?.userId,
	};
}

async function sendPendingApprovalNotifications(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	dedupeKey: string;
}) {
	const [{ employeeUserId, employeeName, managerUserId }, times] = await Promise.all([
		getApprovalNotificationParticipants(params.employeeId, params.managerId, params.organizationId),
		loadWorkPeriodEntryTimes(params),
	]);

	const notifications: Promise<void>[] = [];
	if (employeeUserId) {
		notifications.push(
			onClockOutPendingApproval({
				workPeriodId: params.workPeriodId,
				employeeUserId,
				employeeName,
				organizationId: params.organizationId,
				times,
				durationMinutes: params.durationMinutes,
				idempotencyKey: `${params.dedupeKey}:employee:pending`,
				durable: true,
			}),
		);
	}

	if (managerUserId) {
		notifications.push(
			onClockOutPendingApprovalToManager({
				workPeriodId: params.workPeriodId,
				employeeUserId: employeeUserId || "",
				employeeName,
				organizationId: params.organizationId,
				times,
				durationMinutes: params.durationMinutes,
				managerUserId,
				idempotencyKey: `${params.dedupeKey}:manager:pending`,
				durable: true,
			}),
		);
	}
	const settled = await Promise.allSettled(notifications);
	const rejected = settled.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (rejected) throw rejected.reason;

	return { employeeUserId, employeeName };
}

export async function sendManualEntryApprovalNotifications(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	dedupeKey: string;
}) {
	await sendPendingApprovalNotifications({
		...params,
	});
}

export async function sendManualEntryApprovedNotification(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	dedupeKey: string;
}) {
	const { employeeUserId, employeeName } =
		await getApprovalNotificationParticipants(
			params.employeeId,
			params.managerId,
			params.organizationId,
		);
	if (!employeeUserId) return;

	await onManualEntryApproved({
		workPeriodId: params.workPeriodId,
		employeeUserId,
		organizationId: params.organizationId,
		approverName: employeeName,
		startTime: params.startTime,
		endTime: params.endTime,
		idempotencyKey: `${params.dedupeKey}:employee:approved`,
		durable: true,
	});
}
