import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { readTimeSummary } from "@/app/[locale]/(app)/time-tracking/read-queries";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, userSettings, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { systemClock } from "@/lib/datetime/temporal-core";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { withOpenTasks } from "@/lib/projects/project-tasks";
import { getAvailableCategoriesForEmployee } from "@/lib/query/work-category.queries";
import {
	ClockingAccessError,
	clockingService,
} from "@/lib/time-tracking/clocking-service";
import { listEligibleProjects } from "@/lib/time-tracking/project-eligibility";
import { getUserTimezone } from "@/lib/user-preferences/timezone-server";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";

/** The companion reads the same employee day basis and eligibility as Z8. */
export async function GET() {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user)
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId)
			return NextResponse.json(
				{ error: "Select an organization" },
				{ status: 400 },
			);
		if (
			!(await canAccessOrganizationWithSso(session.session, organizationId))
		) {
			return NextResponse.json(
				{ error: "Organization SSO required" },
				{ status: 403 },
			);
		}
		const actor = await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId: organizationId,
		});
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.id, actor.employee.id),
				eq(employee.organizationId, organizationId),
			),
			columns: { id: true, teamId: true },
		});
		if (!emp)
			return NextResponse.json(
				{ error: "Active employee required" },
				{ status: 403 },
			);
		const [
			timezone,
			weekStartDay,
			preferences,
			organizationSettings,
			categories,
			liveWork,
		] = await Promise.all([
			getUserTimezone(session.user.id),
			getUserWeekStartDay(session.user.id),
			db.query.userSettings.findFirst({
				where: eq(userSettings.userId, session.user.id),
				columns: { locale: true },
			}),
			db.query.organization.findFirst({
				where: eq(organization.id, organizationId),
				columns: { projectsEnabled: true },
			}),
			getAvailableCategoriesForEmployee(emp.id, organizationId),
			db.query.workPeriod.findFirst({
				where: and(
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, emp.id),
					isNull(workPeriod.endTime),
					isNull(workPeriod.deletedAt),
					eq(workPeriod.isActive, true),
				),
				columns: {
					id: true,
					projectId: true,
					workCategoryId: true,
					workLocationType: true,
				},
				// The running task, open or done, so the closing picker can name what it
				// keeps (#930). The task key holds it to the period's project and organization.
				with: { task: { columns: { id: true, name: true } } },
			}),
		]);
		const [summary, projects] = await Promise.all([
			readTimeSummary(
				{ employeeId: emp.id, organizationId },
				timezone,
				weekStartDay,
			),
			organizationSettings?.projectsEnabled
				? listEligibleProjects({
						employeeId: emp.id,
						teamId: emp.teamId,
						organizationId,
					})
				: Promise.resolve([]),
		]);
		// Each listed project's open tasks (#875); older clients ignore the field.
		const projectsWithTasks = await withOpenTasks(
			organizationId,
			projects
				.map(({ id, name }) => ({ id, name }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		);
		return NextResponse.json(
			{
				userId: session.user.id,
				organizationId,
				employeeId: emp.id,
				timezone,
				locale: preferences?.locale ?? null,
				fetchedAt: systemClock.nowInstant().toString(),
				dayTotalBasis: summary.dayTotalBasis,
				projectsEnabled: organizationSettings?.projectsEnabled ?? false,
				projects: projectsWithTasks,
				categories: categories.map(({ id, name }) => ({ id, name })),
				// `liveWork.task` is additive; older clients ignore it.
				liveWork: liveWork ? { ...liveWork, task: liveWork.task ?? null } : null,
			},
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	} catch (error) {
		if (error instanceof ClockingAccessError)
			return NextResponse.json({ error: error.message }, { status: 403 });
		return NextResponse.json(
			{ error: "Cannot load your desktop timekeeping context" },
			{ status: 500 },
		);
	}
}
