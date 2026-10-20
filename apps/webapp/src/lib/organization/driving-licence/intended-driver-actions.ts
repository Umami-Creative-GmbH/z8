"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDrivingLicenceAdministrator } from "./context";
import { INTENDED_DRIVER_REFUSALS } from "./intended-driver-rules";
import {
	removeDrivingLicenceIntendedDriverAssignment,
	setDrivingLicenceIntendedDriverAssignment,
} from "./intended-drivers";

type Result<T> = { success: true; data: T } | { success: false; error: string };
async function action<T>(run: () => Promise<T>): Promise<Result<T>> {
	try {
		return { success: true, data: await run() };
	} catch (error) {
		const refusals: readonly string[] = INTENDED_DRIVER_REFUSALS;
		const code =
			error instanceof z.ZodError
				? "invalid_assignment"
				: error instanceof Error && refusals.includes(error.message)
					? error.message
					: "save_failed";
		return { success: false, error: code };
	}
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
