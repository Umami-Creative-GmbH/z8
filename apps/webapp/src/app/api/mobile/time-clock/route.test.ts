import { beforeEach, describe, expect, it, vi } from "vitest";

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

	it("returns 403 when the user has no employee record in the active organization", async () => {
		mockState.requireMobileEmployee.mockRejectedValue(
			new mockState.MobileApiError(403, "Employee record required for the active organization"),
		);

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({ action: "clock_out" }),
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
		mockState.clockOut.mockResolvedValue({ success: true, data: { id: "entry-1" } });

		const response = await POST(
			new Request("https://app.example.com/api/mobile/time-clock", {
				method: "POST",
				body: JSON.stringify({ action: "clock_out" }),
				headers: {
					"content-type": "application/json",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.clockOut).toHaveBeenCalledWith();
		expect(mockState.clockIn).not.toHaveBeenCalled();
	});
});
