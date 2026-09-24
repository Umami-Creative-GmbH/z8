import { beforeEach, describe, expect, it, vi } from "vitest";

const submissionId = "10000000-0000-4000-8000-000000000099";

const mockState = vi.hoisted(() => ({
	clockIn: vi.fn(),
	clockOut: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/clocking", () => ({
	clockIn: mockState.clockIn,
	clockOut: mockState.clockOut,
}));

const { POST } = await import("./route");

function timeClockRequest(body: unknown, headers: Record<string, string> = {}) {
	return new Request("https://app.example.com/api/time-clock", {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"content-type": "application/json",
			"sec-fetch-site": "same-origin",
			...headers,
		},
	});
}

describe("POST /api/time-clock", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("clocks out through the clocking service with the submission id", async () => {
		mockState.clockOut.mockResolvedValue({
			success: true,
			data: { id: "entry-2", pendingApproval: false },
		});

		const response = await POST(
			timeClockRequest({
				action: "clock_out",
				submissionId,
				projectId: "project-1",
				workCategoryId: "category-1",
				browserTimezone: "Europe/Berlin",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: { id: "entry-2", pendingApproval: false },
		});
		expect(mockState.clockOut).toHaveBeenCalledWith("project-1", "category-1", {
			browserTimezone: "Europe/Berlin",
			submissionId,
		});
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("clocks in with the selected work location", async () => {
		mockState.clockIn.mockResolvedValue({ success: true, data: { id: "entry-1" } });

		const response = await POST(
			timeClockRequest({
				action: "clock_in",
				workLocationType: "remote",
				browserTimezone: "Europe/Berlin",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, data: { id: "entry-1" } });
		expect(mockState.clockIn).toHaveBeenCalledWith("remote", {
			browserTimezone: "Europe/Berlin",
		});
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});

	it("returns clocking failures as an action result with a client error status", async () => {
		mockState.clockIn.mockResolvedValue({
			success: false,
			error: "Cannot clock in on a holiday",
			holidayName: "Christmas",
		});

		const response = await POST(timeClockRequest({ action: "clock_in" }));

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			success: false,
			error: "Cannot clock in on a holiday",
			holidayName: "Christmas",
		});
	});

	it("returns unexpected clocking exceptions as a failed action result", async () => {
		mockState.clockOut.mockRejectedValue(new Error("database unavailable"));

		const response = await POST(timeClockRequest({ action: "clock_out", submissionId }));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			success: false,
			error: "Time clock action failed",
		});
	});

	it("rejects cross-site requests before clocking", async () => {
		const response = await POST(
			timeClockRequest({ action: "clock_in" }, { "sec-fetch-site": "cross-site" }),
		);

		expect(response.status).toBe(403);
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("rejects non-JSON requests before clocking", async () => {
		const response = await POST(
			timeClockRequest({ action: "clock_in" }, { "content-type": "text/plain" }),
		);

		expect(response.status).toBe(415);
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("rejects malformed bodies", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/time-clock", {
				method: "POST",
				body: "{not json",
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ success: false, error: "Invalid request body" });
	});

	it("requires a submission id for clock-out retries to stay idempotent", async () => {
		const response = await POST(timeClockRequest({ action: "clock_out" }));

		expect(response.status).toBe(400);
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});
});
