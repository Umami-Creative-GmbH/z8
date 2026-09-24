"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employee, project, travelExpenseAttachment, travelExpenseClaim } from "@/db/schema";
import {
	ApprovalEvidenceError,
	captureTravelExpenseSubmissionEvidence,
} from "@/lib/approvals/evidence";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { processApproval } from "@/lib/approvals/server/shared";
import {
	createTravelExpenseApprovalWorkflow,
	notifyTravelExpenseRequesterAfterDecisionForApprover,
	persistTravelExpenseDecision,
	preflightTravelExpenseDecision,
} from "@/lib/approvals/server/travel-expense-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { acquireApprovalWriteLock } from "@/lib/approvals/workflow/cutover";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	comparePlainDates,
	dateFromInstant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { TRAVEL_EXPENSE_VALIDATION_MESSAGES } from "@/lib/travel-expenses/types";

export interface CreateTravelExpenseDraftInput {
	type: "receipt" | "mileage" | "per_diem";
	tripStart: string;
	tripEnd: string;
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
				eq(
					travelExpenseClaim.organizationId,
					authContext.employee.organizationId,
				),
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
		let projectId: string | null = null;
		if (input.projectId) {
			const ownedProject = await db.query.project.findFirst({
				where: and(
					eq(project.id, input.projectId),
					eq(project.organizationId, authContext.employee.organizationId),
				),
				columns: { id: true },
			});
			if (!ownedProject) {
				return {
					success: false,
					error: "Failed to create travel expense draft",
				};
			}
			projectId = ownedProject.id;
		}
		const timezone = await getEffectiveTimezone(
			authContext.user.id,
			authContext.employee.organizationId,
		);
		const tripStartDate = parsePlainDate(input.tripStart);
		const tripEndDate = parsePlainDate(input.tripEnd);
		if (comparePlainDates(tripEndDate, tripStartDate) < 0) {
			return {
				success: false,
				error: "Trip end date cannot be before trip start date",
			};
		}
		const tripStart = dateFromInstant(
			tripStartDate.toZonedDateTime(timezone).toInstant(),
		);
		const tripEnd = dateFromInstant(
			tripEndDate
				.add({ days: 1 })
				.toZonedDateTime(timezone)
				.toInstant()
				.subtract({ milliseconds: 1 }),
		);

		const [createdClaim] = await db
			.insert(travelExpenseClaim)
			.values({
				organizationId: authContext.employee.organizationId,
				employeeId: authContext.employee.id,
				type: input.type,
				status: "draft",
				tripStart,
				tripEnd,
				// The entered logical dates and the zone that derived the bounds above.
				tripStartDate: tripStartDate.toString(),
				tripEndDate: tripEndDate.toString(),
				tripDateTimeZone: timezone,
				destinationCity: input.destinationCity ?? null,
				destinationCountry: input.destinationCountry ?? null,
				projectId,
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
		}).catch((error) =>
			logger.error({ error }, "Failed to log travel expense draft creation"),
		);

		revalidatePath("/travel-expenses");
		return { success: true, data: { id: createdClaim.id } };
	} catch (error) {
		logger.error({ error }, "Failed to create travel expense draft");
		return { success: false, error: "Failed to create travel expense draft" };
	}
}

export async function submitTravelExpenseClaim(input: {
	claimId: string;
}): Promise<ServerActionResult<{ status: "submitted" | "approved" }>> {
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
			}),
			db.query.employee.findFirst({
				where: and(
					eq(employee.id, currentEmployee.id),
					eq(employee.organizationId, currentEmployee.organizationId),
					eq(employee.isActive, true),
				),
				columns: {
					teamId: true,
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

		if (!currentEmployeeRecord) {
			return { success: false, error: "Employee not found" };
		}

		const approverId = await getPrimaryEligibleManagerIdForRequester({
			db,
			requesterEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
		});

		if (!approverId) {
			return { success: false, error: "No approver available" };
		}

		const submittedAt = new Date();
		const submission = await db.transaction(async (tx) => {
			const approvalDbService = {
				db: tx,
				query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
			} satisfies ApprovalDbService;
			// Shared rollout lock first, so the evidence mode read below is stable.
			await acquireApprovalWriteLock(approvalDbService, {
				organizationId: currentEmployee.organizationId,
				workflowType: "travel_expense",
			});

			// Receipt finalization takes the same row lock: an upload either
			// attached before this point or is rejected after submission.
			const [lockedClaim] = await tx
				.select({
					id: travelExpenseClaim.id,
					employeeId: travelExpenseClaim.employeeId,
					status: travelExpenseClaim.status,
					type: travelExpenseClaim.type,
					calculatedAmount: travelExpenseClaim.calculatedAmount,
				})
				.from(travelExpenseClaim)
				.where(
					and(
						eq(travelExpenseClaim.id, claim.id),
						eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
					),
				)
				.for("update");
			if (
				!lockedClaim ||
				lockedClaim.employeeId !== currentEmployee.id ||
				lockedClaim.status !== "draft"
			) {
				return { kind: "not_draft" } as const;
			}

			const attachments = await tx
				.select({ id: travelExpenseAttachment.id })
				.from(travelExpenseAttachment)
				.where(
					and(
						eq(travelExpenseAttachment.claimId, lockedClaim.id),
						eq(
							travelExpenseAttachment.organizationId,
							currentEmployee.organizationId,
						),
					),
				);
			if (lockedClaim.type === "receipt" && attachments.length < 1) {
				return { kind: "receipt_required" } as const;
			}

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
						eq(travelExpenseClaim.id, lockedClaim.id),
						eq(
							travelExpenseClaim.organizationId,
							currentEmployee.organizationId,
						),
						eq(travelExpenseClaim.status, "draft"),
					),
				)
				.returning({ id: travelExpenseClaim.id });

			if (!submittedClaim) {
				return { kind: "not_draft" } as const;
			}

			const approvalResult = await Effect.runPromise(
				createTravelExpenseApprovalWorkflow(approvalDbService, {
					claim: {
						id: lockedClaim.id,
						organizationId: currentEmployee.organizationId,
						employeeId: currentEmployee.id,
						calculatedAmount: lockedClaim.calculatedAmount,
						employee: { teamId: currentEmployeeRecord.teamId ?? null },
					},
					defaultApproverId: approverId,
				}),
			);

			// Freezes the submitted facts and receipt manifest; a failure rolls
			// back the whole submission.
			await captureTravelExpenseSubmissionEvidence(tx, {
				organizationId: currentEmployee.organizationId,
				claimId: lockedClaim.id,
				submitter: { employeeId: currentEmployee.id, userId: authContext.user.id },
				routing: approvalResult,
			});

			return { kind: "submitted", submittedClaim, approvalResult } as const;
		});

		if (submission.kind === "not_draft") {
			return { success: false, error: "Only draft claims can be submitted" };
		}
		if (submission.kind === "receipt_required") {
			return {
				success: false,
				error: TRAVEL_EXPENSE_VALIDATION_MESSAGES.RECEIPT_ATTACHMENT_REQUIRED,
			};
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
		}).catch((error) =>
			logger.error({ error }, "Failed to log travel expense submission"),
		);

		revalidatePath("/travel-expenses");
		return {
			success: true,
			data: {
				status:
					submission.approvalResult.kind === "auto_completed"
						? "approved"
						: "submitted",
			},
		};
	} catch (error) {
		if (error instanceof ApprovalEvidenceError && error.code === "evidence_incomplete") {
			logger.warn(
				{ claimId: input.claimId, details: error.details },
				"Travel expense submission held: submission evidence is incomplete",
			);
			return { success: false, error: submissionEvidenceMessage(error.details.field) };
		}
		logger.error({ error }, "Failed to submit travel expense claim");
		return { success: false, error: "Failed to submit travel expense claim" };
	}
}

function submissionEvidenceMessage(field: string | undefined): string {
	switch (field) {
		case "trip_dates":
			return "This claim was created before its trip dates were recorded as entered. Create a new claim to submit it.";
		case "receipt_checksum":
			return "A receipt on this claim was uploaded before receipt content was verified. Create a new claim with the receipts to submit it.";
		default:
			return "This claim cannot be submitted because required submission evidence is incomplete.";
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

		const result = await processApproval(
			"travel_expense_claim",
			input.claimId,
			"approve",
			undefined,
			(dbService, claimId, currentEmployee) =>
				persistTravelExpenseDecision(
					dbService,
					claimId,
					currentEmployee,
					"approve",
					input.note,
				),
			(dbService, claimId, currentEmployee) =>
				preflightTravelExpenseDecision(
					dbService,
					claimId,
					currentEmployee,
					"approve",
				),
			{ transactional: true },
		);

		if (!result.success) {
			return result;
		}

		const approvalDbService = {
			db,
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} satisfies ApprovalDbService;

		await Effect.runPromise(
			notifyTravelExpenseRequesterAfterDecisionForApprover(
				approvalDbService,
				input.claimId,
				authContext.employee.id,
				"approve",
			),
		);

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

		const result = await processApproval(
			"travel_expense_claim",
			input.claimId,
			"reject",
			input.reason,
			(dbService, claimId, currentEmployee) =>
				persistTravelExpenseDecision(
					dbService,
					claimId,
					currentEmployee,
					"reject",
					input.reason,
				),
			(dbService, claimId, currentEmployee) =>
				preflightTravelExpenseDecision(
					dbService,
					claimId,
					currentEmployee,
					"reject",
				),
			{ transactional: true },
		);

		if (!result.success) {
			return result;
		}

		const approvalDbService = {
			db,
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} satisfies ApprovalDbService;

		await Effect.runPromise(
			notifyTravelExpenseRequesterAfterDecisionForApprover(
				approvalDbService,
				input.claimId,
				authContext.employee.id,
				"reject",
				input.reason,
			),
		);

		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "rejected" } };
	} catch (error) {
		logger.error({ error }, "Failed to reject travel expense claim");
		return { success: false, error: "Failed to reject travel expense claim" };
	}
}
