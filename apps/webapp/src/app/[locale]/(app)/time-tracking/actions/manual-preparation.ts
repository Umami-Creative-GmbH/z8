import "server-only";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { changePolicy, changePolicyAssignment, employee, workCategory } from "@/db/schema";
import { isAccountBanned } from "@/lib/auth/account-ban";
import { asAppSubject, defineAbilityFor } from "@/lib/authorization";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import type { PrincipalContext } from "@/lib/authorization/types";
import { isHolidayBlockingTimeEntry } from "@/lib/calendar/holiday-service";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { employeeHasAccessToCategory } from "@/lib/query/work-category.queries";
import {
	evaluateManualApprovalIntent,
	interpretManualInterval,
	type ManualApprovalIntent,
	type ManualCaptureSource,
	type ManualChangePolicy,
	type ManualCommandRejection,
	type ManualInterval,
	type ManualIntervalRejection,
	type ManualTargetZoneSource,
	type ManualTimeEntryCommand,
	type ManualZoneRejection,
	manualCalendarDaysBack,
	manualOccupiedLocalDates,
	resolveManualInterpretationZone,
} from "@/lib/time-tracking/manual-command";
import type { WorkTransactionScope } from "@/lib/time-tracking/work-transaction";
import { validateProjectAssignment } from "./entry-helpers";
import { resolveManualEntryTargetZone } from "./manual-entry-target";

/**
 * Protected manual preparation (#308 / T44, design #258 §1–§3, §6).
 *
 * Runs inside the manual work transaction after its guards are held and after
 * committed replay was ruled out. Every read goes through that transaction:
 * current creation authorization, the target's effective zone, holiday blocking,
 * project/category eligibility and the effective change policy, all evaluated at
 * the one authoritative instant the caller sampled for this attempt. It returns
 * normalized facts for the completed-work operation, never a public prepared
 * object a later save could trust.
 */

type Employee = typeof employee.$inferSelect;

export type ManualPreparationRejection =
	| ManualCommandRejection
	| ManualZoneRejection
	| ManualIntervalRejection
	| { reason: "target_not_authorized" }
	| { reason: "holiday_blocked"; date: string; holidayName: string }
	| { reason: "project_ineligible"; message: string }
	| { reason: "category_ineligible"; message: string }
	| { reason: "policy_ambiguous"; level: ManualPolicyLevel };

export type ManualPolicyLevel = "employee" | "team" | "organization";

export type ManualPolicyEvidence = {
	policyId: string;
	assignmentId: string;
	level: ManualPolicyLevel;
} & ManualChangePolicy;

/** Normalized authoritative facts; the submitted command stays separate. */
export type PreparedManualWork = {
	target: Pick<Employee, "id" | "userId" | "teamId" | "organizationId">;
	isOwnEntry: boolean;
	evaluatedAt: Instant;
	targetZone: { timezone: string; source: ManualTargetZoneSource };
	/** The zone that governed parsing, date validation and capture. */
	timezone: string;
	captureSource: ManualCaptureSource;
	interval: ManualInterval;
	reason: string;
	projectId: string | null;
	workCategoryId: string | null;
	daysBack: number;
	policy: ManualPolicyEvidence | null;
	approval: ManualApprovalIntent;
};

export type ManualPreparation =
	| { ok: true; prepared: PreparedManualWork }
	| { ok: false; rejection: ManualPreparationRejection };

/** Who is submitting: server-derived from the authenticated session. */
export type ManualActor = {
	userId: string;
	organizationId: string;
	/** Session-derived platform-admin status; everything else is re-read here. */
	isPlatformAdmin: boolean;
};

type Reader = WorkTransactionScope["db"];

async function loadPrincipal(tx: Reader, actor: ManualActor): Promise<PrincipalContext | null> {
	const [account] = await tx
		.select({ banned: user.banned, banExpires: user.banExpires, role: user.role })
		.from(user)
		.where(eq(user.id, actor.userId))
		.limit(1);
	if (!account || isAccountBanned(account)) return null;
	const principal = await loadOrganizationPrincipalContext(tx, {
		userId: actor.userId,
		organizationId: actor.organizationId,
	});
	if (actor.isPlatformAdmin && account.role === "admin") {
		return { ...principal, isPlatformAdmin: true };
	}
	return principal.orgMembership ? principal : null;
}

/**
 * Current creation authorization, read in the transaction. Self entries need an
 * active employee in the organization; anyone else requires explicit
 * `create TimeEntry` for an active target in the same organization.
 */
async function authorizeTarget(
	tx: Reader,
	actor: ManualActor,
	targetEmployeeId: string,
): Promise<{ target: Employee; isOwnEntry: boolean; principal: PrincipalContext } | null> {
	const principal = await loadPrincipal(tx, actor);
	if (!principal) return null;
	const [target] = await tx
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.id, targetEmployeeId),
				eq(employee.organizationId, actor.organizationId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!target) return null;
	if (principal.employee?.id === target.id) return { target, isOwnEntry: true, principal };
	const allowed = defineAbilityFor(principal).can(
		"create",
		asAppSubject("TimeEntry", {
			employeeId: target.id,
			organizationId: target.organizationId,
			teamId: target.teamId,
		}),
	);
	return allowed ? { target, isOwnEntry: false, principal } : null;
}

/**
 * The effective change policy at `at`: organization-scoped, active, effective
 * and not yet expired, with employee → team → organization precedence. More than
 * one candidate at the deciding level is ambiguous and fails instead of picking.
 */
async function resolveEffectiveChangePolicy(
	tx: Reader,
	target: Pick<Employee, "id" | "teamId" | "organizationId">,
	at: Date,
): Promise<
	{ ok: true; policy: ManualPolicyEvidence | null } | { ok: false; level: ManualPolicyLevel }
> {
	const rows = await tx
		.select({
			assignmentId: changePolicyAssignment.id,
			level: changePolicyAssignment.assignmentType,
			employeeId: changePolicyAssignment.employeeId,
			teamId: changePolicyAssignment.teamId,
			policyId: changePolicy.id,
			selfServiceDays: changePolicy.selfServiceDays,
			approvalDays: changePolicy.approvalDays,
			noApprovalRequired: changePolicy.noApprovalRequired,
		})
		.from(changePolicyAssignment)
		.innerJoin(
			changePolicy,
			and(
				eq(changePolicy.id, changePolicyAssignment.policyId),
				eq(changePolicy.organizationId, target.organizationId),
				eq(changePolicy.isActive, true),
			),
		)
		.where(
			and(
				eq(changePolicyAssignment.organizationId, target.organizationId),
				eq(changePolicyAssignment.isActive, true),
				or(
					isNull(changePolicyAssignment.effectiveFrom),
					lte(changePolicyAssignment.effectiveFrom, at),
				),
				or(
					isNull(changePolicyAssignment.effectiveUntil),
					gt(changePolicyAssignment.effectiveUntil, at),
				),
			),
		);
	const levels: Array<[ManualPolicyLevel, (row: (typeof rows)[number]) => boolean]> = [
		["employee", (row) => row.employeeId === target.id],
		["team", (row) => target.teamId !== null && row.teamId === target.teamId],
		["organization", () => true],
	];
	for (const [level, matches] of levels) {
		const candidates = rows.filter((row) => row.level === level && matches(row));
		if (candidates.length > 1) return { ok: false, level };
		const [row] = candidates;
		if (row) {
			return {
				ok: true,
				policy: {
					policyId: row.policyId,
					assignmentId: row.assignmentId,
					level,
					selfServiceDays: row.selfServiceDays,
					approvalDays: row.approvalDays,
					noApprovalRequired: row.noApprovalRequired,
				},
			};
		}
	}
	return { ok: true, policy: null };
}

async function validateCategory(
	tx: Reader,
	target: Pick<Employee, "id" | "organizationId">,
	workCategoryId: string,
	at: Date,
): Promise<string | null> {
	const [category] = await tx
		.select({ id: workCategory.id })
		.from(workCategory)
		.where(
			and(
				eq(workCategory.id, workCategoryId),
				eq(workCategory.organizationId, target.organizationId),
				eq(workCategory.isActive, true),
			),
		)
		.limit(1);
	if (!category) return "Work category not found";
	return (await employeeHasAccessToCategory(
		target.id,
		workCategoryId,
		target.organizationId,
		tx,
		at,
	))
		? null
		: "Cannot assign to this work category";
}

/**
 * Interpret the frozen command against current protected facts at `now`. The
 * caller must already hold the manual transaction's guards and have ruled out
 * committed replay; a restart samples a new `now`.
 */
export async function prepareManualWork(
	scope: Pick<WorkTransactionScope, "db" | "assertEmployee">,
	input: { actor: ManualActor; command: ManualTimeEntryCommand; now: Instant },
): Promise<ManualPreparation> {
	const { actor, command, now } = input;
	const tx = scope.db;
	const authorized = await authorizeTarget(tx, actor, command.targetEmployeeId);
	if (!authorized) return { ok: false, rejection: { reason: "target_not_authorized" } };
	const { target, isOwnEntry, principal } = authorized;
	scope.assertEmployee(target.organizationId, target.id);

	const targetZone = await resolveManualEntryTargetZone(target, tx);
	const zone = resolveManualInterpretationZone({ command, isOwnEntry, targetZone });
	if (!zone.ok) return zone;
	const interval = interpretManualInterval({ command, timezone: zone.timezone, now });
	if (!interval.ok) return interval;

	for (const date of manualOccupiedLocalDates(interval.start, interval.end, zone.timezone)) {
		const dayStart = dateFromInstant(date.toZonedDateTime(zone.timezone).toInstant());
		const { isBlocked, holiday } = await isHolidayBlockingTimeEntry(
			target.organizationId,
			dayStart,
			zone.timezone,
			tx,
		);
		if (isBlocked && holiday) {
			return {
				ok: false,
				rejection: {
					reason: "holiday_blocked",
					date: date.toString(),
					holidayName: holiday.holiday.name,
				},
			};
		}
	}

	const at = dateFromInstant(now);
	if (command.projectId) {
		const project = await validateProjectAssignment(
			command.projectId,
			target.id,
			target.teamId,
			target.organizationId,
			tx,
		);
		if (!project.isValid) {
			return {
				ok: false,
				rejection: {
					reason: "project_ineligible",
					message: project.error ?? "Cannot assign to this project",
				},
			};
		}
	}
	if (command.workCategoryId) {
		const message = await validateCategory(tx, target, command.workCategoryId, at);
		if (message) return { ok: false, rejection: { reason: "category_ineligible", message } };
	}

	const daysBack = manualCalendarDaysBack(interval.end, now, zone.timezone);
	let policy: ManualPolicyEvidence | null = null;
	let exemption: "on_behalf" | "owner_admin_self" | null = null;
	if (!isOwnEntry) {
		exemption = "on_behalf";
	} else if (defineAbilityFor(principal).can("manage", "OrgSettings")) {
		exemption = "owner_admin_self";
	} else {
		const resolved = await resolveEffectiveChangePolicy(tx, target, at);
		if (!resolved.ok) {
			return { ok: false, rejection: { reason: "policy_ambiguous", level: resolved.level } };
		}
		policy = resolved.policy;
	}

	return {
		ok: true,
		prepared: {
			target: {
				id: target.id,
				userId: target.userId,
				teamId: target.teamId,
				organizationId: target.organizationId,
			},
			isOwnEntry,
			evaluatedAt: now,
			targetZone,
			timezone: zone.timezone,
			captureSource: zone.captureSource,
			interval,
			reason: command.reason.trim(),
			projectId: command.projectId,
			workCategoryId: command.workCategoryId,
			daysBack,
			policy,
			approval: evaluateManualApprovalIntent({ exemption, policy, daysBack }),
		},
	};
}
