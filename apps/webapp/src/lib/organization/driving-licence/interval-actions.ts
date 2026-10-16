"use server";
import { revalidatePath } from "next/cache";
import { requireDrivingLicenceAdministrator } from "./context";
import {
	applyDrivingLicenceInterval,
	previewDrivingLicenceInterval,
} from "./policy-intervals";

function failure(error: unknown) {
	return {
		success: false as const,
		error:
			error instanceof Error &&
			["forbidden", "stale_preview", "not_configured"].includes(error.message)
				? error.message
				: "invalid_interval",
	};
}
export async function previewDrivingLicenceIntervalAction(input: unknown) {
	try {
		return {
			success: true as const,
			data: await previewDrivingLicenceInterval(
				await requireDrivingLicenceAdministrator(),
				input,
			),
		};
	} catch (error) {
		return failure(error);
	}
}
export async function applyDrivingLicenceIntervalAction(input: unknown) {
	try {
		const data = await applyDrivingLicenceInterval(
			await requireDrivingLicenceAdministrator(),
			input,
		);
		revalidatePath("/settings/driving-licence");
		revalidatePath("/driving-licence");
		return { success: true as const, data };
	} catch (error) {
		return failure(error);
	}
}
