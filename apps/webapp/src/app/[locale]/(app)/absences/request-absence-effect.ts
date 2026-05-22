"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq, or } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	employee,
	timeRecord,
	timeRecordAbsence,
} from "@/db/schema";
import { calculateBusinessDaysWithHalfDays, dateRangesOverlap } from "@/lib/absences/date-utils";
import {
	type NormalizedAbsenceDurationInput,
	normalizeAbsenceDurationInput,
	toAbsenceEntryDurationFields,
	validateAbsenceDurationInput,
} from "@/lib/absences/duration";
import {
	adjustVacationAbsencesForSickness,
	getBlockingOverlapMessage,
	type VacationOverrideSummary,
} from "@/lib/absences/sick-vacation-override";
import type { AbsenceRequest } from "@/lib/absences/types";
import { createAbsenceApprovalWorkflow } from "@/lib/approvals/server/absence-approvals";
import { getEligibleManagerIdsForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { getOrganizationBaseUrl } from "@/lib/app-url";
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
import { addCalendarSyncJob } from "@/lib/queue";
import {
	buildCanonicalAbsenceRecordValues,
	syncCanonicalAbsenceApprovalState,
} from "./actions.canonical";
import {
	createSickDetailValidationError,
	enqueueVacationOverrideCalendarSyncJobs,
	markAutoApprovedAbsenceWorkBalanceDirtyBestEffort,
	selectAbsenceDefaultApproverId,
	shouldApplySickVacationOverrideImmediately,
	validateAbsenceSickDetail,
} from "./request-absence-effect-helpers";

const logger = createLogger("AbsenceActionsEffect");

export interface RequestAbsenceEmployeeContext {
	id: string;
	organizationId: string;
	managerId: string | null;
	teamId?: string | null;
}

type EmployeeWithUserContact = {
	user: { name: string; email: string };
	userId: string;
	organizationId: string;
};

function validateRequestDates(data: AbsenceRequest) {
	const validationError = validateAbsenceDurationInput(data);

	if (validationError) {
		return Effect.fail(
			new ValidationError({
				message: validationError,
				field: "duration",
				value: data.durationKind ?? "full_day",
			}),
		);
	}

	return Effect.void;
}

function checkForOverlappingAbsences(
	dbService: typeof DatabaseService.Service,
	currentEmployee: RequestAbsenceEmployeeContext,
	data: AbsenceRequest,
	category: { type: string; requiresApproval: boolean },
	hasManagerApprovalWorkflow: boolean,
) {
	return Effect.gen(function* (_) {
		const overlappingAbsences = yield* _(
			dbService.query("checkAbsenceOverlaps", async () => {
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						eq(absenceEntry.employeeId, currentEmployee.id),
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						or(eq(absenceEntry.status, "approved"), eq(absenceEntry.status, "pending")),
					),
					with: { category: true },
				});
			}),
		);

		for (const existing of overlappingAbsences) {
			if (!dateRangesOverlap(data.startDate, data.endDate, existing.startDate, existing.endDate)) {
				continue;
			}

			const message = getBlockingOverlapMessage({
				newCategoryType: category.type,
				newStartPeriod: data.startPeriod,
				newEndPeriod: data.endPeriod,
				existingStartPeriod: existing.startPeriod,
				existingEndPeriod: existing.endPeriod,
				existingStatus: existing.status,
				existingCountsAgainstVacation: existing.category.countsAgainstVacation,
				incomingRequiresApproval: category.requiresApproval,
				hasManagerApprovalWorkflow,
			});

			if (message) {
				yield* _(
					Effect.fail(
						new ConflictError({
							message,
							conflictType: "absence_overlap",
							details: {
								existingAbsenceId: existing.id,
								existingStart: existing.startDate,
								existingEnd: existing.endDate,
								existingStatus: existing.status,
							},
						}),
					),
				);
			}
		}
	});
}

function getAbsenceCategory(
	dbService: typeof DatabaseService.Service,
	categoryId: string,
	organizationId: string,
) {
	return dbService
		.query("getAbsenceCategory", async () => {
			return await dbService.db.query.absenceCategory.findFirst({
				where: and(
					eq(absenceCategory.id, categoryId),
					eq(absenceCategory.organizationId, organizationId),
					eq(absenceCategory.isActive, true),
				),
			});
		})
		.pipe(
			Effect.flatMap((category) =>
				category
					? Effect.succeed(category)
					: Effect.fail(
							new NotFoundError({
								message: "Invalid absence category",
								entityType: "absenceCategory",
								entityId: categoryId,
							}),
						),
			),
		);
}

function getRequestingEmployee(
	dbService: typeof DatabaseService.Service,
	userId: string,
	activeOrganizationId?: string | null,
) {
	return dbService
		.query("getEmployeeByUserId", async () => {
			return await dbService.db.query.employee.findFirst({
				where: activeOrganizationId
					? and(
							eq(employee.userId, userId),
							eq(employee.organizationId, activeOrganizationId),
							eq(employee.isActive, true),
						)
					: and(eq(employee.userId, userId), eq(employee.isActive, true)),
			});
		})
		.pipe(
			Effect.flatMap((employeeRecord) =>
				employeeRecord
					? Effect.succeed(employeeRecord as RequestAbsenceEmployeeContext)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);
}

function createRequestedAbsenceRecordsInTransaction(params: {
	dbService: typeof DatabaseService.Service;
	currentEmployee: RequestAbsenceEmployeeContext;
	data: NormalizedAbsenceDurationInput & Pick<AbsenceRequest, "sickDetail">;
	category: { countsAgainstVacation: boolean; requiresApproval: boolean; type: string };
	createdBy: string;
	hasManagerApprovalWorkflow: boolean;
}) {
	const { dbService, currentEmployee, data, category, createdBy, hasManagerApprovalWorkflow } = params;

	return dbService.query("createRequestedAbsenceRecords", async () => {
		return await dbService.db.transaction(async (tx) => {
			let vacationOverrideSummary: VacationOverrideSummary = {
				updatedAbsenceIds: [],
				createdAbsenceIds: [],
				deletedAbsenceIds: [],
			};

			if (
				shouldApplySickVacationOverrideImmediately({
					categoryType: category.type,
					startPeriod: data.startPeriod,
					endPeriod: data.endPeriod,
					requiresApproval: category.requiresApproval,
					hasManagerApprovalWorkflow,
				})
			) {
				vacationOverrideSummary = await adjustVacationAbsencesForSickness({
					tx,
					organizationId: currentEmployee.organizationId,
					employeeId: currentEmployee.id,
					sickStartDate: data.startDate,
					sickEndDate: data.endDate,
					updatedBy: createdBy,
				});
			}

			const entryDuration = toAbsenceEntryDurationFields(data);
			const [newAbsence] = await tx
				.insert(absenceEntry)
				.values({
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					categoryId: data.categoryId,
					startDate: entryDuration.startDate,
					startPeriod: entryDuration.startPeriod,
					endDate: entryDuration.endDate,
					endPeriod: entryDuration.endPeriod,
					notes: data.notes,
					sickDetail: data.sickDetail ?? null,
					status: "pending",
				})
				.returning();

			const canonicalValues = buildCanonicalAbsenceRecordValues({
				organizationId: currentEmployee.organizationId,
				employeeId: currentEmployee.id,
				absenceCategoryId: data.categoryId,
				startDate: data.startDate,
				startPeriod: data.startPeriod,
				endDate: data.endDate,
				endPeriod: data.endPeriod,
				durationKind: data.durationKind,
				startTime: data.startTime,
				endTime: data.endTime,
				countsAgainstVacation: category.countsAgainstVacation,
				requiresApproval: category.requiresApproval,
				createdBy,
			});

			const [canonicalRecord] = await tx
				.insert(timeRecord)
				.values(canonicalValues.timeRecord)
				.returning({ id: timeRecord.id });

			await tx.insert(timeRecordAbsence).values({
				recordId: canonicalRecord.id,
				...canonicalValues.timeRecordAbsence,
			});

			await tx
				.update(absenceEntry)
				.set({ canonicalRecordId: canonicalRecord.id })
				.where(
					and(
						eq(absenceEntry.id, newAbsence.id),
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
					),
				);

			return { ...newAbsence, canonicalRecordId: canonicalRecord.id, vacationOverrideSummary };
		});
	});
}

function createApprovalWorkflow(
	dbService: typeof DatabaseService.Service,
	currentEmployee: RequestAbsenceEmployeeContext,
	absenceId: string,
	categoryId: string,
	approverId: string,
) {
	return createAbsenceApprovalWorkflow(dbService, {
		absence: {
			id: absenceId,
			organizationId: currentEmployee.organizationId,
			employeeId: currentEmployee.id,
			categoryId,
			employee: { teamId: currentEmployee.teamId ?? null },
		},
		defaultApproverId: approverId,
	});
}

function getAbsenceDefaultApproverId(
	dbService: typeof DatabaseService.Service,
	currentEmployee: RequestAbsenceEmployeeContext,
) {
	return dbService.query("getAbsenceDefaultApprover", async () => {
		const eligibleManagerIds = await getEligibleManagerIdsForRequester({
			db: dbService.db,
			requesterEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
		});

		return selectAbsenceDefaultApproverId({
			legacyManagerId: currentEmployee.managerId,
			eligibleManagerIds,
		});
	});
}

function updateAutoApprovedAbsence(
	dbService: typeof DatabaseService.Service,
	absenceId: string,
	queryName: "autoApproveAbsence" | "autoApproveNoManager",
) {
	return dbService.query(queryName, async () => {
		return await dbService.db
			.update(absenceEntry)
			.set({
				status: "approved",
				approvedAt: currentTimestamp(),
			})
			.where(eq(absenceEntry.id, absenceId));
	});
}

function getManagerAndEmployeeDetails(
	dbService: typeof DatabaseService.Service,
	managerId: string,
	currentEmployeeId: string,
) {
	return Effect.all([
		dbService
			.query("getManagerWithUser", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, managerId),
					with: { user: true },
				});
			})
			.pipe(
				Effect.flatMap((manager) =>
					manager
						? Effect.succeed(manager as EmployeeWithUserContact)
						: Effect.fail(
								new NotFoundError({
									message: "Manager not found",
									entityType: "employee",
									entityId: managerId,
								}),
							),
				),
			),
		dbService
			.query("getEmployeeWithUser", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, currentEmployeeId),
					with: { user: true },
				});
			})
			.pipe(
				Effect.flatMap((employeeRecord) =>
					employeeRecord
						? Effect.succeed(employeeRecord as EmployeeWithUserContact)
						: Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: currentEmployeeId,
								}),
							),
				),
			),
	]);
}

function formatDisplayDate(dateStr: string) {
	const dt = DateTime.fromISO(dateStr);
	return dt.toLocaleString({ month: "short", day: "numeric", year: "numeric" });
}

function renderApprovalEmails(params: {
	organizationId: string;
	manager: { user: { name: string; email: string }; userId: string };
	employeeRecord: { user: { name: string; email: string }; userId: string; organizationId: string };
	data: AbsenceRequest;
	categoryName: string;
	businessDays: number;
}) {
	const { organizationId, manager, employeeRecord, data, categoryName, businessDays } = params;

	return Effect.gen(function* (_) {
		const appUrl = yield* _(Effect.promise(() => getOrganizationBaseUrl(organizationId)));

		const [employeeHtml, managerHtml] = yield* _(
			Effect.all([
				Effect.promise(() =>
					renderAbsenceRequestSubmitted({
						employeeName: employeeRecord.user.name,
						startDate: formatDisplayDate(data.startDate),
						endDate: formatDisplayDate(data.endDate),
						absenceType: categoryName,
						days: businessDays,
						managerName: manager.user.name,
						appUrl,
					}),
				),
				Effect.promise(() =>
					renderAbsenceRequestPendingApproval({
						managerName: manager.user.name,
						employeeName: employeeRecord.user.name,
						startDate: formatDisplayDate(data.startDate),
						endDate: formatDisplayDate(data.endDate),
						absenceType: categoryName,
						days: businessDays,
						notes: data.notes || undefined,
						approvalUrl: `${appUrl}/approvals/inbox`,
					}),
				),
			]),
		);

		return { employeeHtml, managerHtml };
	});
}

function sendApprovalEmails(
	emailService: typeof EmailService.Service,
	manager: { user: { name: string; email: string } },
	employeeRecord: { user: { name: string; email: string } },
	employeeHtml: string,
	managerHtml: string,
) {
	return Effect.all(
		[
			emailService.send({
				to: employeeRecord.user.email,
				subject: "Absence Request Submitted",
				html: employeeHtml,
			}),
			emailService.send({
				to: manager.user.email,
				subject: `Absence Request from ${employeeRecord.user.name}`,
				html: managerHtml,
			}),
		],
		{ concurrency: 2 },
	);
}

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
	return requestAbsenceWithResolverEffect(
		data,
		Effect.gen(function* (_) {
			const authService = yield* _(AuthService);
			const session = yield* _(authService.getSession());
			const dbService = yield* _(DatabaseService);
			const currentEmployee = yield* _(
				getRequestingEmployee(dbService, session.user.id, session.session.activeOrganizationId),
			);

			return {
				currentEmployee,
				userId: session.user.id,
			};
		}),
	);
}

export async function requestAbsenceForEmployeeEffect(
	data: AbsenceRequest,
	currentEmployee: RequestAbsenceEmployeeContext,
	userId: string,
): Promise<ServerActionResult<{ absenceId: string }>> {
	return requestAbsenceWithResolverEffect(
		data,
		Effect.succeed({
			currentEmployee,
			userId,
		}),
	);
}

function requestAbsenceWithResolverEffect(
	data: AbsenceRequest,
	resolveRequester: Effect.Effect<
		{ currentEmployee: RequestAbsenceEmployeeContext; userId: string },
		any,
		any
	>,
): Promise<ServerActionResult<{ absenceId: string }>> {
	const normalizedData = normalizeAbsenceDurationInput(data);
	const requestData = { ...normalizedData, sickDetail: data.sickDetail };
	const tracer = trace.getTracer("absences");

	const effect = tracer.startActiveSpan(
		"requestAbsence",
		{
			attributes: {
				"absence.start_date": requestData.startDate,
				"absence.end_date": requestData.endDate,
				"absence.start_period": requestData.startPeriod,
				"absence.end_period": requestData.endPeriod,
				"absence.category_id": requestData.categoryId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const { currentEmployee, userId } = yield* _(resolveRequester);

				span.setAttribute("user.id", userId);

				const dbService = yield* _(DatabaseService);

				span.setAttribute("employee.id", currentEmployee.id);
				span.setAttribute("organization.id", currentEmployee.organizationId);

				logger.info(
					{
						employeeId: currentEmployee.id,
						organizationId: currentEmployee.organizationId,
						userId,
					},
					"Processing absence request",
				);

				yield* _(validateRequestDates(requestData));
				const category = yield* _(
					getAbsenceCategory(dbService, requestData.categoryId, currentEmployee.organizationId),
				);

				const sickDetailError = validateAbsenceSickDetail({
					categoryType: category.type,
					sickDetail: data.sickDetail,
				});
				if (sickDetailError) {
					yield* _(
						Effect.fail(createSickDetailValidationError(sickDetailError)),
					);
				}


				const defaultApproverId = category.requiresApproval
					? yield* _(getAbsenceDefaultApproverId(dbService, currentEmployee))
					: null;

				yield* _(
					checkForOverlappingAbsences(
						dbService,
						currentEmployee,
						requestData,
						category,
						Boolean(defaultApproverId),
					),
				);

				span.setAttribute("absence.category_name", category.name);
				span.setAttribute("absence.requires_approval", category.requiresApproval);

				const businessDays = calculateBusinessDaysWithHalfDays(
					requestData.startDate,
					requestData.startPeriod,
					requestData.endDate,
					requestData.endPeriod,
					[],
				);
				span.setAttribute("absence.business_days", businessDays);

				logger.info(
					{
					categoryId: requestData.categoryId,
						categoryName: category.name,
						businessDays,
						requiresApproval: category.requiresApproval,
					},
					"Absence request validated",
				);

				const newAbsence = yield* _(
					createRequestedAbsenceRecordsInTransaction({
						dbService,
						currentEmployee,
						data: requestData,
						category,
						createdBy: userId,
						hasManagerApprovalWorkflow: Boolean(defaultApproverId),
					}),
				);

				span.setAttribute("absence.id", newAbsence.id);
				span.setAttribute("absence.status", newAbsence.status);
				const canonicalRecordId = newAbsence.canonicalRecordId;
				enqueueVacationOverrideCalendarSyncJobs({
					employeeId: currentEmployee.id,
					summary: newAbsence.vacationOverrideSummary,
				});

				logger.info({ absenceId: newAbsence.id }, "Absence entry created");

				if (category.requiresApproval && defaultApproverId) {
					yield* _(
						createApprovalWorkflow(
							dbService,
							currentEmployee,
							newAbsence.id,
							requestData.categoryId,
							defaultApproverId,
						),
					);

					span.setAttribute("absence.has_approval_request", true);
					span.setAttribute("absence.approver_id", defaultApproverId);

					const [manager, employeeRecord] = yield* _(
						getManagerAndEmployeeDetails(dbService, defaultApproverId, currentEmployee.id),
					);

					const { employeeHtml, managerHtml } = yield* _(
						renderApprovalEmails({
							organizationId: currentEmployee.organizationId,
							manager,
							employeeRecord,
							data: requestData,
							categoryName: category.name,
							businessDays,
						}),
					);

					const emailService = yield* _(EmailService);

					yield* _(
						sendApprovalEmails(emailService, manager, employeeRecord, employeeHtml, managerHtml),
					);

					void onAbsenceRequestSubmitted({
						absenceId: newAbsence.id,
						employeeUserId: employeeRecord.userId,
						employeeName: employeeRecord.user.name,
						organizationId: employeeRecord.organizationId,
						categoryName: category.name,
						startDate: requestData.startDate,
						endDate: requestData.endDate,
					});

					void onAbsenceRequestPendingApproval({
						absenceId: newAbsence.id,
						employeeUserId: employeeRecord.userId,
						employeeName: employeeRecord.user.name,
						organizationId: employeeRecord.organizationId,
						categoryName: category.name,
						startDate: requestData.startDate,
						endDate: requestData.endDate,
						managerUserId: manager.userId,
						managerName: manager.user.name,
					});

					logger.info(
						{
							absenceId: newAbsence.id,
							employeeEmail: employeeRecord.user.email,
							managerEmail: manager.user.email,
						},
						"Absence request notifications sent",
					);
				} else if (!category.requiresApproval) {
					yield* _(updateAutoApprovedAbsence(dbService, newAbsence.id, "autoApproveAbsence"));
					yield* _(
						Effect.promise(() =>
							markAutoApprovedAbsenceWorkBalanceDirtyBestEffort({
								employeeId: currentEmployee.id,
								organizationId: currentEmployee.organizationId,
								absenceId: newAbsence.id,
								startDate: requestData.startDate,
							}),
						),
					);

					yield* _(
						Effect.promise(() =>
							syncCanonicalAbsenceApprovalState({
								organizationId: currentEmployee.organizationId,
								canonicalRecordId,
								approvalState: "approved",
								updatedBy: userId,
							}),
						),
					);

					span.setAttribute("absence.auto_approved", true);

					void addCalendarSyncJob({
						absenceId: newAbsence.id,
						employeeId: currentEmployee.id,
						action: "create",
					});

					logger.info({ absenceId: newAbsence.id }, "Absence auto-approved (no approval required)");
				} else {
					yield* _(updateAutoApprovedAbsence(dbService, newAbsence.id, "autoApproveNoManager"));
					yield* _(
						Effect.promise(() =>
							markAutoApprovedAbsenceWorkBalanceDirtyBestEffort({
								employeeId: currentEmployee.id,
								organizationId: currentEmployee.organizationId,
								absenceId: newAbsence.id,
								startDate: requestData.startDate,
							}),
						),
					);

					yield* _(
						Effect.promise(() =>
							syncCanonicalAbsenceApprovalState({
								organizationId: currentEmployee.organizationId,
								canonicalRecordId,
								approvalState: "approved",
								updatedBy: userId,
							}),
						),
					);

					span.setAttribute("absence.auto_approved", true);
					span.setAttribute("absence.no_manager", true);

					void addCalendarSyncJob({
						absenceId: newAbsence.id,
						employeeId: currentEmployee.id,
						action: "create",
					});

					logger.info(
						{
							absenceId: newAbsence.id,
							employeeId: currentEmployee.id,
						},
						"Absence auto-approved (no manager assigned)",
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
