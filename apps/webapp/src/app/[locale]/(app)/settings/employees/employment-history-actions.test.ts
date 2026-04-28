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
	buildEmploymentAssignmentWindowUpdates,
	buildEmploymentCancellationRestorationPlan,
	canCancelEmploymentHistoryRow,
	shouldConfirmEmploymentHistoryRow,
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

	it("builds assignment window updates for shortened previous rows", () => {
		expect(
			buildEmploymentAssignmentWindowUpdates({
				updates: [{ id: "history-1", validUntil: d("2026-04-01") }],
				existing: [
					{
						id: "history-1",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: "policy-1",
						validFrom: d("2026-01-01"),
						validUntil: null,
					},
				],
			}),
		).toEqual([
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				workPolicyId: "policy-1",
				effectiveFrom: d("2026-01-01"),
				effectiveUntil: d("2026-04-01"),
			},
		]);
	});

	it("does not build assignment window updates for rows without a policy", () => {
		expect(
			buildEmploymentAssignmentWindowUpdates({
				updates: [{ id: "history-1", validUntil: d("2026-04-01") }],
				existing: [
					{
						id: "history-1",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: null,
						validFrom: d("2026-01-01"),
						validUntil: null,
					},
				],
			}),
		).toEqual([]);
	});

	it("allows confirming draft and pending rows", () => {
		expect(shouldConfirmEmploymentHistoryRow({ reviewState: "draft" })).toBe(true);
		expect(shouldConfirmEmploymentHistoryRow({ reviewState: "pending" })).toBe(true);
		expect(shouldConfirmEmploymentHistoryRow({ reviewState: "confirmed" })).toBe(false);
	});

	it("allows canceling rows that have not taken effect", () => {
		const now = d("2026-04-01");
		expect(
			canCancelEmploymentHistoryRow({ reviewState: "draft", validFrom: d("2026-01-01") }, now),
		).toBe(true);
		expect(
			canCancelEmploymentHistoryRow({ reviewState: "pending", validFrom: d("2026-01-01") }, now),
		).toBe(true);
		expect(
			canCancelEmploymentHistoryRow({ reviewState: "confirmed", validFrom: d("2026-05-01") }, now),
		).toBe(true);
		expect(
			canCancelEmploymentHistoryRow({ reviewState: "confirmed", validFrom: d("2026-03-01") }, now),
		).toBe(false);
	});

	it("builds cancellation restoration updates when removing a future confirmed row", () => {
		expect(
			buildEmploymentCancellationRestorationPlan({
				canceled: {
					id: "history-2",
					employeeId: "employee-1",
					organizationId: "org-1",
					workPolicyId: "policy-2",
					validFrom: d("2026-04-01"),
					validUntil: d("2026-08-01"),
					reviewState: "confirmed",
				},
				existing: [
					{
						id: "history-1",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: "policy-1",
						validFrom: d("2026-01-01"),
						validUntil: d("2026-04-01"),
						reviewState: "confirmed",
					},
					{
						id: "history-2",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: "policy-2",
						validFrom: d("2026-04-01"),
						validUntil: d("2026-08-01"),
						reviewState: "confirmed",
					},
					{
						id: "history-3",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: "policy-3",
						validFrom: d("2026-08-01"),
						validUntil: null,
						reviewState: "confirmed",
					},
				],
			}),
		).toEqual({
			historyUpdate: { id: "history-1", validUntil: d("2026-08-01") },
			assignmentWindowUpdate: {
				employeeId: "employee-1",
				organizationId: "org-1",
				workPolicyId: "policy-1",
				effectiveFrom: d("2026-01-01"),
				effectiveUntil: d("2026-08-01"),
			},
		});
	});

	it("does not build cancellation assignment restoration when previous row has no policy", () => {
		expect(
			buildEmploymentCancellationRestorationPlan({
				canceled: {
					id: "history-2",
					employeeId: "employee-1",
					organizationId: "org-1",
					workPolicyId: "policy-2",
					validFrom: d("2026-04-01"),
					validUntil: null,
					reviewState: "confirmed",
				},
				existing: [
					{
						id: "history-1",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: null,
						validFrom: d("2026-01-01"),
						validUntil: d("2026-04-01"),
						reviewState: "confirmed",
					},
					{
						id: "history-2",
						employeeId: "employee-1",
						organizationId: "org-1",
						workPolicyId: "policy-2",
						validFrom: d("2026-04-01"),
						validUntil: null,
						reviewState: "confirmed",
					},
				],
			}),
		).toEqual({
			historyUpdate: { id: "history-1", validUntil: null },
			assignmentWindowUpdate: null,
		});
	});
});
