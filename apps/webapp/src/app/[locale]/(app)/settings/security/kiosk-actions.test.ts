import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	readOwnKioskPinStatus: vi.fn(),
	setOwnKioskPin: vi.fn(),
	readOwnKioskFobStatus: vi.fn(),
	removeOwnKioskFob: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller));
});

vi.mock("@/lib/time-tracking/kiosk/pin-store", () => ({
	readOwnKioskPinStatus: mocks.readOwnKioskPinStatus,
	setOwnKioskPin: mocks.setOwnKioskPin,
}));

vi.mock("@/lib/time-tracking/kiosk/fob-management", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/time-tracking/kiosk/fob-management")>()),
	readOwnKioskFobStatus: mocks.readOwnKioskFobStatus,
	removeOwnKioskFob: mocks.removeOwnKioskFob,
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.loadOrganizationTimezone,
}));

const { KioskPinRefusal } = await import("@/lib/time-tracking/kiosk/pin-errors");
const { KioskFobManagementRefusal } = await import("@/lib/time-tracking/kiosk/fob-errors");
const { getOwnKioskPinStatusAction, setOwnKioskPinAction } = await import("./kiosk-pin-actions");
const { getOwnKioskFobStatusAction, removeOwnKioskFobAction } = await import("./kiosk-fob-actions");

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
const own = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.readOwnKioskPinStatus.mockResolvedValue({ hasEmployee: true, hasPin: false });
	mocks.setOwnKioskPin.mockResolvedValue(undefined);
	mocks.readOwnKioskFobStatus.mockResolvedValue({ active: null, fobReaderInUse: true });
	mocks.removeOwnKioskFob.mockResolvedValue(undefined);
	mocks.loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
});

describe("own kiosk PIN", () => {
	it("reads the signed-in user's PIN status in the active organization", async () => {
		await expect(getOwnKioskPinStatusAction()).resolves.toEqual({
			success: true,
			data: { hasEmployee: true, hasPin: false },
		});
		expect(mocks.readOwnKioskPinStatus).toHaveBeenCalledWith(expect.anything(), own);
	});

	it("sets the signed-in user's PIN", async () => {
		await expect(setOwnKioskPinAction("1234")).resolves.toEqual({
			success: true,
			data: { saved: true },
		});
		expect(mocks.setOwnKioskPin).toHaveBeenCalledWith(expect.anything(), { ...own, pin: "1234" });
	});

	it("passes the store's refusal on as its code", async () => {
		mocks.setOwnKioskPin.mockRejectedValue(new KioskPinRefusal("invalid_pin", "Bad PIN"));

		await expect(setOwnKioskPinAction("12")).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "invalid_pin",
		});
	});

	it.each([
		["a pending membership", pendingMember],
		["a former employee", formerEmployee],
	])("refuses %s", async (_name, caller) => {
		mocks.caller = caller;

		await expect(getOwnKioskPinStatusAction()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(setOwnKioskPinAction("1234")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.setOwnKioskPin).not.toHaveBeenCalled();
	});
});

describe("own kiosk fob", () => {
	it("reads the signed-in user's fob status with the organization's zone", async () => {
		await expect(getOwnKioskFobStatusAction()).resolves.toEqual({
			success: true,
			data: { fob: null, fobReaderInUse: true, timezone: "Europe/Berlin" },
		});
		expect(mocks.readOwnKioskFobStatus).toHaveBeenCalledWith(expect.anything(), own);
	});

	it("is null for someone who is no employee here", async () => {
		mocks.readOwnKioskFobStatus.mockResolvedValue(null);

		await expect(getOwnKioskFobStatusAction()).resolves.toEqual({ success: true, data: null });
	});

	it("removes the fob the user saw", async () => {
		await expect(removeOwnKioskFobAction("fob-1")).resolves.toEqual({
			success: true,
			data: { removed: true },
		});
		expect(mocks.removeOwnKioskFob).toHaveBeenCalledWith(expect.anything(), {
			...own,
			expectedFobId: "fob-1",
		});
	});

	it("passes a changed fob on as its code", async () => {
		mocks.removeOwnKioskFob.mockRejectedValue(
			new KioskFobManagementRefusal("fob_changed", "Changed"),
		);

		await expect(removeOwnKioskFobAction("fob-1")).resolves.toMatchObject({
			success: false,
			refusal: "fob_changed",
		});
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		await expect(getOwnKioskFobStatusAction()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(removeOwnKioskFobAction("fob-1")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.removeOwnKioskFob).not.toHaveBeenCalled();
	});
});
