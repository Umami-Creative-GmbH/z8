import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { timeRecord } from "@/db/schema";
import type { DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";

type TimeRecord = typeof timeRecord.$inferSelect;
type TimeRecordKind = typeof timeRecord.$inferInsert.recordKind;

export interface CreateTimeRecordInput {
	organizationId: string;
	employeeId: string;
	recordKind: TimeRecordKind;
	startAt: Date;
	endAt?: Date | null;
	durationMinutes?: number | null;
	approvalState?: TimeRecord["approvalState"];
	origin?: TimeRecord["origin"];
	createdBy: string;
	updatedBy?: string | null;
}

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
		readonly create: (input: CreateTimeRecordInput) => Effect.Effect<TimeRecord, DatabaseError>;
		readonly listByOrganization: (
			organizationId: string,
			filters?: ListTimeRecordFilters,
		) => Effect.Effect<TimeRecord[], DatabaseError>;
	}
>() {}

export const TimeRecordServiceLive = Layer.effect(
	TimeRecordService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return TimeRecordService.of({
			create: (input) =>
				dbService.query("createTimeRecord", async () => {
					const [record] = await dbService.db
						.insert(timeRecord)
						.values({
							organizationId: input.organizationId,
							employeeId: input.employeeId,
							recordKind: input.recordKind,
							startAt: input.startAt,
							endAt: input.endAt,
							durationMinutes: input.durationMinutes,
							approvalState: input.approvalState,
							origin: input.origin,
							createdBy: input.createdBy,
							updatedAt: new Date(),
							updatedBy: input.updatedBy ?? input.createdBy,
						})
						.returning();

					return record;
				}),

			listByOrganization: (organizationId, filters = {}) =>
				dbService.query("listTimeRecordsByOrganization", async () => {
					const conditions = [eq(timeRecord.organizationId, organizationId)];

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

					if (filters.limit) {
						return query.limit(filters.limit);
					}

					return query;
				}),
		});
	}),
);
