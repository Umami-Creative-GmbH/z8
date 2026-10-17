"use server";
import { z } from "zod";
import { requireDrivingLicenceActor } from "./context";
import {
	readOperationalDrivingEmployees,
	readOperationalDrivingStatus,
} from "./operational";

async function run<T>(
	operation: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
	try {
		return { success: true, data: await operation() };
	} catch {
		return {
			success: false,
			error: "Driving authorization status is unavailable.",
		};
	}
}
export async function getDrivingAuthorizationStatusAction(input: unknown = {}) {
	return run(async () => {
		const value = z
			.strictObject({ employeeId: z.uuid().optional() })
			.parse(input);
		return readOperationalDrivingStatus(
			await requireDrivingLicenceActor(),
			value.employeeId,
		);
	});
}
export async function getOperationalDrivingEmployeesAction(
	input: unknown = {},
) {
	return run(async () => {
		const value = z
			.strictObject({ search: z.string().trim().max(100).default("") })
			.parse(input);
		return readOperationalDrivingEmployees(
			await requireDrivingLicenceActor(),
			value.search,
		);
	});
}
