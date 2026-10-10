import "server-only";

import { getAuthContext } from "@/lib/auth-helpers";
import { runServerActionSafe } from "@/lib/effect/result";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { type KioskPinActionResult, KioskPinRefusal } from "./pin-errors";

type Outcome<T> = { refusal: null; data: T } | { refusal: KioskPinRefusal; data: null };

/** The signed-in user and their active organization. */
export type KioskActionActor = { userId: string; organizationId: string };

/**
 * Runs a kiosk PIN or kiosk-only employee server action for the signed-in user
 * in their active organization, with the runtime's database client. A
 * `KioskPinRefusal` comes back with its stable code for the client to
 * translate; any other failure is `failed`. Authorization is the store's.
 */
export async function runKioskAction<T>(
	name: string,
	action: (db: DatabaseClient, actor: KioskActionActor) => Promise<T>,
): Promise<KioskPinActionResult<T>> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId) {
		return { success: false, error: "Sign in to continue.", code: "sign_in_required" };
	}
	const actor = { userId: authContext.user.id, organizationId };
	const result = await runServerActionSafe(
		DatabaseService.use((dbService) =>
			dbService.query(name, () =>
				action(dbService.db, actor).then(
					(data): Outcome<T> => ({ refusal: null, data }),
					(error: unknown): Outcome<T> => {
						if (error instanceof KioskPinRefusal) return { refusal: error, data: null };
						throw error;
					},
				),
			),
		),
	);
	if (!result.success) return { success: false, error: result.error, code: "failed" };
	const outcome = result.data;
	if (outcome.refusal) {
		return { success: false, error: outcome.refusal.message, code: outcome.refusal.code };
	}
	return { success: true, data: outcome.data };
}
