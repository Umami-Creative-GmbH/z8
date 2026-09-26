"use server";

import { and, eq, isNull } from "drizzle-orm";
import { Cause, Effect, Option, Runtime } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { timeEntry, workPeriod } from "@/db/schema";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { decideOrdinaryWorkPeriodWithStableTargetEffect } from "@/lib/approvals/server/work-period-approvals";
import { ConflictError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { getCurrentEmployee, getCurrentSession } from "./auth";
import { updateWorkPeriodProject as updateWorkPeriodProjectAction } from "../actions";
import { logger } from "./shared";
import { splitOwnWorkPeriod } from "./work-period-split";

export async function approveWorkPeriod(input: {
	workPeriodId: string;
	approvalRequestId: string;
}): Promise<ServerActionResult<{ workPeriodId: string }>> {
	const { workPeriodId, approvalRequestId } = input;
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	try {
		const [selectedWorkPeriod] = await db
			.select({
				id: workPeriod.id,
				organizationId: workPeriod.organizationId,
				approvalStatus: workPeriod.approvalStatus,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.organizationId, currentEmployee.organizationId),
				),
			)
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		const memberRecord = await db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, session.user.id),
				eq(authSchema.member.organizationId, selectedWorkPeriod.organizationId),
			),
		});

		if (memberRecord?.role !== "admin" && memberRecord?.role !== "owner") {
			return {
				success: false,
				error: "Only admins and owners can approve time entries",
			};
		}

		const dbService: ApprovalDbService = {
			db,
			query: <T>(_name: string, operation: () => Promise<T>) =>
				Effect.promise(operation),
		};
		await Effect.runPromise(
			decideOrdinaryWorkPeriodWithStableTargetEffect(
				dbService,
				{
					...currentEmployee,
					user: {
						id: session.user.id,
						name: session.user.name,
						email: session.user.email,
						image: session.user.image ?? null,
					},
				},
				{
					approvalRequestId,
					workPeriodId: selectedWorkPeriod.id,
					decision: { kind: "approve", reason: null },
				},
				{
					approvalRequestId,
					allowOrganizationWideApprover: true,
				},
			),
		);

		return { success: true, data: { workPeriodId: selectedWorkPeriod.id } };
	} catch (error) {
		logger.error({ error, workPeriodId }, "Approve work period error");
		const conflict =
			error instanceof ConflictError
				? error
				: Runtime.isFiberFailure(error)
					? Option.getOrNull(
							Cause.failureOption(error[Runtime.FiberFailureCauseId]),
						)
					: null;
		if (conflict instanceof ConflictError) {
			return {
				success: false,
				error: conflict.message,
				code: conflict._tag,
			};
		}
		return {
			success: false,
			error: "Failed to approve work period. Please try again.",
		};
	}
}

export async function updateWorkPeriodNotes(
	workPeriodId: string,
	notes: string,
): Promise<ServerActionResult<{ workPeriodId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.employeeId, currentEmployee.id),
					eq(workPeriod.organizationId, currentEmployee.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
			return {
				success: false,
				error: "You can only update your own work periods",
			};
		}

		if (!selectedWorkPeriod.clockOutId) {
			return {
				success: false,
				error: "Cannot add notes to an active work period",
			};
		}

		await db
			.update(timeEntry)
			.set({ notes })
			.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		return { success: true, data: { workPeriodId } };
	} catch (error) {
		logger.error({ error }, "Update work period notes error");
		return {
			success: false,
			error: "Failed to update notes. Please try again.",
		};
	}
}

export async function deleteWorkPeriod(
	workPeriodId: string,
): Promise<ServerActionResult<{ deleted: boolean }>> {
	void workPeriodId;
	return { success: false, error: "Deletion requires manager approval" };
}

export async function splitWorkPeriod(
	workPeriodId: string,
	splitDateKey: string,
	splitTime: string,
	beforeNotes?: string,
	afterNotes?: string,
	disambiguation?: "earlier" | "later",
	submissionId?: string,
): Promise<
	ServerActionResult<{ firstPeriodId: string; secondPeriodId: string }>
> {
	return splitOwnWorkPeriod({
		workPeriodId,
		splitDateKey,
		splitTime,
		beforeNotes,
		afterNotes,
		disambiguation,
		submissionId,
	});
}

export async function updateTimeEntryNotes(
	entryId: string,
	notes: string,
): Promise<ServerActionResult<{ entryId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedEntry] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.id, entryId))
			.limit(1);

		if (!selectedEntry) {
			return { success: false, error: "Time entry not found" };
		}

		if (selectedEntry.employeeId !== currentEmployee.id) {
			return {
				success: false,
				error: "You can only update your own time entries",
			};
		}

		await db.update(timeEntry).set({ notes }).where(eq(timeEntry.id, entryId));
		return { success: true, data: { entryId } };
	} catch (error) {
		logger.error({ error }, "Update time entry notes error");
		return {
			success: false,
			error: "Failed to update notes. Please try again.",
		};
	}
}

/** One implementation: the calendar action owns project changes (#286). */
export async function updateWorkPeriodProject(
	workPeriodId: string,
	projectId: string | null,
): Promise<
	ServerActionResult<{ workPeriodId: string; projectId: string | null }>
> {
	return updateWorkPeriodProjectAction(workPeriodId, projectId);
}
