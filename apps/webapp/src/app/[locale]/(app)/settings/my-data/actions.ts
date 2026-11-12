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
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { enqueuePersonalDataExportBuild } from "@/lib/personal-data-export/enqueue-effect";
import {
	authorizePersonalDataExportDownload,
	listPersonalDataExports,
	type PersonalDataExportRequestContext,
	type PersonalDataExportSummary,
	requestPersonalDataExport,
	resolveMyDataAccess,
} from "@/lib/personal-data-export/store";
import { shareRequestContext } from "@/lib/projects/report-share/request-context";
import { getPrivateObjectPresignedUrl, isExportS3Configured } from "@/lib/storage/export-s3-client";

/** Download links are signed for this long; the page asks for a new one per click. */
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Machine-readable refusals the My data page maps to its own copy. */
export type MyDataRefusal = "in_progress" | "daily_limit" | "storage_unavailable";

export type MyDataOverview =
	| { status: "available"; exports: PersonalDataExportSummary[] }
	| { status: "no_employee_record" }
	| { status: "unavailable" };

function requestContext(): Effect.Effect<PersonalDataExportRequestContext> {
	return Effect.promise(async () => shareRequestContext(await headers()));
}

/** Whether My data is available, and the employee's own exports when it is. */
export const getMyDataOverview = organizationAction(
	{ name: "personalDataExport.myDataOverview", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
			const dbService = yield* DatabaseService;
			const now = systemClock.nowInstant();
			return yield* dbService.query("personalDataExport.myDataOverview", async () => {
				const access = await resolveMyDataAccess(dbService.db, { userId, organizationId, now });
				if (access.status !== "available") return access;
				const exports = await listPersonalDataExports(dbService.db, {
					organizationId,
					employeeId: access.employeeId,
					kind: "employee",
					now,
				});
				return { status: "available" as const, exports };
			});
		}),
);

/** Starts an employee export of the signed-in employee's data in the active organization. */
export const requestMyPersonalDataExport = organizationAction(
	{ name: "personalDataExport.requestMine", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
			const dbService = yield* DatabaseService;
			const now = systemClock.nowInstant();
			const access = yield* dbService.query("personalDataExport.myDataAccess", () =>
				resolveMyDataAccess(dbService.db, { userId, organizationId, now }),
			);
			if (access.status !== "available") {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Only employees of this organization can export their personal data",
					}),
				);
			}
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
						refusal: "storage_unavailable" satisfies MyDataRefusal,
					}),
				);
			}
			const request = yield* requestContext();
			const result = yield* dbService.query("personalDataExport.request", () =>
				requestPersonalDataExport(dbService.db, {
					organizationId,
					employeeId: access.employeeId,
					kind: "employee",
					requestedByUserId: userId,
					now,
					request,
				}),
			);
			if (!result.ok) {
				// `own_record` concerns admin exports only; an employee export is always one's own.
				if (result.reason === "employee_not_found" || result.reason === "own_record") {
					return yield* Effect.fail(
						new NotFoundError({ message: "Employee not found", entityType: "employee" }),
					);
				}
				return yield* Effect.fail(
					new ValidationError({
						message:
							result.reason === "in_progress"
								? "An export of your data is already being prepared"
								: "You can request one export of your data every 24 hours",
						refusal: result.reason satisfies MyDataRefusal,
					}),
				);
			}
			yield* enqueuePersonalDataExportBuild(dbService.db, {
				organizationId,
				exportId: result.exportId,
			});
			return { exportId: result.exportId };
		}),
);

/**
 * A fresh, short-lived download URL for one completed export, after checking
 * that the signed-in user may download it (the requester of an employee
 * export, an org admin for an admin export). Every download is audited.
 */
export const getPersonalDataExportDownloadUrl = organizationAction(
	{ name: "personalDataExport.downloadUrl", requires: "member", schema: z.string() },
	({ actor, organizationId, input: exportId }) =>
		Effect.gen(function* () {
			const userId = actor.userId;
			const dbService = yield* DatabaseService;
			const now = systemClock.nowInstant();
			const request = yield* requestContext();
			const download = yield* dbService.query("personalDataExport.authorizeDownload", async () => {
				const access = await resolveMyDataAccess(dbService.db, { userId, organizationId, now });
				if (access.status === "unavailable")
					return { ok: false as const, reason: "not_found" as const };
				return authorizePersonalDataExportDownload(dbService.db, {
					organizationId,
					exportId,
					actor: {
						userId,
						isOrganizationAdmin: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
					},
					now,
					request,
				});
			});
			if (!download.ok) {
				return yield* Effect.fail(
					download.reason === "not_ready"
						? new ValidationError({ message: "This export is not ready yet" })
						: new NotFoundError({
								message: "Export not found",
								entityType: "personal_data_export",
							}),
				);
			}
			const url = yield* Effect.tryPromise({
				try: () =>
					getPrivateObjectPresignedUrl({
						organizationId,
						...download.object,
						fileName: download.fileName,
						expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
					}),
				catch: (cause) =>
					new ExternalServiceError({
						message: "The file is unavailable right now",
						service: "storage",
						operation: "personalDataExport.signDownload",
						cause,
					}),
			});
			return { url };
		}),
);
