"use server";
import { revalidatePath } from "next/cache";
import { requireDrivingLicenceAdministrator } from "./context";
import {
	cleanupDrivingLicenceEvidence,
	placeDrivingLicenceHold,
	readDrivingLicenceRetention,
	releaseDrivingLicenceHold,
} from "./retention";

async function run<T>(
	operation: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
	try {
		return { success: true, data: await operation() };
	} catch {
		return {
			success: false,
			error:
				"Retention administration is unavailable. Check your organization access and case details.",
		};
	}
}
export async function getDrivingLicenceRetentionAction() {
	return run(async () =>
		readDrivingLicenceRetention(await requireDrivingLicenceAdministrator()),
	);
}
export async function placeDrivingLicenceHoldAction(input: unknown) {
	return run(async () => {
		const result = await placeDrivingLicenceHold(
			await requireDrivingLicenceAdministrator(),
			input,
		);
		revalidatePath("/settings/driving-licence");
		return result;
	});
}
export async function releaseDrivingLicenceHoldAction(input: unknown) {
	return run(async () => {
		const result = await releaseDrivingLicenceHold(
			await requireDrivingLicenceAdministrator(),
			input,
		);
		revalidatePath("/settings/driving-licence");
		return result;
	});
}
export async function cleanupDrivingLicenceEvidenceAction() {
	return run(async () => {
		const actor = await requireDrivingLicenceAdministrator();
		const result = await cleanupDrivingLicenceEvidence(
			actor.organizationId,
			actor,
		);
		revalidatePath("/settings/driving-licence");
		return result;
	});
}
