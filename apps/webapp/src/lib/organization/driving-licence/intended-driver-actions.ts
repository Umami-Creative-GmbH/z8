"use server";
import { revalidatePath } from "next/cache";
import { runDrivingLicenceAction } from "./action-result";
import { requireDrivingLicenceAdministrator } from "./context";
import { INTENDED_DRIVER_REFUSALS } from "./intended-driver-rules";
import {
	previewDrivingLicenceIntendedDriverAssignment,
	previewDrivingLicenceIntendedDriverRemoval,
	removeDrivingLicenceIntendedDriverAssignment,
	setDrivingLicenceIntendedDriverAssignment,
} from "./intended-drivers";

function action<T>(run: () => Promise<T>) {
	return runDrivingLicenceAction(run, {
		refusals: INTENDED_DRIVER_REFUSALS,
		invalidCode: "invalid_assignment",
	});
}
function revalidate() {
	revalidatePath("/settings/driving-licence");
	revalidatePath("/driving-licence");
}

/** Owners and admins set an organization, team or employee assignment to Required or Not required. */
export async function setDrivingLicenceIntendedDriverAssignmentAction(input: unknown) {
	return action(async () => {
		const result = await setDrivingLicenceIntendedDriverAssignment(
			await requireDrivingLicenceAdministrator(),
			input,
		);
		revalidate();
		return result;
	});
}

/**
 * Owners and admins: who would lose which class authorizations if this assignment were
 * saved (#1425). Read-only; pass `previewToken` with the save.
 */
export async function previewDrivingLicenceIntendedDriverAssignmentAction(input: unknown) {
	return action(async () =>
		previewDrivingLicenceIntendedDriverAssignment(
			await requireDrivingLicenceAdministrator(),
			input,
		),
	);
}

/** Owners and admins: who would lose which class authorizations if this assignment were removed. */
export async function previewDrivingLicenceIntendedDriverRemovalAction(input: unknown) {
	return action(async () =>
		previewDrivingLicenceIntendedDriverRemoval(await requireDrivingLicenceAdministrator(), input),
	);
}

/** Owners and admins remove an assignment; the next broader one then applies. */
export async function removeDrivingLicenceIntendedDriverAssignmentAction(input: unknown) {
	return action(async () => {
		const result = await removeDrivingLicenceIntendedDriverAssignment(
			await requireDrivingLicenceAdministrator(),
			input,
		);
		revalidate();
		return result;
	});
}
