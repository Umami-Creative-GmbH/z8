import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	customer,
	employeeTeamHistory,
	project,
	projectAssignmentHistory,
	travelExpenseProjectAttributionException,
} from "@/db/schema";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import {
	type EligibilityWindow,
	eligibilityWindowRange,
	type ProjectEligibility,
	resolveProjectEligibility,
} from "./project-eligibility";

/**
 * Reads the captured history behind historical project eligibility (#605).
 * Every read is scoped to one organization; projects of any status are
 * returned, because proven use of a later closed project stays valid.
 */

type Reader = Pick<typeof appDb, "select">;

export interface EligibilityTarget {
	organizationId: string;
	employeeId: string;
}

export interface AttributionExceptionDetails {
	exceptionId: string;
	validFrom: string;
	validTo: string;
	reason: string;
	evidence: string;
	authorizedByEmployeeId: string;
	authorizedAt: Date;
}

export interface ExpenseEligibleProject {
	id: string;
	name: string;
	status: (typeof project.$inferSelect)["status"];
	customerId: string | null;
	customerName: string | null;
	eligibility: ProjectEligibility;
	/** Present when the project is eligible through an exception. */
	exception?: AttributionExceptionDetails;
}

/**
 * The zone whose calendar days a report's expense dates are: the trip's zone,
 * or the organization's zone for a standalone expense, never a viewer's.
 */
export async function expenseDateZone(
	reader: Reader,
	report: { organizationId: string; kind: "standalone" | "trip"; tripTimeZone: string | null },
): Promise<string> {
	if (report.kind === "trip" && report.tripTimeZone) return report.tripTimeZone;
	const [row] = await reader
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, report.organizationId))
		.limit(1);
	return resolvePersonalTimezone({ organizationTimezone: row?.timezone ?? undefined }).timezone;
}

/** Every project the employee could use on (some day of) the window, by name. */
export async function listExpenseEligibleProjects(
	reader: Reader,
	target: EligibilityTarget,
	window: EligibilityWindow,
	options: { projectId?: string } = {},
): Promise<ExpenseEligibleProject[]> {
	const range = eligibilityWindowRange(window);
	const start = dateFromInstant(range.start);
	const end = dateFromInstant(range.end);
	const memberships = await reader
		.select({
			teamId: employeeTeamHistory.teamId,
			effectiveFrom: employeeTeamHistory.effectiveFrom,
			effectiveTo: employeeTeamHistory.effectiveTo,
		})
		.from(employeeTeamHistory)
		.where(
			and(
				eq(employeeTeamHistory.organizationId, target.organizationId),
				eq(employeeTeamHistory.employeeId, target.employeeId),
				lt(employeeTeamHistory.effectiveFrom, end),
				or(isNull(employeeTeamHistory.effectiveTo), gt(employeeTeamHistory.effectiveTo, start)),
			),
		);
	const teamIds = [...new Set(memberships.map((membership) => membership.teamId))];
	const [assignments, exceptions] = await Promise.all([
		reader
			.select({
				projectId: projectAssignmentHistory.projectId,
				assignmentType: projectAssignmentHistory.assignmentType,
				employeeId: projectAssignmentHistory.employeeId,
				teamId: projectAssignmentHistory.teamId,
				effectiveFrom: projectAssignmentHistory.effectiveFrom,
				effectiveTo: projectAssignmentHistory.effectiveTo,
			})
			.from(projectAssignmentHistory)
			.where(
				and(
					eq(projectAssignmentHistory.organizationId, target.organizationId),
					options.projectId ? eq(projectAssignmentHistory.projectId, options.projectId) : undefined,
					lt(projectAssignmentHistory.effectiveFrom, end),
					or(
						isNull(projectAssignmentHistory.effectiveTo),
						gt(projectAssignmentHistory.effectiveTo, start),
					),
					teamIds.length > 0
						? or(
								eq(projectAssignmentHistory.employeeId, target.employeeId),
								inArray(projectAssignmentHistory.teamId, teamIds),
							)
						: eq(projectAssignmentHistory.employeeId, target.employeeId),
				),
			),
		reader
			.select({
				id: travelExpenseProjectAttributionException.id,
				projectId: travelExpenseProjectAttributionException.projectId,
				validFrom: travelExpenseProjectAttributionException.validFrom,
				validTo: travelExpenseProjectAttributionException.validTo,
				reason: travelExpenseProjectAttributionException.reason,
				evidence: travelExpenseProjectAttributionException.evidence,
				authorizedByEmployeeId: travelExpenseProjectAttributionException.authorizedByEmployeeId,
				authorizedAt: travelExpenseProjectAttributionException.authorizedAt,
			})
			.from(travelExpenseProjectAttributionException)
			.where(
				and(
					eq(travelExpenseProjectAttributionException.organizationId, target.organizationId),
					eq(travelExpenseProjectAttributionException.employeeId, target.employeeId),
					options.projectId
						? eq(travelExpenseProjectAttributionException.projectId, options.projectId)
						: undefined,
					lte(travelExpenseProjectAttributionException.validFrom, window.to),
					gte(travelExpenseProjectAttributionException.validTo, window.from),
				),
			)
			.orderBy(
				asc(travelExpenseProjectAttributionException.authorizedAt),
				asc(travelExpenseProjectAttributionException.id),
			),
	]);
	const eligible = resolveProjectEligibility({
		employeeId: target.employeeId,
		window,
		assignments: assignments.map((row) => ({
			...row,
			effectiveFrom: instantFromDate(row.effectiveFrom),
			effectiveTo: row.effectiveTo ? instantFromDate(row.effectiveTo) : null,
		})),
		teamMemberships: memberships.map((row) => ({
			teamId: row.teamId,
			effectiveFrom: instantFromDate(row.effectiveFrom),
			effectiveTo: row.effectiveTo ? instantFromDate(row.effectiveTo) : null,
		})),
		exceptions,
	});
	if (eligible.size === 0) return [];
	const projects = await reader
		.select({
			id: project.id,
			name: project.name,
			status: project.status,
			customerId: project.customerId,
			customerName: customer.name,
		})
		.from(project)
		.leftJoin(
			customer,
			and(eq(customer.id, project.customerId), eq(customer.organizationId, project.organizationId)),
		)
		.where(
			and(
				eq(project.organizationId, target.organizationId),
				inArray(project.id, [...eligible.keys()]),
			),
		)
		.orderBy(asc(project.name), asc(project.id));
	return projects.flatMap((row): ExpenseEligibleProject[] => {
		const eligibility = eligible.get(row.id);
		if (!eligibility) return [];
		if (eligibility.basis !== "exception") return [{ ...row, eligibility }];
		const exception = exceptions.find((candidate) => candidate.id === eligibility.exceptionId);
		if (!exception) return [];
		return [
			{
				...row,
				eligibility,
				exception: {
					exceptionId: exception.id,
					validFrom: exception.validFrom,
					validTo: exception.validTo,
					reason: exception.reason,
					evidence: exception.evidence,
					authorizedByEmployeeId: exception.authorizedByEmployeeId,
					authorizedAt: exception.authorizedAt,
				},
			},
		];
	});
}

/** The project's eligibility for the employee on the window, or null when unproven. */
export async function isProjectEligibleOn(
	reader: Reader,
	target: EligibilityTarget,
	projectId: string,
	window: EligibilityWindow,
): Promise<ExpenseEligibleProject | null> {
	const [eligible] = await listExpenseEligibleProjects(reader, target, window, { projectId });
	return eligible ?? null;
}
