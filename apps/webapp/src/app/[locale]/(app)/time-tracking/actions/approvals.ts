"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import {
	onClockOutApproved,
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
	onManualEntryApproved,
} from "@/lib/notifications/triggers";

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
	const { employeeUserId, employeeName, managerUserId } =
		await getApprovalNotificationParticipants(
			params.employeeId,
			params.managerId,
			params.organizationId,
		);

	const notifications: Promise<void>[] = [];
	if (employeeUserId) {
		notifications.push(
			onClockOutPendingApproval({
				workPeriodId: params.workPeriodId,
				employeeUserId,
				employeeName,
				organizationId: params.organizationId,
				startTime: params.startTime,
				endTime: params.endTime,
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
				startTime: params.startTime,
				endTime: params.endTime,
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

export async function sendClockOutApprovalNotifications(params: {
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

export async function sendClockOutApprovedNotification(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	dedupeKey: string;
}) {
	const { employeeUserId, employeeName } =
		await getApprovalNotificationParticipants(
			params.employeeId,
			params.managerId,
			params.organizationId,
		);
	if (!employeeUserId) return;

	await onClockOutApproved({
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
