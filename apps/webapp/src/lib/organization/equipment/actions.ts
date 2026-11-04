"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { equipmentSetupDetailSchema } from "./contracts";
import {
	applyEquipmentSetupChange,
	readEquipmentSetup,
	readEquipmentSetupDetail,
} from "./setup";

const administrator = Effect.gen(function* () {
	const auth = yield* AuthService;
	const session = yield* auth.getSession();
	const organizationId = session.session.activeOrganizationId;
	const denied = () =>
		new AuthorizationError({
			message:
				"Equipment setup requires an accessible organization owner or admin.",
			resource: "equipment",
			action: "manage",
		});
	if (!organizationId) return yield* Effect.fail(denied());
	yield* requireActiveOrganizationActionActor({
		userId: session.user.id,
		organizationId,
		requiredRole: "admin",
		resource: "equipment",
		action: "manage",
		message:
			"Equipment setup requires an accessible organization owner or admin.",
	});
	const database = yield* DatabaseService;
	const access = yield* database.query("equipment.access", () =>
		resolveEmployeeOrganizationAccess(database.db, {
			organizationId,
			userId: session.user.id,
		}),
	);
	if (!access.allowed) return yield* Effect.fail(denied());
	return { organizationId, userId: session.user.id };
});

/** Every read resolves the actor and active organization on the server. Includes retained archived identities. */
export async function getEquipmentSetup() {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* administrator;
			const database = yield* DatabaseService;
			return yield* database.query("equipment.setup.read", () =>
				readEquipmentSetup(database.db, actor.organizationId),
			);
		}),
	);
}

export async function changeEquipmentSetup(input: unknown) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* administrator;
			const database = yield* DatabaseService;
			const outcome = yield* database.query("equipment.setup.change", () =>
				applyEquipmentSetupChange(database.db, actor, input),
			);
			if (outcome.ok) revalidatePath("/settings/equipment");
			return outcome;
		}),
	);
}

export async function getEquipmentSetupDetail(input: unknown) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* administrator;
			const parsed = equipmentSetupDetailSchema.safeParse(input);
			if (!parsed.success)
				return yield* Effect.fail(
					new ValidationError({
						message: "Invalid equipment record reference.",
					}),
				);
			const database = yield* DatabaseService;
			return yield* database.query("equipment.setup.detail", () =>
				readEquipmentSetupDetail(
					database.db,
					actor.organizationId,
					parsed.data,
				),
			);
		}),
	);
}
