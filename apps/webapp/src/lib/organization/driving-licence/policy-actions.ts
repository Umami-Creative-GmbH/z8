"use server";
import { z } from "zod";
import { db } from "@/db";
import { readEffectiveDrivingAuthorization } from "./checks";
import {
	requireDrivingLicenceActor,
	requireDrivingLicenceAdministrator,
} from "./context";
import {
	enrollDrivingLicenceEmployee,
	listDrivingLicenceEmployees,
	listDrivingLicenceParticipants,
	readDrivingLicencePolicy,
	readDrivingLicenceReactivationImpact,
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
/** Read-only count for the switch-on confirmation (#1422): authorizations the switch-on suspends. */
export async function getDrivingLicenceReactivationImpactAction() {
	return action(async () => {
		const actor = await requireDrivingLicenceAdministrator();
		return readDrivingLicenceReactivationImpact(actor.organizationId);
	});
}
export async function enrollDrivingLicenceEmployeeAction(input: unknown) {
	return action(async () =>
		enrollDrivingLicenceEmployee(
			await requireDrivingLicenceAdministrator(),
			input,
		),
	);
}
export async function getDrivingLicenceAdminDataAction() {
	return action(async () => {
		const actor = await requireDrivingLicenceAdministrator();
		const [policy, employees, participants] = await Promise.all([
			readDrivingLicencePolicy(actor.organizationId),
			listDrivingLicenceEmployees(actor.organizationId),
			listDrivingLicenceParticipants(actor.organizationId),
		]);
		return { policy, employees, participants };
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
