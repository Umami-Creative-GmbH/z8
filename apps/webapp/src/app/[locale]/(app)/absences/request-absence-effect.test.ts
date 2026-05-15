import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSickDetailValidationError,
	enqueueVacationOverrideCalendarSyncJobs,
	shouldApplySickVacationOverrideImmediately,
	validateAbsenceSickDetail,
} from "./request-absence-effect-helpers";

const addCalendarSyncJobMock = vi.hoisted(() => vi.fn());

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
