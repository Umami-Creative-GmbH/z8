"use client";

import { queryOptions } from "@tanstack/react-query";
import { getSurchargeModels } from "@/app/[locale]/(app)/settings/surcharges/actions";
import { queryKeys } from "./keys";

/** The catalog and assignment selector share this read and mutation invalidation. */
export function surchargeModelsQuery(organizationId: string) {
	return queryOptions({
		queryKey: queryKeys.surcharges.models.list(organizationId),
		queryFn: async () => {
			const result = await getSurchargeModels(organizationId);
			if (!result.success)
				throw new Error(result.error || "Surcharge models could not be loaded");
			return result.data;
		},
		staleTime: 30_000,
	});
}
