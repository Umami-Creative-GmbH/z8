"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDrivingLicenceActor } from "./context";
import {
	readDrivingImpedimentState,
	reinstateDrivingAuthorization,
	reportDrivingImpediment,
} from "./impediments";
export async function reportDrivingImpedimentAction(input: unknown) {
	try {
		const data = await reportDrivingImpediment(
			await requireDrivingLicenceActor(),
			input,
		);
		revalidatePath("/driving-licence");
		revalidatePath("/settings/driving-licence");
		return { success: true as const, data };
	} catch {
		return {
			success: false as const,
			error:
				"The report could not be saved. Check your current employee access and retry.",
		};
	}
}

export async function getDrivingImpedimentStateAction(input: {
	employeeId: string;
}) {
	try {
		return {
			success: true as const,
			data: await readDrivingImpedimentState(
				await requireDrivingLicenceActor(),
				z.uuid().parse(input?.employeeId),
			),
		};
	} catch {
		return {
			success: false as const,
			error: "Driving impediment information is unavailable.",
		};
	}
}
export async function reinstateDrivingAuthorizationAction(input: unknown) {
	try {
		const data = await reinstateDrivingAuthorization(
			await requireDrivingLicenceActor(),
			input,
		);
		revalidatePath("/driving-licence");
		revalidatePath("/settings/driving-licence");
		revalidatePath("/settings/driving-licence");
		return { success: true as const, data };
	} catch {
		return {
			success: false as const,
			error:
				"Reinstatement requires current verifier responsibility, a new successful original check and confirmation that all impediments were resolved. Refresh and review the current record.",
		};
	}
}
