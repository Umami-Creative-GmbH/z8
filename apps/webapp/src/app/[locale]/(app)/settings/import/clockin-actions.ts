"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { ClockinClient } from "@/lib/clockin/client";
import type { ClockinImportResult } from "@/lib/clockin/import-types";
import { systemClock } from "@/lib/datetime/temporal-core";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

export interface ClockinPreview {
	employees: number;
	workdays: number;
	absences: number;
	schedules: number;
}

export interface ClockinEmployeeInfo {
	id: number;
	name: string;
	email: string | null;
}

export interface Z8EmployeeInfo {
	id: string;
	userId: string;
	name: string;
	email: string;
}

const tokenSchema = z.strictObject({
	token: z.string().trim().min(1, "API token is required"),
});

/** A failed Clockin call; its message is shown as before. */
function clockin<T>(operation: string, fallback: string, run: () => Promise<T>) {
	return Effect.tryPromise({
		try: run,
		catch: (cause) =>
			new ExternalServiceError({
				message: cause instanceof Error ? cause.message : fallback,
				service: "clockin",
				operation,
				cause,
			}),
	});
}

export const validateClockinCredentials = organizationAction(
	{ name: "clockinImport.validateCredentials", requires: "orgAdmin", schema: tokenSchema },
	({ input }) =>
		Effect.gen(function* () {
			const failed = "Failed to validate Clockin credentials";
			const client = new ClockinClient(input.token);
			const connection = yield* clockin("testConnection", failed, () => client.testConnection());
			if (!connection.success) {
				return yield* Effect.fail(
					new ValidationError({ message: connection.error, field: "token" }),
				);
			}

			// The preview covers this calendar year so far, in UTC.
			const today = systemClock.nowInstant().toZonedDateTimeISO("UTC").toPlainDate();
			const startDate = today.with({ month: 1, day: 1 }).toString();
			const endDate = today.toString();

			const employees = yield* clockin("getEmployees", failed, () => client.getEmployees());
			const employeeIds = employees.map((entry) => entry.id);
			const [workdays, absences] =
				employeeIds.length > 0
					? yield* clockin("preview", failed, () =>
							Promise.all([
								client.searchWorkdays({ employeeIds, startDate, endDate }),
								client.searchAbsences({ employeeIds, startDate, endDate }),
							]),
						)
					: [[], []];

			return {
				employees: employees.length,
				workdays: workdays.length,
				absences: absences.length,
				schedules: 0,
			} satisfies ClockinPreview;
		}),
);

export const fetchClockinEmployees = organizationAction(
	{ name: "clockinImport.fetchClockinEmployees", requires: "orgAdmin", schema: tokenSchema },
	({ input }) =>
		Effect.gen(function* () {
			const client = new ClockinClient(input.token);
			const employees = yield* clockin("getEmployees", "Failed to fetch Clockin employees", () =>
				client.getEmployees(),
			);
			return employees.map(
				(entry): ClockinEmployeeInfo => ({
					id: entry.id,
					name: `${entry.first_name} ${entry.last_name}`.trim(),
					email: entry.email,
				}),
			);
		}),
);

export const fetchZ8Employees = organizationAction(
	{ name: "clockinImport.fetchZ8Employees", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const employees = yield* dbService.query("clockinImport.fetchZ8Employees", () =>
				dbService.db
					.select({
						id: employee.id,
						userId: employee.userId,
						firstName: authSchema.user.firstName,
						lastName: authSchema.user.lastName,
						email: authSchema.user.email,
						userName: authSchema.user.name,
					})
					.from(employee)
					.innerJoin(authSchema.user, eq(employee.userId, authSchema.user.id))
					.where(eq(employee.organizationId, organizationId)),
			);

			return employees.map(
				(entry): Z8EmployeeInfo => ({
					id: entry.id,
					userId: entry.userId,
					name: buildAuthUserDisplayName({
						firstName: entry.firstName,
						lastName: entry.lastName,
						name: entry.userName,
						email: entry.email,
					}),
					email: entry.email,
				}),
			);
		}),
);

/** Direct imports are disabled; imports go through an import review scan. */
export const importClockinData = organizationAction(
	{ name: "clockinImport.importData", requires: "orgAdmin", schema: noInput },
	() =>
		Effect.fail(
			new ValidationError({
				message: "Direct Clockin imports are disabled. Start an import review scan instead.",
			}),
		) as Effect.Effect<ClockinImportResult, ValidationError>,
);
