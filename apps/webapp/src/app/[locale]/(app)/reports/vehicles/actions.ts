"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { member } from "@/db/auth-schema";
import { loadManagedEmployeeIds } from "@/lib/absences/managed-employees";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { requireAuth } from "@/lib/auth-helpers";
import { type AnyAppError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { getReportAccessibleEmployeeIds } from "@/lib/reports/permissions";
import { reportDayRangeFromDays } from "@/lib/reports/project-report-work";
import {
	buildVehicleDistanceReport,
	type VehicleDistanceReport,
} from "@/lib/reports/vehicle-distance-report";
import { loadVehicleDistanceWork } from "@/lib/reports/vehicle-distance-work";

const logger = createLogger("VehicleDistanceReportActions");

/**
 * The distance per vehicle report (#1129) for the signed-in employee in the
 * active organization. Owners and admins of the organization (membership role)
 * and admin employees see everyone; managers see themselves and the employees
 * they manage; everyone else sees their own driving. `fromDay`/`toDay` are ISO
 * calendar days, both inclusive.
 */
export async function getVehicleDistanceReport(
	fromDay: string,
	toDay: string,
): Promise<ServerActionResult<VehicleDistanceReport>> {
	const tracer = trace.getTracer("reports");

	const effect: Effect.Effect<VehicleDistanceReport, AnyAppError, AppServices> =
		tracer.startActiveSpan(
			"getVehicleDistanceReport",
			{ attributes: { "report.start_date": String(fromDay), "report.end_date": String(toDay) } },
			(span) =>
				Effect.gen(function* () {
					const range = reportDayRangeFromDays(fromDay, toDay);
					if (!range) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Choose a period whose end is not before its start",
								field: "period",
							}),
						);
					}
					const authContext = yield* Effect.tryPromise({
						try: async () => await requireAuth(),
						catch: () =>
							new AuthorizationError({ message: "Approved organization membership required" }),
					});
					const organizationId = authContext.session.activeOrganizationId;
					const currentEmployee = authContext.employee;
					if (!organizationId || !currentEmployee) {
						return yield* Effect.fail(
							new AuthorizationError({ message: "Active organization required" }),
						);
					}
					span.setAttribute("user.id", authContext.user.id);
					span.setAttribute("current_employee.id", currentEmployee.id);

					const dbService = yield* DatabaseService;
					const employeeIds = yield* dbService.query("getVehicleDistanceScope", async () => {
						const [membership] = await dbService.db
							.select({ role: member.role })
							.from(member)
							.where(
								and(
									eq(member.userId, authContext.user.id),
									eq(member.organizationId, organizationId),
									eq(member.status, "approved"),
								),
							)
							.limit(1);
						const isOrganizationAdmin =
							hasOrganizationRole(membership?.role, "owner") ||
							hasOrganizationRole(membership?.role, "admin");
						const role = isOrganizationAdmin ? "admin" : currentEmployee.role;
						const managed =
							role === "manager"
								? await loadManagedEmployeeIds(dbService.db, {
										organizationId,
										managerEmployeeId: currentEmployee.id,
									})
								: new Set<string>();
						return getReportAccessibleEmployeeIds({
							currentEmployeeId: currentEmployee.id,
							role,
							managedEmployeeIds: [...managed],
						});
					});

					const work = yield* dbService.query("getVehicleDistanceWork", () =>
						loadVehicleDistanceWork(dbService.db, organizationId, { employeeIds, range }),
					);
					const report = buildVehicleDistanceReport({ ...range, work });

					span.setAttribute("report.total_km", report.totalKm);
					span.setStatus({ code: SpanStatusCode.OK });
					return report;
				}).pipe(
					Effect.catch((error) => {
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: error.message || "Failed to get the distance per vehicle report",
						});
						span.recordException(error);
						logger.error({ error: error.message }, "Failed to get the distance per vehicle report");
						return Effect.fail(error);
					}),
				),
		);

	return runServerActionSafe(effect);
}
