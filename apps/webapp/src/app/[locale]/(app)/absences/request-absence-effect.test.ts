import { beforeEach, describe, expect, it, vi } from "vitest";

const markEmployeeWorkBalanceDirtyMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const loggerErrorMock = vi.hoisted(() => vi.fn());
const addCalendarSyncJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: markEmployeeWorkBalanceDirtyMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => ({
		error: loggerErrorMock,
	})),
}));

import {
	createSickDetailValidationError,
	enqueueVacationOverrideCalendarSyncJobs,
	markAutoApprovedAbsenceWorkBalanceDirtyBestEffort,
	selectAbsenceDefaultApproverId,
	shouldApplySickVacationOverrideImmediately,
	validateAbsenceSickDetail,
} from "./request-absence-effect-helpers";

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

vi.mock("@/lib/queue", () => ({
	addCalendarSyncJob: addCalendarSyncJobMock,
}));

beforeEach(() => {
	addCalendarSyncJobMock.mockClear();
	markEmployeeWorkBalanceDirtyMock.mockClear();
	markEmployeeWorkBalanceDirtyMock.mockResolvedValue(undefined);
	loggerErrorMock.mockClear();
});

describe("validateAbsenceSickDetail", () => {
	it("requires sick detail for sick requests", () => {
		expect(validateAbsenceSickDetail({ categoryType: "sick", sickDetail: undefined })).toBe(
			"Sick detail is required for sick absences",
		);
	});

	it("rejects sick detail for vacation requests", () => {
		expect(validateAbsenceSickDetail({ categoryType: "vacation", sickDetail: "child_sick" })).toBe(
			"Sick detail can only be used for sick absences",
		);
	});

	it("accepts sick detail for sick requests", () => {
		expect(
			validateAbsenceSickDetail({ categoryType: "sick", sickDetail: "without_certificate" }),
		).toBeNull();
	});
});

describe("createSickDetailValidationError", () => {
	it("does not expose the submitted sick detail as the validation value", () => {
		const error = createSickDetailValidationError("Sick detail can only be used for sick absences");

		expect(error.field).toBe("sickDetail");
		expect(error.value).toBe("[redacted]");
	});
});

describe("enqueueVacationOverrideCalendarSyncJobs", () => {
	it("queues calendar sync for updated, created, and deleted vacation overrides", () => {
		enqueueVacationOverrideCalendarSyncJobs({
			employeeId: "employee-1",
			summary: {
				updatedAbsenceIds: ["updated-1"],
				createdAbsenceIds: ["created-1"],
				deletedAbsenceIds: ["deleted-1"],
			},
		});

		expect(addCalendarSyncJobMock).toHaveBeenCalledTimes(3);
		expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(1, {
			absenceId: "updated-1",
			employeeId: "employee-1",
			action: "update",
		});
		expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(2, {
			absenceId: "created-1",
			employeeId: "employee-1",
			action: "create",
		});
		expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(3, {
			absenceId: "deleted-1",
			employeeId: "employee-1",
			action: "delete",
		});
	});
});

describe("selectAbsenceDefaultApproverId", () => {
	it("uses an eligible team fallback manager when the legacy direct manager field is missing", () => {
		expect(
			selectAbsenceDefaultApproverId({
				legacyManagerId: null,
				eligibleManagerIds: ["team-manager"],
			}),
		).toBe("team-manager");
	});

	it("falls back to the legacy direct manager when eligibility data is unavailable", () => {
		expect(
			selectAbsenceDefaultApproverId({
				legacyManagerId: "legacy-manager",
				eligibleManagerIds: [],
			}),
		).toBe("legacy-manager");
	});
});

describe("shouldApplySickVacationOverrideImmediately", () => {
	it("defers approval-required employee sick overrides until approval", () => {
		expect(
			shouldApplySickVacationOverrideImmediately({
				categoryType: "sick",
				startPeriod: "full_day",
				endPeriod: "full_day",
				requiresApproval: true,
				hasManagerApprovalWorkflow: true,
			}),
		).toBe(false);
	});

	it("applies auto-approved sick overrides immediately", () => {
		expect(
			shouldApplySickVacationOverrideImmediately({
				categoryType: "sick",
				startPeriod: "full_day",
				endPeriod: "full_day",
				requiresApproval: false,
				hasManagerApprovalWorkflow: false,
			}),
		).toBe(true);
	});
});

describe("markAutoApprovedAbsenceWorkBalanceDirtyBestEffort", () => {
	it("marks the employee work balance dirty from the absence start date", async () => {
		await markAutoApprovedAbsenceWorkBalanceDirtyBestEffort({
			employeeId: "employee-1",
			organizationId: "org-1",
			absenceId: "absence-1",
			startDate: "2026-05-11",
		});

		expect(markEmployeeWorkBalanceDirtyMock).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-11",
		});
	});

	it("keeps auto-approval successful when dirty marking fails", async () => {
		const error = new Error("dirty marker failed");
		markEmployeeWorkBalanceDirtyMock.mockRejectedValueOnce(error);

		await expect(
			markAutoApprovedAbsenceWorkBalanceDirtyBestEffort({
				employeeId: "employee-1",
				organizationId: "org-1",
				absenceId: "absence-1",
				startDate: "2026-05-11",
			}),
		).resolves.toBeUndefined();

		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				error,
				employeeId: "employee-1",
				organizationId: "org-1",
				absenceId: "absence-1",
			},
			"Failed to mark work balance dirty after auto-approved absence",
		);
	});
});
