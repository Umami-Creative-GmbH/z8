import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	headers: vi.fn(),
	addCronJob: vi.fn(),
	createJobExecution: vi.fn(),
	updateJobExecution: vi.fn(),
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

vi.mock("@/lib/cron/registry", () => ({
	CRON_JOBS: {
		"cron:break-enforcement": { defaultJobOptions: { attempts: 1 } },
	},
	isCronJobName: (jobName: string) => jobName === "cron:break-enforcement",
}));

vi.mock("@/lib/cron/tracking", () => ({
	createJobExecution: mockState.createJobExecution,
	getJobExecution: vi.fn(),
	updateJobExecution: mockState.updateJobExecution,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

vi.mock("@/lib/queue", () => ({
	addCronJob: mockState.addCronJob,
}));

const { GET, POST } = await import("./route");

function createRequest(url: string, init?: RequestInit): NextRequest {
	return new Request(url, init) as unknown as NextRequest;
}

describe("cron job route auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.connection.mockResolvedValue(undefined);
		mockState.headers.mockResolvedValue(new Headers());
		mockState.createJobExecution.mockResolvedValue("execution-1");
		mockState.addCronJob.mockResolvedValue({ id: "job-1" });
	});

	it("rejects query-string cron secrets", async () => {
		const response = await GET(
			createRequest("https://app.example.com/api/cron/break-enforcement?secret=cron-secret"),
			{ params: Promise.resolve({ jobName: "break-enforcement" }) },
		);

		expect(response.status).toBe(401);
		expect(mockState.addCronJob).not.toHaveBeenCalled();
	});

	it("does not log raw manual cron parameters", async () => {
		mockState.headers.mockResolvedValue(new Headers({ authorization: "Bearer cron-secret" }));

		const response = await POST(
			createRequest("https://app.example.com/api/cron/break-enforcement", {
				method: "POST",
				body: JSON.stringify({
					manualParams: { organizationId: "org-1", date: "2026-05-17" },
					triggeredBy: "admin@example.com",
				}),
			}),
			{ params: Promise.resolve({ jobName: "break-enforcement" }) },
		);

		expect(response.status).toBe(200);
		expect(mockState.logger.info).toHaveBeenCalledWith(
			{
				jobName: "cron:break-enforcement",
				manualParamKeys: ["organizationId", "date"],
				triggeredBy: "admin@example.com",
			},
			"Enqueueing manual cron job via API",
		);
	});
});
