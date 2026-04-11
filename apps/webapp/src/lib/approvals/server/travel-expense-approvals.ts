import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { travelExpenseClaim, travelExpenseDecisionLog, employee } from "@/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";
import type { ApprovalDbService, CurrentApprover } from "./types";

export function loadTravelExpenseApprover(
	dbService: ApprovalDbService,
	approverId: string,
) {
	return dbService.query("getTravelExpenseApprover", async () => {
		return await dbService.db.query.employee.findFirst({
			where: eq(employee.id, approverId),
			with: { user: true },
		});
	}).pipe(
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

export function preflightTravelExpenseDecision(
	dbService: ApprovalDbService,
	claimId: string,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
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

		if (claim.approverId !== currentEmployee.id && currentEmployee.role !== "admin") {
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
			dbService.query("updateTravelExpenseDecision", async () => {
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
			}).pipe(
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
					reason: action === "reject" ? commentOrReason ?? null : null,
					comment: action === "approve" ? commentOrReason ?? null : null,
					createdAt: decidedAt,
				});
			}),
		);
	});
}
