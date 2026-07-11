import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	findManagerLinks: vi.fn(),
	getEffectiveTimezone: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mockState.findEmployee },
			employeeManagers: { findMany: mockState.findManagerLinks },
		},
	},
}));

vi.mock("@/lib/timezone/effective-timezone", () => ({
	getEffectiveTimezone: mockState.getEffectiveTimezone,
}));

const { resolveAuthorizedCalendarEmployeeContext } = await import("./calendar-employee-context");

describe("resolveAuthorizedCalendarEmployeeContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findEmployee
			.mockResolvedValueOnce({
				id: "employee-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
				teamId: null,
			})
			.mockResolvedValueOnce({
				id: "employee-2",
				userId: "user-2",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
				teamId: null,
			});
		mockState.findManagerLinks.mockResolvedValue([{ employeeId: "employee-2" }]);
		mockState.getEffectiveTimezone.mockResolvedValue("America/New_York");
	});

	it("returns primitive selected-employee calendar context using the saved timezone", async () => {
		const context = await resolveAuthorizedCalendarEmployeeContext({
			userId: "user-1",
			isPlatformAdmin: false,
			organizationId: "org-1",
			currentEmployeeId: "employee-1",
			requestedEmployeeId: "employee-2",
			now: Temporal.Instant.from("2026-06-01T00:30:00Z"),
		});

		expect(context).toEqual({
			employeeId: "employee-2",
			timezone: "America/New_York",
			initialDateKey: "2026-05-31",
		});
		expect(JSON.parse(JSON.stringify(context))).toEqual(context);
		expect(mockState.getEffectiveTimezone).toHaveBeenCalledWith("user-2", "org-1");
	});

	it("retains an explicit saved UTC timezone", async () => {
		mockState.getEffectiveTimezone.mockResolvedValueOnce("UTC");

		const context = await resolveAuthorizedCalendarEmployeeContext({
			userId: "user-1",
			isPlatformAdmin: false,
			organizationId: "org-1",
			currentEmployeeId: "employee-1",
			requestedEmployeeId: "employee-2",
			now: Temporal.Instant.from("2026-06-01T00:30:00Z"),
		});

		expect(context).toMatchObject({ timezone: "UTC", initialDateKey: "2026-06-01" });
	});

	it("rejects targets outside the active organization", async () => {
		mockState.findEmployee.mockReset();
		mockState.findEmployee
			.mockResolvedValueOnce({
				id: "employee-1",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
				teamId: null,
			})
			.mockResolvedValueOnce(undefined);

		await expect(
			resolveAuthorizedCalendarEmployeeContext({
				userId: "user-1",
				isPlatformAdmin: false,
				organizationId: "org-1",
				currentEmployeeId: "employee-1",
				requestedEmployeeId: "employee-in-other-org",
			}),
		).resolves.toBeUndefined();
	});

	it("rejects an employee that CASL does not authorize", async () => {
		mockState.findManagerLinks.mockResolvedValue([]);

		await expect(
			resolveAuthorizedCalendarEmployeeContext({
				userId: "user-1",
				isPlatformAdmin: false,
				organizationId: "org-1",
				currentEmployeeId: "employee-1",
				requestedEmployeeId: "employee-2",
			}),
		).resolves.toBeUndefined();
	});
});
