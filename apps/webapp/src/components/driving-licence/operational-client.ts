import type {
	getDrivingAuthorizationStatusAction,
	getOperationalDrivingEmployeesAction,
} from "@/lib/organization/driving-licence/operational-actions";
/** Reads use independent GET requests, never Next's server-action dispatch queue. */
export async function loadDrivingAuthorizationStatus(
	organizationId: string,
	employeeId: string | undefined,
	signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof getDrivingAuthorizationStatusAction>>> {
	const params = new URLSearchParams({
		organizationId,
		...(employeeId ? { employeeId } : {}),
	});
	const response = await fetch(`/api/driving-licence/status?${params}`, {
		cache: "no-store",
		credentials: "same-origin",
		signal,
	});
	if (!response.ok)
		throw new Error("Driving authorization status is unavailable.");
	return response.json();
}
export async function loadOperationalDrivingEmployees(
	organizationId: string,
	search: string,
	signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof getOperationalDrivingEmployeesAction>>> {
	const params = new URLSearchParams({ organizationId, search });
	const response = await fetch(
		`/api/driving-licence/operational-employees?${params}`,
		{ cache: "no-store", credentials: "same-origin", signal },
	);
	if (!response.ok)
		throw new Error("Driving authorization status is unavailable.");
	return response.json();
}
