"use server";
import { z } from "zod";
import {
	requireDrivingLicenceActor,
	requireDrivingLicenceAdministrator,
} from "./context";
import {
	enrollDrivingLicenceEmployee,
	listDrivingLicenceEmployees,
	listDrivingLicenceParticipants,
	readDrivingLicencePolicy,
	saveDrivingLicencePolicy,
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
						["forbidden", "timezone_fixed", "not_enabled"].includes(
							error.message,
						)
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
		const [policy, participants] = await Promise.all([
			readDrivingLicencePolicy(actor.organizationId),
			listDrivingLicenceParticipants(actor.organizationId),
		]);
		const own = participants.find((p) => p.employeeId === actor.employeeId);
		return {
			enrolled: !!own,
			status: own ? ("not_yet_checked" as const) : ("not_enrolled" as const),
			authorizedClasses: [] as string[],
			timezone: policy?.timezone ?? null,
		};
	});
}
