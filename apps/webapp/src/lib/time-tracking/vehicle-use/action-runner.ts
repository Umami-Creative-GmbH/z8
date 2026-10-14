import "server-only";

import { runServerActionSafe } from "@/lib/effect/result";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { type VehicleUseActionResult, VehicleUseRefusal } from "./errors";

type Outcome<T> = { refusal: null; data: T } | { refusal: VehicleUseRefusal; data: null };

/**
 * Runs a vehicle use server action with the client of the runtime's
 * `DatabaseService`. A `VehicleUseRefusal` thrown by the action (after any
 * transaction it ran in has rolled back) comes back with its stable code for the
 * client to translate; any other failure is `failed`.
 */
export async function runVehicleUseAction<T>(
	name: string,
	action: (db: DatabaseClient) => Promise<T>,
): Promise<VehicleUseActionResult<T>> {
	const result = await runServerActionSafe(
		DatabaseService.use((dbService) =>
			dbService.query(name, () =>
				action(dbService.db).then(
					(data): Outcome<T> => ({ refusal: null, data }),
					(error: unknown): Outcome<T> => {
						if (error instanceof VehicleUseRefusal) return { refusal: error, data: null };
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
