import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./queries";

const fixtures = vi.hoisted(() => ({
	employee: vi.fn(),
	active: vi.fn(),
	history: vi.fn(),
	summary: vi.fn(),
}));
vi.mock("./auth", () => ({
	getCurrentEmployee: fixtures.employee,
	getCurrentSession: vi.fn(),
	getUserTimezone: vi.fn(),
}));
vi.mock("../read-queries", () => ({
	readActiveWorkPeriod: fixtures.active,
	readWorkPeriods: fixtures.history,
	readTimeSummary: fixtures.summary,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./entry-helpers", () => ({ getAssignedProjectsWithHours: vi.fn() }));
vi.mock("./shared", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/effect-v3/services/change-policy.service", () => ({
	ChangePolicyService: {},
	ChangePolicyServiceLive: {},
}));
vi.mock("@/lib/effect-v3/services/database.service", () => ({
	DatabaseServiceLive: {},
}));

const start = new Date("2026-03-01T00:00:00Z");
const end = new Date("2026-03-31T23:59:59Z");
const employee = { id: "employee-1", organizationId: "org-1" };

describe("fresh guarded time tracking reads", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fixtures.employee.mockResolvedValue(employee);
		fixtures.active.mockResolvedValue(null);
		fixtures.history.mockResolvedValue([]);
		fixtures.summary.mockResolvedValue({
			todayMinutes: 0,
			weekMinutes: 0,
			monthMinutes: 0,
		});
	});
	it("delegates with the freshly authorized organization and retains defaults", async () => {
		await getActiveWorkPeriod(employee.id);
		await getWorkPeriods(employee.id, start, end);
		await getTimeSummary(employee.id);
		const scope = {
			employeeId: employee.id,
			organizationId: employee.organizationId,
		};
		expect(fixtures.active).toHaveBeenCalledWith(scope);
		expect(fixtures.history).toHaveBeenCalledWith(scope, start, end);
		expect(fixtures.summary).toHaveBeenCalledWith(scope, "UTC", "sunday");
		expect(fixtures.employee).toHaveBeenCalledTimes(3);
	});
	it("denies a requested employee different from the authorized employee", async () => {
		expect(await getActiveWorkPeriod("other-employee")).toBeNull();
		expect(await getWorkPeriods("other-employee", start, end)).toEqual([]);
		expect(await getTimeSummary("other-employee")).toEqual({
			todayMinutes: 0,
			weekMinutes: 0,
			monthMinutes: 0,
		});
		expect(fixtures.active).not.toHaveBeenCalled();
		expect(fixtures.history).not.toHaveBeenCalled();
		expect(fixtures.summary).not.toHaveBeenCalled();
	});
	it("denies each read after membership is revoked instead of reusing prior authorization", async () => {
		await getActiveWorkPeriod(employee.id);
		await getWorkPeriods(employee.id, start, end);
		await getTimeSummary(employee.id, "Europe/Berlin", "monday");
		fixtures.employee.mockResolvedValue(null);
		expect(await getActiveWorkPeriod(employee.id)).toBeNull();
		expect(await getWorkPeriods(employee.id, start, end)).toEqual([]);
		expect(await getTimeSummary(employee.id)).toEqual({
			todayMinutes: 0,
			weekMinutes: 0,
			monthMinutes: 0,
		});
		expect(fixtures.employee).toHaveBeenCalledTimes(6);
		expect(fixtures.active).toHaveBeenCalledTimes(1);
		expect(fixtures.history).toHaveBeenCalledTimes(1);
		expect(fixtures.summary).toHaveBeenCalledTimes(1);
	});
	it("does not reuse employee authorization after switching organizations", async () => {
		await getWorkPeriods(employee.id, start, end);
		fixtures.employee.mockResolvedValue({
			id: "employee-2",
			organizationId: "org-2",
		});
		expect(await getWorkPeriods(employee.id, start, end)).toEqual([]);
		await getWorkPeriods("employee-2", start, end);
		expect(fixtures.history).toHaveBeenLastCalledWith(
			{ employeeId: "employee-2", organizationId: "org-2" },
			start,
			end,
		);
	});
	it("retains the presence action deleted-period filter", () => {
		const actionsSource = readFileSync(
			fileURLToPath(new URL("../actions.ts", import.meta.url)),
			"utf8",
		);
		expect(
			actionsSource.slice(
				actionsSource.indexOf("export async function getPresenceStatus"),
			),
		).toContain("isNull(workPeriod.deletedAt)");
	});
});
