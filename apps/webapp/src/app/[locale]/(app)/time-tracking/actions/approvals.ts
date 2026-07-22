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
import { logger } from "./shared";

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
	employeeLogMessage: string;
	managerLogMessage: string;
}) {
	const { employeeUserId, employeeName, managerUserId } =
		await getApprovalNotificationParticipants(
			params.employeeId,
			params.managerId,
			params.organizationId,
		);

	if (employeeUserId) {
		void onClockOutPendingApproval({
			workPeriodId: params.workPeriodId,
			employeeUserId,
			employeeName,
			organizationId: params.organizationId,
			startTime: params.startTime,
			endTime: params.endTime,
			durationMinutes: params.durationMinutes,
		}).catch((error) => {
			logger.error({ error }, params.employeeLogMessage);
		});
	}

	if (managerUserId) {
		void onClockOutPendingApprovalToManager({
			workPeriodId: params.workPeriodId,
			employeeUserId: employeeUserId || "",
			employeeName,
			organizationId: params.organizationId,
			startTime: params.startTime,
			endTime: params.endTime,
			durationMinutes: params.durationMinutes,
			managerUserId,
		}).catch((error) => {
			logger.error({ error }, params.managerLogMessage);
		});
	}

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
}) {
	await sendPendingApprovalNotifications({
		...params,
		employeeLogMessage:
			"Failed to send clock-out pending notification to employee",
		managerLogMessage:
			"Failed to send clock-out pending notification to manager",
	});
}

export async function sendClockOutApprovedNotification(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
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
}) {
	await sendPendingApprovalNotifications({
		...params,
		employeeLogMessage:
			"Failed to send manual entry pending notification to employee",
		managerLogMessage:
			"Failed to send manual entry pending notification to manager",
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
	});
}
