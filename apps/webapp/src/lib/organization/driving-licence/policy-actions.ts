"use server";
import { z } from "zod";
import { db } from "@/db";
import { readEffectiveDrivingAuthorization } from "./checks";
import {
	requireDrivingLicenceActor,
	requireDrivingLicenceAdministrator,
} from "./context";
import { readDrivingLicenceIntendedDriverAdminData } from "./intended-drivers";
import {
	readDrivingLicencePolicy,
	saveDrivingLicencePolicy,
	switchDrivingLicenceControl,
} from "./policy";

type Result<T> = { success: true; data: T } | { success: false; error: string };
async function action<T>(run: () => Promise<T>): Promise<Result<T>> {
	try {
		return { success: true, data: await run() };
	} catch (error) {
		const code =
			error instanceof z.ZodError
				? "invalid_policy"
				: error instanceof Error &&
						[
							"forbidden",
							"timezone_fixed",
							"not_enabled",
							"interval_preview_required",
							"retention_required",
							"setup_required",
							"invalid_setup",
						].includes(error.message)
					? error.message
					: "save_failed";
		return { success: false, error: code };
	}
}
export async function saveDrivingLicencePolicyAction(input: unknown) {
	return action(async () =>
		saveDrivingLicencePolicy(await requireDrivingLicenceAdministrator(), input),
	);
}
/** The Features switch (#1421): owners and admins switch driving licence control on and off. */
export async function switchDrivingLicenceControlAction(input: unknown) {
	return action(async () =>
		switchDrivingLicenceControl(
			await requireDrivingLicenceAdministrator(),
			input,
		),
	);
}
/** The settings page: the policy and the intended-driver assignments (#1423). */
export async function getDrivingLicenceAdminDataAction() {
	return action(async () => {
		const actor = await requireDrivingLicenceAdministrator();
		const [policy, intendedDrivers] = await Promise.all([
			readDrivingLicencePolicy(actor.organizationId),
			readDrivingLicenceIntendedDriverAdminData(actor.organizationId),
		]);
		return { policy, intendedDrivers };
	});
}
export async function getOwnDrivingLicenceStatusAction() {
	return action(async () => {
		const actor = await requireDrivingLicenceActor();
		if (!actor.employeeId)
			return {
				enrolled: false,
				status: "not_enrolled" as const,
				authorizedClasses: [] as string[],
				classes: [],
				timezone: null,
			};
		return readEffectiveDrivingAuthorization(
			db,
			actor.organizationId,
			actor.employeeId,
		);
	});
}
