"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

interface ProcessQualificationEvidenceFileParams {
	tusFileKey: string;
	employeeSkillId: string;
	fileName?: string;
}

export interface ProcessQualificationEvidenceFileResponse {
	success: true;
	evidence: {
		id: string;
		fileName: string;
		mimeType: string;
		fileSize: number;
	};
}

export class QualificationEvidenceFileProcessError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "QualificationEvidenceFileProcessError";
	}
}

export function useQualificationEvidenceFileProcessMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (
			params: ProcessQualificationEvidenceFileParams,
		): Promise<ProcessQualificationEvidenceFileResponse> => {
			const response = await fetch("/api/upload/qualification-evidence/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new QualificationEvidenceFileProcessError(
					errorData.error || "Failed to process qualification evidence file",
					errorData.code,
				);
			}

			return response.json();
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.qualifications.evidence(variables.employeeSkillId),
			});
		},
		retry: false,
	});
}
