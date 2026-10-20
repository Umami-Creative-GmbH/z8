"use server";
import { db } from "@/db";
import { runDrivingLicenceAction } from "./action-result";
import { readEffectiveDrivingAuthorization } from "./checks";
import {
	requireDrivingLicenceActor,
	requireDrivingLicenceAdministrator,
} from "./context";
import { readDrivingLicenceIntendedDriverAdminData } from "./intended-drivers";
import {
	readDrivingLicencePolicy,
	readDrivingLicenceReactivationImpact,
	saveDrivingLicencePolicy,
	switchDrivingLicenceControl,
} from "./policy";

const POLICY_REFUSALS = [
	"forbidden",
	"timezone_fixed",
	"not_enabled",
	"interval_preview_required",
	"retention_required",
	"setup_required",
	"invalid_setup",
];
function action<T>(run: () => Promise<T>) {
	return runDrivingLicenceAction(run, { refusals: POLICY_REFUSALS, invalidCode: "invalid_policy" });
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
				personWideReason: null,
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
