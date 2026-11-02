import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { absenceCategory, employee } from "@/db/schema";
import { scheduledWeekdays, type WeekdayName } from "@/lib/absences/working-days";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import { loadEffectiveWorkPolicies } from "@/lib/work-policy/effective-work-policies";
import {
	type ApproverGoLiveKind,
	type ApproverKindResolution,
	type ApproverRoute,
	type ApproverSkipReason,
	type ApproverUnroutableCause,
	type ApproverVariant,
	type ApproverVariantResult,
	loadApproverRouting,
} from "./approver-routing";
import { APPROVER_KIND_LABEL, approverFixLink } from "./checks/approver";
import { EMPLOYEES_SETTINGS_HREF, PAYROLL_EXPORT_SETTINGS_HREF } from "./checks/payroll-setup";
import { WORK_POLICY_ASSIGNMENTS_HREF } from "./checks/work-policy";
import { resolveGoLiveGroup } from "./group";
import { readPayrollPrerequisites } from "./payroll-prerequisites";
import { readOnlyGoLive } from "./read-only";
import type {
	GoLiveRehearsal,
	GoLiveRehearsalKind,
	GoLiveRehearsalPerson,
	GoLiveRehearsalResult,
	GoLiveRehearsalRoute,
	GoLiveRehearsalVariant,
	GoLiveRehearsalWorkPolicy,
} from "./rehearsal-types";
import {
	type GoLiveAsOf,
	type GoLiveFixLinkResolver,
	type GoLiveGroup,
	type GoLiveMember,
	type GoLiveMessage,
	goLiveMemberKey,
} from "./types";

const WEEKDAYS: readonly WeekdayName[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

/**
 * The go-live rehearsal (Organization ADR 0007): for one checked member of the go-live group,
 * their effective work policy today, how each covered approval kind would route (every stage,
 * fallbacks and stand-ins included) and their payroll prerequisites. It resolves exactly as the
 * go-live checks do (the same group, `loadEffectiveWorkPolicies`, `loadApproverRouting`,
 * `readPayrollPrerequisites`), so the two never disagree, all in one read-only transaction: it
 * writes nothing, starts no workflow and sends nothing.
 *
 * Only a member of the go-live group can be rehearsed: former or excluded employees and ids from
 * another organization are refused as not checked.
 */
export async function rehearseGoLiveMember(
	db: DatabaseClient,
	input: {
		organizationId: string;
		asOf: GoLiveAsOf;
		/** `goLiveMemberKey` of the member to rehearse. */
		memberKey: string;
		fixLink: GoLiveFixLinkResolver;
	},
): Promise<GoLiveRehearsalResult> {
	const { organizationId, asOf, fixLink } = input;
	return readOnlyGoLive(db, async (reader) => {
		const group = await resolveGoLiveGroup(reader, organizationId, asOf);
		const member = group.members.find(
			(candidate) => goLiveMemberKey(candidate) === input.memberKey,
		);
		if (!member) return { ok: false, refusal: "member_not_checked" };

		const policies = await loadEffectiveWorkPolicies(reader, {
			organizationId,
			employees: [workPolicyPerson(member)],
			at: asOf.instant,
		});
		const routing = await loadApproverRouting(reader, {
			organizationId,
			asOf,
			members: [member],
			traceStages: true,
		});
		const resolutions = await routing.resolve(member);
		const prerequisites = await readPayrollPrerequisites(reader, {
			organizationId,
			asOf,
			member,
			groupEmployeeIds: group.members.flatMap((candidate) =>
				candidate.kind === "employee" ? [candidate.employeeId] : [],
			),
		});
		// One query at a time: they share the transaction's connection.
		const people = await loadPeople(reader, organizationId, employeeIdsIn(resolutions));
		const categories = await loadCategoryNames(reader, organizationId, categoryIdsIn(resolutions));

		const rehearsal: GoLiveRehearsal = {
			member,
			asOf: {
				instant: asOf.instant.toString(),
				timezone: asOf.timezone,
				today: asOf.today.toString(),
			},
			workPolicy: workPolicyTrace(policies.get(workPolicyPerson(member).id) ?? null, fixLink),
			approvals: {
				kinds: [...resolutions].map(([kind, resolution]) =>
					kindTrace(kind, resolution, { member, group, people, categories, fixLink }),
				),
				offKinds: [...routing.offKinds],
			},
			payroll: prerequisites.mandatory
				? {
						prerequisites,
						payrollExportFix: fixLink(PAYROLL_EXPORT_SETTINGS_HREF, {
							key: "settings.implementationChecklist.goLive.payrollSetup.fixPayrollExport",
							fallback: "Open payroll export settings",
						}),
						employeesFix: fixLink(EMPLOYEES_SETTINGS_HREF, {
							key: "settings.implementationChecklist.goLive.payrollSetup.fixEmployees",
							fallback: "Review employees",
						}),
					}
				: null,
		};
		return { ok: true, rehearsal };
	});
}

/** Who work policies resolve for: an invitee as a person of their draft team (#1513). */
function workPolicyPerson(member: GoLiveMember) {
	return member.kind === "employee"
		? { id: member.employeeId, teamId: member.primaryTeamId }
		: { id: member.draftId, teamId: member.teamId };
}

function workPolicyTrace(
	policy: EffectiveWorkPolicy | null,
	fixLink: GoLiveFixLinkResolver,
): GoLiveRehearsalWorkPolicy {
	if (!policy) {
		return {
			status: "none",
			fix: fixLink(WORK_POLICY_ASSIGNMENTS_HREF, {
				key: "settings.implementationChecklist.goLive.workPolicy.fix",
				fallback: "Assign work policies",
			}),
		};
	}
	const { schedule } = policy;
	return {
		status: "resolved",
		policyId: policy.policyId,
		policyName: policy.policyName,
		assignmentType: policy.assignmentType,
		assignedVia: policy.assignedVia,
		schedule: schedule
			? {
					cycle: schedule.scheduleCycle,
					hours: scheduleHours(schedule),
					workingDays: [...scheduledWeekdays(schedule)]
						.toSorted((left, right) => left - right)
						.flatMap((isoDay) => WEEKDAYS[isoDay - 1] ?? []),
				}
			: null,
	};
}

/** Hours per cycle: a simple schedule names them; a detailed one adds up its work days. */
function scheduleHours(schedule: NonNullable<EffectiveWorkPolicy["schedule"]>): number | null {
	if (schedule.scheduleType === "simple") {
		const hours = schedule.hoursPerCycle === null ? Number.NaN : Number(schedule.hoursPerCycle);
		return Number.isFinite(hours) ? hours : null;
	}
	return schedule.days.reduce(
		(total, day) => (day.isWorkDay ? total + (Number(day.hoursPerDay) || 0) : total),
		0,
	);
}

type TraceContext = {
	member: GoLiveMember;
	group: GoLiveGroup;
	people: ReadonlyMap<string, string>;
	categories: ReadonlyMap<string, string>;
	fixLink: GoLiveFixLinkResolver;
};

function kindTrace(
	kind: ApproverGoLiveKind,
	resolution: ApproverKindResolution,
	context: TraceContext,
): GoLiveRehearsalKind {
	const teamId =
		context.member.kind === "employee" ? context.member.primaryTeamId : context.member.teamId;
	const variants = resolution.variants.map(({ variant, result }) =>
		variantTrace(variant, result, context),
	);
	return {
		kind,
		label: {
			key: "settings.implementationChecklist.rehearsal.approvals.kind",
			fallback:
				"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}",
			params: { kind: APPROVER_KIND_LABEL[kind] },
		},
		status: resolution.status,
		reason:
			resolution.status === "skipped"
				? skipReason(resolution.reason)
				: resolution.status === "unroutable"
					? unroutableReason(resolution.cause, teamId, context.group)
					: null,
		fix:
			resolution.status === "unroutable"
				? approverFixLink(resolution.cause, teamId, context.fixLink)
				: null,
		variants: collapse(variants),
	};
}

/** Variants that all go the same way read as one. */
function collapse(variants: GoLiveRehearsalVariant[]): GoLiveRehearsalVariant[] {
	const [first] = variants;
	if (!first) return [];
	const outcome = (variant: GoLiveRehearsalVariant) =>
		JSON.stringify({ status: variant.status, route: variant.route, reason: variant.reason });
	const shared = outcome(first);
	return variants.every((variant) => outcome(variant) === shared)
		? [{ ...first, label: null }]
		: variants;
}

function variantTrace(
	variant: ApproverVariant,
	result: ApproverVariantResult,
	context: TraceContext,
): GoLiveRehearsalVariant {
	const teamId =
		context.member.kind === "employee" ? context.member.primaryTeamId : context.member.teamId;
	return {
		label: variantLabel(variant, context.categories),
		status: result.status,
		route: result.status === "unroutable" ? null : routeTrace(result.route, context),
		reason:
			result.status === "skipped"
				? skipReason(result.reason)
				: result.status === "unroutable"
					? unroutableReason(result.cause, teamId, context.group)
					: null,
	};
}

function variantLabel(
	variant: ApproverVariant,
	categories: ReadonlyMap<string, string>,
): GoLiveMessage | null {
	if (variant.absenceCategoryId) {
		return {
			key: "settings.implementationChecklist.rehearsal.approvals.absenceCategory",
			fallback: "Absence category {category}",
			params: { category: categories.get(variant.absenceCategoryId) ?? variant.absenceCategoryId },
		};
	}
	if (variant.travelExpenseAmount !== undefined) {
		return {
			key: "settings.implementationChecklist.rehearsal.approvals.reportTotal",
			fallback: "Report total {amount, number}",
			params: { amount: variant.travelExpenseAmount },
		};
	}
	return null;
}

function routeTrace(route: ApproverRoute, context: TraceContext): GoLiveRehearsalRoute {
	const person = (employeeId: string): GoLiveRehearsalPerson => ({
		employeeId,
		displayName: context.people.get(employeeId) ?? employeeId,
	});
	return {
		path: route.path,
		policyName: route.policy?.name ?? null,
		stages: route.stages.map((stage) => {
			const trace = stage.trace;
			const named = trace?.namedApprover;
			const approverIds = trace?.approverEmployeeIds ?? stage.approverEmployeeIds;
			return {
				sequence: stage.sequence,
				label: stage.label,
				approverType: stage.approverType,
				fallbackBehavior: stage.fallbackBehavior,
				activates: stage.activation === "not_activated" ? "after_earlier_stages" : "at_submission",
				resolution:
					trace?.resolution ??
					(stage.activation === "requester_auto_approve" ? "requester_auto_approve" : "human"),
				approvers: approverIds.map(person),
				viaFallback: trace?.viaFallback ?? false,
				standsInFor:
					named && !named.active && !approverIds.includes(named.employeeId)
						? person(named.employeeId)
						: null,
			};
		}),
	};
}

function employeeIdsIn(resolutions: ReadonlyMap<ApproverGoLiveKind, ApproverKindResolution>) {
	const ids = new Set<string>();
	for (const resolution of resolutions.values()) {
		for (const { result } of resolution.variants) {
			if (result.status === "unroutable") continue;
			for (const stage of result.route.stages) {
				for (const id of stage.trace?.approverEmployeeIds ?? stage.approverEmployeeIds) ids.add(id);
				if (stage.trace?.namedApprover) ids.add(stage.trace.namedApprover.employeeId);
			}
		}
	}
	return [...ids];
}

function categoryIdsIn(resolutions: ReadonlyMap<ApproverGoLiveKind, ApproverKindResolution>) {
	return [
		...new Set(
			[...resolutions.values()].flatMap((resolution) =>
				resolution.variants.flatMap(({ variant }) =>
					variant.absenceCategoryId ? [variant.absenceCategoryId] : [],
				),
			),
		),
	];
}

/** Display names of the organization's employees (former ones too: a stand-in names who left). */
async function loadPeople(
	db: DatabaseClient,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await db
		.select({ id: employee.id, name: user.name, email: user.email })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, organizationId), inArray(employee.id, [...employeeIds])),
		);
	return new Map(rows.map((row) => [row.id, row.name || row.email]));
}

async function loadCategoryNames(
	db: DatabaseClient,
	organizationId: string,
	categoryIds: readonly string[],
): Promise<Map<string, string>> {
	if (categoryIds.length === 0) return new Map();
	const rows = await db
		.select({ id: absenceCategory.id, name: absenceCategory.name })
		.from(absenceCategory)
		.where(
			and(
				eq(absenceCategory.organizationId, organizationId),
				inArray(absenceCategory.id, [...categoryIds]),
			),
		);
	return new Map(rows.map((row) => [row.id, row.name]));
}

/** Why no approval is needed, as the request path decides it. */
function skipReason(reason: ApproverSkipReason): GoLiveMessage {
	switch (reason) {
		case "change_policy_no_policy":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.noChangePolicy",
				fallback: "No change policy applies to them.",
			};
		case "change_policy_trust_mode":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.trustMode",
				fallback: "Their change policy is in trust mode.",
			};
		case "change_policy_within_self_service":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.selfService",
				fallback: "Their change policy only allows changes within its self-service days.",
			};
		case "owner_admin_self":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.ownerAdmin",
				fallback: "Owners and admins record their own work directly.",
			};
		case "no_category_requires_approval":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.noCategoryRequiresApproval",
				fallback: "No absence category requires approval.",
			};
		case "requester_is_approver":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.ownApprover",
				fallback: "They are their own approver, so their requests complete at once.",
			};
		case "owner_self_approval":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.ownerSelfApproval",
				fallback: "As the owner, they approve their own reports, because nobody else can.",
			};
	}
}

/** Why a request of the kind wouldn't get an approver, for this one member. */
function unroutableReason(
	cause: ApproverUnroutableCause,
	teamId: string | null,
	group: GoLiveGroup,
): GoLiveMessage {
	switch (cause.code) {
		case "no_default_approver": {
			const team = teamId ? group.teamNames.get(teamId) : undefined;
			return team
				? {
						key: "settings.implementationChecklist.rehearsal.approvals.unroutable.teamWithoutManager",
						fallback: "No approval policy applies, and team {team} has no eligible manager.",
						params: { team },
					}
				: {
						key: "settings.implementationChecklist.rehearsal.approvals.unroutable.noManager",
						fallback: "No approval policy applies, and they have no eligible manager.",
					};
		}
		case "default_approver_departed":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.managerDeparted",
				fallback: "Their manager has left and nobody stands in.",
			};
		case "policy_unresolvable":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.policyWithoutApprover",
				fallback: "Approval policy {policy} finds no approver for them.",
				params: { policy: cause.policyName },
			};
		case "invalid_policies":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.invalidPolicies",
				fallback: "The approval policies can't be applied.",
			};
		case "self_approval_route":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.selfApprovalRoute",
				fallback: "Their reports would go to themselves, which isn't allowed.",
			};
		case "approval_mode_unsupported":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.approvalModeUnsupported",
				fallback: "They can't be submitted in this organization's approval mode. Contact support.",
			};
		case "no_decider":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.noDecider",
				fallback: "No manager or admin can decide them.",
			};
		case "change_policy_ambiguous":
			return {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.changePolicyAmbiguous",
				fallback: "More than one change policy applies to them, so their entries are refused.",
			};
	}
}
