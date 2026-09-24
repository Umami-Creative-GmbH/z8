"use client";

import { useQuery } from "@tanstack/react-query";
import { getManualEntryTargetContext } from "@/app/[locale]/(app)/time-tracking/actions/manual-entry-context";
import {
	MANUAL_ENTRY_TARGET_NOT_AUTHORIZED,
	type ManualEntryTargetContext,
} from "@/app/[locale]/(app)/time-tracking/actions/types";
import { queryKeys } from "@/lib/query/keys";

export class ManualEntryTargetContextError extends Error {
	readonly notAuthorized: boolean;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "ManualEntryTargetContextError";
		this.notAuthorized = code === MANUAL_ENTRY_TARGET_NOT_AUTHORIZED;
	}
}

/**
 * Loads the creation-authorized form context for a manual entry target.
 * The context is advisory: it is refetched every time the form opens and the
 * server re-checks every submission against the same rules.
 */
export function useManualEntryTargetContext(
	targetEmployeeId: string | undefined,
	enabled: boolean,
) {
	const query = useQuery({
		queryKey: queryKeys.manualEntry.targetContext(targetEmployeeId ?? null),
		queryFn: async (): Promise<ManualEntryTargetContext> => {
			const result = await getManualEntryTargetContext({
				targetEmployeeId: targetEmployeeId ?? null,
			});
			if (!result.success) {
				throw new ManualEntryTargetContextError(result.error, result.code);
			}
			return result.data;
		},
		enabled,
		staleTime: 0,
		retry: false,
	});

	return {
		context: query.data ?? null,
		isLoading: query.isPending && enabled,
		isFetching: query.isFetching,
		error: query.error,
		refetch: query.refetch,
	};
}

export type { ManualEntryTargetContext };
