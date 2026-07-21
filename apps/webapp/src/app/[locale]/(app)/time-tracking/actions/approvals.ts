"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import type { ResolvePolicyAndCreateApprovalResult } from "@/lib/approvals/policies/chain-service";
import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import type { ApprovalPolicyOvertimeRisk } from "@/lib/approvals/policies/types";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { ValidationError } from "@/lib/effect/errors";
import type { OrdinaryTimeApprovalKind } from "@/lib/approvals/server/work-period-approvals";
import {
	finalizeAutoCompletedWorkPeriodApprovalEffect,
	notifyWorkPeriodApprovalAfterCommit,
} from "@/lib/approvals/server/work-period-approvals";
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
		metadata: Record<string, unknown>;
	},
	dbService: ApprovalDbService,
) {
	const rows = await dbService.db
		.insert(approvalRequest)
		.values({
			organizationId: params.organizationId,
			entityType: "time_entry",
			entityId: params.workPeriodId,
			requestedBy: params.employeeId,
			approverId: params.managerId,
			status: "pending",
			reason: params.reason,
			metadata: params.metadata,
		})
		.returning({ id: approvalRequest.id });
	return {
		kind: "default_created" as const,
		approvalRequestId: rows[0]?.id ?? params.workPeriodId,
	};
}

export async function createTimeEntryApprovalRequest(
	params: {
		workPeriodId: string;
		employeeId: string;
		managerId: string | null;
		organizationId: string;
		reason: string;
		overtimeRisk: ApprovalPolicyOvertimeRisk;
		kind: OrdinaryTimeApprovalKind;
		metadata?: Record<string, unknown>;
	},
	options?: ApprovalRequestOptions,
) {
	const requestDbService = options?.dbService ?? approvalDbService;
	const requester = await requestDbService.db.query.employee.findFirst({
		where: and(
			eq(employee.id, params.employeeId),
			eq(employee.organizationId, params.organizationId),
		),
		columns: { teamId: true, organizationId: true, userId: true },
		with: { user: true },
	});
	const existingTimeRequest =
		params.metadata?.timeRequest &&
		typeof params.metadata.timeRequest === "object" &&
		!Array.isArray(params.metadata.timeRequest)
			? (params.metadata.timeRequest as Record<string, unknown>)
			: {};
	const metadata = {
		...(params.metadata ?? {}),
		timeRequest: { ...existingTimeRequest, kind: params.kind },
	};

	let result: ResolvePolicyAndCreateApprovalResult;
	try {
		result = await Effect.runPromise(
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
				metadata,
			}),
		);
	} catch (error) {
		if (!params.managerId) {
			throw new ValidationError({
				message: "No manager assigned to approve time changes",
				field: "managerId",
			});
		}
		logger.error(
			{ error, workPeriodId: params.workPeriodId },
			"Failed to resolve time-entry approval policy; using manager fallback",
		);
		result = await createDefaultTimeEntryApprovalRequest(
			{ ...params, managerId: params.managerId, metadata },
			requestDbService,
		);
	}

	if (result.kind === "auto_completed") {
		if (!requester?.userId || !requester.user) {
			throw new Error("Auto-approval requester not found");
		}
		const actor = {
			id: params.employeeId,
			userId: requester.userId,
			organizationId: params.organizationId,
			user: {
				id: requester.userId,
				name: requester.user.name,
				email: requester.user.email,
				image: requester.user.image,
			},
		};
		const autoCompletion = await Effect.runPromise(
			finalizeAutoCompletedWorkPeriodApprovalEffect(requestDbService, {
				approvalRequestId: result.approvalRequestId,
				organizationId: params.organizationId,
				requesterEmployeeId: params.employeeId,
				requesterUserId: requester.userId,
				requesterName: requester.user.name,
				kind: params.kind,
			}),
		);
		if (options?.notify !== false) {
			await Effect.runPromise(
				notifyWorkPeriodApprovalAfterCommit(
					autoCompletion,
					actor,
					requestDbService,
				),
			);
		}
	}

	return result;
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
		metadata?: Record<string, unknown>;
	},
	options?: ApprovalRequestOptions,
) {
	try {
		const result = await createTimeEntryApprovalRequest(
			{
				...params,
				reason: "Clock-out requires approval (0-day policy)",
				overtimeRisk: "warning",
				kind: "policy_clock_out",
			},
			options,
		);

		if (options?.notify !== false && result.kind !== "auto_completed") {
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
		return result;
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

export async function createManualEntryApprovalRequest(
	params: {
		workPeriodId: string;
		employeeId: string;
		managerId: string | null;
		organizationId: string;
		startTime: Date;
		endTime: Date;
		durationMinutes: number;
		reason: string;
		metadata?: Record<string, unknown>;
	},
	options?: ApprovalRequestOptions,
) {
	try {
		const result = await createTimeEntryApprovalRequest(
			{
				...params,
				reason: `Manual time entry: ${params.reason}`,
				overtimeRisk: "none",
				kind: "manual_time_submission",
			},
			options,
		);

		const notificationManagerId = params.managerId;
		if (
			options?.notify !== false &&
			result.kind !== "auto_completed" &&
			notificationManagerId
		) {
			await sendManualEntryApprovalNotifications({
				...params,
				managerId: notificationManagerId,
			});
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
		return result;
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
