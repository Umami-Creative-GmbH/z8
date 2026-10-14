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
import { loadWorkVehicleUseFormContext } from "@/lib/time-tracking/vehicle-use/form-context";
import { vehicleUseFromColumns } from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
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
					vehicleKind: true,
					vehicleId: true,
					odometerStartKm: true,
					odometerEndKm: true,
					drivenDistanceKm: true,
				},
				// The task foreign key confines it to this work's project and organization.
				with: { task: { columns: { id: true, name: true } } },
			}),
		]);
		const [summary, projects, vehicles] = await Promise.all([
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
			// Vehicle use (#1124): the employee's mode, the active vehicles with the
			// assigned one first and each vehicle's last end reading, which pre-fills
			// the start reading. Older clients ignore the field.
			loadWorkVehicleUseFormContext(db, {
				organizationId,
				employeeId: emp.id,
				...(liveWork ? { excludeWorkPeriodId: liveWork.id } : {}),
			}),
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
				vehicleUse: {
					mode: vehicles.mode,
					// Only active vehicles: no recorded vehicle is passed in.
					vehicles: vehicles.vehicles.map(({ id, name, licencePlate }) => ({
						id,
						name,
						licencePlate,
					})),
					suggestedVehicleIds: vehicles.suggestedVehicleIds ?? [],
					lastEndKmByVehicleId: vehicles.lastEndKmByVehicleId ?? {},
					live: liveWork ? vehicleUseFromColumns(liveWork) : null,
				},
				liveWork: liveWork
					? {
							id: liveWork.id,
							projectId: liveWork.projectId,
							workCategoryId: liveWork.workCategoryId,
							workLocationType: liveWork.workLocationType,
							currentTask: liveWork.task ?? null,
						}
					: null,
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
