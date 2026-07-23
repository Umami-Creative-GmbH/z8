import {
	and,
	asc,
	desc,
	eq,
	gte,
	isNull,
	lte,
	or,
	type SQL,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	employee,
	employeeManagers,
	timeEntry,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { compareInstants } from "@/lib/datetime/temporal-core";
import {
	type ChainValidationResult,
	calculateHash,
	getChainHash,
	validateChainDetailed,
	verifyHash,
} from "@/lib/time-tracking/blockchain";
import { instantFromTimeCorrectionBoundary } from "@/lib/time-tracking/time-correction-temporal";
import type { TimeEntryTimezoneSource } from "@/lib/time-tracking/timezone-capture";
import {
	AuthorizationError,
	ConflictError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "../errors";
import { DatabaseService } from "./database.service";

type TimeEntry = typeof timeEntry.$inferSelect;
type TimeEntryType = "clock_in" | "clock_out" | "correction";
type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface CreateTimeEntryInput {
	employeeId: string;
	organizationId: string;
	type: TimeEntryType;
	timestamp: Date;
	createdBy: string;
	notes?: string;
	location?: string;
	ipAddress?: string;
	deviceInfo?: string;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
}

export interface CreateCorrectionInput {
	employeeId: string;
	organizationId: string;
	replacesEntryId: string;
	timestamp: Date;
	createdBy: string;
	notes: string;
	ipAddress?: string;
	deviceInfo?: string;
	isSuperseded?: boolean;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
	workPeriodId: string;
	transaction?: TransactionClient;
}

export interface GetTimeEntriesInput {
	employeeId: string;
	organizationId: string;
	from?: Date;
	to?: Date;
	includeSuperseded?: boolean;
	authorizationPredicate?: SQL<unknown>;
}

export class TimeEntryService extends Context.Tag("TimeEntryService")<
	TimeEntryService,
	{
		readonly createTimeEntry: (
			input: CreateTimeEntryInput,
		) => Effect.Effect<
			TimeEntry,
			NotFoundError | ValidationError | DatabaseError
		>;

		readonly createCorrectionEntry: (
			input: CreateCorrectionInput,
		) => Effect.Effect<
			TimeEntry,
			| NotFoundError
			| ValidationError
			| ConflictError
			| AuthorizationError
			| DatabaseError
		>;

		readonly getTimeEntries: (
			input: GetTimeEntriesInput,
		) => Effect.Effect<TimeEntry[], DatabaseError>;

		readonly getLatestEntry: (
			employeeId: string,
			organizationId: string,
		) => Effect.Effect<TimeEntry | null, DatabaseError>;

		readonly verifyTimeEntryChain: (
			employeeId: string,
			organizationId: string,
		) => Effect.Effect<ChainValidationResult, DatabaseError>;

		readonly verifyEntry: (
			entryId: string,
			organizationId: string,
		) => Effect.Effect<
			{ isValid: boolean; calculatedHash: string; storedHash: string },
			NotFoundError | DatabaseError
		>;

		readonly getChainHash: (
			employeeId: string,
			organizationId: string,
		) => Effect.Effect<string | null, DatabaseError>;
	}
>() {}

export const TimeEntryServiceLive = Layer.effect(
	TimeEntryService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return TimeEntryService.of({
			createTimeEntry: (input) =>
				Effect.gen(function* (_) {
					// Verify employee exists in the specified organization
					const employeeRecord = yield* _(
						dbService.query("verifyEmployeeExists", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.id, input.employeeId),
									eq(employee.organizationId, input.organizationId),
								),
							});
						}),
					);

					if (!employeeRecord) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found in organization",
									entityType: "employee",
									entityId: input.employeeId,
								}),
							),
						);
					}

					// Get previous entry for blockchain linking (per employee-per-org)
					const previousEntry = yield* _(
						dbService.query("getPreviousEntry", async () => {
							const [entry] = await dbService.db
								.select()
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.employeeId, input.employeeId),
										eq(timeEntry.organizationId, input.organizationId),
									),
								)
								.orderBy(desc(timeEntry.createdAt))
								.limit(1);
							return entry ?? null;
						}),
					);

					// Calculate hash for blockchain integrity
					const hash = calculateHash({
						employeeId: input.employeeId,
						type: input.type,
						timestamp: input.timestamp.toISOString(),
						previousHash: previousEntry?.hash ?? null,
					});

					// Create the time entry with organizationId
					const createdEntry = yield* _(
						dbService.query("createTimeEntry", async () => {
							const [entry] = await dbService.db
								.insert(timeEntry)
								.values({
									employeeId: input.employeeId,
									organizationId: input.organizationId,
									type: input.type,
									timestamp: input.timestamp,
									hash,
									previousHash: previousEntry?.hash ?? null,
									previousEntryId: previousEntry?.id ?? null,
									notes: input.notes,
									location: input.location,
									ipAddress: input.ipAddress,
									deviceInfo: input.deviceInfo,
									createdBy: input.createdBy,
									utcOffsetMinutes: input.utcOffsetMinutes,
									timezone: input.timezone,
									timezoneSource: input.timezoneSource,
								})
								.returning();
							return entry;
						}),
					);

					return createdEntry;
				}),

			createCorrectionEntry: (input) =>
				Effect.gen(function* (_) {
					const correctionEntry = yield* _(
						Effect.catchTag(
							dbService.query("createCorrectionEntry", async () => {
								if (!input.workPeriodId) {
									throw new ValidationError({
										message: "Work period is required for a correction",
										field: "workPeriodId",
									});
								}
								const workPeriodId = input.workPeriodId;
								const applyCorrectionWritesInTransaction = async (
									tx: TransactionClient,
								) => {
									// Global lock order: actor and target employees by ascending ID,
									// followed by authorization rows, then the work period.
									const lockedEmployees = await tx
										.select({
											id: employee.id,
											userId: employee.userId,
											organizationId: employee.organizationId,
											isActive: employee.isActive,
											role: employee.role,
										})
										.from(employee)
										.where(
											and(
												eq(employee.organizationId, input.organizationId),
												or(
													eq(employee.id, input.employeeId),
													eq(employee.userId, input.createdBy),
												),
											),
										)
										.orderBy(asc(employee.id))
										.for("update");
									const targetEmployees = lockedEmployees.filter(
										(candidate) => candidate.id === input.employeeId,
									);
									if (
										targetEmployees.length !== 1 ||
										targetEmployees[0]?.organizationId !==
											input.organizationId ||
										targetEmployees[0]?.isActive !== true
									) {
										throw new NotFoundError({
											message: "Employee not found in organization",
											entityType: "employee",
											entityId: input.employeeId,
										});
									}
									const actorEmployees = lockedEmployees.filter(
										(candidate) => candidate.userId === input.createdBy,
									);
									const actorEmployee = actorEmployees[0];
									const expectedEmployeeCount =
										actorEmployee?.id === input.employeeId ? 1 : 2;
									if (
										actorEmployees.length !== 1 ||
										!actorEmployee ||
										actorEmployee.organizationId !== input.organizationId ||
										actorEmployee.isActive !== true ||
										lockedEmployees.length !== expectedEmployeeCount ||
										new Set(lockedEmployees.map(({ id }) => id)).size !==
											expectedEmployeeCount
									) {
										throw new AuthorizationError({
											message: "Not authorized to correct this time entry",
											userId: input.createdBy,
											resource: "time_entry",
											action: "correct",
										});
									}
									const [actorMembership] = await tx
										.select({ id: member.id })
										.from(member)
										.where(
											and(
												eq(member.userId, input.createdBy),
												eq(member.organizationId, input.organizationId),
												eq(member.status, "approved"),
											),
										)
										.for("update");
									if (!actorMembership) {
										throw new AuthorizationError({
											message: "Not authorized to correct this time entry",
											userId: input.createdBy,
											resource: "time_entry",
											action: "correct",
										});
									}
									if (
										actorEmployee.id !== input.employeeId &&
										actorEmployee.role !== "admin"
									) {
										const [managerAssignment] = await tx
											.select({ id: employeeManagers.id })
											.from(employeeManagers)
											.where(
												and(
													eq(employeeManagers.employeeId, input.employeeId),
													eq(employeeManagers.managerId, actorEmployee.id),
												),
											)
											.for("update");
										if (!managerAssignment) {
											throw new AuthorizationError({
												message: "Not authorized to correct this time entry",
												userId: input.createdBy,
												resource: "time_entry",
												action: "correct",
											});
										}
									}
									const [period] = await tx
										.select()
										.from(workPeriod)
										.where(
											and(
												eq(workPeriod.id, workPeriodId),
												eq(workPeriod.employeeId, input.employeeId),
												eq(workPeriod.organizationId, input.organizationId),
												isNull(workPeriod.deletedAt),
											),
										)
										.for("update");
									if (!period) {
										throw new NotFoundError({
											message: "Work period not found",
											entityType: "workPeriod",
											entityId: workPeriodId,
										});
									}
									const correctsClockIn =
										period.clockInId === input.replacesEntryId;
									const correctsClockOut =
										period.clockOutId === input.replacesEntryId;
									if (!correctsClockIn && !correctsClockOut) {
										throw new ConflictError({
											message:
												"Work period no longer contains the corrected time entry",
											conflictType: "time_correction_work_period_stale",
										});
									}
									const [entryToReplace] = await tx
										.select()
										.from(timeEntry)
										.where(
											and(
												eq(timeEntry.id, input.replacesEntryId),
												eq(timeEntry.employeeId, input.employeeId),
												eq(timeEntry.organizationId, input.organizationId),
												eq(timeEntry.isSuperseded, false),
											),
										)
										.for("update");
									if (!entryToReplace) {
										throw new ConflictError({
											message:
												"Time entry was already corrected by another process",
											conflictType: "time_entry_already_corrected",
										});
									}
									const [legacyPending, canonicalPending] = await Promise.all([
										tx.query.approvalRequest.findFirst({
											where: and(
												eq(
													approvalRequest.organizationId,
													input.organizationId,
												),
												eq(approvalRequest.entityType, "time_entry"),
												eq(approvalRequest.entityId, workPeriodId),
												eq(approvalRequest.status, "pending"),
											),
										}),
										tx.query.approvalWorkflow.findFirst({
											where: and(
												eq(
													approvalWorkflow.organizationId,
													input.organizationId,
												),
												eq(approvalWorkflow.workflowType, "time_correction"),
												eq(approvalWorkflow.sourceType, "time_entry"),
												eq(approvalWorkflow.sourceId, workPeriodId),
												eq(approvalWorkflow.status, "pending"),
											),
										}),
									]);
									if (legacyPending || canonicalPending) {
										throw new ConflictError({
											message:
												"A time correction approval is already pending for this work period",
											conflictType: "pending_time_correction_approval",
										});
									}
									const [previousEntry] = await tx
										.select()
										.from(timeEntry)
										.where(
											and(
												eq(timeEntry.employeeId, input.employeeId),
												eq(timeEntry.organizationId, input.organizationId),
											),
										)
										.orderBy(desc(timeEntry.createdAt))
										.limit(1);
									const hash = calculateHash({
										employeeId: input.employeeId,
										type: "correction",
										timestamp: input.timestamp.toISOString(),
										previousHash: previousEntry?.hash ?? null,
									});
									const [newEntry] = await tx
										.insert(timeEntry)
										.values({
											employeeId: input.employeeId,
											organizationId: input.organizationId,
											type: "correction",
											timestamp: input.timestamp,
											hash,
											previousHash: previousEntry?.hash ?? null,
											previousEntryId: previousEntry?.id ?? null,
											replacesEntryId: input.replacesEntryId,
											notes: input.notes,
											ipAddress: input.ipAddress,
											deviceInfo: input.deviceInfo,
											createdBy: input.createdBy,
											utcOffsetMinutes: input.utcOffsetMinutes,
											timezone: input.timezone,
											timezoneSource: input.timezoneSource,
											...(input.isSuperseded === undefined
												? {}
												: { isSuperseded: input.isSuperseded }),
										})
										.returning();

									if (!input.isSuperseded) {
										const supersededEntries = await tx
											.update(timeEntry)
											.set({
												isSuperseded: true,
												supersededById: newEntry.id,
											})
											.where(
												and(
													eq(timeEntry.id, input.replacesEntryId),
													eq(timeEntry.employeeId, input.employeeId),
													eq(timeEntry.organizationId, input.organizationId),
													eq(timeEntry.isSuperseded, false),
												),
											)
											.returning({ id: timeEntry.id });

										if (supersededEntries.length === 0) {
											throw new ConflictError({
												message:
													"Time entry was already corrected by another process",
												conflictType: "time_entry_already_corrected",
											});
										}

										const startTime = correctsClockIn
											? input.timestamp
											: period.startTime;
										const endTime = correctsClockOut
											? input.timestamp
											: period.endTime;
										const start = instantFromTimeCorrectionBoundary(startTime);
										const end = endTime
											? instantFromTimeCorrectionBoundary(endTime)
											: null;
										if (end && compareInstants(end, start) <= 0) {
											throw new ValidationError({
												message: "Clock out time must be after clock in time",
												field: "workPeriodId",
												value: input.workPeriodId,
											});
										}
										const durationMinutes = end
											? Math.floor(start.until(end).total("minutes"))
											: null;
										const endpointCondition = correctsClockIn
											? eq(workPeriod.clockInId, input.replacesEntryId)
											: eq(workPeriod.clockOutId, input.replacesEntryId);
										const updatedPeriods = await tx
											.update(workPeriod)
											.set({
												...(correctsClockIn
													? { clockInId: newEntry.id, startTime }
													: { clockOutId: newEntry.id, endTime }),
												durationMinutes,
												updatedAt: new Date(),
											})
											.where(
												and(
													eq(workPeriod.id, workPeriodId),
													eq(workPeriod.employeeId, input.employeeId),
													eq(workPeriod.organizationId, input.organizationId),
													isNull(workPeriod.deletedAt),
													endpointCondition,
												),
											)
											.returning({ id: workPeriod.id });

										if (updatedPeriods.length === 0) {
											throw new ConflictError({
												message:
													"Work period changed while applying the correction",
												conflictType: "time_correction_work_period_stale",
												details: { workPeriodId: period.id },
											});
										}

										if (period.canonicalRecordId) {
											await tx
												.update(timeRecord)
												.set({
													startAt: startTime,
													endAt: endTime,
													durationMinutes,
													updatedBy: input.createdBy,
												})
												.where(
													and(
														eq(timeRecord.id, period.canonicalRecordId),
														eq(timeRecord.employeeId, input.employeeId),
														eq(timeRecord.organizationId, input.organizationId),
														eq(timeRecord.recordKind, "work"),
													),
												);
										}
									}

									return newEntry;
								};
								return input.transaction
									? applyCorrectionWritesInTransaction(input.transaction)
									: dbService.db.transaction(
											applyCorrectionWritesInTransaction,
										);
							}),
							"DatabaseError",
							(error) =>
								Effect.fail(
									error.cause instanceof ConflictError ||
										error.cause instanceof AuthorizationError ||
										error.cause instanceof NotFoundError ||
										error.cause instanceof ValidationError
										? error.cause
										: error,
								),
						),
					);

					return correctionEntry;
				}),

			getTimeEntries: (input) =>
				Effect.gen(function* (_) {
					const entries = yield* _(
						dbService.query("getTimeEntries", async () => {
							const conditions = [
								eq(timeEntry.employeeId, input.employeeId),
								eq(timeEntry.organizationId, input.organizationId),
							];

							if (!input.includeSuperseded) {
								conditions.push(eq(timeEntry.isSuperseded, false));
							}

							if (input.from) {
								conditions.push(gte(timeEntry.timestamp, input.from));
							}

							if (input.to) {
								conditions.push(lte(timeEntry.timestamp, input.to));
							}

							if (input.authorizationPredicate) {
								conditions.push(input.authorizationPredicate);
							}

							return await dbService.db
								.select()
								.from(timeEntry)
								.where(and(...conditions))
								.orderBy(desc(timeEntry.createdAt));
						}),
					);

					return entries;
				}),

			getLatestEntry: (employeeId, organizationId) =>
				Effect.gen(function* (_) {
					const entry = yield* _(
						dbService.query("getLatestEntry", async () => {
							const [latestEntry] = await dbService.db
								.select()
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.employeeId, employeeId),
										eq(timeEntry.organizationId, organizationId),
									),
								)
								.orderBy(desc(timeEntry.createdAt))
								.limit(1);
							return latestEntry ?? null;
						}),
					);

					return entry;
				}),

			verifyTimeEntryChain: (employeeId, organizationId) =>
				Effect.gen(function* (_) {
					const entries = yield* _(
						dbService.query("getEntriesForChainValidation", async () => {
							return await dbService.db
								.select()
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.employeeId, employeeId),
										eq(timeEntry.organizationId, organizationId),
									),
								)
								.orderBy(desc(timeEntry.createdAt));
						}),
					);

					return validateChainDetailed(entries);
				}),

			verifyEntry: (entryId, organizationId) =>
				Effect.gen(function* (_) {
					const entry = yield* _(
						dbService.query("getEntryForVerification", async () => {
							const [result] = await dbService.db
								.select()
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.id, entryId),
										eq(timeEntry.organizationId, organizationId),
									),
								)
								.limit(1);
							return result ?? null;
						}),
					);

					if (!entry) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Time entry not found",
									entityType: "timeEntry",
									entityId: entryId,
								}),
							),
						);
					}

					return verifyHash(entry);
				}),

			getChainHash: (employeeId, organizationId) =>
				Effect.gen(function* (_) {
					const entries = yield* _(
						dbService.query("getEntriesForChainHash", async () => {
							return await dbService.db
								.select()
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.employeeId, employeeId),
										eq(timeEntry.organizationId, organizationId),
									),
								)
								.orderBy(desc(timeEntry.createdAt));
						}),
					);

					return getChainHash(entries);
				}),
		});
	}),
);
