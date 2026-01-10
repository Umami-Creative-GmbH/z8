"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

interface ProcessImageParams {
	tusFileKey: string;
	uploadType: "avatar" | "org-logo" | "branding-logo" | "branding-background";
	organizationId?: string;
}

interface ProcessImageResponse {
	success: boolean;
	url: string;
	key: string;
	size: number;
}

export function useImageProcessMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (params: ProcessImageParams): Promise<ProcessImageResponse> => {
			const response = await fetch("/api/upload/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || "Processing failed");
			}

			return response.json();
		},
		onSuccess: (_data, variables) => {
			// Invalidate relevant queries based on upload type
			if (variables.uploadType === "avatar") {
				queryClient.invalidateQueries({ queryKey: queryKeys.profile.current() });
				queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
			} else if (variables.uploadType === "org-logo" && variables.organizationId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.organizations.detail(variables.organizationId),
				});
				queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
			}
			// Branding images don't need query invalidation - handled by form state
		},
		retry: 1,
	});
}
