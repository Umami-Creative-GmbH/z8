import { beforeEach, describe, expect, it, vi } from "vitest";

function utcActionEvidence() {
	return {
		timestamp: new Date().toISOString(),
		browserTimezone: "UTC",
		utcOffsetMinutes: 0,
	};
}

const mockState = vi.hoisted(() => ({
	MobileApiError: class MobileApiError extends Error {
		constructor(
			readonly status: number,
			message: string,
		) {
			super(message);
		}
	},
	requireMobileSessionContext: vi.fn(),
	requireMobileEmployee: vi.fn(),
	clockIn: vi.fn(),
	clockOut: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/clocking", () => ({
	clockIn: mockState.clockIn,
	clockOut: mockState.clockOut,
}));

const { POST } = await import("./route");

describe("POST /api/mobile/time-clock", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			activeOrganizationId: "org-1",
			memberships: [{ organizationId: "org-1" }],
		});
		mockState.requireMobileEmployee.mockResolvedValue({
			id: "emp-1",
			organizationId: "org-1",
		});
	});

	it("requires workLocationType when clocking in", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({ action: "clock_in" }),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "workLocationType is required for clock_in",
		});
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("accepts remote work location when clocking in", async () => {
		mockState.clockIn.mockResolvedValue({
			success: true,
			data: { id: "entry-1" },
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_in",
					workLocationType: "remote",
					...utcActionEvidence(),
				}),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith(
			"user-1",
			"org-1",
		);
		expect(mockState.clockIn).toHaveBeenCalledWith(
			"remote",
			expect.objectContaining({ browserTimezone: "UTC", deviceInfo: "mobile" }),
		);
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});

	it("passes explicit browser timezone to clock-in context", async () => {
		mockState.clockIn.mockResolvedValue({
			success: true,
			data: { id: "entry-1" },
		});
		const timestamp = new Date().toISOString();
		const utcOffsetMinutes = 120;

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_in",
					workLocationType: "remote",
					timestamp,
					browserTimezone: "Europe/Berlin",
					utcOffsetMinutes,
				}),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.clockIn).toHaveBeenCalledWith(
			"remote",
			expect.objectContaining({
				browserTimezone: "Europe/Berlin",
				deviceInfo: "mobile",
			}),
		);
	});

	it("passes the validated mobile instant to the clocking implementation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-10T12:30:00.000Z"));
		mockState.clockIn.mockResolvedValue({
			success: true,
			data: { id: "entry-1" },
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_in",
					workLocationType: "remote",
					timestamp: "2026-07-10T12:30:00.000Z",
					browserTimezone: "UTC",
					utcOffsetMinutes: 0,
				}),
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(200);
		const context = mockState.clockIn.mock.calls[0]?.[1];
		expect(context).toEqual(
			expect.objectContaining({ browserTimezone: "UTC", deviceInfo: "mobile" }),
		);
		expect(context.instant.toString()).toBe("2026-07-10T12:30:00Z");
		vi.useRealTimers();
	});

	it("rejects action evidence with an invalid timezone before clocking", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_out",
					timestamp: new Date().toISOString(),
					browserTimezone: "Not/AZone",
					utcOffsetMinutes: 0,
				}),
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});

	it("rejects an offset that does not match the supplied timezone at the action instant", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_out",
					timestamp: new Date().toISOString(),
					browserTimezone: "Asia/Kathmandu",
					utcOffsetMinutes: 0,
				}),
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});

	it("rejects action evidence more than five minutes in the future", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-10T12:30:00.000Z"));
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_out",
					timestamp: "2026-07-10T12:35:00.001Z",
					browserTimezone: "UTC",
					utcOffsetMinutes: 0,
				}),
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockOut).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("rejects action evidence more than five minutes in the past", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-10T12:30:00.000Z"));
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_out",
					timestamp: "2026-07-10T12:24:59.999Z",
					browserTimezone: "UTC",
					utcOffsetMinutes: 0,
				}),
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockOut).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("rejects a generic timezone field that is not action evidence", async () => {
		mockState.clockIn.mockResolvedValue({
			success: true,
			data: { id: "entry-1" },
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_in",
					workLocationType: "remote",
					...utcActionEvidence(),
					timezone: "Europe/Berlin",
				}),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("rejects obsolete field work location when clocking in", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({ action: "clock_in", workLocationType: "field" }),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("rejects client-supplied employee and organization identifiers", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({
					action: "clock_in",
					employeeId: "employee-foreign",
					organizationId: "org-foreign",
					workLocationType: "remote",
				}),
				headers: { "content-type": "application/json" },
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});

	it("returns 403 when the user has no employee record in the active organization", async () => {
		mockState.requireMobileEmployee.mockRejectedValue(
			new mockState.MobileApiError(
				403,
				"Employee record required for the active organization",
			),
		);

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({ action: "clock_out", ...utcActionEvidence() }),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "Employee record required for the active organization",
		});
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});

	it("returns 400 for malformed json bodies", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: "{",
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid JSON body" });
		expect(mockState.clockIn).not.toHaveBeenCalled();
		expect(mockState.clockOut).not.toHaveBeenCalled();
	});

	it("calls clockOut for clock_out actions after verifying the active-org employee", async () => {
		mockState.clockOut.mockResolvedValue({
			success: true,
			data: { id: "entry-1" },
		});

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({ action: "clock_out", ...utcActionEvidence() }),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith(
			"user-1",
			"org-1",
		);
		expect(mockState.clockOut).toHaveBeenCalledWith(
			undefined,
			undefined,
			expect.objectContaining({ browserTimezone: "UTC", deviceInfo: "mobile" }),
		);
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});
});
