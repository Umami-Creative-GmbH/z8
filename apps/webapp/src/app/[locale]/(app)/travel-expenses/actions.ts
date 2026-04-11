"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	approvalRequest,
	employee,
	travelExpenseAttachment,
	travelExpenseClaim,
} from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { processApproval } from "@/lib/approvals/server/shared";
import {
	persistTravelExpenseDecision,
	preflightTravelExpenseDecision,
} from "@/lib/approvals/server/travel-expense-approvals";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

export interface CreateTravelExpenseDraftInput {
	type: "receipt" | "mileage" | "per_diem";
	tripStart: Date;
	tripEnd: Date;
	destinationCity?: string | null;
	destinationCountry?: string | null;
	projectId?: string | null;
	originalCurrency: string;
	originalAmount: string;
	calculatedCurrency: string;
	calculatedAmount: string;
	notes?: string | null;
}

type TravelExpenseClaimListItem = typeof travelExpenseClaim.$inferSelect;

export async function getMyTravelExpenseClaims(): Promise<
	ServerActionResult<TravelExpenseClaimListItem[]>
> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const claims = await db.query.travelExpenseClaim.findMany({
			where: and(
				eq(travelExpenseClaim.organizationId, authContext.employee.organizationId),
				eq(travelExpenseClaim.employeeId, authContext.employee.id),
			),
			orderBy: [desc(travelExpenseClaim.createdAt)],
		});

		return { success: true, data: claims as TravelExpenseClaimListItem[] };
	} catch (error) {
		logger.error({ error }, "Failed to get travel expense claims");
		return { success: false, error: "Failed to get travel expense claims" };
	}
}

export async function createTravelExpenseDraft(
	input: CreateTravelExpenseDraftInput,
): Promise<ServerActionResult<{ id: string }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const [createdClaim] = await db
			.insert(travelExpenseClaim)
			.values({
				organizationId: authContext.employee.organizationId,
				employeeId: authContext.employee.id,
				type: input.type,
				status: "draft",
				tripStart: input.tripStart,
				tripEnd: input.tripEnd,
				destinationCity: input.destinationCity ?? null,
				destinationCountry: input.destinationCountry ?? null,
				projectId: input.projectId ?? null,
				originalCurrency: input.originalCurrency,
				originalAmount: input.originalAmount,
				calculatedCurrency: input.calculatedCurrency,
				calculatedAmount: input.calculatedAmount,
				notes: input.notes ?? null,
				createdBy: authContext.user.id,
				updatedBy: authContext.user.id,
				updatedAt: new Date(),
			})
			.returning({ id: travelExpenseClaim.id });

		if (!createdClaim) {
			return { success: false, error: "Failed to create draft" };
		}

		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
			actorId: authContext.user.id,
			employeeId: authContext.employee.id,
			targetId: createdClaim.id,
			targetType: "approval",
			organizationId: authContext.employee.organizationId,
			metadata: {
				type: input.type,
			},
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log travel expense draft creation"));

		revalidatePath("/travel-expenses");
		return { success: true, data: { id: createdClaim.id } };
	} catch (error) {
		logger.error({ error }, "Failed to create travel expense draft");
		return { success: false, error: "Failed to create travel expense draft" };
	}
}

export async function submitTravelExpenseClaim(input: {
	claimId: string;
}): Promise<ServerActionResult<{ status: "submitted" }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const currentEmployee = authContext.employee;

		const [claim, currentEmployeeRecord] = await Promise.all([
			db.query.travelExpenseClaim.findFirst({
				where: and(
					eq(travelExpenseClaim.id, input.claimId),
					eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
				),
				with: {
					attachments: true,
				},
			}),
			db.query.employee.findFirst({
				where: and(
					eq(employee.id, currentEmployee.id),
					eq(employee.organizationId, currentEmployee.organizationId),
					eq(employee.isActive, true),
				),
				columns: {
					managerId: true,
				},
			}),
		]);

		if (!claim) {
			return { success: false, error: "Travel expense claim not found" };
		}

		if (claim.employeeId !== currentEmployee.id) {
			return { success: false, error: "Unauthorized" };
		}

		if (claim.status !== "draft") {
			return { success: false, error: "Only draft claims can be submitted" };
		}

		if (claim.type === "receipt" && claim.attachments.length < 1) {
			return {
				success: false,
				error: TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED,
			};
		}

		if (!currentEmployeeRecord) {
			return { success: false, error: "Employee not found" };
		}

		let approverId = currentEmployeeRecord.managerId;
		if (!approverId) {
			const adminApprover = await db.query.employee.findFirst({
				where: and(
					eq(employee.organizationId, currentEmployee.organizationId),
					eq(employee.role, "admin"),
					eq(employee.isActive, true),
				),
				columns: {
					id: true,
				},
				orderBy: [asc(employee.createdAt)],
			});

			approverId = adminApprover?.id ?? null;
		}

		if (!approverId) {
			return { success: false, error: "No approver available" };
		}

		const submittedAt = new Date();
		const updatedClaim = await db.transaction(async (tx) => {
			const [submittedClaim] = await tx
				.update(travelExpenseClaim)
				.set({
					status: "submitted",
					approverId,
					submittedAt,
					updatedBy: authContext.user.id,
					updatedAt: submittedAt,
				})
				.where(
					and(
						eq(travelExpenseClaim.id, claim.id),
						eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
						eq(travelExpenseClaim.status, "draft"),
					),
				)
				.returning({ id: travelExpenseClaim.id });

			if (!submittedClaim) {
				return null;
			}

			await tx.insert(approvalRequest).values({
				organizationId: currentEmployee.organizationId,
				entityType: "travel_expense_claim",
				entityId: claim.id,
				requestedBy: currentEmployee.id,
				approverId,
				status: "pending",
			});

			return submittedClaim;
		});

		if (!updatedClaim) {
			return { success: false, error: "Only draft claims can be submitted" };
		}

		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_SUBMITTED,
			actorId: authContext.user.id,
			employeeId: currentEmployee.id,
			targetId: claim.id,
			targetType: "approval",
			organizationId: currentEmployee.organizationId,
			metadata: {
				approverId,
				type: claim.type,
			},
			timestamp: submittedAt,
		}).catch((error) => logger.error({ error }, "Failed to log travel expense submission"));

		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "submitted" } };
	} catch (error) {
		logger.error({ error }, "Failed to submit travel expense claim");
		return { success: false, error: "Failed to submit travel expense claim" };
	}
}

export async function approveTravelExpenseClaim(input: {
	claimId: string;
	note?: string;
}): Promise<ServerActionResult<{ status: "approved" }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		if (authContext.employee.role !== "manager" && authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized" };
		}

		const result = await processApproval(
			"travel_expense_claim",
			input.claimId,
			"approve",
			undefined,
			(dbService, claimId, currentEmployee) =>
				persistTravelExpenseDecision(dbService, claimId, currentEmployee, "approve", input.note),
			(dbService, claimId, currentEmployee) =>
				preflightTravelExpenseDecision(dbService, claimId, currentEmployee, "approve"),
			{ transactional: true },
		);

		if (!result.success) {
			return result;
		}

		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "approved" } };
	} catch (error) {
		logger.error({ error }, "Failed to approve travel expense claim");
		return { success: false, error: "Failed to approve travel expense claim" };
	}
}

export async function rejectTravelExpenseClaim(input: {
	claimId: string;
	reason: string;
}): Promise<ServerActionResult<{ status: "rejected" }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		if (authContext.employee.role !== "manager" && authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized" };
		}

		const result = await processApproval(
			"travel_expense_claim",
			input.claimId,
			"reject",
			input.reason,
			(dbService, claimId, currentEmployee) =>
				persistTravelExpenseDecision(dbService, claimId, currentEmployee, "reject", input.reason),
			(dbService, claimId, currentEmployee) =>
				preflightTravelExpenseDecision(dbService, claimId, currentEmployee, "reject"),
			{ transactional: true },
		);

		if (!result.success) {
			return result;
		}

		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "rejected" } };
	} catch (error) {
		logger.error({ error }, "Failed to reject travel expense claim");
		return { success: false, error: "Failed to reject travel expense claim" };
	}
}
