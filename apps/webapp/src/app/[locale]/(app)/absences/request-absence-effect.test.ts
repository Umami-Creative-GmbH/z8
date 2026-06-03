import { Effect } from "effect";
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

import { createRequestedAbsenceRecordsInTransaction } from "./request-absence-effect";
import {
	createSickDetailValidationError,
	enqueueVacationOverrideCalendarSyncJobs,
	getMissingAbsenceApproverMessage,
	markAutoApprovedAbsenceWorkBalanceDirtyBestEffort,
	shouldApplySickVacationOverrideImmediately,
	validateAbsenceSickDetail,
} from "./request-absence-effect-helpers";

function createInsertBuilder(result?: unknown[]) {
	return {
		values: vi.fn(() => ({
			returning: vi.fn().mockResolvedValue(result ?? []),
		})),
	};
}

function createVoidInsertBuilder() {
	return {
		values: vi.fn().mockResolvedValue(undefined),
	};
}

function createUpdateBuilder() {
	return {
		set: vi.fn(() => ({
			where: vi.fn().mockResolvedValue(undefined),
		})),
	};
}

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

describe("getMissingAbsenceApproverMessage", () => {
	it("returns the missing-manager message for approval-required requests without an approver", () => {
		expect(
			getMissingAbsenceApproverMessage({
				requiresApproval: true,
				approverId: null,
			}),
		).toBe("No manager assigned to approve absence requests");
	});

	it("returns null for approval-required requests with an approver", () => {
		expect(
			getMissingAbsenceApproverMessage({
				requiresApproval: true,
				approverId: "manager-1",
			}),
		).toBeNull();
	});

	it("returns null for requests that do not require approval without an approver", () => {
		expect(
			getMissingAbsenceApproverMessage({
				requiresApproval: false,
				approverId: null,
			}),
		).toBeNull();
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

describe("createRequestedAbsenceRecordsInTransaction", () => {
	it("creates approval-required absences and approval workflow in the same transaction", async () => {
		const transaction = vi.fn(async (callback) => callback(tx));
		const insert = vi
			.fn()
			.mockReturnValueOnce(createInsertBuilder([{ id: "absence-1" }]))
			.mockReturnValueOnce(createInsertBuilder([{ id: "canonical-1" }]))
			.mockReturnValueOnce(createVoidInsertBuilder());
		const tx = {
			insert,
			update: vi.fn(() => createUpdateBuilder()),
		};
		const dbService = {
			db: { transaction },
			query: vi.fn((_name, run) => Effect.tryPromise({ try: run, catch: (error) => error })),
		};
		const createApprovalWorkflow = vi.fn(() => Effect.fail(new Error("approval failed")));

		await expect(
			Effect.runPromise(
				createRequestedAbsenceRecordsInTransaction({
					dbService: dbService as never,
					currentEmployee: { id: "employee-1", organizationId: "org-1", teamId: "team-1" },
					data: {
						categoryId: "category-1",
						startDate: "2026-05-11",
						startPeriod: "full_day",
						endDate: "2026-05-12",
						endPeriod: "full_day",
						notes: "Vacation",
						durationKind: "full_day",
						sickDetail: null,
					},
					category: { countsAgainstVacation: true, requiresApproval: true, type: "vacation" },
					createdBy: "user-1",
					hasManagerApprovalWorkflow: true,
					approvalWorkflow: {
						categoryId: "category-1",
						approverId: "manager-1",
						create: createApprovalWorkflow,
					},
				}),
			),
		).rejects.toThrow("approval failed");

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(createApprovalWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({ db: tx }),
			expect.objectContaining({ id: "employee-1", organizationId: "org-1", teamId: "team-1" }),
			"absence-1",
			"category-1",
			"manager-1",
		);
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
