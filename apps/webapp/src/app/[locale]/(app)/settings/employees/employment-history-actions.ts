"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import {
	type EmployeeEmploymentHistory,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
} from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	cancelEmploymentTerms,
	changeHourlyWage,
	confirmEmploymentTerms,
	writeEmploymentTerms,
} from "@/lib/employment-history/write-terms";
import {
	type OrganizationActionContext,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import {
	changeHourlyWageSchema,
	upsertEmploymentHistorySchema,
} from "@/lib/validations/employment-history";
import { revalidateEmployeesCache } from "./employee-action-utils";
import { keepTermsRefusal, markContractWorkBalanceDirty } from "./employment-history-helpers";
import { loadManagedEmployee } from "./managed-employee";

/** Terms with the employment stint they belong to, for grouping by stint. */
export type EmployeeEmploymentHistoryWithPeriod = EmployeeEmploymentHistory & {
	employmentPeriod: {
		id: string;
		status: "open" | "closed" | "legacy_unknown";
		startedAt: Date | null;
		endedAt: Date | null;
	} | null;
};

const employeeIdSchema = z.uuid("Invalid employee ID");
const NO_ACCESS = "You do not have access to this employee's employment history";

const termsTargetSchema = z.strictObject({
	employeeId: employeeIdSchema,
	historyId: z.uuid("Invalid employment history ID"),
});

/** Marks the work balance dirty after confirmed terms changed, and refreshes the employee caches. */
function afterTermsChange(
	context: OrganizationActionContext<unknown>,
	employeeId: string,
	terms: Pick<EmployeeEmploymentHistory, "reviewState" | "validFrom">,
	options: { always?: boolean } = {},
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		if (options.always || terms.reviewState === "confirmed") {
			yield* Effect.promise(() =>
				markContractWorkBalanceDirty(dbService.db, {
					employeeId,
					organizationId: context.organizationId,
					validFrom: terms.validFrom,
				}),
			);
		}
		revalidateEmployeesCache(context.organizationId);
	});
}

export const listEmployeeEmploymentHistoryAction = organizationAction(
	{ name: "employmentHistory.list", requires: "scopedManager", schema: employeeIdSchema },
	(context) =>
		Effect.gen(function* () {
			const { organizationId, input: employeeId } = context;
			yield* loadManagedEmployee(context, employeeId, { message: NO_ACCESS });
			const dbService = yield* DatabaseService;

			const history = yield* dbService.query("listEmployeeEmploymentHistory", () =>
				dbService.db.query.employeeEmploymentHistory.findMany({
					where: and(
						eq(employeeEmploymentHistory.employeeId, employeeId),
						eq(employeeEmploymentHistory.organizationId, organizationId),
					),
					orderBy: [desc(employeeEmploymentHistory.validFrom)],
				}),
			);

			const periods = yield* dbService.query("listEmployeeEmploymentPeriods", () =>
				dbService.db
					.select({
						id: employeeEmploymentPeriod.id,
						status: employeeEmploymentPeriod.status,
						startedAt: employeeEmploymentPeriod.startedAt,
						endedAt: employeeEmploymentPeriod.endedAt,
					})
					.from(employeeEmploymentPeriod)
					.where(
						and(
							eq(employeeEmploymentPeriod.employeeId, employeeId),
							eq(employeeEmploymentPeriod.organizationId, organizationId),
						),
					),
			);
			const periodById = new Map(periods.map((period) => [period.id, period]));

			return history.map(
				(entry): EmployeeEmploymentHistoryWithPeriod => ({
					...entry,
					employmentPeriod: entry.employmentPeriodId
						? (periodById.get(entry.employmentPeriodId) ?? null)
						: null,
				}),
			);
		}),
);

export const createEmployeeEmploymentHistoryAction = organizationAction(
	{
		name: "employmentHistory.create",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema, data: upsertEmploymentHistorySchema }),
	},
	(context) =>
		Effect.gen(function* () {
			const { actor, organizationId, input } = context;
			yield* loadManagedEmployee(context, input.employeeId, { message: NO_ACCESS });
			const dbService = yield* DatabaseService;
			const createdHistory = yield* dbService
				.query("createEmployeeEmploymentHistory", () =>
					dbService.db.transaction((tx) =>
						writeEmploymentTerms(tx, {
							organizationId,
							employeeId: input.employeeId,
							actorUserId: actor.userId,
							terms: input.data,
						}),
					),
				)
				.pipe(Effect.mapError(keepTermsRefusal));
			yield* afterTermsChange(context, input.employeeId, createdHistory);
			return createdHistory;
		}),
);

/**
 * "Change wage" on the Contract & Work Model card: new terms from a date that
 * copy the hourly terms in force then, with a new wage. Org admins only.
 */
export const changeEmployeeWageAction = organizationAction(
	{
		name: "employmentHistory.changeWage",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema, data: changeHourlyWageSchema }),
	},
	(context) =>
		Effect.gen(function* () {
			const { actor, organizationId, input } = context;
			yield* loadManagedEmployee(context, input.employeeId, { message: NO_ACCESS });
			const dbService = yield* DatabaseService;
			const written = yield* dbService
				.query("employmentTerms.changeWage", () =>
					dbService.db.transaction((tx) =>
						changeHourlyWage(tx, {
							organizationId,
							employeeId: input.employeeId,
							actorUserId: actor.userId,
							effectiveOn: parsePlainDate(input.data.effectiveOn),
							hourlyRate: input.data.hourlyRate,
							changeReason: input.data.changeReason,
							reviewState: input.data.reviewState,
						}),
					),
				)
				.pipe(Effect.mapError(keepTermsRefusal));
			yield* afterTermsChange(context, input.employeeId, written);
			return written;
		}),
);

export const confirmEmployeeEmploymentHistoryAction = organizationAction(
	{ name: "employmentHistory.confirm", requires: "orgAdmin", schema: termsTargetSchema },
	(context) =>
		Effect.gen(function* () {
			const { actor, organizationId, input } = context;
			yield* loadManagedEmployee(context, input.employeeId, { message: NO_ACCESS });
			const dbService = yield* DatabaseService;
			const confirmedHistory = yield* dbService
				.query("confirmEmployeeEmploymentHistory", () =>
					dbService.db.transaction((tx) =>
						confirmEmploymentTerms(tx, {
							organizationId,
							employeeId: input.employeeId,
							actorUserId: actor.userId,
							termsId: input.historyId,
						}),
					),
				)
				.pipe(Effect.mapError(keepTermsRefusal));
			yield* afterTermsChange(context, input.employeeId, confirmedHistory, { always: true });
			return confirmedHistory;
		}),
);

export const cancelEmployeeEmploymentHistoryAction = organizationAction(
	{ name: "employmentHistory.cancel", requires: "orgAdmin", schema: termsTargetSchema },
	(context) =>
		Effect.gen(function* () {
			const { actor, organizationId, input } = context;
			yield* loadManagedEmployee(context, input.employeeId, { message: NO_ACCESS });
			const dbService = yield* DatabaseService;
			const canceledHistory = yield* dbService
				.query("cancelEmployeeEmploymentHistory", () =>
					dbService.db.transaction((tx) =>
						cancelEmploymentTerms(tx, {
							organizationId,
							employeeId: input.employeeId,
							actorUserId: actor.userId,
							termsId: input.historyId,
						}),
					),
				)
				.pipe(Effect.mapError(keepTermsRefusal));
			yield* afterTermsChange(context, input.employeeId, canceledHistory);
		}),
);
