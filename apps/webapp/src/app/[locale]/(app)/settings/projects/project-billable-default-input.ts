import "server-only";

import { Effect } from "effect";
import { decideProjectBillableDefault } from "@/lib/billable-time/project-billable-default";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { type DatabaseError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseService } from "@/lib/effect/services/database.service";

/**
 * The billable default a project create or update stores (#900): refused without a customer,
 * switched off when the project loses its customer. Anything but a boolean is invalid.
 * Shared by the project form and creating a project from a template (#880).
 */
export function projectBillableDefault(input: {
	requested: unknown;
	current: boolean;
	customerId: string | null;
}): Effect.Effect<boolean, ValidationError> {
	if (input.requested !== undefined && typeof input.requested !== "boolean") {
		return Effect.fail(
			new ValidationError({ message: "Invalid billable default", field: "billableDefault" }),
		);
	}
	const decision = decideProjectBillableDefault({
		requested: input.requested,
		current: input.current,
		customerId: input.customerId,
	});
	return decision.ok
		? Effect.succeed(decision.billableDefault)
		: Effect.fail(
				new ValidationError({
					message: "Only a project with a customer can be billable by default",
					field: "billableDefault",
				}),
			);
}

/**
 * The billable default is part of Billable Time: while the module is off, a
 * request that would change it is refused (#768). Defaults already set keep being
 * applied to new work, and the automatic switch-off on customer removal still runs.
 */
export function requireBillableTimeForDefaultChange(
	dbService: typeof DatabaseService.Service,
	organizationId: string,
	input: { requested: unknown; current: boolean },
): Effect.Effect<void, ValidationError | DatabaseError> {
	return Effect.gen(function* () {
		if (input.requested === undefined || input.requested === input.current) return;
		const settings = yield* dbService.query("billableTime.settings", () =>
			getBillableTimeSettings(organizationId, dbService.db),
		);
		if (!settings.enabled) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Billable Time is switched off",
					field: "billableDefault",
				}),
			);
		}
	});
}
