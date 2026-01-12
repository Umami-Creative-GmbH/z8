"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	employee,
	employeeVacationAllowance,
	holiday,
	vacationAllowance,
} from "@/db/schema";
import {
	calculateBusinessDaysWithHalfDays,
	dateRangesOverlap,
	getYearRange,
} from "@/lib/absences/date-utils";
import { canCancelAbsence } from "@/lib/absences/permissions";
import type {
	AbsenceRequest,
	AbsenceWithCategory,
	Holiday,
	VacationBalance,
} from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { auth } from "@/lib/auth";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import {
	renderAbsenceRequestPendingApproval,
	renderAbsenceRequestSubmitted,
} from "@/lib/email/render";
import { createLogger } from "@/lib/logger";
import {
	onAbsenceRequestPendingApproval,
	onAbsenceRequestSubmitted,
} from "@/lib/notifications/triggers";

const logger = createLogger("AbsenceActionsEffect");

/**
 * Request an absence with Effect-based workflow
 * - Type-safe error handling
 * - OTEL tracing with business context
 * - Retry logic for email notifications
 * - Parallel email sending
 */
export async function requestAbsenceEffect(
	data: AbsenceRequest,
): Promise<ServerActionResult<{ absenceId: string }>> {
	const tracer = trace.getTracer("absences");

	const effect = tracer.startActiveSpan(
		"requestAbsence",
		{
			attributes: {
				"absence.start_date": data.startDate,
				"absence.end_date": data.endDate,
				"absence.start_period": data.startPeriod,
				"absence.end_period": data.endPeriod,
				"absence.category_id": data.categoryId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				// Step 1: Authenticate and get current employee
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());

				span.setAttribute("user.id", session.user.id);

				// Step 2: Get current employee profile
				const dbService = yield* _(DatabaseService);
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

				span.setAttribute("employee.id", currentEmployee.id);
				span.setAttribute("organization.id", currentEmployee.organizationId);

				logger.info(
					{
						employeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
						userId: session.user.id,
					},
					"Processing absence request",
				);

				// Step 3: Validate dates (YYYY-MM-DD strings can be compared lexicographically)
				if (data.startDate > data.endDate) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Start date must be before end date",
								field: "startDate",
								value: data.startDate,
							}),
						),
					);
				}

				// Validate same-day period logic
				if (data.startDate === data.endDate) {
					// If same day: AM start with PM end is fine, but PM start with AM end is invalid
					if (data.startPeriod === "pm" && data.endPeriod === "am") {
						yield* _(
							Effect.fail(
								new ValidationError({
									message:
										"Cannot end in the morning if starting in the afternoon on the same day",
									field: "endPeriod",
									value: data.endPeriod,
								}),
							),
						);
					}
				}

				// Step 4: Check for overlapping absences
				const overlappingAbsences = yield* _(
					dbService.query("checkAbsenceOverlaps", async () => {
						return await dbService.db.query.absenceEntry.findMany({
							where: and(
								eq(absenceEntry.employeeId, currentEmployee.id),
								eq(absenceEntry.status, "approved"),
							),
						});
					}),
				);

				for (const existing of overlappingAbsences) {
					if (
						dateRangesOverlap(data.startDate, data.endDate, existing.startDate, existing.endDate)
					) {
						yield* _(
							Effect.fail(
								new ConflictError({
									message: "Absence request overlaps with an existing approved absence",
									conflictType: "absence_overlap",
									details: {
										existingAbsenceId: existing.id,
										existingStart: existing.startDate,
										existingEnd: existing.endDate,
									},
								}),
							),
						);
					}
				}

				// Step 5: Get absence category
				const category = yield* _(
					dbService.query("getAbsenceCategory", async () => {
						const cat = await dbService.db.query.absenceCategory.findFirst({
							where: eq(absenceCategory.id, data.categoryId),
						});

						if (!cat) {
							throw new Error("Category not found");
						}

						return cat;
					}),
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Invalid absence category",
								entityType: "absenceCategory",
								entityId: data.categoryId,
							}),
					),
				);

				span.setAttribute("absence.category_name", category.name);
				span.setAttribute("absence.requires_approval", category.requiresApproval);

				// Step 6: Calculate business days (with half-day support)
				const businessDays = calculateBusinessDaysWithHalfDays(
					data.startDate,
					data.startPeriod,
					data.endDate,
					data.endPeriod,
					[],
				);
				span.setAttribute("absence.business_days", businessDays);

				logger.info(
					{
						categoryId: data.categoryId,
						categoryName: category.name,
						businessDays,
						requiresApproval: category.requiresApproval,
					},
					"Absence request validated",
				);

				// Step 7: Insert absence entry
				const [newAbsence] = yield* _(
					dbService.query("insertAbsenceEntry", async () => {
						return await dbService.db
							.insert(absenceEntry)
							.values({
								employeeId: currentEmployee.id,
								categoryId: data.categoryId,
								startDate: data.startDate,
								startPeriod: data.startPeriod,
								endDate: data.endDate,
								endPeriod: data.endPeriod,
								notes: data.notes,
								status: "pending",
							})
							.returning();
					}),
				);

				span.setAttribute("absence.id", newAbsence.id);
				span.setAttribute("absence.status", newAbsence.status);

				logger.info({ absenceId: newAbsence.id }, "Absence entry created");

				// Step 8: Handle approval workflow and notifications
				const managerId = currentEmployee.managerId;
				if (category.requiresApproval && managerId) {
					// Create approval request
					yield* _(
						dbService.query("createApprovalRequest", async () => {
							return await dbService.db.insert(approvalRequest).values({
								entityType: "absence_entry",
								entityId: newAbsence.id,
								requestedBy: currentEmployee.id,
								approverId: managerId,
								status: "pending",
							});
						}),
					);

					span.setAttribute("absence.has_approval_request", true);
					span.setAttribute("absence.approver_id", managerId);

					// Step 9: Fetch manager and employee details for email
					const [manager, empWithUser] = yield* _(
						Effect.all([
							dbService.query("getManagerWithUser", async () => {
								const mgr = await dbService.db.query.employee.findFirst({
									where: eq(employee.id, managerId),
									with: { user: true },
								});

								if (!mgr) {
									throw new Error("Manager not found");
								}

								return mgr;
							}),
							dbService.query("getEmployeeWithUser", async () => {
								const emp = await dbService.db.query.employee.findFirst({
									where: eq(employee.id, currentEmployee.id),
									with: { user: true },
								});

								if (!emp) {
									throw new Error("Employee not found");
								}

								return emp;
							}),
						]),
					);

					const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
					// Format YYYY-MM-DD date strings for display
					const formatDate = (dateStr: string) => {
						const dt = DateTime.fromISO(dateStr);
						return dt.toLocaleString({ month: "short", day: "numeric", year: "numeric" });
					};

					// Step 10: Render email templates
					const [employeeHtml, managerHtml] = yield* _(
						Effect.all([
							Effect.promise(() =>
								renderAbsenceRequestSubmitted({
									employeeName: empWithUser.user.name,
									startDate: formatDate(data.startDate),
									endDate: formatDate(data.endDate),
									absenceType: category.name,
									days: businessDays,
									managerName: manager.user.name,
									appUrl,
								}),
							),
							Effect.promise(() =>
								renderAbsenceRequestPendingApproval({
									managerName: manager.user.name,
									employeeName: empWithUser.user.name,
									startDate: formatDate(data.startDate),
									endDate: formatDate(data.endDate),
									absenceType: category.name,
									days: businessDays,
									notes: data.notes || undefined,
									approvalUrl: `${appUrl}/approvals`,
								}),
							),
						]),
					);

					// Step 11: Send emails in parallel with retry logic
					const emailService = yield* _(EmailService);

					yield* _(
						Effect.all(
							[
								emailService.send({
									to: empWithUser.user.email,
									subject: "Absence Request Submitted",
									html: employeeHtml,
								}),
								emailService.send({
									to: manager.user.email,
									subject: `Absence Request from ${empWithUser.user.name}`,
									html: managerHtml,
								}),
							],
							{ concurrency: 2 }, // Send both emails in parallel
						),
					);

					// Trigger in-app notifications (fire-and-forget)
					void onAbsenceRequestSubmitted({
						absenceId: newAbsence.id,
						employeeUserId: empWithUser.userId,
						employeeName: empWithUser.user.name,
						organizationId: empWithUser.organizationId,
						categoryName: category.name,
						startDate: data.startDate,
						endDate: data.endDate,
					});

					void onAbsenceRequestPendingApproval({
						absenceId: newAbsence.id,
						employeeUserId: empWithUser.userId,
						employeeName: empWithUser.user.name,
						organizationId: empWithUser.organizationId,
						categoryName: category.name,
						startDate: data.startDate,
						endDate: data.endDate,
						managerUserId: manager.userId,
						managerName: manager.user.name,
					});

					logger.info(
						{
							absenceId: newAbsence.id,
							employeeEmail: empWithUser.user.email,
							managerEmail: manager.user.email,
						},
						"Absence request notifications sent",
					);
				} else if (!category.requiresApproval) {
					// Auto-approve if approval not required
					yield* _(
						dbService.query("autoApproveAbsence", async () => {
							return await dbService.db
								.update(absenceEntry)
								.set({
									status: "approved",
									approvedAt: currentTimestamp(),
								})
								.where(eq(absenceEntry.id, newAbsence.id));
						}),
					);

					span.setAttribute("absence.auto_approved", true);

					logger.info({ absenceId: newAbsence.id }, "Absence auto-approved (no approval required)");
				} else {
					// No manager assigned
					span.setAttribute("absence.no_manager", true);

					logger.warn(
						{
							absenceId: newAbsence.id,
							employeeId: currentEmployee.id,
						},
						"Absence requires approval but employee has no manager",
					);
				}

				span.setStatus({ code: SpanStatusCode.OK });
				span.end();

				return { absenceId: newAbsence.id };
			}).pipe(
				Effect.catchAll((error) => {
					span.recordException(error as Error);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: String(error),
					});
					span.end();

					logger.error({ error }, "Failed to process absence request");

					return Effect.fail(error);
				}),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// Utility and Data-Fetching Functions (non-Effect)
// =============================================================================

/**
 * Get current employee from session
 * Uses activeOrganizationId to get the correct employee record for the active org
 */
export async function getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const activeOrgId = session.session?.activeOrganizationId;

	// If we have an active organization, get employee for that org
	if (activeOrgId) {
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
				eq(employee.isActive, true),
			),
		});
		if (emp) return emp;
	}

	// Fall back to first active employee record (for backwards compatibility)
	const emp = await db.query.employee.findFirst({
		where: and(eq(employee.userId, session.user.id), eq(employee.isActive, true)),
	});

	return emp;
}

/**
 * Get vacation balance for an employee
 */
export async function getVacationBalance(
	employeeId: string,
	year: number,
): Promise<VacationBalance | null> {
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return null;
	}

	// Get organization vacation allowance for the year
	const orgAllowance = await db.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, emp.organizationId),
			eq(vacationAllowance.year, year),
		),
	});

	if (!orgAllowance) {
		return null;
	}

	// Get employee-specific allowance
	const empAllowance = await db.query.employeeVacationAllowance.findFirst({
		where: and(
			eq(employeeVacationAllowance.employeeId, employeeId),
			eq(employeeVacationAllowance.year, year),
		),
	});

	// Get all absences for the employee in this year
	// Date range as YYYY-MM-DD strings for comparison
	const startOfYear = `${year}-01-01`;
	const endOfYear = `${year}-12-31`;
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			gte(absenceEntry.startDate, startOfYear),
			lte(absenceEntry.endDate, endOfYear),
		),
		with: {
			category: true,
		},
	});

	// Transform to AbsenceWithCategory type
	const absencesWithCategory: AbsenceWithCategory[] = absences.map((a) => ({
		id: a.id,
		employeeId: a.employeeId,
		startDate: a.startDate,
		startPeriod: a.startPeriod,
		endDate: a.endDate,
		endPeriod: a.endPeriod,
		status: a.status,
		notes: a.notes,
		category: {
			id: a.category.id,
			name: a.category.name,
			type: a.category.type,
			color: a.category.color,
			countsAgainstVacation: a.category.countsAgainstVacation,
		},
		approvedBy: a.approvedBy,
		approvedAt: a.approvedAt,
		rejectionReason: a.rejectionReason,
		createdAt: a.createdAt,
	}));

	// Calculate balance
	const balance = calculateVacationBalance({
		organizationAllowance: orgAllowance,
		employeeAllowance: empAllowance,
		absences: absencesWithCategory,
		currentDate: currentTimestamp(),
		year,
	});

	return balance;
}

/**
 * Get absence entries for an employee within a date range
 *
 * @param employeeId - Employee ID
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 */
export async function getAbsenceEntries(
	employeeId: string,
	startDate: string,
	endDate: string,
): Promise<AbsenceWithCategory[]> {
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			gte(absenceEntry.startDate, startDate),
			lte(absenceEntry.endDate, endDate),
		),
		with: {
			category: true,
		},
		orderBy: [desc(absenceEntry.startDate)],
	});

	return absences.map((a) => ({
		id: a.id,
		employeeId: a.employeeId,
		startDate: a.startDate,
		startPeriod: a.startPeriod,
		endDate: a.endDate,
		endPeriod: a.endPeriod,
		status: a.status,
		notes: a.notes,
		category: {
			id: a.category.id,
			name: a.category.name,
			type: a.category.type,
			color: a.category.color,
			countsAgainstVacation: a.category.countsAgainstVacation,
		},
		approvedBy: a.approvedBy,
		approvedAt: a.approvedAt,
		rejectionReason: a.rejectionReason,
		createdAt: a.createdAt,
	}));
}

/**
 * Get holidays for an organization within a date range
 */
export async function getHolidays(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<Holiday[]> {
	const holidays = await db.query.holiday.findMany({
		where: and(
			eq(holiday.organizationId, organizationId),
			gte(holiday.startDate, startDate),
			lte(holiday.endDate, endDate),
			eq(holiday.isActive, true),
		),
	});

	return holidays.map((h) => ({
		id: h.id,
		name: h.name,
		startDate: h.startDate,
		endDate: h.endDate,
		categoryId: h.categoryId,
	}));
}

/**
 * Cancel an absence request
 */
export async function cancelAbsenceRequest(
	absenceId: string,
): Promise<{ success: boolean; error?: string }> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	// Get the absence
	const absence = await db.query.absenceEntry.findFirst({
		where: eq(absenceEntry.id, absenceId),
	});

	if (!absence) {
		return { success: false, error: "Absence not found" };
	}

	// Check permissions
	const canCancel = await canCancelAbsence(currentEmployee.id, absence.employeeId, absence.status);

	if (!canCancel) {
		return {
			success: false,
			error: "You do not have permission to cancel this absence",
		};
	}

	// Delete the absence
	await db.delete(absenceEntry).where(eq(absenceEntry.id, absenceId));

	// Delete associated approval request
	await db
		.delete(approvalRequest)
		.where(
			and(eq(approvalRequest.entityType, "absence_entry"), eq(approvalRequest.entityId, absenceId)),
		);

	return { success: true };
}

/**
 * Get absence categories for an organization
 */
export async function getAbsenceCategories(organizationId: string): Promise<
	Array<{
		id: string;
		name: string;
		type: string;
		description: string | null;
		color: string | null;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
	}>
> {
	const categories = await db.query.absenceCategory.findMany({
		where: and(
			eq(absenceCategory.organizationId, organizationId),
			eq(absenceCategory.isActive, true),
		),
	});

	return categories.map((c) => ({
		id: c.id,
		name: c.name,
		type: c.type,
		description: c.description,
		color: c.color,
		requiresApproval: c.requiresApproval,
		countsAgainstVacation: c.countsAgainstVacation,
	}));
}

// Re-export Effect functions with cleaner names (backward compatibility)
export const requestAbsence = requestAbsenceEffect;
