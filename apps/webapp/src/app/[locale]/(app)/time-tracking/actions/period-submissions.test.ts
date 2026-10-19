import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	getRequestSession: vi.fn(),
	loadEmployeePeriodReadinessView: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { marker: "application-db" } }));
vi.mock("@/lib/auth/request-session", () => ({ getRequestSession: state.getRequestSession }));
vi.mock("@/lib/time-tracking/period-submissions/submission-readiness", () => ({
	loadEmployeePeriodReadinessView: state.loadEmployeePeriodReadinessView,
}));
vi.mock("@/lib/time-tracking/period-submissions/submission-service", () => ({
	submitPeriodSubmission: vi.fn(),
}));
vi.mock("@/lib/time-tracking/period-submissions/submission-withdrawal", () => ({
	withdrawOwnPeriodSubmission: vi.fn(),
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(DatabaseServiceLive);
});

const { readPeriodReadiness } = await import("./period-submissions");

const VIEW = {
	employeeId: "employee-1",
	timezone: "Europe/Berlin",
	periods: [],
};

describe("readPeriodReadiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.getRequestSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		state.loadEmployeePeriodReadinessView.mockResolvedValue(VIEW);
	});

	it("reads the signed-in user's own view in the active organization", async () => {
		await expect(
			readPeriodReadiness({ organizationId: "org-1", employeeId: "employee-1" }),
		).resolves.toEqual({ success: true, data: VIEW });
		expect(state.loadEmployeePeriodReadinessView).toHaveBeenCalledWith(
			{ organizationId: "org-1", userId: "user-1" },
			expect.objectContaining({ database: expect.anything() }),
		);
	});

	it("refuses when the active organization is no longer the page's", async () => {
		const result = await readPeriodReadiness({ organizationId: "org-2", employeeId: "employee-1" });
		expect(result.success).toBe(false);
		expect(state.loadEmployeePeriodReadinessView).not.toHaveBeenCalled();
	});

	it("refuses another employee's view and discloses nothing of it", async () => {
		const result = await readPeriodReadiness({ organizationId: "org-1", employeeId: "employee-2" });
		expect(result).toMatchObject({ success: false });
		expect(JSON.stringify(result)).not.toContain("Europe/Berlin");
	});

	it("refuses without a signed-in session", async () => {
		state.getRequestSession.mockResolvedValue(null);
		const result = await readPeriodReadiness({ organizationId: "org-1", employeeId: "employee-1" });
		expect(result.success).toBe(false);
		expect(state.loadEmployeePeriodReadinessView).not.toHaveBeenCalled();
	});

	it("answers no view when the organization collects no periods from the user", async () => {
		state.loadEmployeePeriodReadinessView.mockResolvedValue(null);
		await expect(
			readPeriodReadiness({ organizationId: "org-1", employeeId: "employee-1" }),
		).resolves.toEqual({ success: true, data: null });
	});
});
