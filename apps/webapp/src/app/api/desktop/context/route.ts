import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { readTimeSummary } from "@/app/[locale]/(app)/time-tracking/read-queries";
import { db } from "@/db";
import {
	employee,
	project,
	projectAssignment,
	userSettings,
	workPeriod,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { systemClock } from "@/lib/datetime/temporal-core";
import { canAccessOrganizationWithSso } from "@/lib/enterprise-identity/session-sso-store";
import { listOpenTasksByProject } from "@/lib/projects/project-tasks";
import { getAvailableCategoriesForEmployee } from "@/lib/query/work-category.queries";
import {
	ClockingAccessError,
	clockingService,
} from "@/lib/time-tracking/clocking-service";
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
			categories,
			assignments,
			liveWork,
		] = await Promise.all([
			getUserTimezone(session.user.id),
			getUserWeekStartDay(session.user.id),
			db.query.userSettings.findFirst({
				where: eq(userSettings.userId, session.user.id),
				columns: { locale: true },
			}),
			getAvailableCategoriesForEmployee(emp.id, organizationId),
			db
				.selectDistinct({ projectId: projectAssignment.projectId })
				.from(projectAssignment)
				.where(
					and(
						eq(projectAssignment.organizationId, organizationId),
						or(
							eq(projectAssignment.employeeId, emp.id),
							...(emp.teamId ? [eq(projectAssignment.teamId, emp.teamId)] : []),
						),
					),
				),
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
			}),
		]);
		const [summary, projects] = await Promise.all([
			readTimeSummary(
				{ employeeId: emp.id, organizationId },
				timezone,
				weekStartDay,
			),
			assignments.length
				? db.query.project.findMany({
						where: and(
							eq(project.organizationId, organizationId),
							eq(project.isActive, true),
							inArray(
								project.id,
								assignments.map((item) => item.projectId),
							),
						),
						columns: { id: true, name: true },
						orderBy: (table, { asc }) => [asc(table.name)],
					})
				: Promise.resolve([]),
		]);
		// Each listed project's open tasks (#875); older clients ignore the field.
		const tasks = await listOpenTasksByProject({
			organizationId,
			projectIds: projects.map((item) => item.id),
		});
		return NextResponse.json(
			{
				userId: session.user.id,
				organizationId,
				employeeId: emp.id,
				timezone,
				locale: preferences?.locale ?? null,
				fetchedAt: systemClock.nowInstant().toString(),
				dayTotalBasis: summary.dayTotalBasis,
				projects: projects.map((item) => ({ ...item, tasks: tasks.get(item.id) ?? [] })),
				categories: categories.map(({ id, name }) => ({ id, name })),
				liveWork: liveWork ?? null,
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
