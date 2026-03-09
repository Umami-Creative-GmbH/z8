"use server";

import { Effect } from "effect";
import {
	getLocationsWithSubareasForOrganization,
	type LocationWithSubareas,
	requireCurrentEmployee,
	runSchedulingAction,
	type SchedulingActionResult,
} from "./shared";

export type { LocationWithSubareas };

export async function getLocationsWithSubareas(): Promise<
	SchedulingActionResult<LocationWithSubareas[]>
> {
	const effect = Effect.gen(function* (_) {
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		return yield* _(getLocationsWithSubareasForOrganization(currentEmployee.organizationId));
	});

	return runSchedulingAction("getLocationsWithSubareas", effect);
}
