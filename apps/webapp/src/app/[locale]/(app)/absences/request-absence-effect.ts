import "server-only";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	employee,
	timeRecord,
	timeRecordAbsence,
} from "@/db/schema";
import {
	calculateBusinessDaysWithHalfDays,
	dateRangesOverlap,
} from "@/lib/absences/date-utils";
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
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { captureAbsenceLegacyApprovalState } from "@/lib/approvals/domain-adapters/absence-legacy-state";
import { createLegacyApprovalWriteCoordinator } from "@/lib/approvals/domain-adapters/legacy-write-coordinator";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import {
	type AbsenceApprovalWorkflowResult,
	type ApprovedAbsenceResult,
	createAbsenceApprovalWorkflow,
	finalizeAbsenceTerminalInTransaction,
	runAutoCompletedAbsenceMaintenance,
} from "@/lib/approvals/server/absence-approvals";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { finalizeOrdinaryWorkPeriodTerminalInTransaction } from "@/lib/approvals/server/work-period-approvals";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import {
	ApprovalWorkflowStartError,
	type StartApprovalWorkflowInput,
	startApprovalWorkflow,
} from "@/lib/approvals/workflow/start-workflow";
import { getAbility } from "@/lib/auth-helpers";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
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
	shouldApplySickVacationOverrideImmediately,
	validateAbsenceSickDetail,
} from "./request-absence-effect-helpers";

const logger = createLogger("AbsenceActionsEffect");

export interface RequestAbsenceEmployeeContext {
	id: string;
	organizationId: string;
	teamId?: string | null;
}

interface AbsenceSubmissionApprovalLifecycle {
	withApprovalTransaction<T>(
		operation: (context: ApprovalWorkflowTransactionContext) => Promise<T>,
	): Promise<T>;
	captureLegacyState: typeof captureAbsenceLegacyApprovalState;
	startCanonicalWorkflow: typeof startApprovalWorkflow;
	finalizeCanonicalAutoCompletion: typeof finalizeAbsenceTerminalInTransaction;
	nowInstant(): Instant;
}

type RequestedAbsenceApprovalWorkflowResult =
	| AbsenceApprovalWorkflowResult
	| {
			kind: "canonical";
			workflowId: string;
			status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
	  };

function createTransactionDbService(
	dbService: typeof DatabaseService.Service,
	contextDbService: ApprovalWorkflowTransactionContext["dbService"],
): ApprovalDbService {
	return {
		db: contextDbService.db as ApprovalDbService["db"],
		query: dbService.query,
	};
}

function createDefaultAbsenceSubmissionApprovalLifecycle(
	dbService: typeof DatabaseService.Service,
	currentEmployee: RequestAbsenceEmployeeContext,
): AbsenceSubmissionApprovalLifecycle {
	const runtime = createProductionApprovalWorkflowRuntime({
		db: dbService.db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async (input) =>
					await finalizeAbsenceTerminalInTransaction({
						...input,
						dbService: createTransactionDbService(dbService, input.dbService),
					}),
				deleteCancelledAbsence: async () => {
					throw new Error(
						"Absence cancellation is not wired into the approval workflow runtime",
					);
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal:
					finalizeTimeCorrectionTerminalInTransaction,
				deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: finalizeOrdinaryWorkPeriodTerminalInTransaction,
			},
		},
		canManageApproval: async ({ organizationId, actorEmployeeId }) => {
			if (
				organizationId !== currentEmployee.organizationId ||
				actorEmployeeId !== currentEmployee.id
			) {
				return false;
			}
			const ability = await getAbility();
			return ability?.cannot("manage", "Approval") === false;
		},
		clock: systemClock,
	});

	return {
		withApprovalTransaction: (operation) =>
			runtime.repository.withTransaction(operation),
		captureLegacyState: captureAbsenceLegacyApprovalState,
		startCanonicalWorkflow: startApprovalWorkflow,
		finalizeCanonicalAutoCompletion: finalizeAbsenceTerminalInTransaction,
		nowInstant: () => systemClock.nowInstant(),
	};
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
						or(
							eq(absenceEntry.status, "approved"),
							eq(absenceEntry.status, "pending"),
						),
					),
					with: { category: true },
				});
			}),
		);

		for (const existing of overlappingAbsences) {
			if (
				!dateRangesOverlap(
					data.startDate,
					data.endDate,
					existing.startDate,
					existing.endDate,
				)
			) {
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

export function createRequestedAbsenceRecordsInTransaction(params: {
	dbService: typeof DatabaseService.Service;
	currentEmployee: RequestAbsenceEmployeeContext;
	data: NormalizedAbsenceDurationInput & Pick<AbsenceRequest, "sickDetail">;
	category: {
		name: string;
		countsAgainstVacation: boolean;
		requiresApproval: boolean;
		type: string;
	};
	createdBy: string;
	hasManagerApprovalWorkflow: boolean;
	approvalWorkflow?: {
		categoryId: string;
		approverId: string | null;
		create?: typeof createApprovalWorkflow;
	};
	approvalLifecycle?: AbsenceSubmissionApprovalLifecycle;
}) {
	const {
		dbService,
		currentEmployee,
		data,
		category,
		createdBy,
		hasManagerApprovalWorkflow,
	} = params;
	const approvalLifecycle = params.approvalWorkflow
		? (params.approvalLifecycle ??
			createDefaultAbsenceSubmissionApprovalLifecycle(
				dbService,
				currentEmployee,
			))
		: undefined;

	return dbService
		.query("createRequestedAbsenceRecords", async () => {
			const createRecords = async (
				tx: ApprovalDbService["db"],
				approvalContext?: ApprovalWorkflowTransactionContext,
			) => {
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

				await Promise.all([
					tx.insert(timeRecordAbsence).values({
						recordId: canonicalRecord.id,
						...canonicalValues.timeRecordAbsence,
					}),
					tx
						.update(absenceEntry)
						.set({ canonicalRecordId: canonicalRecord.id })
						.where(
							and(
								eq(absenceEntry.id, newAbsence.id),
								eq(absenceEntry.organizationId, currentEmployee.organizationId),
							),
						),
				]);

				let approvalWorkflowResult:
					| RequestedAbsenceApprovalWorkflowResult
					| undefined;
				let autoCompletion: ApprovedAbsenceResult | undefined;
				if (params.approvalWorkflow) {
					if (!approvalContext || !approvalLifecycle) {
						throw new Error("Approval transaction context is required");
					}
					const sourceIdentity = {
						organizationId: currentEmployee.organizationId,
						workflowType: "absence" as const,
						sourceType: "absence_entry",
						sourceId: newAbsence.id,
					};
					const actor = {
						kind: "employee" as const,
						employeeId: currentEmployee.id,
						userId: createdBy,
					};
					const submissionKey = `absence:${newAbsence.id}:submission`;
					const gate = await approvalContext.writeGate.acquire({
						organizationId: currentEmployee.organizationId,
						workflowType: "absence",
					});
					const fixedGate = {
						acquire: async (input: {
							organizationId: string;
							workflowType: "absence";
						}) => {
							if (
								input.organizationId !== currentEmployee.organizationId ||
								input.workflowType !== "absence"
							) {
								throw new Error("Approval submission gate scope mismatch");
							}
							return gate;
						},
					};
					const context = {
						...approvalContext,
						writeGate: fixedGate,
					} as ApprovalWorkflowTransactionContext;
					const bindSourceWorkflow: StartApprovalWorkflowInput["bindSourceWorkflow"] =
						async (workflowId) => {
							const rows = await tx
								.update(absenceEntry)
								.set({ approvalWorkflowId: workflowId })
								.where(
									and(
										eq(absenceEntry.id, newAbsence.id),
										eq(
											absenceEntry.organizationId,
											currentEmployee.organizationId,
										),
										isNull(absenceEntry.approvalWorkflowId),
									),
								)
								.returning({
									id: absenceEntry.id,
									organizationId: absenceEntry.organizationId,
									approvalWorkflowId: absenceEntry.approvalWorkflowId,
								});
							if (
								rows.length !== 1 ||
								rows[0]?.id !== newAbsence.id ||
								rows[0]?.organizationId !== currentEmployee.organizationId ||
								rows[0]?.approvalWorkflowId !== workflowId
							) {
								throw new Error(
									"Scoped absence workflow binding affected an unexpected row count",
								);
							}
							return {
								organizationId: currentEmployee.organizationId,
								sourceType: "absence_entry",
								sourceId: newAbsence.id,
								workflowId,
								affectedRows: 1,
							};
						};

					if (
						gate.mode === "legacy" ||
						gate.mode === "shadow" ||
						gate.mode === "ready"
					) {
						const transactionalDbService = createTransactionDbService(
							dbService,
							approvalContext.dbService,
						);
						const create =
							params.approvalWorkflow.create ?? createApprovalWorkflow;
						const capturedAt = approvalLifecycle.nowInstant();
						const coordinator = createLegacyApprovalWriteCoordinator({
							writeGate: fixedGate,
							compatibilityWriter: approvalContext.compatibilityWriter,
						});

						approvalWorkflowResult = await coordinator.execute({
							organizationId: currentEmployee.organizationId,
							workflowType: "absence",
							sourceIdentity,
							actor,
							idempotencyKey: submissionKey,
							expectedVersion: null,
							captureState: () =>
								approvalLifecycle.captureLegacyState({
									dbService: approvalContext.dbService,
									organizationId: currentEmployee.organizationId,
									absenceId: newAbsence.id,
									capturedAt,
								}),
							mutate:
								async (): Promise<RequestedAbsenceApprovalWorkflowResult> => {
									const result = await Effect.runPromise(
										Effect.either(
											create(
												transactionalDbService,
												currentEmployee,
												newAbsence.id,
												params.approvalWorkflow?.categoryId ?? data.categoryId,
												params.approvalWorkflow?.approverId ?? null,
											),
										),
									);
									if (result._tag === "Left") throw result.left;
									return result.right as RequestedAbsenceApprovalWorkflowResult;
								},
							afterMirror: async (observed) => {
								if (
									observed.snapshot.organizationId !==
										currentEmployee.organizationId ||
									observed.snapshot.workflowType !== "absence" ||
									observed.snapshot.sourceType !== "absence_entry" ||
									observed.snapshot.sourceId !== newAbsence.id
								) {
									throw new Error("Observed absence workflow scope mismatch");
								}
								await bindSourceWorkflow(observed.snapshot.id);
							},
						});
						if (approvalWorkflowResult.kind === "auto_completed") {
							autoCompletion = approvalWorkflowResult.autoCompletion;
						}
					} else {
						const verifySourceWorkflow: StartApprovalWorkflowInput["verifySourceWorkflow"] =
							async (workflowId) => {
								const linked = await tx.query.absenceEntry.findFirst({
									where: and(
										eq(absenceEntry.id, newAbsence.id),
										eq(
											absenceEntry.organizationId,
											currentEmployee.organizationId,
										),
										eq(absenceEntry.approvalWorkflowId, workflowId),
									),
									columns: { id: true },
								});
								return {
									organizationId: currentEmployee.organizationId,
									sourceType: "absence_entry",
									sourceId: newAbsence.id,
									workflowId,
									affectedRows: linked?.id === newAbsence.id ? 1 : 0,
								};
							};
						const startResult = await approvalLifecycle.startCanonicalWorkflow({
							context,
							organizationId: currentEmployee.organizationId,
							workflowType: "absence",
							sourceIdentity,
							requesterEmployeeId: currentEmployee.id,
							actor,
							submissionKey,
							defaultApproverEmployeeId: params.approvalWorkflow.approverId,
							routingContext: {
								organizationId: currentEmployee.organizationId,
								workflowType: "absence",
								source: { type: "absence_entry", id: newAbsence.id },
								requesterEmployeeId: currentEmployee.id,
								teamIds: currentEmployee.teamId ? [currentEmployee.teamId] : [],
								locationId: null,
								absenceCategoryId: data.categoryId,
								travelExpenseAmount: null,
								overtimeRisk: null,
								employeeGroupIds: [],
							},
							displayProjection: {
								displayPayload: {
									absenceId: newAbsence.id,
									employeeId: currentEmployee.id,
									categoryName: category.name,
									startDate: data.startDate,
									endDate: data.endDate,
								},
								searchText: `${category.name} ${data.startDate} ${data.endDate}`,
							},
							bindSourceWorkflow,
							verifySourceWorkflow,
						});
						approvalWorkflowResult = {
							kind: "canonical",
							workflowId: startResult.snapshot.id,
							status: startResult.status,
						};
						if (
							startResult.kind === "created" &&
							startResult.status === "approved"
						) {
							autoCompletion =
								(await approvalLifecycle.finalizeCanonicalAutoCompletion({
									dbService: createTransactionDbService(
										dbService,
										approvalContext.dbService,
									),
									organizationId: currentEmployee.organizationId,
									absenceId: newAbsence.id,
									expectedApprovalWorkflowId: startResult.snapshot.id,
									expectedCanonicalRecordId: canonicalRecord.id,
									actorEmployeeId: currentEmployee.id,
									actorUserId: createdBy,
									transition: { kind: "approve" },
									finalizedAt:
										startResult.snapshot.completedAt ??
										approvalLifecycle.nowInstant(),
								})) as ApprovedAbsenceResult;
						}
						if (gate.mode === "canonical") {
							await approvalContext.compatibilityWriter.mirrorCanonicalToLegacy(
								{
									result: {
										snapshot: startResult.snapshot,
										events: startResult.events,
										projection: startResult.projection,
										outbox: startResult.outbox,
									},
								},
							);
						}
					}
				}

				return {
					...newAbsence,
					status: autoCompletion?.absence.status ?? newAbsence.status,
					canonicalRecordId: canonicalRecord.id,
					vacationOverrideSummary,
					approvalWorkflowResult,
					autoCompletion,
				};
			};

			if (params.approvalWorkflow) {
				if (!approvalLifecycle)
					throw new Error("Approval lifecycle is unavailable");
				return await approvalLifecycle.withApprovalTransaction((context) =>
					createRecords(
						context.dbService.db as ApprovalDbService["db"],
						context,
					),
				);
			}

			return await dbService.db.transaction((tx) => createRecords(tx));
		})
		.pipe(
			Effect.mapError((error) => {
				if (error.cause instanceof ValidationError) return error.cause;
				if (
					error.cause instanceof ApprovalWorkflowStartError &&
					error.cause.code === "NO_DEFAULT_APPROVER"
				) {
					return new ValidationError({
						message: "No manager assigned to approve absence requests",
						field: "managerId",
					});
				}
				return error;
			}),
		);
}

function createApprovalWorkflow(
	dbService: ApprovalDbService,
	currentEmployee: RequestAbsenceEmployeeContext,
	absenceId: string,
	categoryId: string,
	approverId: string | null,
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
		transactionBehavior: "existing",
	});
}

function getAbsenceDefaultApproverId(
	dbService: typeof DatabaseService.Service,
	currentEmployee: RequestAbsenceEmployeeContext,
) {
	return dbService.query("getAbsenceDefaultApprover", async () => {
		return await getPrimaryEligibleManagerIdForRequester({
			db: dbService.db,
			requesterEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
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
	employeeRecord: {
		user: { name: string; email: string };
		userId: string;
		organizationId: string;
	};
	data: AbsenceRequest;
	categoryName: string;
	businessDays: number;
}) {
	const {
		organizationId,
		manager,
		employeeRecord,
		data,
		categoryName,
		businessDays,
	} = params;

	return Effect.gen(function* (_) {
		const appUrl = yield* _(
			Effect.promise(() => getOrganizationBaseUrl(organizationId)),
		);

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

async function deliverPendingAbsenceSubmissionBestEffort(params: {
	dbService: typeof DatabaseService.Service;
	emailService: typeof EmailService.Service;
	currentEmployee: RequestAbsenceEmployeeContext;
	defaultApproverId: string;
	absenceId: string;
	data: AbsenceRequest;
	categoryName: string;
	businessDays: number;
}) {
	try {
		const [manager, employeeRecord] = await Effect.runPromise(
			getManagerAndEmployeeDetails(
				params.dbService,
				params.defaultApproverId,
				params.currentEmployee.id,
			),
		);
		const { employeeHtml, managerHtml } = await Effect.runPromise(
			renderApprovalEmails({
				organizationId: params.currentEmployee.organizationId,
				manager,
				employeeRecord,
				data: params.data,
				categoryName: params.categoryName,
				businessDays: params.businessDays,
			}),
		);
		await Effect.runPromise(
			sendApprovalEmails(
				params.emailService,
				manager,
				employeeRecord,
				employeeHtml,
				managerHtml,
			),
		);
		await Promise.all([
			onAbsenceRequestSubmitted({
				absenceId: params.absenceId,
				employeeUserId: employeeRecord.userId,
				employeeName: employeeRecord.user.name,
				organizationId: employeeRecord.organizationId,
				categoryName: params.categoryName,
				startDate: params.data.startDate,
				endDate: params.data.endDate,
			}),
			onAbsenceRequestPendingApproval({
				absenceId: params.absenceId,
				employeeUserId: employeeRecord.userId,
				employeeName: employeeRecord.user.name,
				organizationId: employeeRecord.organizationId,
				categoryName: params.categoryName,
				startDate: params.data.startDate,
				endDate: params.data.endDate,
				managerUserId: manager.userId,
				managerName: manager.user.name,
			}),
		]);
		logger.info(
			{
				absenceId: params.absenceId,
				employeeEmail: employeeRecord.user.email,
				managerEmail: manager.user.email,
			},
			"Absence request notifications sent",
		);
	} catch (error) {
		logger.error(
			{ error, absenceId: params.absenceId },
			"Failed to deliver absence submission notifications after commit",
		);
	}
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
				getRequestingEmployee(
					dbService,
					session.user.id,
					session.session.activeOrganizationId,
				),
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
	approvalLifecycle?: AbsenceSubmissionApprovalLifecycle,
): Promise<ServerActionResult<{ absenceId: string }>> {
	return requestAbsenceWithResolverEffect(
		data,
		Effect.succeed({
			currentEmployee,
			userId,
		}),
		approvalLifecycle,
	);
}

function requestAbsenceWithResolverEffect(
	data: AbsenceRequest,
	resolveRequester: Effect.Effect<
		{ currentEmployee: RequestAbsenceEmployeeContext; userId: string },
		AnyAppError,
		AuthService | DatabaseService
	>,
	approvalLifecycle?: AbsenceSubmissionApprovalLifecycle,
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
					getAbsenceCategory(
						dbService,
						requestData.categoryId,
						currentEmployee.organizationId,
					),
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
				span.setAttribute(
					"absence.requires_approval",
					category.requiresApproval,
				);

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
						hasManagerApprovalWorkflow: category.requiresApproval,
						approvalWorkflow: category.requiresApproval
							? {
									categoryId: requestData.categoryId,
									approverId: defaultApproverId,
								}
							: undefined,
						approvalLifecycle,
					}),
				);

				span.setAttribute("absence.id", newAbsence.id);
				span.setAttribute("absence.status", newAbsence.status);
				const canonicalRecordId = newAbsence.canonicalRecordId;
				enqueueVacationOverrideCalendarSyncJobs({
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					summary: newAbsence.vacationOverrideSummary,
				});

				logger.info({ absenceId: newAbsence.id }, "Absence entry created");
				const autoCompletion = newAbsence.autoCompletion;
				if (autoCompletion) {
					yield* _(
						Effect.promise(() =>
							runAutoCompletedAbsenceMaintenance(autoCompletion),
						),
					);
					span.setAttribute("absence.auto_approved", true);
				} else if (category.requiresApproval) {
					if (
						defaultApproverId &&
						newAbsence.approvalWorkflowResult?.kind !== "canonical"
					) {
						span.setAttribute("absence.has_approval_request", true);
						span.setAttribute("absence.approver_id", defaultApproverId);
						const emailService = yield* _(EmailService);
						yield* _(
							Effect.promise(() =>
								deliverPendingAbsenceSubmissionBestEffort({
									dbService,
									emailService,
									currentEmployee,
									defaultApproverId,
									absenceId: newAbsence.id,
									data: requestData,
									categoryName: category.name,
									businessDays,
								}),
							),
						);
					}
				} else if (!category.requiresApproval) {
					yield* _(
						updateAutoApprovedAbsence(
							dbService,
							newAbsence.id,
							"autoApproveAbsence",
						),
					);
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
						organizationId: currentEmployee.organizationId,
						action: "create",
					});

					logger.info(
						{ absenceId: newAbsence.id },
						"Absence auto-approved (no approval required)",
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
