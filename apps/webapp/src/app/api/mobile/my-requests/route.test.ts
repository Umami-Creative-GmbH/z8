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
	getSelfServiceRequests: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/lib/self-service-requests/get-self-service-requests", () => ({
	getSelfServiceRequests: mockState.getSelfServiceRequests,
}));

const { GET } = await import("./route");

describe("GET /api/mobile/my-requests", () => {
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
		mockState.getSelfServiceRequests.mockResolvedValue({
			items: [
				{
					id: "absence:absence-pending-1",
					sourceType: "absence",
					sourceId: "absence-pending-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					status: "pending",
					submittedAt: new Date("2026-04-09T08:30:00.000Z"),
					resolvedAt: null,
					title: "Pending vacation",
					subtitle: "2026-04-20 to 2026-04-21",
					decisionReason: null,
					availableActions: ["cancel", "view"],
					sourceHref: "/absences",
				},
				{
					id: "absence:absence-1",
					sourceType: "absence",
					sourceId: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					status: "approved",
					submittedAt: new Date("2026-04-10T08:30:00.000Z"),
					resolvedAt: new Date("2026-04-11T09:00:00.000Z"),
					title: "Vacation",
					subtitle: "2026-05-01 to 2026-05-02",
					decisionReason: null,
					availableActions: ["view"],
					sourceHref: "/absences",
				},
			],
			counts: {
				pending: 1,
				requiredFixes: 0,
				recentDecisions: 1,
				total: 1,
			},
			sourceErrors: [{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." }],
		});
	});

	it("returns the employee's self-service requests for the active organization", async () => {
		const response = await GET(new Request("https://app.example.com/api/mobile/my-requests"));

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.getSelfServiceRequests).toHaveBeenCalledWith({
			employeeId: "emp-1",
			organizationId: "org-1",
		});
		expect(mockState.getSelfServiceRequests).toHaveBeenCalledOnce();
		expect(await response.json()).toEqual({
			items: [
				{
					id: "absence:absence-pending-1",
					sourceType: "absence",
					sourceId: "absence-pending-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					status: "pending",
					submittedAt: "2026-04-09T08:30:00.000Z",
					resolvedAt: null,
					title: "Pending vacation",
					subtitle: "2026-04-20 to 2026-04-21",
					decisionReason: null,
					availableActions: ["view"],
					sourceHref: "/absences",
				},
				{
					id: "absence:absence-1",
					sourceType: "absence",
					sourceId: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					status: "approved",
					submittedAt: "2026-04-10T08:30:00.000Z",
					resolvedAt: "2026-04-11T09:00:00.000Z",
					title: "Vacation",
					subtitle: "2026-05-01 to 2026-05-02",
					decisionReason: null,
					availableActions: ["view"],
					sourceHref: "/absences",
				},
			],
			counts: {
				pending: 1,
				requiredFixes: 0,
				recentDecisions: 1,
				total: 1,
			},
			sourceErrors: [
				{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." },
			],
		});
	});

	it("returns 400 when no active organization is selected", async () => {
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: {
				user: { id: "user-1" },
				session: { activeOrganizationId: null },
			},
			activeOrganizationId: null,
			memberships: [],
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/my-requests"));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Active organization required" });
		expect(mockState.requireMobileEmployee).not.toHaveBeenCalled();
		expect(mockState.getSelfServiceRequests).not.toHaveBeenCalled();
	});
});
