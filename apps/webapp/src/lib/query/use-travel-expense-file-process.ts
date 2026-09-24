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

class TravelExpenseFileProcessError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "TravelExpenseFileProcessError";
	}
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
				throw new TravelExpenseFileProcessError(
					errorData.error || "Failed to process travel expense file",
					response.status,
				);
			}

			return response.json();
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.detail(variables.claimId),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.list() });
		},
		// A rejected upload (for example a claim submitted meanwhile) is final;
		// retrying would only replace its explanation with a missing-file error.
		retry: (failureCount, error) =>
			failureCount < 1 &&
			!(error instanceof TravelExpenseFileProcessError && error.status < 500),
	});
}
