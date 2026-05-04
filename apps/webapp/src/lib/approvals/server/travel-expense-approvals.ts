import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalRequest,
	employee,
	travelExpenseClaim,
	travelExpenseDecisionLog,
} from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
} from "@/lib/effect/errors";
import type { ApprovalActionOptions } from "../domain/types";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import type { ApprovalPolicyEvaluationContext } from "../policies/types";
import type { ApprovalDbService, CurrentApprover } from "./types";

export function buildTravelExpenseApprovalPolicyContext(claim: {
	id: string;
	organizationId: string;
	employeeId: string;
	totalAmount?: number | string;
	calculatedAmount?: number | string;
	employee: { teamId: string | null };
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: claim.organizationId,
		approvalType: "travel_expense_claim",
		requesterEmployeeId: claim.employeeId,
		teamId: claim.employee.teamId,
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: Number(claim.totalAmount ?? claim.calculatedAmount),
		overtimeRisk: null,
		employeeGroupIds: [],
		entityType: "travel_expense_claim",
		entityId: claim.id,
	};
}

export function createTravelExpenseApprovalWorkflow(
	dbService: ApprovalDbService,
	input: {
		claim: Parameters<typeof buildTravelExpenseApprovalPolicyContext>[0];
		defaultApproverId: string;
	},
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return resolvePolicyAndCreateApproval(dbService, {
		context: buildTravelExpenseApprovalPolicyContext(input.claim),
		defaultApproverId: input.defaultApproverId,
	});
}

export function loadTravelExpenseApprover(dbService: ApprovalDbService, approverId: string) {
	return dbService
		.query("getTravelExpenseApprover", async () => {
			return await dbService.db.query.employee.findFirst({
				where: eq(employee.id, approverId),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((currentEmployee) =>
				currentEmployee
					? Effect.succeed(currentEmployee as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
								entityId: approverId,
							}),
						),
			),
		);
}

function hasAssignedPendingTravelExpenseApproval(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
) {
	return dbService
		.query("getAssignedTravelExpenseApprovalRequest", async () => {
			return await dbService.db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.entityType, "travel_expense_claim"),
					eq(approvalRequest.entityId, claimId),
					eq(approvalRequest.approverId, currentEmployee.id),
					eq(approvalRequest.organizationId, currentEmployee.organizationId),
					eq(approvalRequest.status, "pending"),
				),
			});
		})
		.pipe(Effect.map(Boolean));
}

export function preflightTravelExpenseDecision(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	options?: Pick<ApprovalActionOptions, "allowAnyApprover">,
) {
	return Effect.gen(function* (_) {
		const claim = yield* _(
			dbService.query("getTravelExpenseClaimForDecision", async () => {
				return await dbService.db.query.travelExpenseClaim.findFirst({
					where: and(
						eq(travelExpenseClaim.id, claimId),
						eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
					),
				});
			}),
		);

		if (!claim) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Travel expense claim not found",
						entityType: "travel_expense_claim",
						entityId: claimId,
					}),
				),
			);
		}

		const hasDirectAuthorization =
			claim.approverId === currentEmployee.id ||
			currentEmployee.role === "admin" ||
			!!options?.allowAnyApprover;
		const hasAssignedApproval = hasDirectAuthorization
			? false
			: yield* _(hasAssignedPendingTravelExpenseApproval(dbService, claimId, currentEmployee));

		if (!hasDirectAuthorization && !hasAssignedApproval) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Unauthorized",
						userId: currentEmployee.id,
						resource: "travel_expense_claim",
						action,
					}),
				),
			);
		}

		if (claim.status !== "submitted") {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "Only submitted claims can be decided",
						conflictType: "travel_expense_claim_status",
					}),
				),
			);
		}

		return claim;
	});
}

export function persistTravelExpenseDecision(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	commentOrReason?: string,
) {
	return Effect.gen(function* (_) {
		const decidedAt = new Date();
		yield* _(
			dbService
				.query("updateTravelExpenseDecision", async () => {
					const updateQuery = dbService.db
						.update(travelExpenseClaim)
						.set({
							status: action === "approve" ? "approved" : "rejected",
							decidedAt,
							updatedBy: currentEmployee.user.id,
							updatedAt: decidedAt,
						})
						.where(
							and(
								eq(travelExpenseClaim.id, claimId),
								eq(travelExpenseClaim.organizationId, currentEmployee.organizationId),
								eq(travelExpenseClaim.status, "submitted"),
							),
						);

					const updatedRows =
						updateQuery && typeof updateQuery === "object" && "returning" in updateQuery
							? await updateQuery.returning({ id: travelExpenseClaim.id })
							: await updateQuery;

					return updatedRows;
				})
				.pipe(
					Effect.flatMap((updatedRows) =>
						Array.isArray(updatedRows) && updatedRows.length === 0
							? Effect.fail(
									new ConflictError({
										message: "Only submitted claims can be decided",
										conflictType: "travel_expense_claim_status",
									}),
								)
							: Effect.succeed(updatedRows),
					),
				),
		);

		yield* _(
			dbService.query("insertTravelExpenseDecisionLog", async () => {
				await dbService.db.insert(travelExpenseDecisionLog).values({
					organizationId: currentEmployee.organizationId,
					claimId,
					actorEmployeeId: currentEmployee.id,
					approverId: currentEmployee.id,
					action: action === "approve" ? "approved" : "rejected",
					reason: action === "reject" ? (commentOrReason ?? null) : null,
					comment: action === "approve" ? (commentOrReason ?? null) : null,
					createdAt: decidedAt,
				});
			}),
		);
	});
}
