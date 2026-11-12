"use server";

import { Effect } from "effect";
import { headers } from "next/headers";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ExternalServiceError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { enqueuePersonalDataExportBuild } from "@/lib/personal-data-export/enqueue-effect";
import {
	listAdminPersonalDataExports,
	type PersonalDataExportRequestContext,
	requestPersonalDataExport,
} from "@/lib/personal-data-export/store";
import { shareRequestContext } from "@/lib/projects/report-share/request-context";
import { isExportS3Configured } from "@/lib/storage/export-s3-client";

/**
 * Admin exports on the employee page (#811, #1166): an org admin (owners
 * included) requests and lists personal data exports of any employee of the
 * active organization, current or former, but never of their own record.
 * Downloads go through `getPersonalDataExportDownloadUrl` (My data actions),
 * which lets org admins download admin exports.
 */

/** Machine-readable refusals the employee page maps to its own copy. */
export type AdminExportRefusal = "in_progress" | "storage_unavailable";

const employeeIdSchema = z.uuid("Invalid employee ID");

function employeeNotFound() {
	return new NotFoundError({ message: "Employee not found", entityType: "employee" });
}

/** Admin exports hold withheld data: never of, or for, the admin's own employee record. */
function ownRecordRefusal(userId: string, action: string) {
	return new AuthorizationError({
		message: "Export your own data from My data instead",
		userId,
		resource: "personal_data_export",
		action,
	});
}

/** The employee's admin exports that are still kept, newest first. */
export const getEmployeePersonalDataExportsAction = organizationAction(
	{ name: "personalDataExport.listAdmin", requires: "orgAdmin", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const listed = yield* dbService.query("personalDataExport.listAdmin", () =>
				listAdminPersonalDataExports(dbService.db, {
					organizationId,
					employeeId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
				}),
			);
			if (listed.ok) return listed.exports;
			return yield* Effect.fail(
				listed.reason === "own_record"
					? ownRecordRefusal(actor.userId, "list")
					: employeeNotFound(),
			);
		}),
);

/** Starts an admin export of one employee's personal data. */
export const requestEmployeePersonalDataExportAction = organizationAction(
	{ name: "personalDataExport.requestAdmin", requires: "orgAdmin", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const storageReady = yield* Effect.tryPromise({
				try: () => isExportS3Configured(organizationId),
				catch: (cause) =>
					new ExternalServiceError({
						message: "File storage is unavailable",
						service: "storage",
						operation: "personalDataExport.checkStorage",
						cause,
					}),
			});
			if (!storageReady) {
				return yield* Effect.fail(
					new ValidationError({
						message: "File storage is not set up for this organization",
						refusal: "storage_unavailable" satisfies AdminExportRefusal,
					}),
				);
			}
			const request = yield* Effect.promise(
				async (): Promise<PersonalDataExportRequestContext> => shareRequestContext(await headers()),
			);
			const result = yield* dbService.query("personalDataExport.requestAdmin", () =>
				requestPersonalDataExport(dbService.db, {
					organizationId,
					employeeId,
					kind: "admin",
					requestedByUserId: actor.userId,
					now: systemClock.nowInstant(),
					request,
				}),
			);
			if (!result.ok) {
				switch (result.reason) {
					case "employee_not_found":
						return yield* Effect.fail(employeeNotFound());
					case "own_record":
						return yield* Effect.fail(ownRecordRefusal(actor.userId, "request"));
					case "in_progress":
					case "daily_limit":
						// Admin exports have no daily limit; only one export per employee builds at a time.
						return yield* Effect.fail(
							new ValidationError({
								message: "An export of this employee's data is already being prepared",
								refusal: "in_progress" satisfies AdminExportRefusal,
							}),
						);
				}
			}
			yield* enqueuePersonalDataExportBuild(dbService.db, {
				organizationId,
				exportId: result.exportId,
			});
			return { exportId: result.exportId };
		}),
);
