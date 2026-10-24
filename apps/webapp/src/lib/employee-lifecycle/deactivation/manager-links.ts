import "server-only";

import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { member, user } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { onCurrentRoster } from "../current-roster";
import {
	type AreaApplyResult,
	type DeactivationApplyContext,
	type DeactivationPlanContext,
	type DeactivationReader,
	type DeactivationWriter,
	deactivationAuditMetadata,
	type ManagerLinksApplied,
	type ManagerLinksPlan,
} from "./types";

/**
 * Manager links at a deactivation (#1440, Organization ADR 0006). The person's
 * links end in both directions: their own managers, and every report they
 * manage. A report with another current manager just loses this one (that
 * manager becomes primary when the ending link was the primary one); a report
 * left with no current manager gets the replacement the admin picked, who must
 * be a current admin or manager. A report who is a former employee just loses
 * the link: nobody is asked for and nobody is added. `employee_managers` has no organization
 * column, so every read and write is scoped through the employees it joins.
 */

/** The admin's pick for a report is missing or not eligible; the plan must not be applied. */
export class ManagerLinksRefusedError extends Error {
	constructor(readonly employeeIds: string[]) {
		super("A report needs an eligible replacement manager");
		this.name = "ManagerLinksRefusedError";
	}
}

const reportEmployee = alias(employee, "report_employee");
const managerEmployee = alias(employee, "manager_employee");
const reportUser = alias(user, "report_user");
const managerUser = alias(user, "manager_user");

type ReportLink = { employeeId: string; name: string; isPrimary: boolean; current: boolean };

/**
 * Links in which the person manages someone in the organization, and whether
 * that report is on the current roster at `at` (a former report's link just
 * ends: a former employee never gets a new manager).
 */
async function loadReportLinks(
	reader: DeactivationReader,
	ctx: Pick<DeactivationPlanContext, "organizationId" | "employeeId" | "at">,
): Promise<ReportLink[]> {
	return reader
		.select({
			employeeId: employeeManagers.employeeId,
			name: reportUser.name,
			isPrimary: employeeManagers.isPrimary,
			current: onCurrentRoster(ctx.organizationId, reportEmployee, ctx.at),
		})
		.from(employeeManagers)
		.innerJoin(
			reportEmployee,
			and(
				eq(reportEmployee.id, employeeManagers.employeeId),
				eq(reportEmployee.organizationId, ctx.organizationId),
			),
		)
		.innerJoin(reportUser, eq(reportUser.id, reportEmployee.userId))
		.where(
			and(
				eq(employeeManagers.managerId, ctx.employeeId),
				ne(employeeManagers.employeeId, ctx.employeeId),
			),
		)
		.orderBy(asc(reportUser.name), asc(employeeManagers.employeeId));
}

/** The other managers of those reports, and whether each is on the current roster at `at`. */
async function loadOtherManagers(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
	reportIds: string[],
) {
	if (reportIds.length === 0) return [];
	return reader
		.select({
			employeeId: employeeManagers.employeeId,
			managerId: employeeManagers.managerId,
			isPrimary: employeeManagers.isPrimary,
			current: onCurrentRoster(ctx.organizationId, managerEmployee, ctx.at),
		})
		.from(employeeManagers)
		.innerJoin(
			managerEmployee,
			and(
				eq(managerEmployee.id, employeeManagers.managerId),
				eq(managerEmployee.organizationId, ctx.organizationId),
			),
		)
		.where(
			and(
				inArray(employeeManagers.employeeId, reportIds),
				ne(employeeManagers.managerId, ctx.employeeId),
			),
		)
		.orderBy(asc(employeeManagers.assignedAt), asc(employeeManagers.id));
}

/** The person's own managers. */
async function loadOwnManagerLinks(reader: DeactivationReader, ctx: DeactivationPlanContext) {
	return reader
		.select({
			employeeId: employeeManagers.managerId,
			name: managerUser.name,
			isPrimary: employeeManagers.isPrimary,
		})
		.from(employeeManagers)
		.innerJoin(
			managerEmployee,
			and(
				eq(managerEmployee.id, employeeManagers.managerId),
				eq(managerEmployee.organizationId, ctx.organizationId),
			),
		)
		.innerJoin(managerUser, eq(managerUser.id, managerEmployee.userId))
		.where(
			and(
				eq(employeeManagers.employeeId, ctx.employeeId),
				ne(employeeManagers.managerId, ctx.employeeId),
			),
		)
		.orderBy(asc(managerUser.name), asc(employeeManagers.managerId));
}

/**
 * Who may replace the person as manager: what the manager picker offers, the
 * current roster at `at` with an approved membership and the admin or manager
 * role, never the person who leaves.
 */
async function loadReplacementOptions(reader: DeactivationReader, ctx: DeactivationPlanContext) {
	return reader
		.select({ employeeId: employee.id, name: user.name })
		.from(employee)
		.innerJoin(
			member,
			and(eq(member.userId, employee.userId), eq(member.organizationId, employee.organizationId)),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				onCurrentRoster(ctx.organizationId, employee, ctx.at),
				eq(member.status, "approved"),
				inArray(employee.role, ["admin", "manager"]),
				ne(employee.id, ctx.employeeId),
			),
		)
		.orderBy(asc(user.name), asc(employee.id));
}

/** Reads only; the apply runs the same plan inside the deactivation transaction. */
export async function planManagerLinks(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<ManagerLinksPlan> {
	const reportLinks = await loadReportLinks(reader, ctx);
	const otherManagers = await loadOtherManagers(
		reader,
		ctx,
		reportLinks.map((report) => report.employeeId),
	);
	const ownManagerLinks = await loadOwnManagerLinks(reader, ctx);
	const replacementOptions = await loadReplacementOptions(reader, ctx);
	const eligible = new Set(replacementOptions.map((option) => option.employeeId));

	const plan: ManagerLinksPlan = {
		reportsNeedingReplacement: [],
		reportsKeepingAnotherManager: [],
		formerReports: [],
		ownManagerLinks,
		replacementOptions,
	};
	for (const report of reportLinks) {
		if (!report.current) {
			plan.formerReports.push({ employeeId: report.employeeId, name: report.name });
			continue;
		}
		const others = otherManagers.filter((other) => other.employeeId === report.employeeId);
		const current = others.filter((other) => other.current);
		if (current.length > 0) {
			const promote = report.isPrimary && !current.some((other) => other.isPrimary);
			plan.reportsKeepingAnotherManager.push({
				employeeId: report.employeeId,
				name: report.name,
				newPrimaryManagerId: promote ? (current[0]?.managerId ?? null) : null,
			});
			continue;
		}
		const pick = ctx.replacementManagers[report.employeeId] ?? null;
		const refusal =
			pick === null
				? ctx.replaceManagers
					? ("replacement_missing" as const)
					: null
				: pick !== report.employeeId && eligible.has(pick)
					? null
					: ("replacement_ineligible" as const);
		plan.reportsNeedingReplacement.push({
			employeeId: report.employeeId,
			name: report.name,
			wasPrimary: report.isPrimary,
			replacementEmployeeId: pick,
			refusal,
		});
	}
	return plan;
}

/**
 * The replacement picks the plan validated: report → their eligible new
 * manager. Picks for anyone else (a report who keeps another manager, a former
 * report, someone who isn't a report) and refused picks are left out, so they
 * never decide where an approval duty goes.
 */
export function validatedReplacementManagers(plan: ManagerLinksPlan): Record<string, string> {
	return Object.fromEntries(
		plan.reportsNeedingReplacement.flatMap((report) =>
			report.refusal === null && report.replacementEmployeeId !== null
				? [[report.employeeId, report.replacementEmployeeId]]
				: [],
		),
	);
}

/** Employees of the organization, for scoping `employee_managers` writes. */
function organizationEmployeeIds(writer: DeactivationWriter, organizationId: string) {
	return writer
		.select({ id: employee.id })
		.from(employee)
		.where(eq(employee.organizationId, organizationId));
}

/**
 * Changes exactly the links the plan lists, inside the deactivation
 * transaction, and audits each under the acting admin. A link already gone is
 * skipped, so a re-run changes nothing. Throws `ManagerLinksRefusedError` when
 * the plan still carries a refusal: the caller refuses the deactivation first.
 */
export async function applyManagerLinks(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
	plan: ManagerLinksPlan,
): Promise<AreaApplyResult<ManagerLinksApplied>> {
	const refused = plan.reportsNeedingReplacement.filter((report) => report.refusal !== null);
	if (refused.length > 0) throw new ManagerLinksRefusedError(refused.map((r) => r.employeeId));

	const applied: ManagerLinksApplied = { removedLinks: [], addedLinks: [], promotedLinks: [] };
	const replaced = plan.reportsNeedingReplacement.filter(
		(report) => report.replacementEmployeeId !== null,
	);
	const endingReportIds = [
		...plan.reportsKeepingAnotherManager.map((report) => report.employeeId),
		...replaced.map((report) => report.employeeId),
		...plan.formerReports.map((report) => report.employeeId),
	];
	const ownManagerIds = plan.ownManagerLinks.map((link) => link.employeeId);
	const inOrganization = inArray(
		employeeManagers.employeeId,
		organizationEmployeeIds(tx, ctx.organizationId),
	);

	const removed =
		endingReportIds.length + ownManagerIds.length === 0
			? []
			: await tx
					.delete(employeeManagers)
					.where(
						and(
							inOrganization,
							or(
								endingReportIds.length > 0
									? and(
											eq(employeeManagers.managerId, ctx.employeeId),
											inArray(employeeManagers.employeeId, endingReportIds),
										)
									: undefined,
								ownManagerIds.length > 0
									? and(
											eq(employeeManagers.employeeId, ctx.employeeId),
											inArray(employeeManagers.managerId, ownManagerIds),
										)
									: undefined,
							),
						),
					)
					.returning({
						id: employeeManagers.id,
						employeeId: employeeManagers.employeeId,
						managerId: employeeManagers.managerId,
						isPrimary: employeeManagers.isPrimary,
					});
	for (const link of removed) {
		applied.removedLinks.push({ employeeId: link.employeeId, managerId: link.managerId });
		await recordLinkAudit(tx, ctx, AuditAction.MANAGER_REMOVED, link);
	}

	for (const report of replaced) {
		const replacementId = report.replacementEmployeeId as string;
		const [primary] = await tx
			.select({ id: employeeManagers.id })
			.from(employeeManagers)
			.where(
				and(
					inOrganization,
					eq(employeeManagers.employeeId, report.employeeId),
					eq(employeeManagers.isPrimary, true),
				),
			)
			.limit(1);
		const isPrimary = report.wasPrimary || primary === undefined;
		const [added] = await tx
			.insert(employeeManagers)
			.values({
				employeeId: report.employeeId,
				managerId: replacementId,
				isPrimary,
				assignedBy: ctx.actorUserId,
			})
			.onConflictDoNothing()
			.returning({
				id: employeeManagers.id,
				employeeId: employeeManagers.employeeId,
				managerId: employeeManagers.managerId,
				isPrimary: employeeManagers.isPrimary,
			});
		if (!added) continue;
		applied.addedLinks.push({
			employeeId: added.employeeId,
			managerId: added.managerId,
			isPrimary: added.isPrimary,
		});
		await recordLinkAudit(tx, ctx, AuditAction.MANAGER_ASSIGNED, added);
	}

	for (const report of plan.reportsKeepingAnotherManager) {
		if (report.newPrimaryManagerId === null) continue;
		const [promoted] = await tx
			.update(employeeManagers)
			.set({ isPrimary: true })
			.where(
				and(
					inOrganization,
					eq(employeeManagers.employeeId, report.employeeId),
					eq(employeeManagers.managerId, report.newPrimaryManagerId),
					eq(employeeManagers.isPrimary, false),
				),
			)
			.returning({
				id: employeeManagers.id,
				employeeId: employeeManagers.employeeId,
				managerId: employeeManagers.managerId,
				isPrimary: employeeManagers.isPrimary,
			});
		if (!promoted) continue;
		applied.promotedLinks.push({ employeeId: promoted.employeeId, managerId: promoted.managerId });
		await recordLinkAudit(tx, ctx, AuditAction.MANAGER_PRIMARY_CHANGED, promoted);
	}

	return { applied, afterCommit: [] };
}

async function recordLinkAudit(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
	action: AuditAction,
	link: { id: string; employeeId: string; managerId: string; isPrimary: boolean },
) {
	await ctx.audit.record(tx, {
		organizationId: ctx.organizationId,
		action,
		actorUserId: ctx.actorUserId,
		targetType: "employee_manager",
		targetId: link.id,
		employeeId: link.employeeId,
		metadata: {
			...deactivationAuditMetadata(ctx),
			employeeId: link.employeeId,
			managerId: link.managerId,
			isPrimary: link.isPrimary,
		},
	});
}

/**
 * Everyone whose authorization facts the manager-link changes touch, besides
 * the person and the chosen replacements: their reports and their own
 * managers. For the deactivation's `withAuthorizationMutation` route.
 */
export async function managerLinkAuthorizationEmployeeIds(
	reader: DeactivationReader,
	input: { organizationId: string; employeeId: string },
): Promise<string[]> {
	const rows = await reader
		.select({ employeeId: employeeManagers.employeeId, managerId: employeeManagers.managerId })
		.from(employeeManagers)
		.innerJoin(
			reportEmployee,
			and(
				eq(reportEmployee.id, employeeManagers.employeeId),
				eq(reportEmployee.organizationId, input.organizationId),
			),
		)
		.where(
			or(
				eq(employeeManagers.managerId, input.employeeId),
				eq(employeeManagers.employeeId, input.employeeId),
			),
		);
	const ids = new Set<string>();
	for (const row of rows) {
		ids.add(row.employeeId === input.employeeId ? row.managerId : row.employeeId);
	}
	ids.delete(input.employeeId);
	return [...ids].toSorted();
}
