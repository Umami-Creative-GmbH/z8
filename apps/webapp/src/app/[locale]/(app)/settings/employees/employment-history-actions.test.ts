import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/schema", () => ({
	employee: {},
	employeeEmploymentHistory: {},
	workPolicy: {},
	workPolicyAssignment: {},
}));

vi.mock("@/lib/effect/errors", () => ({
	NotFoundError: class NotFoundError extends Error {},
}));

vi.mock("@/lib/effect/result", () => ({}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
	}),
}));

vi.mock("./employee-action-utils", () => ({
	ensureSettingsActorCanAccessEmployeeTarget: vi.fn(),
	getEmployeeSettingsActorContext: vi.fn(),
	getTargetEmployee: vi.fn(),
	requireOrgAdminEmployeeSettingsAccess: vi.fn(),
	revalidateEmployeesCache: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
	validateInput: vi.fn(),
}));

import {
	buildEmploymentAssignmentSyncPlan,
	shouldUpdateCurrentEmployeeFields,
} from "./employment-history-actions";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("employment history action helpers", () => {
	it("updates current employee fields for current confirmed rows", () => {
		expect(
			shouldUpdateCurrentEmployeeFields(
				{ validFrom: d("2026-01-01"), validUntil: null, reviewState: "confirmed" },
				d("2026-04-01"),
			),
		).toBe(true);
	});

	it("does not update current employee fields for future confirmed rows", () => {
		expect(
			shouldUpdateCurrentEmployeeFields(
				{ validFrom: d("2026-07-01"), validUntil: null, reviewState: "confirmed" },
				d("2026-04-01"),
			),
		).toBe(false);
	});

	it("does not sync assignments for draft rows", () => {
		expect(
			buildEmploymentAssignmentSyncPlan({
				employeeId: "employee-1",
				organizationId: "org-1",
				workPolicyId: "policy-1",
				validFrom: d("2026-01-01"),
				validUntil: null,
				reviewState: "draft",
			}),
		).toBeNull();
	});

	it("builds employee assignment values for confirmed rows with a policy", () => {
		expect(
			buildEmploymentAssignmentSyncPlan({
				employeeId: "employee-1",
				organizationId: "org-1",
				workPolicyId: "policy-1",
				validFrom: d("2026-01-01"),
				validUntil: d("2026-04-01"),
				reviewState: "confirmed",
			}),
		).toMatchObject({
			policyId: "policy-1",
			organizationId: "org-1",
			assignmentType: "employee",
			employeeId: "employee-1",
			priority: 2,
			isActive: true,
		});
	});
});
