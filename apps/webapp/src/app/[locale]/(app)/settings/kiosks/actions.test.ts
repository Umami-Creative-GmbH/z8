import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/effect/errors";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	transaction: vi.fn(),
	orderBy: vi.fn(),
	listKiosks: vi.fn(),
	createKiosk: vi.fn(),
	updateKiosk: vi.fn(),
	issueKioskPairingCode: vi.fn(),
	revokeKiosk: vi.fn(),
	listKioskFrozenRefusals: vi.fn(),
	readAppendAdmission: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const chain = { from: () => chain, where: () => chain, orderBy: mocks.orderBy };
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { select: () => chain, transaction: mocks.transaction },
			// Like the real service: a rejection becomes a `DatabaseError` with its cause.
			query: (name, fn) =>
				Effect.tryPromise({
					try: fn,
					catch: (cause) => new DatabaseError({ message: name, operation: name, cause }),
				}),
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit-trail", () => ({
	withAuditTrail: (work: (audit: unknown) => Promise<unknown>) => work({}),
}));
vi.mock("@/lib/time-tracking/kiosk/kiosk-store", () => ({
	listKiosks: mocks.listKiosks,
	createKiosk: mocks.createKiosk,
	updateKiosk: mocks.updateKiosk,
	issueKioskPairingCode: mocks.issueKioskPairingCode,
	revokeKiosk: mocks.revokeKiosk,
}));
vi.mock("@/lib/time-tracking/kiosk/frozen-refusal-store", () => ({
	listKioskFrozenRefusals: mocks.listKioskFrozenRefusals,
}));
vi.mock("@/lib/time-tracking/work-transaction", () => ({
	readAppendAdmission: mocks.readAppendAdmission,
}));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.loadOrganizationTimezone,
}));

const { KioskSettingsRefusal } = await import("@/lib/time-tracking/kiosk/kiosk-settings-errors");
const {
	createKioskAction,
	getKioskAdminDataAction,
	issueKioskPairingCodeAction,
	revokeKioskAction,
	updateKioskAction,
} = await import("./actions");

const KIOSK = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const EXPIRES = new Date("2026-11-12T10:10:00Z");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) => work({}));
	mocks.orderBy.mockResolvedValue([{ id: LOCATION, name: "Store" }]);
	mocks.listKiosks.mockResolvedValue([]);
	mocks.listKioskFrozenRefusals.mockResolvedValue([]);
	mocks.readAppendAdmission.mockResolvedValue("append");
	mocks.loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
	mocks.createKiosk.mockResolvedValue({
		kioskId: KIOSK,
		pairingCode: "ABCDE-FGHJK",
		expiresAt: EXPIRES,
	});
	mocks.updateKiosk.mockResolvedValue(undefined);
	mocks.issueKioskPairingCode.mockResolvedValue({ pairingCode: "MNPQR-STVWX", expiresAt: EXPIRES });
	mocks.revokeKiosk.mockResolvedValue(undefined);
});

const calls = [
	["getKioskAdminDataAction", () => getKioskAdminDataAction()],
	[
		"createKioskAction",
		() =>
			createKioskAction({ name: "Front door", locationId: LOCATION, timezone: "Europe/Berlin" }),
	],
	["updateKioskAction", () => updateKioskAction({ kioskId: KIOSK, name: "Back door" })],
	["issueKioskPairingCodeAction", () => issueKioskPairingCodeAction({ kioskId: KIOSK })],
	["revokeKioskAction", () => revokeKioskAction({ kioskId: KIOSK })],
] as const;

describe("kiosk settings actions", () => {
	it.each(calls)("%s refuses a scoped manager", async (_name, call) => {
		mocks.caller = scopedManager;

		expect(await call()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.listKiosks).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it.each(calls)("%s succeeds for an org admin", async (_name, call) => {
		expect(await call()).toMatchObject({ success: true });
	});

	it("loads the kiosks of the session's organization", async () => {
		const result = await getKioskAdminDataAction();

		expect(result).toEqual({
			success: true,
			data: {
				kiosks: [],
				locations: [{ id: LOCATION, name: "Store" }],
				organizationTimezone: "Europe/Berlin",
				organizationAdopted: true,
				refusals: [],
			},
		});
		expect(mocks.listKiosks).toHaveBeenCalledWith(expect.anything(), "org-1");
	});

	it("creates a kiosk in the session's organization, as the caller", async () => {
		const result = await createKioskAction({
			name: "Front door",
			locationId: LOCATION,
			timezone: "Europe/Berlin",
		});

		expect(result).toEqual({
			success: true,
			data: { kioskId: KIOSK, pairingCode: "ABCDE-FGHJK", expiresAt: EXPIRES.toISOString() },
		});
		expect(mocks.createKiosk).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			organizationId: "org-1",
			actorUserId: "user-1",
			name: "Front door",
			locationId: LOCATION,
			timezone: "Europe/Berlin",
		});
	});

	it("returns a store refusal with its stable code", async () => {
		mocks.updateKiosk.mockRejectedValue(
			new KioskSettingsRefusal("offline_needs_adoption", "Offline mode needs adoption."),
		);

		expect(await updateKioskAction({ kioskId: KIOSK, offlineModeEnabled: true })).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "offline_needs_adoption",
		});
	});

	it("reads a malformed kiosk or location ID as not found", async () => {
		expect(await revokeKioskAction({ kioskId: "not-a-uuid" })).toMatchObject({
			success: false,
			refusal: "kiosk_not_found",
		});
		expect(
			await createKioskAction({ name: "Front door", locationId: "nope", timezone: "UTC" }),
		).toMatchObject({ success: false, refusal: "location_not_found" });
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("refuses a switch that is not on or off", async () => {
		const result = await updateKioskAction({
			kioskId: KIOSK,
			offlineModeEnabled: "yes" as unknown as boolean,
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.updateKiosk).not.toHaveBeenCalled();
	});
});
