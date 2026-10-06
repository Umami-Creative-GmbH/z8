import { and, asc, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Option, Result } from "effect";
import type { db as appDb } from "@/db";
import {
	approvalChainStageInstance,
	approvalPolicy,
	approvalPolicyCondition,
	employee,
	employeeManagers,
	team,
	teamMembership,
	travelExpenseReport,
	travelExpenseSettings,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { stampMileagePolicies } from "@/lib/travel-expenses/mileage-item-store";
import type { ReportOwner } from "@/lib/travel-expenses/report-store";
import { resolveReportReviewer } from "@/lib/travel-expenses/report-reviewer-routing";
import {
	checkReportSubmission,
	type ReportSubmissionTotals,
	type ReviewedReportVersions,
} from "@/lib/travel-expenses/report-submission";
import type { TripReportMissingRequirements } from "@/lib/travel-expenses/trip-report";
import { acquireApprovalWriteGate } from "../authority";
import { loadEmployeeLabel } from "../evidence/absence-submission";
import { buildTravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import { captureTravelExpenseReportSubmittedRevision } from "../evidence/travel-expense-report-store";
import {
	loadTravelExpenseReportFactsInput,
	verifyTravelExpenseReportLifecycle,
} from "../evidence/travel-expense-report-submission";
import { resolvePolicyAndCreateApproval } from "../policies/chain-service";
import {
	APPROVAL_AMOUNT_THRESHOLD_CURRENCY,
	type ApprovalPolicyEvaluationContext,
} from "../policies/types";
import type { ApprovalDbService } from "./types";

/**
 * Submission owner of travel expense reports (#602). In one transaction, under
 * the `travel_expense` rollout gate and the report row lock (the lock receipt
 * finalization and draft saves take), it checks the saved report against what
 * the employee reviewed, routes it to one eligible reviewer other than the
 * requester, creates the legacy approval rows and freezes the complete
 * revision. Any refusal or failure rolls everything back; nothing is ever
 * approved during submission, whatever the reimbursable total.
 */

type Database = typeof appDb;

export type SubmitTravelExpenseReportResult =
	| {
			kind: "submitted";
			approvalRequestId: string;
			reviewerEmployeeId: string;
			submittedRevisionId: string;
			submissionCycle: number;
			totals: ReportSubmissionTotals;
	  }
	| { kind: "not_found" }
	| { kind: "not_draft" }
	| { kind: "changed_since_review" }
	| { kind: "incomplete"; missing: TripReportMissingRequirements }
	/** Nobody but the requester could review it; setup guidance applies. */
	| { kind: "no_reviewer"; reason: "requester_inactive" | "no_eligible_reviewer" }
	/** A matched approval policy would let the requester approve their own report. */
	| { kind: "self_approval_route" }
	/** A matched approval policy could not resolve a stage approver; `message` is for logs. */
	| { kind: "routing_failed"; message: string }
	/** Amount-threshold policies exist, but the report is not in their currency. */
	| { kind: "threshold_currency_unsupported"; currency: string }
	/** The organization moved `travel_expense` to canonical authority, which has no report adapter. */
	| { kind: "authority_unsupported" };

type Refusal = Exclude<SubmitTravelExpenseReportResult, { kind: "submitted" }>;

class SubmissionRefused extends Error {
	constructor(readonly result: Refusal) {
		super(result.kind);
	}
}

function refuse(result: Refusal): never {
	throw new SubmissionRefused(result);
}

async function loadRoutingDirectory(
	tx: ApprovalDbService["db"],
	input: { organizationId: string; requesterEmployeeId: string },
) {
	const [employees, managerLinks, memberships, teams, settings] = await Promise.all([
		tx
			.select({
				id: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
				role: employee.role,
				teamId: employee.teamId,
			})
			.from(employee)
			.where(eq(employee.organizationId, input.organizationId)),
		tx
			.select({
				employeeId: employeeManagers.employeeId,
				managerId: employeeManagers.managerId,
				isPrimary: employeeManagers.isPrimary,
			})
			.from(employeeManagers)
			.where(eq(employeeManagers.employeeId, input.requesterEmployeeId)),
		tx
			.select({ employeeId: teamMembership.employeeId, teamId: teamMembership.teamId })
			.from(teamMembership)
			.where(
				and(
					eq(teamMembership.organizationId, input.organizationId),
					eq(teamMembership.employeeId, input.requesterEmployeeId),
				),
			),
		tx
			.select({
				id: team.id,
				organizationId: team.organizationId,
				primaryManagerId: team.primaryManagerId,
			})
			.from(team)
			.where(eq(team.organizationId, input.organizationId)),
		tx
			.select({ expenseApproverEmployeeId: travelExpenseSettings.expenseApproverEmployeeId })
			.from(travelExpenseSettings)
			.where(eq(travelExpenseSettings.organizationId, input.organizationId))
			.limit(1),
	]);
	return {
		employees,
		managerLinks,
		teamMemberships: memberships,
		teams,
		expenseApproverEmployeeId: settings[0]?.expenseApproverEmployeeId ?? null,
	};
}

/** Whether an active approval policy of the organization routes by amount. */
async function hasAmountThresholdPolicy(
	tx: ApprovalDbService["db"],
	organizationId: string,
): Promise<boolean> {
	const rows = await tx
		.select({ id: approvalPolicyCondition.id })
		.from(approvalPolicyCondition)
		.innerJoin(
			approvalPolicy,
			and(
				eq(approvalPolicy.id, approvalPolicyCondition.policyId),
				eq(approvalPolicy.organizationId, approvalPolicyCondition.organizationId),
			),
		)
		.where(
			and(
				eq(approvalPolicyCondition.organizationId, organizationId),
				eq(approvalPolicyCondition.conditionType, "travel_expense_amount"),
				eq(approvalPolicy.isActive, true),
			),
		)
		.limit(1);
	return rows.length > 0;
}

function policyContext(input: {
	organizationId: string;
	reportId: string;
	requesterEmployeeId: string;
	teamId: string | null;
	totals: ReportSubmissionTotals;
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: input.organizationId,
		approvalType: "travel_expense_report",
		requesterEmployeeId: input.requesterEmployeeId,
		teamId: input.teamId,
		locationId: null,
		absenceCategoryId: null,
		// Thresholds measure everything the reviewer approves, company-paid
		// costs included, so a zero reimbursable total never skips a stage.
		// Only an amount in the threshold currency is ever compared.
		travelExpenseAmount:
			input.totals.currency === APPROVAL_AMOUNT_THRESHOLD_CURRENCY
				? Number(input.totals.total)
				: null,
		overtimeRisk: null,
		employeeGroupIds: [],
		entityType: "travel_expense_report",
		entityId: input.reportId,
	};
}

function failureOf(cause: Cause.Cause<unknown>): unknown {
	return (
		Option.getOrNull(Cause.findErrorOption(cause)) ??
		Result.getOrNull(Cause.findDefect(cause)) ??
		new Error("An error has occurred")
	);
}

export async function submitTravelExpenseReport(
	database: Database,
	input: { owner: ReportOwner; reportId: string; reviewed: ReviewedReportVersions },
	now: Instant = systemClock.nowInstant(),
): Promise<SubmitTravelExpenseReportResult> {
	const { owner } = input;
	const submittedAt = dateFromInstant(now);
	try {
		return await database.transaction(async (tx) => {
			const dbService: ApprovalDbService = {
				db: tx,
				query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
			};
			// Rollout gate first, so the authority read holds until commit.
			const gate = await acquireApprovalWriteGate(dbService, {
				organizationId: owner.organizationId,
				workflowType: "travel_expense",
			});
			if (gate.authority !== "legacy") refuse({ kind: "authority_unsupported" });

			const [locked] = await tx
				.select({
					status: travelExpenseReport.status,
					submissionCount: travelExpenseReport.submissionCount,
					detailsVersion: travelExpenseReport.detailsVersion,
				})
				.from(travelExpenseReport)
				.where(
					and(
						eq(travelExpenseReport.id, input.reportId),
						eq(travelExpenseReport.organizationId, owner.organizationId),
						eq(travelExpenseReport.employeeId, owner.employeeId),
					),
				)
				.for("update");
			if (!locked) refuse({ kind: "not_found" });
			if (locked.status !== "draft") refuse({ kind: "not_draft" });

			const live = await loadTravelExpenseReportFactsInput(tx, {
				organizationId: owner.organizationId,
				reportId: input.reportId,
			});
			if (!live) refuse({ kind: "not_found" });
			const report = live.report;
			// Prices mileage with the policy effective today and stamps it for the frozen facts (#606).
			const mileage = await stampMileagePolicies(tx, {
				organizationId: owner.organizationId,
				reimbursementCurrency: report.reimbursementCurrency,
				items: live.items,
			});
			const check = checkReportSubmission(
				{
					kind: report.kind,
					reimbursementCurrency: report.reimbursementCurrency,
					detailsVersion: locked.detailsVersion,
					details:
						report.kind === "trip" && report.tripTimeZone
							? {
									purpose: report.tripPurpose,
									startDate: report.tripStartDate,
									endDate: report.tripEndDate,
									timeZone: report.tripTimeZone,
									destinations: report.tripDestinations,
								}
							: null,
					items: live.items
						.toSorted((left, right) => left.position - right.position)
						.map((item) => ({
							id: item.id,
							version: item.version,
							type: item.type,
							mileage: mileage.get(item.id) ?? null,
							receiptIds: live.receipts
								.filter((receipt) => receipt.itemId === item.id)
								.map((receipt) => receipt.id),
							draft: {
								expenseDate: item.expenseDate,
								category: item.category,
								description: item.description,
								amount: item.originalAmount,
								currency: item.originalCurrency,
								paidBy: item.paidBy,
								accountingReference: item.accountingReference,
							},
						})),
				},
				input.reviewed,
			);
			if (!check.ok) {
				refuse(
					check.reason === "incomplete"
						? { kind: "incomplete", missing: check.missing }
						: { kind: "changed_since_review" },
				);
			}

			const directory = await loadRoutingDirectory(tx, {
				organizationId: owner.organizationId,
				requesterEmployeeId: owner.employeeId,
			});
			const reviewer = resolveReportReviewer({
				organizationId: owner.organizationId,
				requesterEmployeeId: owner.employeeId,
				...directory,
			});
			if (!reviewer.ok && reviewer.reason === "requester_inactive") {
				refuse({ kind: "no_reviewer", reason: reviewer.reason });
			}
			// Thresholds are denominated in one known currency: an amount in another
			// currency is never compared as an unlabeled number where one could route.
			if (
				check.totals.currency !== APPROVAL_AMOUNT_THRESHOLD_CURRENCY &&
				(await hasAmountThresholdPolicy(tx, owner.organizationId))
			) {
				refuse({ kind: "threshold_currency_unsupported", currency: check.totals.currency });
			}

			const submissionCycle = locked.submissionCount + 1;
			const [submitted] = await tx
				.update(travelExpenseReport)
				.set({
					status: "submitted",
					submissionCount: sql`${travelExpenseReport.submissionCount} + 1`,
					submittedAt,
					decidedAt: null,
					updatedAt: submittedAt,
					updatedBy: owner.userId,
				})
				.where(
					and(
						eq(travelExpenseReport.id, input.reportId),
						eq(travelExpenseReport.organizationId, owner.organizationId),
						eq(travelExpenseReport.status, "draft"),
					),
				)
				.returning({ submissionCount: travelExpenseReport.submissionCount });
			if (submitted?.submissionCount !== submissionCycle) refuse({ kind: "not_draft" });

			const requester = directory.employees.find((candidate) => candidate.id === owner.employeeId);
			const routingExit = await Effect.runPromiseExit(
				resolvePolicyAndCreateApproval(dbService, {
					context: policyContext({
						organizationId: owner.organizationId,
						reportId: input.reportId,
						requesterEmployeeId: owner.employeeId,
						teamId: requester?.teamId ?? null,
						totals: check.totals,
					}),
					// Used only when no approval policy matches the report.
					defaultApproverId: reviewer.ok ? reviewer.reviewerId : null,
					transactionBehavior: "existing",
				}),
			);
			if (Exit.isFailure(routingExit)) {
				const failure = failureOf(routingExit.cause);
				if (failure instanceof ValidationError) {
					// Only the unmatched-policy path needs the default reviewer ("managerId").
					refuse(
						!reviewer.ok && failure.field === "managerId"
							? { kind: "no_reviewer", reason: reviewer.reason }
							: { kind: "routing_failed", message: failure.message },
					);
				}
				throw failure;
			}
			const routing = routingExit.value;
			if (routing.kind === "auto_completed") refuse({ kind: "self_approval_route" });
			if (routing.kind === "chain_created") {
				// A policy stage resolved to the requester was approved by the system.
				const selfStages = await tx
					.select({ id: approvalChainStageInstance.id })
					.from(approvalChainStageInstance)
					.where(
						and(
							eq(approvalChainStageInstance.organizationId, owner.organizationId),
							eq(approvalChainStageInstance.chainInstanceId, routing.chainInstanceId),
							eq(approvalChainStageInstance.resolvedApproverEmployeeId, owner.employeeId),
						),
					)
					.orderBy(asc(approvalChainStageInstance.stepOrder))
					.limit(1);
				if (selfStages.length > 0) refuse({ kind: "self_approval_route" });
			}
			const lifecycle = await verifyTravelExpenseReportLifecycle(tx, {
				organizationId: owner.organizationId,
				reportId: input.reportId,
				routing,
			});
			if (lifecycle.approverEmployeeId === owner.employeeId) {
				refuse({ kind: "self_approval_route" });
			}

			const frozen = await loadTravelExpenseReportFactsInput(tx, {
				organizationId: owner.organizationId,
				reportId: input.reportId,
			});
			if (!frozen) refuse({ kind: "not_found" });
			const facts = buildTravelExpenseReportSubmittedFacts(frozen);
			const [subject, submitter] = await Promise.all([
				loadEmployeeLabel(tx, owner.organizationId, { employeeId: owner.employeeId }),
				loadEmployeeLabel(tx, owner.organizationId, { userId: owner.userId }),
			]);
			if (!subject || submitter?.employeeId !== owner.employeeId) {
				throw new Error("The submitting employee could not be identified");
			}
			const revision = await captureTravelExpenseReportSubmittedRevision(tx, {
				organizationId: owner.organizationId,
				submittedAt: now,
				facts,
				labels: {
					subjectName: subject.name,
					submitterName: submitter.name,
					receiptFileNames: frozen.fileNames,
				},
				submitter: { employeeId: owner.employeeId, userId: owner.userId },
				legacy: {
					approvalRequestId: routing.approvalRequestId,
					chainInstanceId: lifecycle.chainInstanceId,
					observedWorkflowId: null,
				},
			});
			return {
				kind: "submitted",
				approvalRequestId: routing.approvalRequestId,
				reviewerEmployeeId: lifecycle.approverEmployeeId,
				submittedRevisionId: revision.id,
				submissionCycle,
				totals: check.totals,
			} as const;
		});
	} catch (error) {
		if (error instanceof SubmissionRefused) return error.result;
		throw error;
	}
}
