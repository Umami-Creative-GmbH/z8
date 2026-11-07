import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { employeeDeactivation } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { reactivationItems } from "./employment-ending";
import type { EmploymentEndingApplied } from "./employment-ending/types";
import {
	buildReactivationChecklistItems,
	type ChecklistApplied,
	type ChecklistPlan,
	legacyAccessEndsItems,
	type ReactivationChecklist,
} from "./reactivation-checklist";
import type { LifecycleClient } from "./types";

/**
 * The re-grant checklist of the employee's latest deactivation once it was
 * reactivated, until an org admin dismisses it (#1441, D14). A deactivation
 * that is still in effect, or a later one, shows no checklist. The caller
 * checks that the actor is an org admin of `organizationId`.
 */
export async function loadReactivationChecklist(
	database: LifecycleClient,
	input: { organizationId: string; employeeId: string },
): Promise<ReactivationChecklist | null> {
	const [latest] = await database
		.select({
			id: employeeDeactivation.id,
			deactivatedAt: employeeDeactivation.deactivatedAt,
			reactivatedAt: employeeDeactivation.reactivatedAt,
			dismissedAt: employeeDeactivation.checklistDismissedAt,
			reason: employeeDeactivation.reason,
			result: employeeDeactivation.result,
			applied: employeeDeactivation.applied,
			plan: employeeDeactivation.plan,
		})
		.from(employeeDeactivation)
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.employeeId, input.employeeId),
			),
		)
		.orderBy(desc(employeeDeactivation.deactivatedAt), desc(employeeDeactivation.createdAt))
		.limit(1);
	if (!latest?.reactivatedAt || latest.dismissedAt) return null;
	const applied = appliedSchema.safeParse(latest.applied);
	if (!applied.success) return null;
	const plan = checklistPlanSchema.safeParse(latest.plan);
	const ended = applied.data;
	const holdings = ended.employmentEnding
		? // Written by the participants themselves, in the same transaction as the ending.
			reactivationItems(ended.employmentEnding as Partial<EmploymentEndingApplied>, input)
		: ended.accessEnds
			? legacyAccessEndsItems({
					employeeId: input.employeeId,
					accessEnds: ended.accessEnds,
					plannedGrants: legacyPlannedGrantsSchema.safeParse(latest.plan).data?.accessEnds.grants ?? null,
				})
			: [];

	const timeZone = await loadOrganizationTimezone(database, input.organizationId);
	return {
		deactivationId: latest.id,
		employeeId: input.employeeId,
		deactivatedAt: dateNotRecorded(latest)
			? null
			: instantFromDate(new Date(latest.deactivatedAt)).toString(),
		reactivatedAt: instantFromDate(new Date(latest.reactivatedAt)).toString(),
		timeZone,
		items: buildReactivationChecklistItems({
			employeeId: input.employeeId,
			applied: ended,
			plan: plan.success ? plan.data : null,
			holdings,
		}),
	};
}

/**
 * A backfilled deactivation without surviving evidence (#1442) stores the run
 * instant on its row; when they left is not recorded.
 */
function dateNotRecorded(row: { reason: string; result: unknown }): boolean {
	if (row.reason !== "employee_deactivation_backfill") return false;
	const result = backfillResultSchema.safeParse(row.result);
	return !result.success || result.data.backfill.leftAt === null;
}

// The ledger's jsonb columns, validated before the checklist reads them.
const ids = z.array(z.string());
const link = z.object({ employeeId: z.string(), managerId: z.string() });
const appliedSchema = z.object({
	managerLinks: z.object({
		removedLinks: z.array(link),
		addedLinks: z.array(link.extend({ isPrimary: z.boolean() })),
		promotedLinks: z.array(link),
	}),
	teamLinks: z.object({
		teamIds: ids,
		projectAssignmentProjectIds: ids,
		projectManagerProjectIds: ids,
	}),
	approvalDuties: z.object({ handoverTaskIds: ids, reviewIds: ids }),
	shifts: z.object({ openedShiftIds: ids }),
	absences: z.object({ cancelledAbsenceIds: ids }),
	/**
	 * What Employment ending ended (#1624), by participant; each participant
	 * reads its own entry. A participant missing here has no items.
	 */
	employmentEnding: z.record(z.string(), z.unknown()).optional(),
	/** What deactivations stored before #1624 ended. */
	accessEnds: z
		.object({
			grantIds: ids,
			drivingAuthorizationIds: ids,
			kioskBadgeIds: ids,
			// Not listed in deactivations stored before kiosk fobs ended with them (#1509).
			kioskFobIds: ids.default([]),
			shareLinkIds: ids,
		})
		.optional(),
}) satisfies z.ZodType<ChecklistApplied>;
const named = z.array(z.object({ employeeId: z.string(), name: z.string() }));
const project = z.array(z.object({ projectId: z.string(), name: z.string() }));
const absenceItem = z.object({
	absenceId: z.string(),
	categoryName: z.string(),
	startDate: z.string(),
	endDate: z.string(),
	status: z.enum(["pending", "approved"]),
});
const checklistPlanSchema: z.ZodType<ChecklistPlan> = z.object({
	managerLinks: z.object({
		replacementOptions: named,
		reportsNeedingReplacement: named,
		reportsKeepingAnotherManager: named,
		ownManagerLinks: named,
		// Not listed in plans stored before former reports were.
		formerReports: named.default([]),
	}),
	teamLinks: z.object({
		teams: z.array(z.object({ teamId: z.string(), name: z.string() })),
		projectAssignments: project,
		projectManagerLinks: project,
	}),
	shifts: z.object({
		shiftsToOpen: z.array(
			z.object({
				shiftId: z.string(),
				date: z.string(),
				startTime: z.string(),
				endTime: z.string(),
			}),
		),
	}),
	absences: z.object({ absencesToCancel: z.array(absenceItem) }),
});
/** The grant kinds a plan stored before #1624 named (`legacyAccessEndsItems`). */
const legacyPlannedGrantsSchema = z.object({
	accessEnds: z.object({
		grants: z.array(
			z.object({
				kind: z.enum([
					"expense_officer",
					"payroll_access",
					"personnel_file_officer",
					"driving_licence_verifier",
					"equipment_officer",
				]),
				grantId: z.string(),
			}),
		),
	}),
});
const backfillResultSchema = z.object({
	backfill: z.object({ leftAt: z.string().nullable() }),
});

/**
 * Dismisses the checklist of a reactivated deactivation for every org admin.
 * The first dismissal wins; a deactivation still in effect is never touched.
 */
export async function dismissReactivationChecklist(
	database: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		deactivationId: string;
		actorUserId: string;
	},
): Promise<boolean> {
	const rows = await database
		.update(employeeDeactivation)
		.set({
			checklistDismissedAt: dateFromInstant(systemClock.nowInstant()),
			checklistDismissedBy: input.actorUserId,
		})
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.employeeId, input.employeeId),
				eq(employeeDeactivation.id, input.deactivationId),
				isNotNull(employeeDeactivation.reactivatedAt),
				isNull(employeeDeactivation.checklistDismissedAt),
			),
		)
		.returning({ id: employeeDeactivation.id });
	return rows.length > 0;
}
