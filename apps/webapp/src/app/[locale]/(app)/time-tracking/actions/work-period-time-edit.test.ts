import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
	actorEmployee: "41000000-0000-4000-8000-000000000001",
	otherEmployee: "41000000-0000-4000-8000-000000000002",
	period: "41000000-0000-4000-8000-000000000003",
	clockIn: "41000000-0000-4000-8000-000000000004",
	clockOut: "41000000-0000-4000-8000-000000000005",
	submission: "41000000-0000-4000-8000-000000000006",
};

const state = vi.hoisted(() => ({
	selectLimit: vi.fn(),
	approvalRequestFindFirst: vi.fn(),
	approvalWorkflowFindFirst: vi.fn(),
	employeeFindFirst: vi.fn(),
	memberFindFirst: vi.fn(),
	resolveOnBehalfAuthority: vi.fn(),
	getCurrentEmployee: vi.fn(),
	getUserTimezone: vi.fn(),
	isOrgAdmin: vi.fn(),
	getEditCapability: vi.fn(),
	editSameDay: vi.fn(),
	requestCorrection: vi.fn(),
	applyAdminEdit: vi.fn(),
	validateRange: vi.fn(),
	markDirty: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: state.selectLimit }) }),
		}),
		query: {
			approvalRequest: { findFirst: state.approvalRequestFindFirst },
			approvalWorkflow: { findFirst: state.approvalWorkflowFindFirst },
			employee: { findFirst: state.employeeFindFirst },
			member: { findFirst: state.memberFindFirst },
		},
	},
}));
vi.mock("./auth", () => ({
	getCurrentSession: async () => ({
		user: { id: "user-actor" },
		session: { activeOrganizationId: "org-1" },
	}),
	getCurrentEmployee: state.getCurrentEmployee,
	getUserTimezone: state.getUserTimezone,
	getRequestMetadata: async () => ({
		ipAddress: "127.0.0.1",
		userAgent: "vitest",
	}),
}));
vi.mock("./policy-helpers", () => ({
	getEditCapabilityForPeriod: state.getEditCapability,
}));
vi.mock("./shared", () => ({
	logger: { error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/auth-helpers", () => ({ isOrgAdminCasl: state.isOrgAdmin }));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ allowed: true }),
	isBillingMutationAllowed: () => true,
}));
vi.mock("@/lib/approvals/server/time-correction-submission", () => ({
	editSameDayTimeEntry: state.editSameDay,
	requestTimeCorrectionEffect: state.requestCorrection,
}));
vi.mock("@/lib/approvals/server/time-correction-on-behalf", () => ({
	resolveOnBehalfCorrectionAuthority: state.resolveOnBehalfAuthority,
}));
vi.mock("@/lib/time-tracking/admin-work-period-time-edit", () => ({
	applyAdminWorkPeriodTimeEdit: state.applyAdminEdit,
	replayAdminWorkPeriodTimeEdit: async () => null,
}));
vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntryRange: state.validateRange,
}));
vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: state.markDirty,
}));

const { getWorkPeriodTimeEditContext, updateWorkPeriodTimes } = await import(
	"./work-period-time-edit"
);

const ownPeriod = {
	id: ids.period,
	employeeId: ids.actorEmployee,
	organizationId: "org-1",
	clockInId: ids.clockIn,
	clockOutId: ids.clockOut,
	// 09:00-17:00 in Europe/Berlin (UTC+2)
	startTime: new Date("2026-09-01T07:00:00.000Z"),
	endTime: new Date("2026-09-01T15:00:00.000Z"),
	approvalStatus: "approved",
	workLocationType: "field",
	workCategoryId: null,
	deletedAt: null,
};

function unchangedInput() {
	return {
		workPeriodId: ids.period,
		submissionId: ids.submission,
		clockInDate: "2026-09-01",
		clockInTime: "09:00",
		clockOutDate: "2026-09-01",
		clockOutTime: "17:00",
		reason: "",
	};
}

describe("work period time edit actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.getCurrentEmployee.mockResolvedValue({
			id: ids.actorEmployee,
			organizationId: "org-1",
		});
		state.selectLimit.mockResolvedValue([ownPeriod]);
		state.approvalRequestFindFirst.mockResolvedValue(undefined);
		state.approvalWorkflowFindFirst.mockResolvedValue(undefined);
		state.getUserTimezone.mockResolvedValue("Europe/Berlin");
		state.isOrgAdmin.mockResolvedValue(false);
		state.memberFindFirst.mockResolvedValue({ role: "member" });
		state.resolveOnBehalfAuthority.mockResolvedValue(null);
		state.getEditCapability.mockResolvedValue({
			type: "direct",
			reason: "within_self_service",
		});
		state.validateRange.mockResolvedValue({ isValid: true });
		state.editSameDay.mockResolvedValue({
			success: true,
			data: { workPeriodId: ids.period },
		});
		state.requestCorrection.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		state.applyAdminEdit.mockResolvedValue({
			workPeriodId: ids.period,
			employeeId: ids.otherEmployee,
			dirtyFromDate: "2026-08-03",
			balanceRefresh: "caller",
		});
	});

	it("returns the current values in the entry owner's timezone", async () => {
		const result = await getWorkPeriodTimeEditContext(ids.period);

		expect(result).toEqual({
			success: true,
			data: {
				access: { kind: "self_service" },
				timezone: "Europe/Berlin",
				values: {
					clockInDate: "2026-09-01",
					clockInTime: "09:00",
					clockOutDate: "2026-09-01",
					clockOutTime: "17:00",
				},
			},
		});
	});

	it("routes an admin's change of another employee's entry through that employee's approval chain", async () => {
		state.isOrgAdmin.mockResolvedValue(true);
		state.selectLimit.mockResolvedValue([
			{ ...ownPeriod, employeeId: ids.otherEmployee },
		]);
		state.employeeFindFirst.mockResolvedValue({ userId: "user-other" });
		state.getUserTimezone.mockImplementation(async (userId: string) =>
			userId === "user-other" ? "America/New_York" : "Europe/Berlin",
		);
		state.requestCorrection.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1", status: "approved" },
		});

		const context = await getWorkPeriodTimeEditContext(ids.period);
		expect(context).toMatchObject({
			success: true,
			data: {
				access: { kind: "on_behalf" },
				timezone: "America/New_York",
				values: { clockInDate: "2026-09-01", clockInTime: "03:00" },
			},
		});

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInDate: "2026-08-03",
			clockInTime: "08:00",
			clockOutDate: "2026-08-03",
			clockOutTime: "12:30",
			reason: "  Forgot to clock in  ",
		});

		expect(result).toEqual({ success: true, data: { status: "applied" } });
		expect(state.getEditCapability).not.toHaveBeenCalled();
		expect(state.requestCorrection).toHaveBeenCalledWith({
			workPeriodId: ids.period,
			submissionId: ids.submission,
			newClockInDate: "2026-08-03",
			newClockInTime: "08:00",
			newClockOutDate: "2026-08-03",
			newClockOutTime: "12:30",
			reason: "Forgot to clock in",
			workLocationType: "remote",
			workCategoryId: null,
		});
		expect(state.applyAdminEdit).not.toHaveBeenCalled();
		expect(state.editSameDay).not.toHaveBeenCalled();
	});

	it("lets an eligible manager change a report's entry, pending the configured approver", async () => {
		state.selectLimit.mockResolvedValue([
			{ ...ownPeriod, employeeId: ids.otherEmployee },
		]);
		state.employeeFindFirst.mockResolvedValue({ userId: "user-other" });
		state.resolveOnBehalfAuthority.mockResolvedValue("eligible_manager");

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "08:30",
			reason: "Started early",
		});

		expect(result).toEqual({ success: true, data: { status: "pending" } });
		expect(state.resolveOnBehalfAuthority).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				actorEmployeeId: ids.actorEmployee,
				actorMemberRole: "member",
				ownerEmployeeId: ids.otherEmployee,
			}),
		);
		expect(state.getEditCapability).not.toHaveBeenCalled();
		expect(state.requestCorrection).toHaveBeenCalledWith(
			expect.objectContaining({ newClockInTime: "08:30", reason: "Started early" }),
		);
	});

	it("requires a reason for on-behalf changes", async () => {
		state.selectLimit.mockResolvedValue([
			{ ...ownPeriod, employeeId: ids.otherEmployee },
		]);
		state.employeeFindFirst.mockResolvedValue({ userId: "user-other" });
		state.resolveOnBehalfAuthority.mockResolvedValue("eligible_manager");

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "08:30",
		});

		expect(result).toEqual({ success: false, error: "Reason is required" });
		expect(state.requestCorrection).not.toHaveBeenCalled();
	});

	it("rejects admin edits that end in the future", async () => {
		state.isOrgAdmin.mockResolvedValue(true);

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInDate: "2099-01-01",
			clockOutDate: "2099-01-01",
		});

		expect(result).toMatchObject({
			success: false,
			error: "Clock out time cannot be in the future",
		});
		expect(state.applyAdminEdit).not.toHaveBeenCalled();
	});

	it("applies same-day time changes directly inside the self-service window", async () => {
		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockOutTime: "16:30",
		});

		expect(result).toEqual({ success: true, data: { status: "applied" } });
		expect(state.editSameDay).toHaveBeenCalledWith({
			workPeriodId: ids.period,
			submissionId: ids.submission,
			newClockInDate: "2026-09-01",
			newClockInTime: "09:00",
			newClockOutDate: "2026-09-01",
			newClockOutTime: "16:30",
			reason: undefined,
			workLocationType: "remote",
			workCategoryId: null,
		});
		expect(state.requestCorrection).not.toHaveBeenCalled();
	});

	it("routes an employee's date change through an approval request", async () => {
		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockOutDate: "2026-09-02",
			clockOutTime: "01:00",
			reason: "  Night shift ran long  ",
		});

		expect(result).toEqual({ success: true, data: { status: "pending" } });
		expect(state.requestCorrection).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: ids.period,
				submissionId: ids.submission,
				newClockOutDate: "2026-09-02",
				newClockOutTime: "01:00",
				reason: "Night shift ran long",
			}),
		);
		expect(state.editSameDay).not.toHaveBeenCalled();
	});

	it("requires a reason when the change needs approval", async () => {
		state.getEditCapability.mockResolvedValue({
			type: "approval_required",
			reason: "within_approval_window",
		});

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "08:30",
		});

		expect(result).toEqual({ success: false, error: "Reason is required" });
		expect(state.requestCorrection).not.toHaveBeenCalled();
	});

	it("rejects employee edits beyond the approval window", async () => {
		state.getEditCapability.mockResolvedValue({
			type: "forbidden",
			reason: "beyond_approval_window",
			daysBack: 40,
		});

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "08:30",
			reason: "Late fix",
		});

		expect(result).toMatchObject({
			success: false,
			code: "beyond_approval_window",
		});
		expect(state.editSameDay).not.toHaveBeenCalled();
		expect(state.requestCorrection).not.toHaveBeenCalled();
	});

	it("rejects editing another employee's entry without admin or manager authority", async () => {
		state.selectLimit.mockResolvedValue([
			{ ...ownPeriod, employeeId: ids.otherEmployee },
		]);

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "08:30",
			reason: "Fix",
		});

		expect(result).toMatchObject({ success: false, code: "not_owner" });
		expect(state.applyAdminEdit).not.toHaveBeenCalled();
		expect(state.requestCorrection).not.toHaveBeenCalled();
	});

	it("blocks edits while a correction is already pending", async () => {
		state.isOrgAdmin.mockResolvedValue(true);
		state.approvalWorkflowFindFirst.mockResolvedValue({ id: "workflow-1" });

		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "08:30",
		});

		expect(result).toMatchObject({
			success: false,
			code: "pending_time_correction_approval",
		});
		expect(state.applyAdminEdit).not.toHaveBeenCalled();
	});

	it("rejects malformed input before loading the work period", async () => {
		const result = await updateWorkPeriodTimes({
			...unchangedInput(),
			clockInTime: "9am",
		});

		expect(result).toEqual({ success: false, error: "Invalid date or time" });
		expect(state.selectLimit).not.toHaveBeenCalled();
	});
});
