"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import type { ApprovalPolicyOvertimeRisk } from "@/lib/approvals/policies/types";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import {
	onClockOutPendingApproval,
	onClockOutPendingApprovalToManager,
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

	return { employeeName };
}

const approvalDbService = {
	db,
	query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
} satisfies ApprovalDbService;

type ApprovalRequestOptions = {
	dbService?: ApprovalDbService;
	notify?: boolean;
};

async function createDefaultTimeEntryApprovalRequest(
	params: {
		workPeriodId: string;
		employeeId: string;
		managerId: string;
		organizationId: string;
		reason: string;
		requestKind: "manual_time_submission" | "policy_clock_out";
	},
	dbService: ApprovalDbService,
) {
	await dbService.db.insert(approvalRequest).values({
		organizationId: params.organizationId,
		entityType: "time_entry",
		entityId: params.workPeriodId,
		requestedBy: params.employeeId,
		approverId: params.managerId,
		status: "pending",
		reason: params.reason,
		metadata: { timeRequest: { kind: params.requestKind } },
	});
}

export async function createTimeEntryApprovalRequest(
	params: {
		workPeriodId: string;
		employeeId: string;
		managerId: string;
		organizationId: string;
		reason: string;
		requestKind: "manual_time_submission" | "policy_clock_out";
		overtimeRisk: ApprovalPolicyOvertimeRisk;
	},
	options?: ApprovalRequestOptions,
) {
	const requestDbService = options?.dbService ?? approvalDbService;
	const requester = await requestDbService.db.query.employee.findFirst({
		where: and(
			eq(employee.id, params.employeeId),
			eq(employee.organizationId, params.organizationId),
		),
		columns: { teamId: true, organizationId: true },
	});

	try {
		await Effect.runPromise(
			resolvePolicyAndCreateApproval(requestDbService, {
				context: {
					organizationId: params.organizationId,
					approvalType: "time_entry",
					requesterEmployeeId: params.employeeId,
					teamId:
						requester?.organizationId === params.organizationId
							? (requester.teamId ?? null)
							: null,
					locationId: null,
					absenceCategoryId: null,
					travelExpenseAmount: null,
					overtimeRisk: params.overtimeRisk,
					employeeGroupIds: [],
					entityType: "time_entry",
					entityId: params.workPeriodId,
				},
				defaultApproverId: params.managerId,
				reason: params.reason,
				metadata: { timeRequest: { kind: params.requestKind } },
			}),
		);
	} catch (error) {
		logger.error(
			{ error, workPeriodId: params.workPeriodId },
			"Failed to resolve time-entry approval policy; using manager fallback",
		);
		await createDefaultTimeEntryApprovalRequest(params, requestDbService);
	}
}

export async function createClockOutApprovalRequest(
	params: {
		workPeriodId: string;
		employeeId: string;
		managerId: string;
		organizationId: string;
		startTime: Date;
		endTime: Date;
		durationMinutes: number;
	},
	options?: ApprovalRequestOptions,
): Promise<void> {
	try {
		await createTimeEntryApprovalRequest(
			{
				...params,
				reason: "Clock-out requires approval (0-day policy)",
				requestKind: "policy_clock_out",
				overtimeRisk: "warning",
			},
			options,
		);

		if (options?.notify !== false) {
			await sendClockOutApprovalNotifications(params);
		}

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
		throw error;
	}
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

export async function createManualEntryApprovalRequest(
	params: {
		workPeriodId: string;
		employeeId: string;
		managerId: string;
		organizationId: string;
		startTime: Date;
		endTime: Date;
		durationMinutes: number;
		reason: string;
	},
	options?: ApprovalRequestOptions,
): Promise<void> {
	try {
		await createTimeEntryApprovalRequest(
			{
				...params,
				reason: `Manual time entry: ${params.reason}`,
				requestKind: "manual_time_submission",
				overtimeRisk: "none",
			},
			options,
		);

		if (options?.notify !== false) {
			await sendManualEntryApprovalNotifications(params);
		}

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
		throw error;
	}
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
