"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import {
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
} from "@/lib/notifications/triggers";
import { logger } from "./shared";

async function getApprovalNotificationParticipants(employeeId: string, managerId: string) {
	const [employeeData, managerData] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.id, employeeId),
			with: { user: { columns: { id: true, name: true } } },
		}),
		db.query.employee.findFirst({
			where: eq(employee.id, managerId),
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
	const { employeeUserId, employeeName, managerUserId } = await getApprovalNotificationParticipants(
		params.employeeId,
		params.managerId,
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

	return { employeeName };
}

export async function createClockOutApprovalRequest(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
}): Promise<void> {
	try {
		await db.insert(approvalRequest).values({
			organizationId: params.organizationId,
			entityType: "time_entry",
			entityId: params.workPeriodId,
			requestedBy: params.employeeId,
			approverId: params.managerId,
			status: "pending",
			reason: "Clock-out requires approval (0-day policy)",
		});

		await sendPendingApprovalNotifications({
			...params,
			employeeLogMessage: "Failed to send clock-out pending notification to employee",
			managerLogMessage: "Failed to send clock-out pending notification to manager",
		});

		logger.info(
			{
				workPeriodId: params.workPeriodId,
				employeeId: params.employeeId,
				managerId: params.managerId,
				durationMinutes: params.durationMinutes,
			},
			"Clock-out approval request created",
		);
	} catch (error) {
		logger.error(
			{ error, workPeriodId: params.workPeriodId },
			"Failed to create clock-out approval request",
		);
	}
}

export async function createManualEntryApprovalRequest(params: {
	workPeriodId: string;
	employeeId: string;
	managerId: string;
	organizationId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	reason: string;
}): Promise<void> {
	try {
		await db.insert(approvalRequest).values({
			organizationId: params.organizationId,
			entityType: "time_entry",
			entityId: params.workPeriodId,
			requestedBy: params.employeeId,
			approverId: params.managerId,
			status: "pending",
			reason: `Manual time entry: ${params.reason}`,
		});

		await sendPendingApprovalNotifications({
			...params,
			employeeLogMessage: "Failed to send manual entry pending notification to employee",
			managerLogMessage: "Failed to send manual entry pending notification to manager",
		});

		logger.info(
			{
				workPeriodId: params.workPeriodId,
				employeeId: params.employeeId,
				managerId: params.managerId,
				durationMinutes: params.durationMinutes,
			},
			"Manual entry approval request created",
		);
	} catch (error) {
		logger.error(
			{ error, workPeriodId: params.workPeriodId },
			"Failed to create manual entry approval request",
		);
	}
}
