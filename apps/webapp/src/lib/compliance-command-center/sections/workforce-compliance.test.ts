import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const violationGroupBy = vi.fn();
	const violationWhere = vi.fn(() => ({ groupBy: violationGroupBy }));
	const violationFrom = vi.fn(() => ({ where: violationWhere }));
	const exceptionWhere = vi.fn();
	const exceptionFrom = vi.fn(() => ({ where: exceptionWhere }));

	return {
		select: vi.fn(),
		violationWhere,
		violationGroupBy,
		exceptionWhere,
		configureSelectChain() {
			this.select
				.mockImplementationOnce(() => ({ from: violationFrom }))
				.mockImplementationOnce(() => ({ from: exceptionFrom }));
		},
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("?")),
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	complianceException: {
		organizationId: "complianceException.organizationId",
		status: "complianceException.status",
	},
	workPolicyViolation: {
		organizationId: "workPolicyViolation.organizationId",
		violationDate: "workPolicyViolation.violationDate",
		violationType: "workPolicyViolation.violationType",
	},
}));

const { deriveWorkforceComplianceSection, getWorkforceComplianceSection } = await import(
	"./workforce-compliance"
);

describe("deriveWorkforceComplianceSection", () => {
	it("marks the section critical when rest-period or max-hours violations exist", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 1,
			maxDailyHourViolations: 0,
			overtimeViolations: 2,
			pendingExceptions: 0,
			latestViolationAt: DateTime.utc().minus({ hours: 2 }).toISO(),
		});

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContain("Rest-period violations: 1");
	});

	it("falls back to warning for overtime-only drift", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 0,
			maxDailyHourViolations: 0,
			overtimeViolations: 3,
			pendingExceptions: 1,
			latestViolationAt: DateTime.utc().minus({ days: 1 }).toISO(),
		});

		expect(result.card.status).toBe("warning");
	});
});

describe("getWorkforceComplianceSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.configureSelectChain();
	});

	it("counts non-overtime policy violations toward the critical max-hours bucket", async () => {
		mockState.violationGroupBy.mockResolvedValue([
			{
				violationType: "max_weekly",
				count: 1,
				latestViolationAt: new Date("2026-04-11T10:00:00.000Z"),
			},
			{
				violationType: "break_required",
				count: 2,
				latestViolationAt: new Date("2026-04-11T11:00:00.000Z"),
			},
		]);
		mockState.exceptionWhere.mockResolvedValue([{ count: 0 }]);

		const result = await getWorkforceComplianceSection("org-1");

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContain("Max-hours violations: 3");
	});
});
