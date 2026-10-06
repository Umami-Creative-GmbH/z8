import { IconReceipt2 } from "@tabler/icons-react";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import { approvalRequest, employee, travelExpenseReport } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { calculateSLADeadline } from "../domain/sla-calculator";
import type {
	ApprovalActionOptions,
	ApprovalDetail,
	ApprovalDisplayMetadata,
	ApprovalPriority,
	ApprovalTimelineEvent,
	ApprovalTypeHandler,
	UnifiedApprovalItem,
} from "../domain/types";
import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import { loadTravelExpenseReportSubmittedRevision } from "../evidence/travel-expense-report-store";
import { loadTravelExpenseApprover } from "../server/travel-expense-approvals";
import { decideTravelExpenseReportEffect } from "../server/travel-expense-report-approvals";
import type { ApprovalDatabase } from "../server/types";
import { buildSLAInfo, fetchApprovals, getApprovalCount } from "./base-handler";

/**
 * Approvals inbox handler of travel expense reports (#602). Items and details
 * show the frozen submission, never the live report; every decision goes
 * through the report decision owner.
 */

export interface TravelExpenseReportApprovalEntity {
	id: string;
	organizationId: string;
	employeeId: string;
	status: "draft" | "submitted" | "approved" | "rejected" | "returned";
	employee: {
		id: string;
		userId: string;
		teamId: string | null;
		user: { id: string; name: string; email: string; image: string | null };
	};
	/** The latest frozen submission; null only when none was captured. */
	submitted: TravelExpenseReportSubmittedFacts | null;
}

function decisionOptions(options: ApprovalActionOptions) {
	return {
		...(options.approvalRequestId ? { approvalRequestId: options.approvalRequestId } : {}),
		...(options.allowAnyApprover ? { allowAnyApprover: true } : {}),
		...(options.allowOrganizationWideApprover ? { allowOrganizationWideApprover: true } : {}),
	};
}

async function loadReportEntities(
	database: ApprovalDatabase,
	organizationId: string,
	reportIds: string[],
): Promise<Map<string, TravelExpenseReportApprovalEntity>> {
	if (reportIds.length === 0) return new Map();
	const rows = await database
		.select({
			report: {
				id: travelExpenseReport.id,
				organizationId: travelExpenseReport.organizationId,
				employeeId: travelExpenseReport.employeeId,
				status: travelExpenseReport.status,
			},
			employee: { id: employee.id, userId: employee.userId, teamId: employee.teamId },
			user: { id: user.id, name: user.name, email: user.email, image: user.image },
		})
		.from(travelExpenseReport)
		.innerJoin(
			employee,
			and(
				eq(employee.id, travelExpenseReport.employeeId),
				eq(employee.organizationId, travelExpenseReport.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				inArray(travelExpenseReport.id, reportIds),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		);
	const revisions = await Promise.all(
		rows.map((row) =>
			loadTravelExpenseReportSubmittedRevision(database, {
				organizationId,
				reportId: row.report.id,
			}),
		),
	);
	return new Map(
		rows.map((row, index) => [
			row.report.id,
			{
				...row.report,
				employee: { ...row.employee, user: row.user },
				submitted: revisions[index]?.facts ?? null,
			},
		]),
	);
}

function getDisplayMetadata(entity: TravelExpenseReportApprovalEntity): ApprovalDisplayMetadata {
	const facts = entity.submitted;
	if (!facts) {
		return {
			title: "Expense report",
			subtitle: "Submitted facts unavailable",
			summary: "",
			icon: "receipt",
		};
	}
	const { trip, totals, items } = facts;
	const dates = trip
		? trip.startDate === trip.endDate
			? trip.startDate
			: `${trip.startDate} – ${trip.endDate}`
		: (items[0]?.expenseDate ?? "");
	const subtitle = trip
		? `${trip.purpose} · ${dates}`
		: `${items[0]?.description ?? ""} · ${dates}`;
	const companyPaid =
		totals.companyPaid === "0.00" ? "" : ` · company-paid ${totals.currency} ${totals.companyPaid}`;
	return {
		title: trip ? "Trip expense report" : "Expense report",
		subtitle,
		summary: `${items.length} ${items.length === 1 ? "expense" : "expenses"} · reimbursable ${totals.currency} ${totals.reimbursable}${companyPaid}`,
		icon: "receipt",
	};
}

function requesterOf(entity: TravelExpenseReportApprovalEntity): UnifiedApprovalItem["requester"] {
	return {
		id: entity.employee.id,
		userId: entity.employee.userId,
		name: entity.employee.user.name,
		email: entity.employee.user.email,
		image: entity.employee.user.image,
		teamId: entity.employee.teamId,
	};
}

export const TravelExpenseReportHandler: ApprovalTypeHandler<TravelExpenseReportApprovalEntity> = {
	type: "travel_expense_report",
	displayName: "Expense report",
	icon: IconReceipt2,
	// Each report needs its own review of the frozen facts.
	supportsBulkApprove: false,

	getApprovals: (params) =>
		fetchApprovals({
			entityType: "travel_expense_report",
			params,
			fetchEntitiesByIds: (entityIds) =>
				Effect.gen(function* () {
					const dbService = yield* DatabaseService;
					return yield* dbService.query("batchGetTravelExpenseReports", () =>
						loadReportEntities(dbService.db, params.organizationId, entityIds),
					);
				}),
			filterEntity: (entity, queryParams) => {
				if (entity.organizationId !== queryParams.organizationId) return false;
				if (queryParams.teamId && entity.employee.teamId !== queryParams.teamId) return false;
				if (queryParams.search) {
					const search = queryParams.search.toLowerCase();
					return (
						entity.employee.user.name.toLowerCase().includes(search) ||
						entity.employee.user.email.toLowerCase().includes(search)
					);
				}
				return true;
			},
			transformToItem: (request, entity) => ({
				id: request.id,
				approvalType: "travel_expense_report",
				entityId: request.entityId,
				typeName: "Expense report",
				requester: requesterOf(entity),
				approverId: request.approverId,
				organizationId: request.organizationId,
				status: request.status,
				createdAt: request.createdAt,
				resolvedAt: request.approvedAt,
				priority: TravelExpenseReportHandler.calculatePriority(entity, request.createdAt),
				sla: buildSLAInfo(
					TravelExpenseReportHandler.calculateSLADeadline(entity, request.createdAt),
				),
				display: getDisplayMetadata(entity),
			}),
		}),

	getCount: (approverId, organizationId, visibility) =>
		getApprovalCount("travel_expense_report", approverId, organizationId, visibility),

	getDetail: (entityId, organizationId, context) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			if (!organizationId) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Expense report not found",
						entityType: "travel_expense_report",
						entityId,
					}),
				);
			}
			const entity = yield* dbService.query("getTravelExpenseReportDetail", async () =>
				(await loadReportEntities(dbService.db, organizationId, [entityId])).get(entityId),
			);
			if (!entity) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Expense report not found in this organization",
						entityType: "travel_expense_report",
						entityId,
					}),
				);
			}
			const request = yield* dbService.query("getTravelExpenseReportApprovalRequest", async () =>
				dbService.db.query.approvalRequest.findFirst({
					where: and(
						eq(approvalRequest.entityType, "travel_expense_report"),
						eq(approvalRequest.entityId, entityId),
						eq(approvalRequest.organizationId, entity.organizationId),
						...(context?.approvalId ? [eq(approvalRequest.id, context.approvalId)] : []),
					),
					with: { approver: { with: { user: true } } },
				}),
			);
			if (!request) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Approval request not found",
						entityType: "approval_request",
						entityId,
					}),
				);
			}
			const approver = request.approver
				? { name: request.approver.user.name, image: request.approver.user.image }
				: null;
			const timeline: ApprovalTimelineEvent[] = [
				{
					id: `${request.id}-created`,
					type: "created",
					performedBy: { name: entity.employee.user.name, image: entity.employee.user.image },
					timestamp: request.createdAt,
					message: "Expense report submitted for approval",
				},
			];
			if (request.status === "approved" && request.approvedAt) {
				timeline.push({
					id: `${request.id}-approved`,
					type: "approved",
					performedBy: approver,
					timestamp: request.approvedAt,
					message: "Expense report approved",
				});
			}
			if (request.status === "rejected") {
				timeline.push({
					id: `${request.id}-rejected`,
					type: "rejected",
					performedBy: approver,
					timestamp: request.updatedAt,
					message: request.rejectionReason
						? `Expense report rejected: ${request.rejectionReason}`
						: "Expense report rejected",
				});
			}
			return {
				approval: {
					id: request.id,
					approvalType: "travel_expense_report",
					entityId: entity.id,
					typeName: "Expense report",
					requester: requesterOf(entity),
					approverId: request.approverId,
					organizationId: entity.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: request.approvedAt,
					priority: TravelExpenseReportHandler.calculatePriority(entity, request.createdAt),
					sla: buildSLAInfo(
						TravelExpenseReportHandler.calculateSLADeadline(entity, request.createdAt),
					),
					display: getDisplayMetadata(entity),
				},
				entity,
				timeline,
			} satisfies ApprovalDetail<TravelExpenseReportApprovalEntity>;
		}),

	approve: (entityId, approverId, options) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const actor = yield* loadTravelExpenseApprover(dbService, approverId);
			yield* decideTravelExpenseReportEffect(dbService, actor, {
				reportId: entityId,
				action: "approve",
				...(options?.acceptedReceiptExceptionItemIds
					? { acceptedReceiptExceptionItemIds: options.acceptedReceiptExceptionItemIds }
					: {}),
				...(options ? { options: decisionOptions(options) } : {}),
			});
		}),

	reject: (entityId, approverId, reason, options) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const actor = yield* loadTravelExpenseApprover(dbService, approverId);
			yield* decideTravelExpenseReportEffect(dbService, actor, {
				reportId: entityId,
				action: "reject",
				reason,
				...(options ? { options: decisionOptions(options) } : {}),
			});
		}),

	calculatePriority: (_entity, createdAt) => {
		const ageHours =
			(systemClock.nowInstant().epochMilliseconds - instantFromDate(createdAt).epochMilliseconds) /
			3_600_000;
		if (ageHours > 72) return "urgent";
		if (ageHours > 24) return "high";
		if (ageHours > 8) return "normal";
		return "low";
	},

	calculateSLADeadline: (entity, createdAt) => {
		const priority: ApprovalPriority = TravelExpenseReportHandler.calculatePriority(
			entity,
			createdAt,
		);
		return calculateSLADeadline("travel_expense_report", priority, createdAt);
	},

	getDisplayMetadata,
};
