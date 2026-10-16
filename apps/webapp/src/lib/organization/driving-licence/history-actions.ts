"use server";
import { revalidatePath } from "next/cache";
import { requireDrivingLicenceActor } from "./context";
import {
	readDrivingLicenceHistory,
	supplementDrivingLicenceCheck,
} from "./history";

async function run<T>(
	operation: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
	try {
		return { success: true, data: await operation() };
	} catch {
		return {
			success: false,
			error:
				"Driving licence history is unavailable. Check your current responsibility and correction details.",
		};
	}
}
export async function supplementDrivingLicenceCheckAction(input: unknown) {
	return run(async () => {
		const result = await supplementDrivingLicenceCheck(
			await requireDrivingLicenceActor(),
			input,
		);
		revalidatePath("/driving-licence");
		return result;
	});
}
export async function getDrivingLicenceHistoryAction(input: unknown) {
	return run(async () =>
		readDrivingLicenceHistory(await requireDrivingLicenceActor(), input),
	);
}
