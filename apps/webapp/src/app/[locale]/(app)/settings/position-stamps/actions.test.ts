import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	resolvePositionCapture: vi.fn(),
	listPositionStampAccessLog: vi.fn(),
	agreeToPositionNotice: vi.fn(),
	declinePositionNotice: vi.fn(),
	withdrawPositionConsent: vi.fn(),
	tx: { name: "tx" },
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { transaction: (fn: (tx: unknown) => unknown) => fn(mocks.tx) },
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/time-tracking/position-capture/resolver", () => ({
	resolvePositionCapture: mocks.resolvePositionCapture,
}));
vi.mock("@/lib/time-tracking/position-capture/access-log", () => ({
	listPositionStampAccessLog: mocks.listPositionStampAccessLog,
}));
vi.mock("@/lib/time-tracking/position-capture/store", () => ({
	agreeToPositionNotice: mocks.agreeToPositionNotice,
	declinePositionNotice: mocks.declinePositionNotice,
	withdrawPositionConsent: mocks.withdrawPositionConsent,
}));

const { PositionCaptureRefusal } = await import("@/lib/time-tracking/position-capture/errors");
const {
	agreeToPositionNoticeAction,
	declinePositionNoticeAction,
	getOwnPositionCaptureAction,
	getOwnPositionStampAccessLogAction,
	withdrawPositionConsentAction,
} = await import("./actions");

const NOTICE_ID = "6f1c3e1a-0b7a-4c55-9a52-0d3c2b7e9f10";
const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
/** One level below org member: no settings access at all. */
const pendingMember: StubCaller = { ...orgMember, membershipRole: null };
const formerEmployee: StubCaller = {
	...orgMember,
	employee: { id: "employee-1", role: "employee", former: true },
};
const ownerWithoutEmployee: StubCaller = { ...orgMember, membershipRole: "owner", employee: null };
const subject = { organizationId: "org-1", employeeId: "employee-1" };

const actions = {
	getOwnPositionCaptureAction: () => getOwnPositionCaptureAction(),
	getOwnPositionStampAccessLogAction: () => getOwnPositionStampAccessLogAction(),
	agreeToPositionNoticeAction: () => agreeToPositionNoticeAction({ noticeId: NOTICE_ID }),
	declinePositionNoticeAction: () => declinePositionNoticeAction({ noticeId: NOTICE_ID }),
	withdrawPositionConsentAction: () => withdrawPositionConsentAction(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.resolvePositionCapture.mockResolvedValue({
		captureOn: true,
		retentionDays: 30,
		notice: null,
		consent: { kind: "undecided" },
		canWithdraw: false,
		asksForConsent: false,
	});
	mocks.listPositionStampAccessLog.mockResolvedValue([]);
	mocks.agreeToPositionNotice.mockResolvedValue({
		grantedAt: Temporal.Instant.from("2026-11-12T09:00:00Z"),
	});
	mocks.declinePositionNotice.mockResolvedValue(undefined);
	mocks.withdrawPositionConsent.mockResolvedValue({ withdrawnConsentIds: ["c1", "c2"] });
});

describe("own position stamps", () => {
	it("resolves position capture for the signed-in employee", async () => {
		await expect(getOwnPositionCaptureAction()).resolves.toEqual({
			success: true,
			data: {
				captureOn: true,
				retentionDays: 30,
				notice: null,
				consent: { kind: "undecided" },
				canWithdraw: false,
				asksForConsent: false,
			},
		});
		expect(mocks.resolvePositionCapture).toHaveBeenCalledWith(expect.anything(), subject);
	});

	it("lists who was shown the signed-in employee's positions", async () => {
		await expect(getOwnPositionStampAccessLogAction()).resolves.toEqual({
			success: true,
			data: [],
		});
		expect(mocks.listPositionStampAccessLog).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			subjectEmployeeId: "employee-1",
		});
	});

	it("records consent to the notice the employee saw", async () => {
		await expect(agreeToPositionNoticeAction({ noticeId: NOTICE_ID })).resolves.toEqual({
			success: true,
			data: { grantedAt: "2026-11-12T09:00:00Z" },
		});
		expect(mocks.agreeToPositionNotice).toHaveBeenCalledWith(
			mocks.tx,
			expect.objectContaining({ ...subject, noticeId: NOTICE_ID }),
		);
	});

	it("records 'not now' and a withdrawal", async () => {
		await expect(declinePositionNoticeAction({ noticeId: NOTICE_ID })).resolves.toEqual({
			success: true,
			data: { declined: true },
		});
		await expect(withdrawPositionConsentAction()).resolves.toEqual({
			success: true,
			data: { withdrawn: 2 },
		});
	});

	it("refuses a notice ID that is no UUID with its code", async () => {
		await expect(agreeToPositionNoticeAction({ noticeId: "nope" })).resolves.toMatchObject({
			success: false,
			refusal: "invalid_notice",
		});
		expect(mocks.agreeToPositionNotice).not.toHaveBeenCalled();
	});

	it("passes a store refusal on as its code", async () => {
		mocks.agreeToPositionNotice.mockRejectedValue(
			new PositionCaptureRefusal("notice_changed", "Changed"),
		);

		await expect(agreeToPositionNoticeAction({ noticeId: NOTICE_ID })).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "notice_changed",
		});
	});

	it("needs an employee profile: an owner without one is refused with its code", async () => {
		mocks.caller = ownerWithoutEmployee;

		for (const action of Object.values(actions)) {
			await expect(action()).resolves.toMatchObject({
				success: false,
				refusal: "employee_profile_required",
			});
		}
	});

	it.each([
		["a pending membership", pendingMember],
		["a former employee", formerEmployee],
	])("refuses %s", async (_name, caller) => {
		mocks.caller = caller;

		for (const action of Object.values(actions)) {
			await expect(action()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		}
		expect(mocks.resolvePositionCapture).not.toHaveBeenCalled();
		expect(mocks.withdrawPositionConsent).not.toHaveBeenCalled();
	});
});
