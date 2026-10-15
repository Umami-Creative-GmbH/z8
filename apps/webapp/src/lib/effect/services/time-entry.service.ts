import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { timeEntry } from "@/db/schema";
import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";
import { readEmployeeAppendAssurance } from "@/lib/time-tracking/append-assurance-reader";
import { getChainHash, verifyHash } from "@/lib/time-tracking/blockchain";
import { type DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "./database.service";

type TimeEntry = typeof timeEntry.$inferSelect;

export interface GetTimeEntriesInput {
	employeeId: string;
	organizationId: string;
	from?: Date;
	to?: Date;
	includeSuperseded?: boolean;
	authorizationPredicate?: SQL<unknown>;
}

export class TimeEntryService extends Context.Service<
	TimeEntryService,
	{
		readonly getTimeEntries: (
			input: GetTimeEntriesInput,
		) => Effect.Effect<TimeEntry[], DatabaseError>;

		readonly getLatestEntry: (
			employeeId: string,
			organizationId: string,
		) => Effect.Effect<TimeEntry | null, DatabaseError>;

		/** Graph-aware append assurance; see `lib/time-tracking/append-assurance.ts`. */
		readonly getAppendAssurance: (
			employeeId: string,
			organizationId: string,
		) => Effect.Effect<AppendAssuranceReport, DatabaseError>;

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
>()("TimeEntryService") {}

export const TimeEntryServiceLive = Layer.effect(
	TimeEntryService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		return TimeEntryService.of({
			getTimeEntries: (input) =>
				Effect.gen(function* () {
					const entries = yield* dbService.query("getTimeEntries", async () => {
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
					});

					return entries;
				}),

			getLatestEntry: (employeeId, organizationId) =>
				Effect.gen(function* () {
					const entry = yield* dbService.query("getLatestEntry", async () => {
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
					});

					return entry;
				}),

			getAppendAssurance: (employeeId, organizationId) =>
				dbService.query("getAppendAssurance", () =>
					readEmployeeAppendAssurance(dbService.db, { organizationId, employeeId }),
				),

			verifyEntry: (entryId, organizationId) =>
				Effect.gen(function* () {
					const entry = yield* dbService.query("getEntryForVerification", async () => {
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
					});

					if (!entry) {
						yield* Effect.fail(
							new NotFoundError({
								message: "Time entry not found",
								entityType: "timeEntry",
								entityId: entryId,
							}),
						);
					}

					return verifyHash(entry);
				}),

			getChainHash: (employeeId, organizationId) =>
				Effect.gen(function* () {
					const entries = yield* dbService.query("getEntriesForChainHash", async () => {
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
					});

					return getChainHash(entries);
				}),
		});
	}),
);
