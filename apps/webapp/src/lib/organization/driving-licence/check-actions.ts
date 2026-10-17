"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	completeDrivingLicenceCheck,
	readDrivingLicenceEmployeeRecord,
	readDrivingLicenceWorklist,
} from "./checks";
import { requireDrivingLicenceActor } from "./context";

async function run<T>(
	operation: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
	try {
		return { success: true, data: await operation() };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof z.ZodError
					? "Check the original inspection confirmations, classes and document dates."
					: "Driving licence check is unavailable. Check your current responsibility and selections.",
		};
	}
}
export async function completeDrivingLicenceCheckAction(input: unknown) {
	return run(async () => {
		const result = await completeDrivingLicenceCheck(
			await requireDrivingLicenceActor(),
			input,
		);
		revalidatePath("/driving-licence");
		revalidatePath("/settings/driving-licence");
		return result;
	});
}
export async function getDrivingLicenceEmployeeRecordAction(input: {
	employeeId: string;
}) {
	return run(async () =>
		readDrivingLicenceEmployeeRecord(
			await requireDrivingLicenceActor(),
			z.uuid().parse(input?.employeeId),
		),
	);
}
export async function getDrivingLicenceCheckWorklistAction() {
	return run(async () =>
		readDrivingLicenceWorklist(await requireDrivingLicenceActor()),
	);
}
