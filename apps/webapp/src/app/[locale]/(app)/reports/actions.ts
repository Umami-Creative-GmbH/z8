"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { canGenerateReport, getAccessibleEmployees } from "@/lib/reports/permissions";
import { generateEmployeeReport } from "@/lib/reports/report-generator";
import type { AccessibleEmployee, ReportData } from "@/lib/reports/types";

const logger = createLogger("ReportsActionsEffect");

/**
 * Generate a report for an employee with Effect-based workflow
 * - Permission checks
 * - Type-safe error handling
 * - OTEL tracing with business context
 */
export async function generateReport(
	targetEmployeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<ServerActionResult<ReportData>> {
	const tracer = trace.getTracer("reports");

	const effect = tracer.startActiveSpan(
		"generateReport",
		{
			attributes: {
				"report.target_employee_id": targetEmployeeId,
				"report.start_date": startDate.toISOString(),
				"report.end_date": endDate.toISOString(),
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				// Step 1: Authenticate and get current employee
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("user.id", session.user.id);

				// Step 2: Get current employee profile
				const currentEmployee = yield* _(
					dbService.query("getEmployeeByUserId", async () => {
						const emp = await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
							with: { user: true },
						});

						if (!emp) {
							throw new Error("Employee not found");
						}

						return emp;
					}),
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
					),
				);

				span.setAttribute("current_employee.id", currentEmployee.id);
				span.setAttribute("current_employee.role", currentEmployee.role);

				// Step 3: Permission check
				const hasAccess = yield* _(
					dbService.query("checkReportPermissions", async () => {
						return await canGenerateReport(currentEmployee.id, targetEmployeeId);
					}),
				);

				if (!hasAccess) {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: "Permission denied",
					});

					logger.warn(
						{
							currentEmployeeId: currentEmployee.id,
							targetEmployeeId,
						},
						"Report access denied",
					);

					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "You do not have permission to generate this report",
							}),
						),
					);
				}

				span.setAttribute("permission.granted", true);

				// Step 4: Generate report
				logger.info(
					{
						currentEmployeeId: currentEmployee.id,
						targetEmployeeId,
						startDate: startDate.toISOString(),
						endDate: endDate.toISOString(),
					},
					"Generating report",
				);

				const reportData = yield* _(
					dbService.query("generateEmployeeReport", async () => {
						return await generateEmployeeReport(
							targetEmployeeId,
							currentEmployee.organizationId,
							startDate,
							endDate,
						);
					}),
				);

				span.setAttribute("report.work_hours", reportData.workHours.totalHours);
				span.setAttribute("report.work_days", reportData.workHours.workDays);
				span.setAttribute("report.home_office_days", reportData.absences.homeOffice.days);
				span.setStatus({ code: SpanStatusCode.OK });

				logger.info(
					{
						currentEmployeeId: currentEmployee.id,
						targetEmployeeId,
						workHours: reportData.workHours.totalHours,
						workDays: reportData.workHours.workDays,
					},
					"Report generated successfully",
				);

				return yield* _(Effect.succeed(reportData));
			}).pipe(
				Effect.catchAll((error) => {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message || "Report generation failed",
					});
					span.recordException(error);

					logger.error(
						{
							error: error.message,
							targetEmployeeId,
						},
						"Report generation failed",
					);

					return Effect.fail(error);
				}),
			Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect as any);
}

/**
 * Get list of employees the current user can generate reports for
 * - Employees see only themselves
 * - Managers see themselves + direct reports
 * - Admins see all employees in organization
 */
export async function getAccessibleEmployeesAction(): Promise<
	ServerActionResult<AccessibleEmployee[]>
> {
	const tracer = trace.getTracer("reports");

	const effect = tracer.startActiveSpan("getAccessibleEmployees", (span) => {
		return Effect.gen(function* (_) {
			// Step 1: Authenticate and get current employee
			const authService = yield* _(AuthService);
			const session = yield* _(authService.getSession());
			const dbService = yield* _(DatabaseService);

			span.setAttribute("user.id", session.user.id);

			// Step 2: Get current employee profile
			const currentEmployee = yield* _(
				dbService.query("getEmployeeByUserId", async () => {
					const emp = await dbService.db.query.employee.findFirst({
						where: eq(employee.userId, session.user.id),
					});

					if (!emp) {
						throw new Error("Employee not found");
					}

					return emp;
				}),
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Employee profile not found",
							entityType: "employee",
						}),
				),
			);

			span.setAttribute("current_employee.id", currentEmployee.id);
			span.setAttribute("current_employee.role", currentEmployee.role);

			// Step 3: Get accessible employees
			const accessibleEmployees = yield* _(
				dbService.query("getAccessibleEmployees", async () => {
					return await getAccessibleEmployees(currentEmployee.id);
				}),
			);

			span.setAttribute("accessible_employees.count", accessibleEmployees.length);
			span.setStatus({ code: SpanStatusCode.OK });

			logger.info(
				{
					currentEmployeeId: currentEmployee.id,
					count: accessibleEmployees.length,
				},
				"Retrieved accessible employees",
			);

			return yield* _(Effect.succeed(accessibleEmployees));
		}).pipe(
			Effect.catchAll((error) => {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: error.message || "Failed to get accessible employees",
				});
				span.recordException(error);

				logger.error(
					{
						error: error.message,
					},
					"Failed to get accessible employees",
				);

				return Effect.fail(error);
			}),
			Effect.provide(AppLayer),
		);
	});

	return runServerActionSafe(effect as any);
}

/**
 * Get current employee from session
 * Helper function for server components
 */
export async function getCurrentEmployee(): Promise<typeof employee.$inferSelect | null> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
		with: {
			user: true,
		},
	});

	return emp || null;
}
