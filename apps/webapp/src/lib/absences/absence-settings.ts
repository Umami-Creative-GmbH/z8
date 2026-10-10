import { eq, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { absenceSetting } from "@/db/schema";

/**
 * Organization-wide absence settings (#982). No row means the defaults. Only
 * owners and admins change them, in the absence settings.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

export interface AbsenceSettings {
	/**
	 * Employees may attach sick notes to their own sick-leave absences. Only
	 * employee uploads depend on it, and it needs personnel files (ADR 0002).
	 */
	employeeSickNoteUpload: boolean;
}

export const DEFAULT_ABSENCE_SETTINGS: AbsenceSettings = Object.freeze({
	employeeSickNoteUpload: false,
});

export async function loadAbsenceSettings(
	database: Reader,
	organizationId: string,
): Promise<AbsenceSettings> {
	const [row] = await database
		.select({ employeeSickNoteUpload: absenceSetting.employeeSickNoteUpload })
		.from(absenceSetting)
		.where(eq(absenceSetting.organizationId, organizationId))
		.limit(1);
	return row ?? DEFAULT_ABSENCE_SETTINGS;
}

export type SaveEmployeeSickNoteUploadResult =
	| { kind: "saved"; employeeSickNoteUpload: boolean }
	| { kind: "personnel_files_disabled" };

/**
 * Turns employee sick notes on or off. Turning them on needs personnel files,
 * checked under a lock on the organization row so a concurrent toggle of
 * personnel files cannot slip in between; turning them off always works.
 */
export async function saveEmployeeSickNoteUpload(
	database: Database,
	input: { organizationId: string; enabled: boolean; actorUserId: string },
): Promise<SaveEmployeeSickNoteUploadResult> {
	return database.transaction(async (tx) => {
		if (input.enabled) {
			const [org] = await tx
				.select({ personnelFilesEnabled: organization.personnelFilesEnabled })
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.for("share");
			if (org?.personnelFilesEnabled !== true) return { kind: "personnel_files_disabled" };
		}
		await tx
			.insert(absenceSetting)
			.values({
				organizationId: input.organizationId,
				employeeSickNoteUpload: input.enabled,
				updatedBy: input.actorUserId,
			})
			.onConflictDoUpdate({
				target: absenceSetting.organizationId,
				set: {
					employeeSickNoteUpload: input.enabled,
					updatedBy: input.actorUserId,
					updatedAt: sql`now()`,
				},
			});
		return { kind: "saved", employeeSickNoteUpload: input.enabled };
	});
}
