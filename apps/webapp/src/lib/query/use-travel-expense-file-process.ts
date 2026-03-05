"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

interface ProcessTravelExpenseFileParams {
	tusFileKey: string;
	claimId: string;
	fileName?: string;
}

export interface ProcessTravelExpenseFileResponse {
	success: true;
	attachment: {
		id: string;
		fileName: string;
		mimeType: string;
		sizeBytes: number;
		storageKey: string;
	};
}

export function useTravelExpenseFileProcessMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (
			params: ProcessTravelExpenseFileParams,
		): Promise<ProcessTravelExpenseFileResponse> => {
			const response = await fetch("/api/upload/travel-expense/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || "Failed to process travel expense file");
			}

			return response.json();
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.detail(variables.claimId),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.list() });
		},
		retry: 1,
	});
}
