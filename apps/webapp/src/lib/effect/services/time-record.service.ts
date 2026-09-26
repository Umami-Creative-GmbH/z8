import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { timeRecord } from "@/db/schema";
import { type DatabaseError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

type TimeRecord = typeof timeRecord.$inferSelect;
type TimeRecordKind = typeof timeRecord.$inferInsert.recordKind;

export interface ListTimeRecordFilters {
	employeeId?: string;
	recordKind?: TimeRecordKind;
	startAtFrom?: Date;
	startAtTo?: Date;
	limit?: number;
}

export class TimeRecordService extends Context.Tag("TimeRecordService")<
	TimeRecordService,
	{
		readonly listByOrganization: (
			organizationId: string,
			filters?: ListTimeRecordFilters,
		) => Effect.Effect<TimeRecord[], ValidationError | DatabaseError>;
	}
>() {}

export const TimeRecordServiceLive = Layer.effect(
	TimeRecordService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return TimeRecordService.of({
			listByOrganization: (organizationId, filters = {}) =>
				Effect.gen(function* (_) {
					if (
						filters.limit !== undefined &&
						(!Number.isInteger(filters.limit) || filters.limit <= 0)
					) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Limit must be a positive integer",
									field: "limit",
									value: filters.limit,
								}),
							),
						);
					}

					return yield* _(
						dbService.query("listTimeRecordsByOrganization", async () => {
							const conditions = [
								eq(timeRecord.organizationId, organizationId),
							];

							if (filters.employeeId) {
								conditions.push(eq(timeRecord.employeeId, filters.employeeId));
							}

							if (filters.recordKind) {
								conditions.push(eq(timeRecord.recordKind, filters.recordKind));
							}

							if (filters.startAtFrom) {
								conditions.push(gte(timeRecord.startAt, filters.startAtFrom));
							}

							if (filters.startAtTo) {
								conditions.push(lte(timeRecord.startAt, filters.startAtTo));
							}

							const query = dbService.db
								.select()
								.from(timeRecord)
								.where(and(...conditions))
								.orderBy(desc(timeRecord.startAt));

							if (filters.limit !== undefined) {
								return query.limit(filters.limit);
							}

							return query;
						}),
					);
				}),
		});
	}),
);
