"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";
import {
	equipmentFiltersSchema,
	equipmentSetupDetailSchema,
} from "./contracts";
import { applyEquipmentChange, readEquipment } from "./custody";
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

const equipmentActor = Effect.gen(function* () {
	const auth = yield* AuthService;
	const session = yield* auth.getSession();
	const organizationId = session.session.activeOrganizationId;
	const database = yield* DatabaseService;
	if (
		!organizationId ||
		!(yield* database.query("equipment.authentication", () =>
			canAccessOrganization(session.session, organizationId, database.db),
		))
	)
		return yield* Effect.fail(
			new AuthorizationError({
				message: "Equipment access is not available.",
				resource: "equipment",
				action: "read",
			}),
		);
	return { userId: session.user.id, organizationId, session: session.session };
});

/** Execute a handover. Authorization and employment are rechecked inside its transaction. */
export async function changeEquipment(input: unknown) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* equipmentActor;
			const database = yield* DatabaseService;
			const result = yield* database
				.query("equipment.change", () =>
					applyEquipmentChange(database.db, actor, input),
				)
				.pipe(
					Effect.mapError((error) =>
						error.cause instanceof AuthorizationError ? error.cause : error,
					),
				);
			if (result.ok) {
				revalidatePath("/equipment");
				revalidatePath("/my-equipment");
				revalidatePath("/settings/employees", "layout");
				revalidatePath("/settings/equipment");
			}
			return result;
		}),
	);
}

export async function getEquipmentOverview(input: unknown = {}) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* equipmentActor;
			const parsed = equipmentFiltersSchema.safeParse(input);
			if (!parsed.success)
				return yield* Effect.fail(
					new ValidationError({ message: "Invalid equipment filters." }),
				);
			const database = yield* DatabaseService;
			return yield* database
				.query("equipment.overview", () =>
					readEquipment(database.db, actor, {
						kind: "overview",
						filters: parsed.data,
					}),
				)
				.pipe(
					Effect.mapError((error) =>
						error.cause instanceof AuthorizationError ? error.cause : error,
					),
				);
		}),
	);
}

export async function getEmployeeEquipment(employeeId: unknown) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* equipmentActor;
			const parsed = z.uuid().safeParse(employeeId);
			if (!parsed.success)
				return yield* Effect.fail(
					new ValidationError({ message: "Invalid employee reference." }),
				);
			const database = yield* DatabaseService;
			return yield* database
				.query("equipment.employee", () =>
					readEquipment(database.db, actor, {
						kind: "employee",
						employeeId: parsed.data,
					}),
				)
				.pipe(
					Effect.mapError((error) =>
						error.cause instanceof AuthorizationError ? error.cause : error,
					),
				);
		}),
	);
}

export async function getMyEquipment() {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* equipmentActor;
			const database = yield* DatabaseService;
			return yield* database
				.query("equipment.personal", () =>
					readEquipment(database.db, actor, { kind: "personal" }),
				)
				.pipe(
					Effect.mapError((error) =>
						error.cause instanceof AuthorizationError ? error.cause : error,
					),
				);
		}),
	);
}
