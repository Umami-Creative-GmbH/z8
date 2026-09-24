import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	headers: vi.fn(),
	getSession: vi.fn(),
	getJobExecution: vi.fn(),
	getJobStatus: vi.fn(),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
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
	auth: { api: { getSession: mockState.getSession } },
}));

vi.mock("@/lib/cron/tracking", () => ({
	getJobExecution: mockState.getJobExecution,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

vi.mock("@/lib/queue", () => ({
	getJobStatus: mockState.getJobStatus,
}));

const { GET } = await import("./route");

function callGet(executionId = "execution-1", query = "") {
	return GET(
		new Request(
			`https://app.example.com/api/cron/status/${executionId}${query}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ executionId }) },
	);
}

describe("cron status route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.connection.mockResolvedValue(undefined);
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue(null);
		mockState.getJobStatus.mockResolvedValue(null);
	});

	it("rejects query-string cron secrets", async () => {
		const response = await callGet("execution-1", "?secret=cron-secret");

		expect(response.status).toBe(401);
		expect(mockState.getJobExecution).not.toHaveBeenCalled();
	});

	it("rejects requests without a valid secret or admin session", async () => {
		mockState.headers.mockResolvedValue(new Headers({ authorization: "Bearer wrong-secret" }));

		const response = await callGet();

		expect(response.status).toBe(401);
		expect(mockState.getJobExecution).not.toHaveBeenCalled();
	});

	it("accepts the cron bearer secret", async () => {
		mockState.headers.mockResolvedValue(new Headers({ authorization: "Bearer cron-secret" }));
		mockState.getJobExecution.mockResolvedValue({
			id: "execution-1",
			jobName: "cron:break-enforcement",
			status: "completed",
			bullmqJobId: null,
		});

		const response = await callGet();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			executionId: "execution-1",
			status: "completed",
		});
		expect(mockState.getSession).not.toHaveBeenCalled();
	});

	it("accepts an admin session", async () => {
		mockState.getSession.mockResolvedValue({ user: { role: "admin" } });
		mockState.getJobExecution.mockResolvedValue(null);

		const response = await callGet();

		expect(response.status).toBe(404);
	});

	it("does not leak internal error messages", async () => {
		mockState.headers.mockResolvedValue(new Headers({ authorization: "Bearer cron-secret" }));
		mockState.getJobExecution.mockRejectedValue(
			new Error('relation "cron_job_execution" does not exist at postgres://internal-host'),
		);

		const response = await callGet();
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body).toEqual({ error: "Failed to fetch execution status" });
		expect(JSON.stringify(body)).not.toContain("internal-host");
		expect(mockState.logger.error).toHaveBeenCalledTimes(1);
	});
});
