import { withReviewedVacationReconciliation } from "./vacation-reconciliation";
import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db as applicationDatabase } from "@/db";
import { user } from "@/db/auth-schema";
import {
	absenceChangeRequest,
	absenceEntry,
	approvalStageAssignment,
	employee,
} from "@/db/schema";
import { recordCanonicalDeputyDecisionOf } from "@/lib/approvals/deputy/deputy-decision-store";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { createCanonicalSourceApprovalRuntime } from "@/lib/approvals/server/period-submission-runtime";
import type { ApprovalWorkflowSnapshot } from "@/lib/approvals/workflow/ports";
import {
	ABSENCE_CHANGE_OBSOLETE_REASON,
	ABSENCE_CHANGE_OBSOLETE_SYSTEM_ID,
} from "@/lib/approvals/workflow/ports";
import {
	ApprovalWorkflowStartError,
	startApprovalWorkflow,
} from "@/lib/approvals/workflow/start-workflow";
import type { ApprovalWorkflowCommand } from "@/lib/approvals/workflow/state-machine";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type Clock,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { isUuid } from "@/lib/validations/uuid";
import {
	type AppliedAbsenceChange,
	publishAbsenceChange,
} from "./change-request-post-commit";
import {
	loadCanonicalCoverage,
	resolveProposedCoverage,
	validateAbsenceProposal,
} from "./change-request-proposal";
import type { AbsenceChangeRow } from "./change-request-records";
import {
	type AbsenceChangeDatabase,
	auditAbsenceChange,
	loadChangeRequest,
	originalAbsence,
	validateEffectiveAbsence,
} from "./change-request-store";
import {
	AbsenceChangeError,
	type AbsenceChangeRequestInput,
	type AbsenceChangeSummary,
} from "./change-request-types";
import { parseAbsenceChangeInput } from "./change-request-validation";

type Dependencies = {
	database?: AbsenceChangeDatabase;
	clock?: Clock;
	canManageApprovals?: () => Promise<boolean>;
};

export async function requestAbsenceChange(
	input: AbsenceChangeRequestInput & { organizationId: string; userId: string },
	dependencies: Dependencies = {},
) {
	const parsed = parseAbsenceChangeInput({
		absenceId: input.absenceId,
		kind: input.kind,
		proposed: input.proposed,
		reason: input.reason,
		...(input.kind === "change"
			? {
					coverage: input.coverage,
					historicalReconciliation: input.historicalReconciliation,
				}
			: {}),
	});
	input = { ...input, ...parsed };
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	const [requester] = await database
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.userId),
				employeeHasOrganizationAccess(clock.nowInstant()),
			),
		)
		.limit(1);
	if (!requester)
		throw new AbsenceChangeError("not_found", "Employee not found");
	const runtime = createCanonicalSourceApprovalRuntime(database, {
		clock,
		workflowType: "absence_change",
	});
	return runtime.repository
		.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as AbsenceChangeDatabase;
			await acquireExclusiveOrganizationConfigurationGuard(
				tx,
				input.organizationId,
			);
			const [absence] = await tx
				.select()
				.from(absenceEntry)
				.where(
					and(
						eq(absenceEntry.id, input.absenceId),
						eq(absenceEntry.organizationId, input.organizationId),
						eq(absenceEntry.employeeId, requester.id),
					),
				)
				.for("update");
			if (!absence)
				throw new AbsenceChangeError("not_found", "Absence not found");
			if (absence.status !== "approved")
				throw new AbsenceChangeError(
					"not_approved",
					"Only approved absences can receive change requests",
				);
			const [pending] = await tx
				.select({ id: absenceChangeRequest.id })
				.from(absenceChangeRequest)
				.where(
					and(
						eq(absenceChangeRequest.organizationId, input.organizationId),
						eq(absenceChangeRequest.absenceId, absence.id),
						eq(absenceChangeRequest.status, "pending"),
					),
				)
				.limit(1);
			if (pending)
				throw new AbsenceChangeError(
					"already_pending",
					"Withdraw the pending change request before submitting a replacement",
				);
			const original = originalAbsence(
				absence,
				await loadCanonicalCoverage(tx, {
					organizationId: input.organizationId,
					employeeId: requester.id,
					canonicalRecordId: absence.canonicalRecordId,
				}),
			);
			const proposed =
				input.kind === "change" && input.proposed
					? resolveProposedCoverage(
							original,
							input.proposed,
							input.coverage ?? "keep",
						)
					: null;
			const validateProposal = () =>
				validateAbsenceProposal(tx, {
					organizationId: input.organizationId,
					employeeId: requester.id,
					absenceId: absence.id,
					original,
					proposed,
					at: clock.nowInstant(),
				});
			const displacedVacations =
				input.historicalReconciliation && proposed
					? await withReviewedVacationReconciliation(
							tx,
							{
								organizationId: input.organizationId,
								actorUserId: input.userId,
								proof: input.historicalReconciliation,
								expectedChange: { absenceId: absence.id, proposed },
							},
							async (review) => {
								proposed.historicalReconciliationReview = {
									reason: review.sourceState.input.reason,
									totals: review.totals.map((total) => ({
										year: total.year,
										currentDays: total.currentDays,
										remainingDays: total.remainingDays,
										datedDays: total.datedDays,
									})),
									balances: review.balances.map((balance) => ({
										year: balance.year,
										before: balance.before?.remainingDays ?? null,
										after: balance.after?.remainingDays ?? null,
									})),
								};
								return validateProposal();
							},
						)
					: await validateProposal();
			if (proposed) {
				proposed.displacedVacations = displacedVacations;
				if (input.historicalReconciliation)
					proposed.historicalReconciliation = input.historicalReconciliation;
			}
			const [row] = await tx
				.insert(absenceChangeRequest)
				.values({
					organizationId: input.organizationId,
					employeeId: requester.id,
					absenceId: absence.id,
					kind: input.kind,
					original,
					proposed,
					reason: input.reason.trim(),
					submittedBy: input.userId,
					createdAt: dateFromInstant(clock.nowInstant()),
				})
				.returning();
			const routingContext = {
				organizationId: input.organizationId,
				workflowType: "absence_change" as const,
				source: { type: "absence_change_request", id: row.id },
				requesterEmployeeId: requester.id,
				teamIds: requester.teamId ? [requester.teamId] : [],
				locationId: null,
				absenceCategoryId: absence.categoryId,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
			};
			const link = (workflowId: string, affectedRows: number) => ({
				organizationId: input.organizationId,
				sourceType: "absence_change_request",
				sourceId: row.id,
				workflowId,
				affectedRows,
			});
			const started = await startApprovalWorkflow({
				nowInstant: () => clock.nowInstant(),
				context,
				organizationId: input.organizationId,
				workflowType: "absence_change",
				sourceIdentity: {
					organizationId: input.organizationId,
					workflowType: "absence_change",
					sourceType: "absence_change_request",
					sourceId: row.id,
				},
				requesterEmployeeId: requester.id,
				actor: {
					kind: "employee",
					employeeId: requester.id,
					userId: input.userId,
				},
				submissionKey: `absence-change:${row.id}`,
				defaultApproverEmployeeId:
					await getPrimaryEligibleManagerIdForRequester({
						db: tx,
						organizationId: input.organizationId,
						requesterEmployeeId: requester.id,
					}),
				routingContext,
				contextSnapshot: { ...routingContext },
				displayProjection: {
					displayPayload: {
						absenceId: absence.id,
						kind: row.kind,
						reason: row.reason,
						startDate: proposed?.startDate ?? original.startDate,
						endDate: proposed?.endDate ?? original.endDate,
					},
					searchText: `${row.reason} ${original.startDate} ${original.endDate}`,
				},
				bindSourceWorkflow: async (workflowId) => {
					const updated = await tx
						.update(absenceChangeRequest)
						.set({ approvalWorkflowId: workflowId })
						.where(
							and(
								eq(absenceChangeRequest.id, row.id),
								eq(absenceChangeRequest.organizationId, input.organizationId),
							),
						)
						.returning({ id: absenceChangeRequest.id });
					return link(workflowId, updated.length);
				},
				verifySourceWorkflow: async (workflowId) => {
					const linked = await tx
						.select({ id: absenceChangeRequest.id })
						.from(absenceChangeRequest)
						.where(
							and(
								eq(absenceChangeRequest.id, row.id),
								eq(absenceChangeRequest.organizationId, input.organizationId),
								eq(absenceChangeRequest.approvalWorkflowId, workflowId),
							),
						);
					return link(workflowId, linked.length);
				},
			});
			if (started.terminal)
				throw new AbsenceChangeError(
					"no_approver",
					"Another eligible approver is required",
				);
			await auditAbsenceChange(tx, {
				row,
				actorUserId: input.userId,
				action: "submitted",
				at: clock.nowInstant(),
			});
			return { id: row.id, workflowId: started.snapshot.id };
		})
		.catch((error: unknown) => {
			if (
				error instanceof ApprovalWorkflowStartError &&
				(error.code === "NO_DEFAULT_APPROVER" ||
					error.code === "ACTIVATION_FAILED")
			)
				throw new AbsenceChangeError(
					"no_approver",
					"No other eligible approver is available. Ask an administrator to configure approval routing.",
				);
			throw error;
		})
		.then(async (result) => {
			await publishAbsenceChange(database, {
				organizationId: input.organizationId,
				workflowId: result.workflowId,
				requestId: result.id,
			});
			return result;
		});
}

export async function decideAbsenceChange(
	input: {
		organizationId: string;
		actorEmployeeId: string;
		assignmentId: string;
		action: "approve" | "reject";
		reason?: string;
		allowOrganizationWideApprover?: boolean;
	},
	dependencies: Dependencies = {},
) {
	if (!isUuid(input.assignmentId) || !isUuid(input.actorEmployeeId))
		throw new AbsenceChangeError("not_found", "Approval not found");
	if (input.action === "reject" && !input.reason?.trim())
		throw new AbsenceChangeError(
			"reason_required",
			"A rejection reason is required",
		);
	if (input.reason && input.reason.length > 2000)
		throw new AbsenceChangeError("invalid_input", "The reason is too long");
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	const [actor] = await database
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, input.actorEmployeeId),
				employeeHasOrganizationAccess(clock.nowInstant()),
			),
		)
		.limit(1);
	if (!actor) throw new AbsenceChangeError("not_found", "Approver not found");
	const runtime = createCanonicalSourceApprovalRuntime(database, {
		clock,
		workflowType: "absence_change",
		canManageApproval: async (employeeId) =>
			input.allowOrganizationWideApprover === true &&
			employeeId === actor.id &&
			(await (dependencies.canManageApprovals?.() ?? canManageApprovals())),
	});
	let workflowToRetire: string | null = null;
	return runtime.repository
		.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as AbsenceChangeDatabase;
			const [assignment] = await tx
				.select()
				.from(approvalStageAssignment)
				.where(
					and(
						eq(approvalStageAssignment.id, input.assignmentId),
						eq(approvalStageAssignment.organizationId, input.organizationId),
					),
				)
				.limit(1);
			if (!assignment)
				throw new AbsenceChangeError("not_found", "Approval not found");
			const snapshot = await context.repository.loadSnapshot({
				organizationId: input.organizationId,
				workflowId: assignment.workflowId,
			});
			if (snapshot.workflowType !== "absence_change")
				throw new AbsenceChangeError("not_found", "Approval not found");
			workflowToRetire = snapshot.id;
			const command: Extract<
				ApprovalWorkflowCommand,
				{ type: "approve" | "reject" }
			> =
				input.action === "approve"
					? {
							type: "approve",
							stageId: assignment.stageId,
							assignmentId: assignment.id,
						}
					: {
							type: "reject",
							stageId: assignment.stageId,
							assignmentId: assignment.id,
							reason: input.reason?.trim() ?? "",
						};
			const execution =
				await runtime.transitionEngine.executeInTransactionWithDisposition(
					context,
					{
						organizationId: input.organizationId,
						workflowId: snapshot.id,
						expectedVersion: snapshot.version,
						idempotencyKey: `absence-change-decision:${assignment.id}:${input.action}:${createHash(
							"sha256",
						)
							.update(input.reason ?? "")
							.digest("hex")}`,
						principal: { kind: "employee", userId: actor.userId },
						command,
					},
				);
			if (execution.disposition === "executed")
				await recordCanonicalDeputyDecisionOf(tx, {
					organizationId: input.organizationId,
					command,
					result: execution.result,
					entityType: "absence_change_request",
					entityId: snapshot.sourceId,
					performedByUserId: actor.userId,
				});
			return {
				workflowId: snapshot.id,
				status: execution.result.snapshot.status,
				requestId: snapshot.sourceId,
				fresh: execution.disposition === "executed",
				applied: execution.finalization?.workOutcome as
					| AppliedAbsenceChange
					| undefined,
			};
		})
		.catch(async (error: unknown) => {
			// The adapter runs after authorization. Retirement starts only when that authorized
			// decision detected stale source data, after its failed transaction has rolled back.
			if (
				error instanceof AbsenceChangeError &&
				error.code === "obsolete" &&
				workflowToRetire
			) {
				const retiredWorkflowId = workflowToRetire;
				await runtime.repository.withTransaction(async (context) => {
					const tx = context.dbService.db as unknown as AbsenceChangeDatabase;
					const snapshot = await context.repository.loadSnapshot({
						organizationId: input.organizationId,
						workflowId: retiredWorkflowId,
					});
					if (
						snapshot.status !== "pending" ||
						snapshot.workflowType !== "absence_change"
					)
						return;
					const row = await loadChangeRequest(
						tx,
						input.organizationId,
						snapshot.sourceId,
					);
					if (row?.status !== "pending") return;
					await retirePendingChange(runtime, context, {
						row,
						snapshot,
						actorUserId: actor.userId,
						decisionReason: error.message,
						at: clock.nowInstant(),
					});
				});
			}
			throw error;
		})
		.then(async (result) => {
			if (result.fresh)
				await publishAbsenceChange(database, {
					organizationId: input.organizationId,
					workflowId: result.workflowId,
					requestId: result.requestId,
					applied: result.applied,
				});
			return { workflowId: result.workflowId, status: result.status };
		});
}

export async function withdrawAbsenceChange(
	input: { organizationId: string; userId: string; id: string },
	dependencies: Dependencies = {},
) {
	if (!isUuid(input.id))
		throw new AbsenceChangeError("not_found", "Change request not found");
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	const runtime = createCanonicalSourceApprovalRuntime(database, {
		clock,
		workflowType: "absence_change",
	});
	return runtime.repository
		.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as AbsenceChangeDatabase;
			const [requester] = await tx
				.select({ id: employee.id })
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, input.organizationId),
						eq(employee.userId, input.userId),
						employeeHasOrganizationAccess(clock.nowInstant()),
					),
				)
				.limit(1);
			if (!requester)
				throw new AbsenceChangeError("not_found", "Change request not found");
			const [row] = await tx
				.select()
				.from(absenceChangeRequest)
				.where(
					and(
						eq(absenceChangeRequest.organizationId, input.organizationId),
						eq(absenceChangeRequest.employeeId, requester.id),
						eq(absenceChangeRequest.id, input.id),
					),
				)
				.for("update");
			if (!row?.approvalWorkflowId)
				throw new AbsenceChangeError("not_found", "Change request not found");
			if (row.status !== "pending")
				throw new AbsenceChangeError(
					"not_pending",
					"Change request is already decided",
				);
			const snapshot = await context.repository.loadSnapshot({
				organizationId: input.organizationId,
				workflowId: row.approvalWorkflowId,
			});
			await runtime.transitionEngine.executeInTransactionWithDisposition(
				context,
				{
					organizationId: input.organizationId,
					workflowId: snapshot.id,
					expectedVersion: snapshot.version,
					idempotencyKey: `absence-change-withdraw:${row.id}`,
					principal: { kind: "employee", userId: input.userId },
					command: { type: "cancel", reason: "Withdrawn by the employee" },
				},
			);
			return { id: row.id, workflowId: snapshot.id };
		})
		.then(async (result) => {
			await publishAbsenceChange(database, {
				organizationId: input.organizationId,
				workflowId: result.workflowId,
				requestId: result.id,
			});
			return result;
		});
}

async function canManageApprovals(): Promise<boolean> {
	const { getAbility } = await import("@/lib/auth-helpers");
	return (await getAbility())?.cannot("manage", "Approval") === false;
}

/** Own history includes cancelled absences; pending requests are never hidden by the recent limit. */
export async function listOwnAbsenceChanges(
	input: { organizationId: string; userId: string },
	dependencies: Dependencies = {},
): Promise<AbsenceChangeSummary[]> {
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	const [requester] = await database
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.userId),
				employeeHasOrganizationAccess(clock.nowInstant()),
			),
		)
		.limit(1);
	if (!requester)
		throw new AbsenceChangeError("not_found", "Employee not found");
	const scope = and(
		eq(absenceChangeRequest.organizationId, input.organizationId),
		eq(absenceChangeRequest.employeeId, requester.id),
	);
	const waiting = await database
		.select()
		.from(absenceChangeRequest)
		.where(and(scope, eq(absenceChangeRequest.status, "pending")));
	if (waiting.length) {
		const runtime = createCanonicalSourceApprovalRuntime(database, {
			clock,
			workflowType: "absence_change",
		});
		for (const request of waiting) {
			if (!request.approvalWorkflowId) continue;
			const workflowId = request.approvalWorkflowId;
			const retired = await runtime.repository.withTransaction(
				async (context) => {
					const tx = context.dbService.db as unknown as AbsenceChangeDatabase;
					const snapshot = await context.repository.loadSnapshot({
						organizationId: input.organizationId,
						workflowId,
					});
					const row = await loadChangeRequest(
						tx,
						input.organizationId,
						request.id,
					);
					if (
						!row ||
						row.employeeId !== requester.id ||
						row.status !== "pending" ||
						snapshot.status !== "pending"
					)
						return false;
					try {
						await validateEffectiveAbsence(tx, row, clock.nowInstant());
						return false;
					} catch (error) {
						if (
							!(error instanceof AbsenceChangeError) ||
							error.code !== "obsolete"
						)
							throw error;
						await retirePendingChange(runtime, context, {
							row,
							snapshot,
							actorUserId: input.userId,
							decisionReason: error.message,
							at: clock.nowInstant(),
						});
						return true;
					}
				},
			);
			if (retired)
				await publishAbsenceChange(database, {
					organizationId: input.organizationId,
					workflowId: request.approvalWorkflowId,
					requestId: request.id,
				});
		}
	}
	const [pending, recent] = await Promise.all([
		database
			.select()
			.from(absenceChangeRequest)
			.where(and(scope, eq(absenceChangeRequest.status, "pending")))
			.orderBy(desc(absenceChangeRequest.createdAt)),
		database
			.select()
			.from(absenceChangeRequest)
			.where(scope)
			.orderBy(desc(absenceChangeRequest.createdAt))
			.limit(50),
	]);
	const deciderIds = [
		...new Set(
			[...pending, ...recent].flatMap((row) =>
				row.decidedBy ? [row.decidedBy] : [],
			),
		),
	];
	const deciders = deciderIds.length
		? await database
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, deciderIds))
		: [];
	const deciderNames = new Map(
		deciders.map((decider) => [decider.id, decider.name]),
	);
	return [
		...new Map([...pending, ...recent].map((row) => [row.id, row])).values(),
	].map((row) => ({
		id: row.id,
		absenceId: row.absenceId,
		kind: row.kind,
		status: row.status,
		original: row.original,
		proposed: row.proposed,
		reason: row.reason,
		decisionReason: row.decisionReason,
		createdAt: instantFromDate(row.createdAt).toString(),
		decidedAt: row.decidedAt ? instantFromDate(row.decidedAt).toString() : null,
		deciderName: row.decidedBy
			? (deciderNames.get(row.decidedBy) ?? null)
			: null,
	}));
}

/** One transition and audit path for a proposal whose reviewed facts are no longer valid. */
async function retirePendingChange(
	runtime: ReturnType<typeof createCanonicalSourceApprovalRuntime>,
	context: ApprovalWorkflowTransactionContext,
	input: {
		row: AbsenceChangeRow;
		snapshot: ApprovalWorkflowSnapshot;
		actorUserId: string;
		decisionReason: string;
		at: Instant;
	},
) {
	const tx = context.dbService.db as unknown as AbsenceChangeDatabase;
	await runtime.transitionEngine.executeInTransactionWithDisposition(context, {
		organizationId: input.row.organizationId,
		workflowId: input.snapshot.id,
		expectedVersion: input.snapshot.version,
		idempotencyKey: `absence-change-obsolete:${input.row.id}`,
		principal: { kind: "system", systemId: ABSENCE_CHANGE_OBSOLETE_SYSTEM_ID },
		command: { type: "cancel", reason: ABSENCE_CHANGE_OBSOLETE_REASON },
	});
	await tx
		.update(absenceChangeRequest)
		.set({ decisionReason: input.decisionReason, decidedBy: null })
		.where(
			and(
				eq(absenceChangeRequest.id, input.row.id),
				eq(absenceChangeRequest.organizationId, input.row.organizationId),
				eq(absenceChangeRequest.status, "obsolete"),
			),
		);
	await auditAbsenceChange(tx, {
		row: input.row,
		actorUserId: input.actorUserId,
		action: "obsolete",
		at: input.at,
	});
}
