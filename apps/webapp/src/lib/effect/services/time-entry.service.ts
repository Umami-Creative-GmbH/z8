import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { employee, timeEntry } from "@/db/schema";
import {
	type ChainValidationResult,
	calculateHash,
	getChainHash,
	validateChainDetailed,
	verifyHash,
} from "@/lib/time-tracking/blockchain";
import { type DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

type TimeEntry = typeof timeEntry.$inferSelect;
type TimeEntryType = "clock_in" | "clock_out" | "correction";

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
}

export interface GetTimeEntriesInput {
	employeeId: string;
	organizationId: string;
	from?: Date;
	to?: Date;
	includeSuperseded?: boolean;
}

export class TimeEntryService extends Context.Tag("TimeEntryService")<
	TimeEntryService,
	{
		readonly createTimeEntry: (
			input: CreateTimeEntryInput,
		) => Effect.Effect<TimeEntry, NotFoundError | ValidationError | DatabaseError>;

		readonly createCorrectionEntry: (
			input: CreateCorrectionInput,
		) => Effect.Effect<TimeEntry, NotFoundError | ValidationError | DatabaseError>;

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
								})
								.returning();
							return entry;
						}),
					);

					return createdEntry;
				}),

			createCorrectionEntry: (input) =>
				Effect.gen(function* (_) {
					// Verify employee exists in the specified organization
					const employeeRecord = yield* _(
						dbService.query("verifyEmployeeForCorrection", async () => {
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

					// Verify the entry being replaced exists and belongs to the same org
					const entryToReplace = yield* _(
						dbService.query("getEntryToReplace", async () => {
							const [entry] = await dbService.db
								.select()
								.from(timeEntry)
								.where(
									and(
										eq(timeEntry.id, input.replacesEntryId),
										eq(timeEntry.organizationId, input.organizationId),
									),
								)
								.limit(1);
							return entry ?? null;
						}),
					);

					if (!entryToReplace) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Time entry to replace not found",
									entityType: "timeEntry",
									entityId: input.replacesEntryId,
								}),
							),
						);
					}

					// Validate the entry belongs to the same employee
					if (entryToReplace.employeeId !== input.employeeId) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Cannot correct another employee's time entry",
									field: "replacesEntryId",
									value: input.replacesEntryId,
								}),
							),
						);
					}

					// Check if entry is already superseded
					if (entryToReplace.isSuperseded) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "This time entry has already been corrected",
									field: "replacesEntryId",
									value: input.replacesEntryId,
								}),
							),
						);
					}

					// Get previous entry for blockchain linking (per employee-per-org)
					const previousEntry = yield* _(
						dbService.query("getPreviousEntryForCorrection", async () => {
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

					// Calculate hash for the correction entry
					const hash = calculateHash({
						employeeId: input.employeeId,
						type: "correction",
						timestamp: input.timestamp.toISOString(),
						previousHash: previousEntry?.hash ?? null,
					});

					// Create correction entry and mark original as superseded in a transaction
					const correctionEntry = yield* _(
						dbService.query("createCorrectionEntry", async () => {
							// Insert the correction entry with organizationId
							const [newEntry] = await dbService.db
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
								})
								.returning();

							// Mark the original entry as superseded
							await dbService.db
								.update(timeEntry)
								.set({
									isSuperseded: true,
									supersededById: newEntry.id,
								})
								.where(eq(timeEntry.id, input.replacesEntryId));

							return newEntry;
						}),
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

			verifyEntry: (entryId) =>
				Effect.gen(function* (_) {
					const entry = yield* _(
						dbService.query("getEntryForVerification", async () => {
							const [result] = await dbService.db
								.select()
								.from(timeEntry)
								.where(eq(timeEntry.id, entryId))
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
