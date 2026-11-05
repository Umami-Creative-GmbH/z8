import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareTimeCorrectionRevision } from "./time-correction-revision";

const mocks = vi.hoisted(() => ({
	session: vi.fn(),
	detail: vi.fn(),
	authority: vi.fn(),
	actor: vi.fn(),
	membership: vi.fn(),
	period: vi.fn(),
	request: vi.fn(),
	workflow: vi.fn(),
	zone: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/auth", () => ({
	getCurrentSession: mocks.session,
	getUserTimezone: mocks.zone,
}));
vi.mock("../inbox/authorized-detail", () => ({
	loadAuthorizedApprovalDetail: mocks.detail,
}));
vi.mock("./time-correction-on-behalf", () => ({
	resolveOnBehalfCorrectionAuthority: mocks.authority,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mocks.actor },
			member: { findFirst: mocks.membership },
			workPeriod: { findFirst: mocks.period },
			approvalRequest: { findFirst: mocks.request },
			approvalWorkflow: { findFirst: mocks.workflow },
		},
	},
}));
const metadata = {
	timeCorrection: {
		action: "edit",
		clockInCorrectionId: "11111111-1111-4111-8111-111111111111",
		workLocationType: "office",
		workCategoryId: null,
		vehicleUse: null,
	},
	timeCorrectionOriginalWorkMetadata: {
		workLocationType: "office",
		workCategoryId: null,
		vehicleUse: null,
	},
};
const detail = {
	status: "found",
	detail: {
		actions: { canReject: true },
		item: { type: "time_entry", entityId: "period-1" },
		sections: [
			{
				type: "time_comparison",
				action: "edit",
				requested: {
					start: { at: "2026-11-02T13:17:00Z", utcOffsetMinutes: 60 },
					end: { at: "2026-11-02T15:10:00Z", utcOffsetMinutes: 60 },
				},
			},
		],
	},
};
const period = {
	id: "period-1",
	employeeId: "owner",
	organizationId: "org-1",
	startTime: new Date("2026-11-02T13:47:00Z"),
	endTime: new Date("2026-11-02T15:10:00Z"),
	isActive: false,
	deletedAt: null,
	employee: { organizationId: "org-1", userId: "owner-user", isActive: true },
	approvalWorkflowId: "workflow-1",
	workLocationType: "office",
	workCategoryId: null,
};
describe("preparing a time correction revision", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.session.mockResolvedValue({
			user: { id: "actor-user" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.detail.mockResolvedValue(detail);
		mocks.actor.mockResolvedValue({ id: "actor" });
		mocks.membership.mockResolvedValue({ role: "admin" });
		mocks.period.mockResolvedValue(period);
		mocks.request.mockResolvedValue({
			id: "22222222-2222-4222-8222-222222222222",
			status: "pending",
			entityId: "period-1",
			requestedBy: "owner",
			metadata,
			reason: "Forgot",
		});
		mocks.authority.mockResolvedValue("organization_admin");
		mocks.zone.mockResolvedValue("Europe/Berlin");
	});
	it("preserves requested metadata and uses the employee timezone", async () => {
		const result = await prepareTimeCorrectionRevision(
			"22222222-2222-4222-8222-222222222222",
		);
		expect(result).toMatchObject({
			success: true,
			data: {
				timezone: "Europe/Berlin",
				request: {
					newClockInTime: "14:17",
					newClockOutTime: "16:10",
					workLocationType: "office",
					vehicleUse: null,
				},
				originalStart: { time: "14:47" },
			},
		});
		expect(mocks.zone).toHaveBeenCalledWith("owner-user");
		expect(mocks.authority).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				ownerEmployeeId: "owner",
				actorEmployeeId: "actor",
			}),
		);
	});
	it("refuses unauthorized detail access before reading source work", async () => {
		mocks.detail.mockResolvedValue({ status: "not_found" });
		expect(
			await prepareTimeCorrectionRevision(
				"22222222-2222-4222-8222-222222222222",
			),
		).toMatchObject({
			success: false,
		});
		expect(mocks.period).not.toHaveBeenCalled();
	});
	it("requires on-behalf edit authority as well as approval rights", async () => {
		mocks.authority.mockResolvedValue(null);
		expect(
			await prepareTimeCorrectionRevision(
				"22222222-2222-4222-8222-222222222222",
			),
		).toMatchObject({
			success: false,
		});
		expect(mocks.request).not.toHaveBeenCalled();
	});
	it("refuses stale and cross-organization work", async () => {
		mocks.period.mockResolvedValue({
			...period,
			employee: { ...period.employee, organizationId: "other-org" },
		});
		expect(
			await prepareTimeCorrectionRevision(
				"22222222-2222-4222-8222-222222222222",
			),
		).toMatchObject({
			success: false,
		});
	});
	it("prepares a canonical correction from its pending workflow evidence", async () => {
		mocks.request.mockResolvedValue(null);
		mocks.workflow.mockResolvedValue({ contextSnapshot: metadata });
		expect(
			await prepareTimeCorrectionRevision(
				"33333333-3333-4333-8333-333333333333",
			),
		).toMatchObject({
			success: true,
			data: { request: { newClockInTime: "14:17", vehicleUse: null } },
		});
	});
	it("does not prepare a completed or changed request for replacement", async () => {
		mocks.request.mockResolvedValue({
			status: "approved",
			entityId: "period-1",
			requestedBy: "owner",
		});
		expect(
			await prepareTimeCorrectionRevision(
				"22222222-2222-4222-8222-222222222222",
			),
		).toMatchObject({
			success: false,
		});
	});
});
