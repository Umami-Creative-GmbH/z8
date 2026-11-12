import { randomUUID } from "node:crypto";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { resolveChangePolicy } from "@/lib/time-tracking/change-policy/resolution";
import { resolveReportReviewer } from "@/lib/travel-expenses/report-reviewer-routing";
import { periodSubmissionRoutingContext } from "../domain-adapters/period-submission.adapter";
import { PERIOD_SUBMISSION_SOURCE_TYPE } from "../domain-adapters/period-submission-contract";
import { decideLegacyRoute, type LegacyRouteDecision } from "../policies/legacy-route-decision";
import {
	type EligibleManagerEmployee,
	type EligibleTeamMembership,
	resolvePrimaryEligibleManager,
} from "../policies/manager-eligibility";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "../policies/types";
import {
	ApprovalStageActivationError,
	type ApprovalStageReviewerDirectory,
} from "../routing/approver-resolver";
import {
	ApprovalRoutingPolicyValidationError,
	findMatchingRoutingPolicy,
} from "../routing/policy-matcher";
import {
	createDatabaseStageActivationResolver,
	loadApprovalStageDirectory,
} from "../routing/stage-activation-resolver";
import type { ApprovalRoutingContext } from "../routing/types";
import type { ApprovalWorkflowSnapshot, JsonObject } from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import { ApprovalWorkflowStartError, planApprovalWorkflowStart } from "../workflow/start-workflow";
import {
	absenceCategoryVariants,
	absenceFallsBackToDefaultApprover,
	absenceNeedsApproval,
	expenseAmountVariants,
	expenseSelfApprovalRule,
	isOwnerOrAdminSelfRecording,
	manualWorkChangePolicyRule,
	shiftRequestDeciders,
	timeCorrectionDirectChange,
} from "./rules";
import {
	type ApprovalRouteCanonicalKind,
	type ApprovalRouteSnapshot,
	loadApprovalRouteSnapshot,
} from "./snapshot";
import {
	type ApprovalRoute,
	type ApprovalRouteKind,
	type ApprovalRouteNote,
	type ApprovalRouteOutcome,
	type ApprovalRoutePreview,
	type ApprovalRouteRequester,
	type ApprovalRouteStage,
	type ApprovalRouteStageTrace,
	type ApprovalRouteVariant,
	approvalRouteRequesterKey,
} from "./types";

/**
 * The approval route preview (Approvals glossary; Organization ADR 0007): how each covered
 * approval kind would route each requester at an explicit instant, worked out by the rules
 * submitting applies. Canonical kinds plan the workflow start with `planApprovalWorkflowStart`;
 * legacy kinds take the legacy route decision; built-in rules come from `./rules`.
 *
 * Organization-wide inputs are read once (`loadApprovalRouteSnapshot`); requesters are then routed
 * in memory, except a stage naming an approver who left, whose stand-in is read for that
 * requester as a start reads it. Nothing starts a workflow or writes a row: pass a read-only
 * reader when the caller needs that enforced.
 */
export async function previewApprovalRoutes(
	reader: DatabaseClient,
	input: {
		organizationId: string;
		at: Instant;
		requesters: readonly ApprovalRouteRequester[];
		/** Trace every canonical stage, later ones included (reads more per stage). */
		traceStages?: boolean;
	},
): Promise<ApprovalRoutePreview> {
	const snapshot = await loadApprovalRouteSnapshot(reader, {
		organizationId: input.organizationId,
		at: input.at,
	});
	return routeApprovalRequesters(
		snapshot,
		{ requesters: input.requesters, traceStages: input.traceStages },
		{
			loadNamedApproverDirectory: (args) =>
				loadApprovalStageDirectory(reader, {
					organizationId: input.organizationId,
					at: input.at,
					...args,
				}),
		},
	);
}

export interface ApprovalRouteDependencies {
	/**
	 * The directory a stage naming an approver who left resolves from, for one requester: the
	 * replacement chosen for them included. Called once per approver and requester.
	 */
	loadNamedApproverDirectory(input: {
		namedApproverId: string;
		stageId: string;
		requesterEmployeeId: string;
	}): Promise<ApprovalStageReviewerDirectory>;
}

/** Stands in for the source row a real start binds; nothing is written under it. */
const PREVIEW_SOURCE_ID = "00000000-0000-4000-8000-000000000000";

const CANONICAL_SOURCE_TYPE: Record<ApprovalRouteCanonicalKind, string> = {
	absence: "absence_entry",
	time_correction: "time_entry",
	manual_time_submission: "time_entry",
	period_submission: PERIOD_SUBMISSION_SOURCE_TYPE,
};

/** A requester as routing sees them. A prospective requester gets a stand-in employee id. */
type Requester = {
	id: string;
	teamId: string | null;
	userId: string | null;
	prospective: boolean;
};

type LegacyContext = Omit<
	ApprovalPolicyEvaluationContext,
	"organizationId" | "requesterEmployeeId" | "employeeGroupIds" | "entityId"
>;

type VariantOutcome = { variant: ApprovalRouteVariant; outcome: ApprovalRouteOutcome };

/**
 * Routes requesters over a snapshot in memory: the decisions of the approval route preview,
 * without the reads. `deps` answers the one per-requester read (a departed named approver).
 */
export async function routeApprovalRequesters(
	snapshot: ApprovalRouteSnapshot,
	input: { requesters: readonly ApprovalRouteRequester[]; traceStages?: boolean },
	deps: ApprovalRouteDependencies,
): Promise<ApprovalRoutePreview> {
	const { organizationId, at } = snapshot;

	const employeesById = new Map(snapshot.employees.map((row) => [row.id, row]));
	const requesters = input.requesters.map((requester): [string, Requester] => {
		const key = approvalRouteRequesterKey(requester);
		if (requester.kind === "prospective") {
			return [key, { id: randomUUID(), teamId: requester.teamId, userId: null, prospective: true }];
		}
		const row = employeesById.get(requester.employeeId);
		if (!row) {
			throw new Error(
				`Requester ${requester.employeeId} is not an employee of organization ${organizationId}`,
			);
		}
		return [key, { id: row.id, teamId: row.teamId, userId: row.userId, prospective: false }];
	});

	// Prospective requesters join the directories as an employee of their team: active, the role
	// `employee`, no manager links or groups of their own.
	const prospective = requesters.flatMap(([, requester]) =>
		requester.prospective ? [requester] : [],
	);
	const prospectiveEmployees: EligibleManagerEmployee[] = prospective.map((requester) => ({
		id: requester.id,
		organizationId,
		isActive: true,
		role: "employee",
		teamId: requester.teamId,
	}));
	const prospectiveMemberships: EligibleTeamMembership[] = prospective.flatMap((requester) =>
		requester.teamId ? [{ employeeId: requester.id, teamId: requester.teamId }] : [],
	);
	const withProspective = (
		directory: ApprovalStageReviewerDirectory,
	): ApprovalStageReviewerDirectory => ({
		...directory,
		employees: [...directory.employees, ...prospectiveEmployees],
		teamMemberships: [...directory.teamMemberships, ...prospectiveMemberships],
	});
	const stageDirectory = withProspective(snapshot.stageDirectory);
	const legacyDirectory = {
		employees: [
			...snapshot.employees.map(({ userId: _userId, ...row }) => row),
			...prospectiveEmployees,
		],
		managerLinks: snapshot.managerLinks,
		teamMemberships: [...snapshot.teamMemberships, ...prospectiveMemberships],
		teams: snapshot.teams,
	};

	const activeStageIds = new Set(
		snapshot.stageDirectory.employees.filter((row) => row.isActive).map((row) => row.id),
	);
	// A departed named approver's stand-in is chosen per requester: read once per (approver,
	// requester) for the whole preview. A planned stage is never stored, so no handover review
	// names it: the stage id can't change what is read.
	const namedDirectories = new Map<string, Promise<ApprovalStageReviewerDirectory>>();
	const activationResolver = createDatabaseStageActivationResolver({
		loadDirectory: async (_executor, args) => {
			if (args.namedApproverId === null || activeStageIds.has(args.namedApproverId)) {
				return stageDirectory;
			}
			const key = `${args.namedApproverId}:${args.requesterEmployeeId}`;
			let directory = namedDirectories.get(key);
			if (!directory) {
				directory = deps
					.loadNamedApproverDirectory({
						namedApproverId: args.namedApproverId,
						stageId: args.stageId,
						requesterEmployeeId: args.requesterEmployeeId,
					})
					.then(withProspective);
				namedDirectories.set(key, directory);
			}
			return directory;
		},
	});
	// Planning reads nothing itself: the policies and every directory come from the snapshot.
	const dbService = { db: null as never };

	const activeLegacyPolicies = snapshot.legacyPolicies.filter((policy) => policy.isActive);
	const absenceVariants = absenceCategoryVariants(
		snapshot.approvalCategoryIds,
		activeLegacyPolicies,
	);
	const expenseAmounts = expenseAmountVariants(activeLegacyPolicies);

	const changePolicyOf = (requester: Requester) =>
		resolveChangePolicy(
			snapshot.changePolicies,
			{
				organizationId,
				// A prospective requester has no employee assignment: their team's and the organization's apply.
				employeeId: requester.prospective ? null : requester.id,
				teamId: requester.teamId,
			},
			at,
		);

	const organizationRoleOf = (requester: Requester) =>
		requester.userId === null ? null : (snapshot.memberRoles.get(requester.userId) ?? null);

	function defaultApproverOf(requester: Requester): string | null {
		const result = resolvePrimaryEligibleManager({
			organizationId,
			requesterEmployeeId: requester.id,
			...legacyDirectory,
		});
		return result.ok ? result.managerId : null;
	}

	async function planCanonical(
		kind: ApprovalRouteCanonicalKind,
		requester: Requester,
		defaultApproverEmployeeId: string | null,
		routingContext: ApprovalRoutingContext,
	): Promise<ApprovalRouteOutcome> {
		const invalid = { kind: "unroutable", reason: { code: "invalid_policies" } } as const;
		const policies = snapshot.canonicalPolicies[kind];
		if (!policies || policies === "invalid") return invalid;
		let matched: ApprovalPolicyDraft | null;
		try {
			matched = findMatchingRoutingPolicy(routingContext, policies);
		} catch (error) {
			if (error instanceof ApprovalRoutingPolicyValidationError) return invalid;
			throw error;
		}
		try {
			const planned = await planApprovalWorkflowStart({
				context: { dbService, activationResolver },
				organizationId,
				workflowType: kind,
				sourceIdentity: {
					organizationId,
					workflowType: kind,
					sourceType: CANONICAL_SOURCE_TYPE[kind],
					sourceId: PREVIEW_SOURCE_ID,
				},
				requesterEmployeeId: requester.id,
				submissionKey: `approval-route-preview:${kind}:${requester.id}`,
				defaultApproverEmployeeId,
				routingContext,
				contextSnapshot: normalizeStableData(routingContext) as JsonObject,
				displaySnapshot: {},
				now: at,
				policies,
			});
			const { snapshot: workflow } = planned;
			if (workflow.status !== "approved" && workflow.status !== "pending") {
				throw new Error(`Approval workflow would not start pending: ${workflow.status}`);
			}
			const outcome: Extract<ApprovalRouteOutcome, { kind: "routed" }> = {
				kind: "routed",
				path: "canonical",
				policy: matched ? { id: matched.id, name: matched.name } : null,
				defaultApproverEmployeeId,
				stages: canonicalStages(workflow),
				autoCompleted: workflow.status === "approved",
				notes: [],
			};
			if (input.traceStages) await traceCanonicalStages(outcome.stages, workflow, routingContext);
			return outcome;
		} catch (error) {
			if (!(error instanceof ApprovalWorkflowStartError)) throw error;
			// A resolver that failed has not found nobody: the preview fails (#1302 review).
			if (
				error.code === "ACTIVATION_FAILED" &&
				error.details.activationCode === "resolver_failure"
			) {
				throw error;
			}
			if (error.code === "INVALID_POLICY") return invalid;
			if (error.code === "NO_DEFAULT_APPROVER") {
				return { kind: "unroutable", reason: { code: "no_default_approver" } };
			}
			if (error.code === "ACTIVATION_FAILED" || error.code === "ACTIVATION_LIMIT") {
				if (matched) {
					return {
						kind: "unroutable",
						reason: { code: "policy_unresolvable", policyId: matched.id, policyName: matched.name },
					};
				}
				return {
					kind: "unroutable",
					reason:
						defaultApproverEmployeeId && !activeStageIds.has(defaultApproverEmployeeId)
							? { code: "default_approver_departed" }
							: { code: "no_default_approver" },
				};
			}
			throw error;
		}
	}

	type StageResolution = Pick<ApprovalRouteStageTrace, "resolution" | "approverEmployeeIds">;

	/**
	 * Resolves one planned stage through the activation resolver the plan used. A waiting stage
	 * activates once the earlier ones decide, so it resolves as the transition engine activates a
	 * persisted workflow's stage.
	 */
	async function resolvePlannedStage(
		workflow: ApprovalWorkflowSnapshot,
		stage: ApprovalWorkflowSnapshot["stages"][number],
		routingContext: JsonObject,
		resolverSnapshot: JsonObject,
	): Promise<StageResolution> {
		try {
			const resolved = await activationResolver.resolve({
				dbService,
				organizationId,
				workflow,
				stage: { ...stage, resolverSnapshot },
				actor: { kind: "system", employeeId: null, userId: null },
				routingContext,
				...(stage.status === "waiting" ? { requesterMode: "existing_workflow" as const } : {}),
			});
			return resolved.activationMode === "requester_auto_approve"
				? { resolution: "requester_auto_approve", approverEmployeeIds: [] }
				: {
						resolution: "human",
						approverEmployeeIds: resolved.assignments.map(
							(assignment) => assignment.approverEmployeeId,
						),
					};
		} catch (error) {
			if (error instanceof ApprovalStageActivationError) {
				return { resolution: "unresolvable", approverEmployeeIds: [] };
			}
			throw error;
		}
	}

	/** Every stage of a planned route, later ones included, with fallbacks and stand-ins named. */
	async function traceCanonicalStages(
		stages: ApprovalRouteStage[],
		workflow: ApprovalWorkflowSnapshot,
		routingContext: ApprovalRoutingContext,
	) {
		const context = normalizeStableData(routingContext) as JsonObject;
		for (const [index, stage] of workflow.stages.entries()) {
			const routeStage = stages[index];
			if (!routeStage) continue;
			const resolved: StageResolution =
				stage.status === "waiting"
					? await resolvePlannedStage(workflow, stage, context, stage.resolverSnapshot)
					: {
							resolution:
								stage.activationMode === "requester_auto_approve"
									? "requester_auto_approve"
									: "human",
							approverEmployeeIds: stage.assignments.map(
								(assignment) => assignment.approverEmployeeId,
							),
						};
			const fallback = stage.resolverSnapshot.fallbackBehavior;
			// Without its fallback, would the stage still find the same people?
			const viaFallback =
				resolved.resolution !== "unresolvable" &&
				typeof fallback === "string" &&
				fallback !== "fail" &&
				!sameResolution(
					resolved,
					await resolvePlannedStage(workflow, stage, context, {
						...stage.resolverSnapshot,
						fallbackBehavior: "fail",
					}),
				);
			const named = stage.resolverSnapshot.approverEmployeeId;
			routeStage.trace = {
				...resolved,
				viaFallback,
				namedApprover:
					typeof named === "string"
						? { employeeId: named, active: activeStageIds.has(named) }
						: null,
			};
		}
	}

	/** What `resolvePolicyAndCreateApproval` would create, or why it fails. */
	function decideLegacy(
		requester: Requester,
		context: LegacyContext,
		defaultApproverId: string | null,
	): LegacyRouteDecision {
		return decideLegacyRoute({
			context: {
				...context,
				organizationId,
				requesterEmployeeId: requester.id,
				employeeGroupIds: [...(snapshot.employeeGroupIds.get(requester.id) ?? [])],
				entityId: PREVIEW_SOURCE_ID,
			},
			policies: snapshot.legacyPolicies,
			defaultApproverId,
			...legacyDirectory,
		});
	}

	function legacyContext(
		approvalType: LegacyContext["approvalType"],
		requester: Requester,
		overrides: Partial<LegacyContext> = {},
	): LegacyContext {
		return {
			approvalType,
			teamId: requester.teamId,
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: null,
			entityType: approvalType,
			...overrides,
		};
	}

	function canonicalContext(
		kind: ApprovalRouteCanonicalKind,
		requester: Requester,
		overrides: Partial<ApprovalRoutingContext>,
	): ApprovalRoutingContext {
		return {
			organizationId,
			workflowType: kind,
			source: { type: CANONICAL_SOURCE_TYPE[kind], id: PREVIEW_SOURCE_ID },
			requesterEmployeeId: requester.id,
			teamIds: requester.teamId ? [requester.teamId] : [],
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: null,
			employeeGroupIds: [],
			...overrides,
		};
	}

	async function absenceRoute(requester: Requester): Promise<ApprovalRoute> {
		if (!absenceNeedsApproval(snapshot.approvalCategoryIds)) {
			return skipped("no_category_requires_approval");
		}
		const defaultApproverId = defaultApproverOf(requester);
		const canonical = snapshot.authority.absence === "canonical";
		const variants: VariantOutcome[] = [];
		for (const absenceCategoryId of absenceVariants) {
			const variant = { absenceCategoryId };
			if (canonical) {
				variants.push({
					variant,
					outcome: await planCanonical(
						"absence",
						requester,
						defaultApproverId,
						canonicalContext("absence", requester, { absenceCategoryId }),
					),
				});
				continue;
			}
			const decision = decideLegacy(
				requester,
				legacyContext("absence_entry", requester, { absenceCategoryId }),
				defaultApproverId,
			);
			if (decision.kind === "failure" && absenceFallsBackToDefaultApprover(decision)) {
				variants.push({
					variant,
					outcome: defaultApproverId
						? legacyDefaultOutcome(requester.id, defaultApproverId)
						: { kind: "unroutable", reason: { code: "no_default_approver" } },
				});
				continue;
			}
			variants.push({ variant, outcome: legacyOutcome(decision, defaultApproverId) });
		}
		return combine(variants);
	}

	async function routeTimeKind(
		kind: "time_correction" | "manual_time_submission",
		requester: Requester,
		notes: ApprovalRouteNote[],
	): Promise<ApprovalRoute> {
		const overtimeRisk = kind === "manual_time_submission" ? ("none" as const) : null;
		const defaultApproverId = defaultApproverOf(requester);
		const outcome =
			snapshot.authority[kind] === "canonical"
				? await planCanonical(
						kind,
						requester,
						defaultApproverId,
						canonicalContext(kind, requester, { overtimeRisk }),
					)
				: legacyOutcome(
						decideLegacy(
							requester,
							legacyContext("time_entry", requester, { overtimeRisk }),
							defaultApproverId,
						),
						defaultApproverId,
					);
		return combine([{ variant: {}, outcome }], notes);
	}

	async function timeCorrectionRoute(requester: Requester): Promise<ApprovalRoute> {
		const direct = timeCorrectionDirectChange(changePolicyOf(requester));
		return routeTimeKind(
			"time_correction",
			requester,
			direct ? [{ code: "direct_change", cause: direct }] : [],
		);
	}

	async function manualWorkRoute(requester: Requester): Promise<ApprovalRoute> {
		if (!requester.prospective && isOwnerOrAdminSelfRecording(organizationRoleOf(requester))) {
			return skipped("owner_admin_self");
		}
		const rule = manualWorkChangePolicyRule(changePolicyOf(requester));
		if (rule.skip) return skipped(rule.skip);
		return routeTimeKind("manual_time_submission", requester, rule.notes);
	}

	async function periodSubmissionRoute(requester: Requester): Promise<ApprovalRoute> {
		// A canonical-only kind: the write gate opens only in complete mode.
		if (!snapshot.periodSubmissionWriteGateOpen) {
			return unroutable({ code: "approval_mode_unsupported" });
		}
		const routingContext = periodSubmissionRoutingContext({
			organizationId,
			submissionId: PREVIEW_SOURCE_ID,
			requesterEmployeeId: requester.id,
			teamIds: requester.teamId ? [requester.teamId] : [],
		});
		return combine([
			{
				variant: {},
				outcome: await planCanonical(
					"period_submission",
					requester,
					defaultApproverOf(requester),
					routingContext,
				),
			},
		]);
	}

	function expenseReportRoute(requester: Requester): ApprovalRoute {
		// Submitting refuses outside legacy authority: nobody can submit a report.
		if (snapshot.authority.travel_expense !== "legacy") {
			return unroutable({ code: "approval_mode_unsupported" });
		}
		const reviewer = resolveReportReviewer({
			organizationId,
			requesterEmployeeId: requester.id,
			...legacyDirectory,
			expenseApproverEmployeeId: snapshot.expenseApproverEmployeeId,
			requesterIsOrganizationOwner:
				!requester.prospective && hasOrganizationRole(organizationRoleOf(requester), "owner"),
		});
		if (!reviewer.ok && reviewer.reason === "requester_inactive") {
			return unroutable({ code: "no_default_approver" });
		}
		const ownerAlone = reviewer.ok && reviewer.source === "owner_self_approval";
		const defaultApproverId = reviewer.ok ? reviewer.reviewerId : null;
		const variants = expenseAmounts.map((travelExpenseAmount): VariantOutcome => {
			const variant = { travelExpenseAmount };
			const outcome = legacyOutcome(
				decideLegacy(
					requester,
					legacyContext("travel_expense_report", requester, { travelExpenseAmount }),
					defaultApproverId,
				),
				defaultApproverId,
			);
			if (outcome.kind !== "routed") return { variant, outcome };
			const verdict = expenseSelfApprovalRule({
				requesterEmployeeId: requester.id,
				autoCompleted: outcome.autoCompleted,
				stageApproverIds: outcome.stages.flatMap((stage) => stage.approverEmployeeIds),
				ownerAlone,
			});
			if (verdict === "refused") {
				return {
					variant,
					outcome: { kind: "unroutable", reason: { code: "self_approval_route" } },
				};
			}
			return {
				variant,
				outcome:
					verdict === "owner_self_approval"
						? { ...outcome, notes: [{ code: "owner_self_approval" }] }
						: outcome,
			};
		});
		return combine(variants, [{ code: "report_contents_checked_at_submit" }]);
	}

	function shiftRequestRoute(requester: Requester): ApprovalRoute {
		const deciders = shiftRequestDeciders(snapshot.roster);
		if (deciders.length === 0) return unroutable({ code: "no_decider" });
		const others = deciders.filter((id) => id !== requester.id);
		const alone = others.length === 0;
		return combine([
			{
				variant: {},
				outcome: {
					kind: "routed",
					path: "shift_deciders",
					policy: null,
					defaultApproverEmployeeId: null,
					stages: [
						{
							sequence: 1,
							label: null,
							approverType: "manager_or_admin",
							fallbackBehavior: null,
							approverEmployeeIds: alone ? deciders : others,
							activation: alone ? "requester_auto_approve" : "human",
						},
					],
					// The request stays pending until they decide it themselves.
					autoCompleted: false,
					notes: alone ? [{ code: "requester_only_decider" }] : [],
				},
			},
		]);
	}

	const routes = new Map<string, Map<ApprovalRouteKind, ApprovalRoute>>();
	for (const [key, requester] of requesters) {
		const byKind = new Map<ApprovalRouteKind, ApprovalRoute>();
		for (const kind of snapshot.kinds) {
			switch (kind) {
				case "absence":
					byKind.set(kind, await absenceRoute(requester));
					break;
				case "time_correction":
					byKind.set(kind, await timeCorrectionRoute(requester));
					break;
				case "manual_time_submission":
					byKind.set(kind, await manualWorkRoute(requester));
					break;
				case "period_submission":
					byKind.set(kind, await periodSubmissionRoute(requester));
					break;
				case "travel_expense":
					byKind.set(kind, expenseReportRoute(requester));
					break;
				case "shift_request":
					byKind.set(kind, shiftRequestRoute(requester));
					break;
			}
		}
		routes.set(key, byKind);
	}
	return { kinds: snapshot.kinds, offKinds: snapshot.offKinds, routes };
}

function skipped(reason: Extract<ApprovalRoute, { kind: "skipped" }>["reason"]): ApprovalRoute {
	return { kind: "skipped", reason, notes: [], variants: [] };
}

function unroutable(
	reason: Extract<ApprovalRoute, { kind: "unroutable" }>["reason"],
): ApprovalRoute {
	return { kind: "unroutable", reason, notes: [], variants: [] };
}

/** Unroutable when any variant is; routed otherwise, auto-completed when every variant is. */
function combine(variants: VariantOutcome[], notes: ApprovalRouteNote[] = []): ApprovalRoute {
	for (const { outcome } of variants) {
		if (outcome.kind === "unroutable") {
			return { kind: "unroutable", reason: outcome.reason, notes, variants };
		}
	}
	return {
		kind: "routed",
		autoCompleted:
			variants.length > 0 &&
			variants.every(({ outcome }) => outcome.kind === "routed" && outcome.autoCompleted),
		notes,
		variants,
	};
}

/** A legacy decision as a route outcome. */
function legacyOutcome(
	decision: LegacyRouteDecision,
	defaultApproverId: string | null,
): ApprovalRouteOutcome {
	if (decision.kind === "failure") {
		switch (decision.reason) {
			case "invalid_policies":
				return { kind: "unroutable", reason: { code: "invalid_policies" } };
			case "no_default_approver":
				return { kind: "unroutable", reason: { code: "no_default_approver" } };
			case "stage_unresolvable":
			case "policy_has_no_stages":
				return {
					kind: "unroutable",
					reason: {
						code: "policy_unresolvable",
						policyId: decision.policy.id,
						policyName: decision.policy.name,
					},
				};
		}
	}
	switch (decision.kind) {
		case "default": {
			const self = decision.disposition.kind === "auto_approve";
			return {
				kind: "routed",
				path: "legacy",
				policy: null,
				defaultApproverEmployeeId: decision.approverEmployeeId,
				stages: [defaultStage(decision.approverEmployeeId, self)],
				autoCompleted: self,
				notes: [],
			};
		}
		case "policy":
			return {
				kind: "routed",
				path: "legacy",
				policy: { id: decision.policy.id, name: decision.policy.name },
				defaultApproverEmployeeId: defaultApproverId,
				stages: decision.stages.map(({ stage, approverEmployeeId, disposition }) => ({
					sequence: stage.stepOrder,
					label: stage.label,
					approverType: stage.approverType,
					fallbackBehavior: null,
					approverEmployeeIds: [approverEmployeeId],
					activation: disposition.kind === "auto_approve" ? "requester_auto_approve" : "human",
				})),
				autoCompleted: decision.autoCompleted,
				notes: [],
			};
	}
}

/** The legacy default-approver route: one stage, the requester's default approver. */
function legacyDefaultOutcome(
	requesterId: string,
	approverEmployeeId: string,
): Extract<ApprovalRouteOutcome, { kind: "routed" }> {
	const self = approverEmployeeId === requesterId;
	return {
		kind: "routed",
		path: "legacy",
		policy: null,
		defaultApproverEmployeeId: approverEmployeeId,
		stages: [defaultStage(approverEmployeeId, self)],
		autoCompleted: self,
		notes: [],
	};
}

function defaultStage(approverEmployeeId: string, self: boolean): ApprovalRouteStage {
	return {
		sequence: 1,
		label: null,
		approverType: "default_approver",
		fallbackBehavior: null,
		approverEmployeeIds: [approverEmployeeId],
		activation: self ? "requester_auto_approve" : "human",
	};
}

function canonicalStages(workflow: ApprovalWorkflowSnapshot): ApprovalRouteStage[] {
	return workflow.stages.map((stage) => ({
		sequence: stage.sequence,
		label: stage.label || null,
		approverType: String(stage.resolverSnapshot.approverType ?? ""),
		fallbackBehavior:
			typeof stage.resolverSnapshot.fallbackBehavior === "string"
				? stage.resolverSnapshot.fallbackBehavior
				: null,
		approverEmployeeIds: stage.assignments.map((assignment) => assignment.approverEmployeeId),
		activation:
			stage.status === "waiting"
				? "not_activated"
				: stage.activationMode === "requester_auto_approve"
					? "requester_auto_approve"
					: "human",
	}));
}

function sameResolution(
	left: Pick<ApprovalRouteStageTrace, "resolution" | "approverEmployeeIds">,
	right: Pick<ApprovalRouteStageTrace, "resolution" | "approverEmployeeIds">,
) {
	if (left.resolution !== right.resolution) return false;
	const rightIds = new Set(right.approverEmployeeIds);
	return (
		left.approverEmployeeIds.length === rightIds.size &&
		left.approverEmployeeIds.every((id) => rightIds.has(id))
	);
}
