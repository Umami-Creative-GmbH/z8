"use server";

import { Effect } from "effect";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth-helpers";
import { isOrganizationAdmin } from "@/lib/authorization/organization-admin";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
	AuthorizationError,
	ExternalServiceError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { enqueuePersonalDataExport } from "@/lib/personal-data-export/processor";
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

type MyDataEffect<T> = Effect.Effect<T, AnyAppError, AppServices>;

/** Download links are signed for this long; the page asks for a new one per click. */
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Machine-readable refusals the My data page maps to its own copy. */
export type MyDataRefusal = "in_progress" | "daily_limit" | "storage_unavailable";

export type MyDataOverview =
	| { status: "available"; exports: PersonalDataExportSummary[] }
	| { status: "no_employee_record" }
	| { status: "unavailable" };

/** The signed-in user and their active organization; no employee record required. */
function signedInMember() {
	return Effect.gen(function* () {
		const authContext = yield* Effect.tryPromise({
			try: () => getAuthContext(),
			catch: () => new AuthorizationError({ message: "Sign in to continue" }),
		});
		const organizationId = authContext?.session.activeOrganizationId;
		if (!authContext || !organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({ message: "Active organization required" }),
			);
		}
		const dbService = yield* DatabaseService;
		return { dbService, organizationId, userId: authContext.user.id };
	});
}

function requestContext(): Effect.Effect<PersonalDataExportRequestContext> {
	return Effect.promise(async () => shareRequestContext(await headers()));
}

/** Whether My data is available, and the employee's own exports when it is. */
export async function getMyDataOverview(): Promise<ServerActionResult<MyDataOverview>> {
	const effect: MyDataEffect<MyDataOverview> = Effect.gen(function* () {
		const { dbService, organizationId, userId } = yield* signedInMember();
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
	});
	return runServerActionSafe(effect);
}

/** Starts an employee export of the signed-in employee's data in the active organization. */
export async function requestMyPersonalDataExport(): Promise<
	ServerActionResult<{ exportId: string }>
> {
	const effect: MyDataEffect<{ exportId: string }> = Effect.gen(function* () {
		const { dbService, organizationId, userId } = yield* signedInMember();
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
			if (result.reason === "employee_not_found") {
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
		const queued = yield* dbService.query("personalDataExport.enqueue", () =>
			enqueuePersonalDataExport(dbService.db, { organizationId, exportId: result.exportId }),
		);
		if (!queued) {
			return yield* Effect.fail(
				new ExternalServiceError({
					message: "The export could not be started. Please try again.",
					service: "queue",
					operation: "personalDataExport.enqueue",
				}),
			);
		}
		return { exportId: result.exportId };
	});
	return runServerActionSafe(effect);
}

/**
 * A fresh, short-lived download URL for one completed export, after checking
 * that the signed-in user may download it (the requester of an employee
 * export, an org admin for an admin export). Every download is audited.
 */
export async function getPersonalDataExportDownloadUrl(
	exportId: string,
): Promise<ServerActionResult<{ url: string }>> {
	const effect: MyDataEffect<{ url: string }> = Effect.gen(function* () {
		const { dbService, organizationId, userId } = yield* signedInMember();
		const now = systemClock.nowInstant();
		const request = yield* requestContext();
		const download = yield* dbService.query("personalDataExport.authorizeDownload", async () => {
			const access = await resolveMyDataAccess(dbService.db, { userId, organizationId, now });
			if (access.status === "unavailable")
				return { ok: false as const, reason: "not_found" as const };
			return authorizePersonalDataExportDownload(dbService.db, {
				organizationId,
				exportId: String(exportId),
				actor: {
					userId,
					isOrganizationAdmin: await isOrganizationAdmin(dbService.db, { userId, organizationId }),
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
	});
	return runServerActionSafe(effect);
}
