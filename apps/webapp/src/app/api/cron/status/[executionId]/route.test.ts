import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	headers: vi.fn(),
	getSession: vi.fn(),
	getJobExecution: vi.fn(),
	getJobStatus: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("@/env", () => ({
	env: { CRON_SECRET: "cron-secret" },
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/cron/tracking", () => ({
	getJobExecution: mockState.getJobExecution,
}));

vi.mock("@/lib/queue", () => ({
	getJobStatus: mockState.getJobStatus,
}));

const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return new Request(url) as unknown as NextRequest;
}

describe("cron status route auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.connection.mockResolvedValue(undefined);
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue(null);
	});

	it("rejects query-string cron secrets", async () => {
		const response = await GET(
			createRequest("https://app.example.com/api/cron/status/execution-1?secret=cron-secret"),
			{ params: Promise.resolve({ executionId: "execution-1" }) },
		);

		expect(response.status).toBe(401);
		expect(mockState.getJobExecution).not.toHaveBeenCalled();
	});
});
