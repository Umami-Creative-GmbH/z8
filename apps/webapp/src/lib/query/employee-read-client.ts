"use client";

import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { ApiError, fetchApi } from "@/lib/fetch";
import {
	type EmployeeReadDataset,
	type EmployeeReadParams,
	type EmployeeReadScope,
	type EmployeeReadSnapshot,
	sameEmployeeReadScope,
} from "@/lib/organization/employee-read-types";

/** fetchApi revives the existing SuperJSON Date metadata at this JSON boundary. */
export async function fetchEmployeeRead<K extends EmployeeReadDataset>(
	dataset: K,
	scope: EmployeeReadScope,
	params: EmployeeReadParams[K],
	signal: AbortSignal,
): Promise<EmployeeReadSnapshot<K>> {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) search.set(key, String(value));
	}
	const result = await fetchApi<EmployeeReadSnapshot<K>>(
		`/api/settings/employees/read/${dataset}?${search}`,
		{
			signal,
			cache: "no-store",
			headers: {
				[ORGANIZATION_CONTEXT_HEADERS.user]: scope.userId,
				[ORGANIZATION_CONTEXT_HEADERS.organization]: scope.organizationId,
			},
		},
	);
	if (!sameEmployeeReadScope(result.scope, scope)) {
		throw new ApiError("Employee context changed. Refresh to continue.", 409);
	}
	return result;
}
