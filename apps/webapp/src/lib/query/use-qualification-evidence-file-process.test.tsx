/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./keys";
import { useQualificationEvidenceFileProcessMutation } from "./use-qualification-evidence-file-process";

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

describe("useQualificationEvidenceFileProcessMutation", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("processes an uploaded TUS file and invalidates qualification evidence", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		queryClient.setQueryData(queryKeys.qualifications.evidence("employee-skill-1"), []);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					success: true,
					evidence: {
						id: "evidence-1",
						fileName: "forklift-license.pdf",
						mimeType: "application/pdf",
						fileSize: 1234,
						fileKey: "qualification-evidence/file.pdf",
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);

		const { result } = renderHook(() => useQualificationEvidenceFileProcessMutation(), {
			wrapper: createWrapper(queryClient),
		});

		result.current.mutate({
			tusFileKey: "tmp-upload-key",
			employeeSkillId: "employee-skill-1",
			fileName: "forklift-license.pdf",
		});

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());

		expect(fetchMock).toHaveBeenCalledWith("/api/upload/qualification-evidence/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tusFileKey: "tmp-upload-key",
				employeeSkillId: "employee-skill-1",
				fileName: "forklift-license.pdf",
			}),
		});
		expect(
			queryClient.getQueryState(queryKeys.qualifications.evidence("employee-skill-1"))
				?.isInvalidated,
		).toBe(true);
	});
});
