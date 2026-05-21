/* @vitest-environment jsdom */

import { SWRConfig } from "swr";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJobStatuses } from "./use-job-status";

function wrapper({ children }: { children: React.ReactNode }) {
	return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

describe("useJobStatuses", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps successful statuses when another job status request fails", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);

			if (url.includes("/api/jobs/job-complete/status")) {
				return new Response(JSON.stringify({ state: "completed", progress: 100 }), { status: 200 });
			}

			return new Response("temporary failure", { status: 500 });
		});

		const { result } = renderHook(
			() => useJobStatuses(["job-complete", "job-transient-error"], { refreshInterval: 0 }),
			{ wrapper },
		);

		await waitFor(() => expect(result.current.statuses.get("job-complete")?.state).toBe("completed"));

		expect(result.current.completedCount).toBe(1);
		expect(result.current.failedCount).toBe(0);
		expect(result.current.pendingCount).toBe(1);
		expect(result.current.statuses.has("job-transient-error")).toBe(false);
	});
});
