import "server-only";

import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, project, workCategory, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { getAvailableCategoriesForEmployee } from "@/lib/query/work-category.queries";
import { listEligibleProjects } from "../project-eligibility";
import type { KioskAttribution, KioskAttributionField, KioskAttributionOption } from "./protocol";

type Reader = Pick<typeof db, "select" | "query">;

/** A field the kiosk asks only while there is something to decide (#887). */
function fieldOf(
	current: KioskAttributionOption | null,
	options: KioskAttributionOption[],
): KioskAttributionField | undefined {
	return current || options.length > 0 ? { current, options } : undefined;
}

/**
 * What a kiosk asks at an online clock-out (#887), after the employee's PIN or
 * badge: the live work's project and work category, and the choices the shared
 * booking-eligibility rules offer the employee (bookable projects assigned to
 * them or their team, while the organization has projects on; the active
 * categories of their effective set at `now`). Clocking checks a choice again
 * with the same rules when the work ends. Every read is filtered by the kiosk's
 * organization. Null when the work is not live or nothing is to decide.
 */
export async function readKioskAttribution(
	reader: Reader,
	input: { organizationId: string; employeeId: string; workPeriodId: string; now: Instant },
): Promise<KioskAttribution | null> {
	const { organizationId, employeeId, workPeriodId } = input;
	const [subject, settings, [live]] = await Promise.all([
		reader.query.employee.findFirst({
			where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
			columns: { teamId: true },
		}),
		reader.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { projectsEnabled: true },
		}),
		reader
			.select({ projectId: workPeriod.projectId, workCategoryId: workPeriod.workCategoryId })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, employeeId),
				),
			)
			.limit(1),
	]);
	if (!subject || !live) return null;

	const projectsEnabled = settings?.projectsEnabled === true;
	const [projects, categories, [currentProject], [currentCategory]] = await Promise.all([
		projectsEnabled
			? listEligibleProjects({ employeeId, teamId: subject.teamId, organizationId }, reader)
			: Promise.resolve([]),
		getAvailableCategoriesForEmployee(
			employeeId,
			organizationId,
			reader,
			dateFromInstant(input.now),
		),
		projectsEnabled && live.projectId
			? reader
					.select({ id: project.id, name: project.name })
					.from(project)
					.where(and(eq(project.id, live.projectId), eq(project.organizationId, organizationId)))
					.limit(1)
			: Promise.resolve([]),
		live.workCategoryId
			? reader
					.select({ id: workCategory.id, name: workCategory.name })
					.from(workCategory)
					.where(
						and(
							eq(workCategory.id, live.workCategoryId),
							eq(workCategory.organizationId, organizationId),
						),
					)
					.limit(1)
			: Promise.resolve([]),
	]);

	const projectField = projectsEnabled
		? fieldOf(
				currentProject ?? null,
				projects.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
			)
		: undefined;
	const categoryField = fieldOf(
		currentCategory ?? null,
		categories.map(({ id, name }) => ({ id, name })),
	);
	if (!projectField && !categoryField) return null;
	return {
		...(projectField ? { project: projectField } : {}),
		...(categoryField ? { workCategory: categoryField } : {}),
	};
}
