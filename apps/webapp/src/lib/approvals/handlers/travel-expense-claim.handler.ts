import { IconReceipt2 } from "@tabler/icons-react";
import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { approvalRequest, travelExpenseClaim } from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type {
	ApprovalDetail,
	ApprovalDisplayMetadata,
	ApprovalPriority,
	ApprovalQueryParams,
	ApprovalTimelineEvent,
	ApprovalTypeHandler,
} from "../domain/types";
import { calculateSLADeadline } from "../domain/sla-calculator";
import {
	loadTravelExpenseApprover,
	persistTravelExpenseDecision,
	preflightTravelExpenseDecision,
} from "../server/travel-expense-approvals";
import { processApprovalWithCurrentEmployee } from "../server/shared";
import { buildSLAInfo, fetchApprovals, getApprovalCount } from "./base-handler";

interface TravelExpenseClaimWithRelations {
	id: string;
	organizationId: string;
	employeeId: string;
	approverId: string | null;
	type: "receipt" | "mileage" | "per_diem";
	status: "draft" | "submitted" | "approved" | "rejected";
	tripStart: Date;
	tripEnd: Date;
	destinationCity: string | null;
	destinationCountry: string | null;
	projectId: string | null;
	originalCurrency: string;
	originalAmount: string;
	calculatedCurrency: string;
	calculatedAmount: string;
	notes: string | null;
	submittedAt: Date | null;
	decidedAt: Date | null;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
	employee: {
		id: string;
		userId: string;
		teamId: string | null;
		organizationId: string;
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
	project: {
		id: string;
		name: string;
	} | null;
}

function getClaimTypeLabel(type: TravelExpenseClaimWithRelations["type"]): string {
	switch (type) {
		case "receipt":
			return "Receipt";
		case "mileage":
			return "Mileage";
		case "per_diem":
			return "Per Diem";
	}
}

function getClaimIcon(type: TravelExpenseClaimWithRelations["type"]): string {
	switch (type) {
		case "receipt":
			return "receipt";
		case "mileage":
			return "route";
		case "per_diem":
			return "briefcase";
	}
}

function formatTripDateRange(start: Date, end: Date): string {
	const startDate = DateTime.fromJSDate(start);
	const endDate = DateTime.fromJSDate(end);

	if (startDate.hasSame(endDate, "day")) {
		return startDate.toFormat("LLL dd, yyyy");
	}

	if (startDate.hasSame(endDate, "month") && startDate.hasSame(endDate, "year")) {
		return `${startDate.toFormat("LLL d")}-${endDate.toFormat("d, yyyy")}`;
	}

	if (startDate.hasSame(endDate, "year")) {
		return `${startDate.toFormat("LLL d")}-${endDate.toFormat("LLL d, yyyy")}`;
	}

	return `${startDate.toFormat("LLL d, yyyy")}-${endDate.toFormat("LLL d, yyyy")}`;
}

function getDisplayMetadata(entity: TravelExpenseClaimWithRelations): ApprovalDisplayMetadata {
	const destination = entity.destinationCity ?? entity.destinationCountry ?? "Trip";
	const tripRange = formatTripDateRange(entity.tripStart, entity.tripEnd);
	const claimTypeLabel = getClaimTypeLabel(entity.type);

	return {
		title: "Travel Expense",
		subtitle: `${destination} - ${tripRange}`,
		summary: `${claimTypeLabel} for ${entity.calculatedCurrency} ${entity.calculatedAmount}`,
		badge: entity.project
			? {
					label: entity.project.name,
					color: null,
				}
			: undefined,
		icon: getClaimIcon(entity.type),
	};
}

export const TravelExpenseClaimHandler: ApprovalTypeHandler<TravelExpenseClaimWithRelations> = {
	type: "travel_expense_claim",
	displayName: "Travel Expense",
	icon: IconReceipt2,
	supportsBulkApprove: true,

	getApprovals: (params: ApprovalQueryParams) =>
		fetchApprovals({
			entityType: "travel_expense_claim",
			params,
			fetchEntitiesByIds: (entityIds) =>
				Effect.gen(function* (_) {
					const dbService = yield* _(DatabaseService);

					const claims = yield* _(
						dbService.query("batchGetTravelExpenseClaims", async () => {
							return await dbService.db.query.travelExpenseClaim.findMany({
								where: and(
									inArray(travelExpenseClaim.id, entityIds),
									eq(travelExpenseClaim.organizationId, params.organizationId),
								),
								with: {
									employee: { with: { user: true } },
									project: true,
								},
							});
						}),
					);

					const map = new Map<string, TravelExpenseClaimWithRelations>();
					for (const claim of claims) {
						map.set(claim.id, claim as TravelExpenseClaimWithRelations);
					}

					return map;
				}),
			filterEntity: (entity, queryParams) => {
				if (entity.organizationId !== queryParams.organizationId) {
					return false;
				}

				if (queryParams.teamId && entity.employee.teamId !== queryParams.teamId) {
					return false;
				}

				if (queryParams.search) {
					const searchLower = queryParams.search.toLowerCase();
					const matchesName = entity.employee.user.name.toLowerCase().includes(searchLower);
					const matchesEmail = entity.employee.user.email.toLowerCase().includes(searchLower);
					const matchesProject = entity.project?.name.toLowerCase().includes(searchLower) ?? false;
					if (!matchesName && !matchesEmail && !matchesProject) {
						return false;
					}
				}

				return true;
			},
			transformToItem: (request, entity) => {
				const priority = TravelExpenseClaimHandler.calculatePriority(entity, request.createdAt);
				const slaDeadline = TravelExpenseClaimHandler.calculateSLADeadline(entity, request.createdAt);

				return {
					id: request.id,
					approvalType: "travel_expense_claim",
					entityId: request.entityId,
					typeName: "Travel Expense",
					requester: {
						id: entity.employee.id,
						userId: entity.employee.userId,
						name: entity.employee.user.name,
						email: entity.employee.user.email,
						image: entity.employee.user.image,
						teamId: entity.employee.teamId,
					},
					approverId: request.approverId,
					organizationId: request.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: request.approvedAt,
					priority,
					sla: buildSLAInfo(slaDeadline),
					display: TravelExpenseClaimHandler.getDisplayMetadata(entity),
				};
			},
		}),

	getCount: (approverId, organizationId) =>
		getApprovalCount("travel_expense_claim", approverId, organizationId),

	getDetail: (entityId, organizationId) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);

			const claim = yield* _(
				dbService.query("getTravelExpenseClaimDetail", async () => {
					return await dbService.db.query.travelExpenseClaim.findFirst({
						where: and(
							eq(travelExpenseClaim.id, entityId),
							...(organizationId
								? [eq(travelExpenseClaim.organizationId, organizationId)]
								: []),
						),
						with: {
							employee: { with: { user: true } },
							project: true,
						},
					});
				}),
				Effect.flatMap((claim) =>
					claim
						? Effect.succeed(claim as TravelExpenseClaimWithRelations)
						: Effect.fail(
								new NotFoundError({
									message: organizationId
										? "Travel expense claim not found in this organization"
										: "Travel expense claim not found",
									entityType: "travel_expense_claim",
									entityId,
								}),
							),
				),
			);

			const request = yield* _(
				dbService.query("getTravelExpenseApprovalRequest", async () => {
					return await dbService.db.query.approvalRequest.findFirst({
						where: and(
							eq(approvalRequest.entityType, "travel_expense_claim"),
							eq(approvalRequest.entityId, entityId),
						),
						with: {
							approver: { with: { user: true } },
						},
					});
				}),
				Effect.flatMap((request) =>
					request
						? Effect.succeed(request)
						: Effect.fail(
								new NotFoundError({
									message: "Approval request not found",
									entityType: "approval_request",
									entityId,
								}),
							),
				),
			);

			const priority = TravelExpenseClaimHandler.calculatePriority(claim, request.createdAt);
			const slaDeadline = TravelExpenseClaimHandler.calculateSLADeadline(claim, request.createdAt);

			const timeline: ApprovalTimelineEvent[] = [
				{
					id: `${request.id}-created`,
					type: "created",
					performedBy: {
						name: claim.employee.user.name,
						image: claim.employee.user.image,
					},
					timestamp: request.createdAt,
					message: "Travel expense submitted for approval",
				},
			];

			if (request.status === "approved" && request.approvedAt) {
				timeline.push({
					id: `${request.id}-approved`,
					type: "approved",
					performedBy: request.approver
						? {
								name: request.approver.user.name,
								image: request.approver.user.image,
							}
						: null,
					timestamp: request.approvedAt,
					message: "Travel expense approved",
				});
			}

			if (request.status === "rejected" && request.approvedAt) {
				timeline.push({
					id: `${request.id}-rejected`,
					type: "rejected",
					performedBy: request.approver
						? {
								name: request.approver.user.name,
								image: request.approver.user.image,
							}
						: null,
					timestamp: request.approvedAt,
					message: request.rejectionReason
						? `Travel expense rejected: ${request.rejectionReason}`
						: "Travel expense rejected",
				});
			}

			return {
				approval: {
					id: request.id,
					approvalType: "travel_expense_claim",
					entityId: claim.id,
					typeName: "Travel Expense",
					requester: {
						id: claim.employee.id,
						userId: claim.employee.userId,
						name: claim.employee.user.name,
						email: claim.employee.user.email,
						image: claim.employee.user.image,
						teamId: claim.employee.teamId,
					},
					approverId: request.approverId,
					organizationId: claim.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: request.approvedAt,
					priority,
					sla: buildSLAInfo(slaDeadline),
					display: TravelExpenseClaimHandler.getDisplayMetadata(claim),
				},
				entity: claim,
				timeline,
			} as ApprovalDetail<TravelExpenseClaimWithRelations>;
		}),

	approve: (entityId, approverId) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);
			const currentEmployee = yield* _(loadTravelExpenseApprover(dbService, approverId));
			yield* _(
				processApprovalWithCurrentEmployee(
					dbService,
					currentEmployee,
					"travel_expense_claim",
					entityId,
					"approve",
					undefined,
					(decisionDbService, decisionEntityId, approver) =>
						persistTravelExpenseDecision(decisionDbService, decisionEntityId, approver, "approve"),
					(decisionDbService, decisionEntityId, approver) =>
						preflightTravelExpenseDecision(
							decisionDbService,
							decisionEntityId,
							approver,
							"approve",
						),
					{ transactional: true },
				),
			);
		}),

	reject: (entityId, approverId, reason) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);
			const currentEmployee = yield* _(loadTravelExpenseApprover(dbService, approverId));
			yield* _(
				processApprovalWithCurrentEmployee(
					dbService,
					currentEmployee,
					"travel_expense_claim",
					entityId,
					"reject",
					reason,
					(decisionDbService, decisionEntityId, approver) =>
						persistTravelExpenseDecision(
							decisionDbService,
							decisionEntityId,
							approver,
							"reject",
							reason,
						),
					(decisionDbService, decisionEntityId, approver) =>
						preflightTravelExpenseDecision(
							decisionDbService,
							decisionEntityId,
							approver,
							"reject",
						),
					{ transactional: true },
				),
			);
		}),

	calculatePriority: (_entity, createdAt) => {
		const requestAgeHours = DateTime.now().diff(DateTime.fromJSDate(createdAt), "hours").hours;

		if (requestAgeHours > 72) return "urgent";
		if (requestAgeHours > 24) return "high";
		if (requestAgeHours > 8) return "normal";
		return "low";
	},

	calculateSLADeadline: (entity, createdAt) => {
		const priority: ApprovalPriority = TravelExpenseClaimHandler.calculatePriority(entity, createdAt);
		return calculateSLADeadline("travel_expense_claim", priority, createdAt);
	},

	getDisplayMetadata,
};
