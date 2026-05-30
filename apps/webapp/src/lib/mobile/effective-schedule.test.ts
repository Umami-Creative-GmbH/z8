import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	employeeFindFirst: vi.fn(),
	assignmentFindFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mockState.employeeFindFirst },
			workPolicyAssignment: { findFirst: mockState.assignmentFindFirst },
		},
	},
}));

const { getMobileEffectiveSchedule } = await import("./effective-schedule");

function assignment(name: string, assignedVia: string) {
	return {
		policy: {
			name,
			isActive: true,
			scheduleEnabled: true,
			schedule: {
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				hoursPerCycle: "40.00",
				homeOfficeDaysPerCycle: 1,
				days: [{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 }],
			},
		},
		team: assignedVia === "Team A" ? { name: "Team A" } : undefined,
	};
}

describe("getMobileEffectiveSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.employeeFindFirst.mockResolvedValue({ id: "emp-1", teamId: "team-1" });
	});

	it("returns an individual assignment before team or organization assignments", async () => {
		mockState.assignmentFindFirst.mockResolvedValueOnce(
			assignment("Individual Policy", "Individual"),
		);

		await expect(getMobileEffectiveSchedule("emp-1", "org-1")).resolves.toEqual({
			policyName: "Individual Policy",
			assignedVia: "Individual",
			scheduleCycle: "weekly",
			scheduleType: "detailed",
			hoursPerCycle: "40.00",
			homeOfficeDaysPerCycle: 1,
			days: [{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 }],
		});
		expect(mockState.assignmentFindFirst).toHaveBeenCalledTimes(1);
	});

	it("falls back from missing individual assignment to team assignment", async () => {
		mockState.assignmentFindFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(assignment("Team Policy", "Team A"));

		const result = await getMobileEffectiveSchedule("emp-1", "org-1");

		expect(result?.policyName).toBe("Team Policy");
		expect(result?.assignedVia).toBe("Team A");
		expect(mockState.assignmentFindFirst).toHaveBeenCalledTimes(2);
	});

	it("returns null when no active schedule assignment exists", async () => {
		mockState.assignmentFindFirst.mockResolvedValue(null);

		await expect(getMobileEffectiveSchedule("emp-1", "org-1")).resolves.toBeNull();
		expect(mockState.assignmentFindFirst).toHaveBeenCalledTimes(3);
	});
});
