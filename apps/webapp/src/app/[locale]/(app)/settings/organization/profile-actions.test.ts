import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ORGANIZATION_PROFILE } from "@/lib/organization/profile";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => {
	const limit = vi.fn();
	const onConflictDoUpdate = vi.fn();
	return {
		caller: null as StubCaller | null,
		billing: "true",
		limit,
		onConflictDoUpdate,
		values: vi.fn(() => ({ onConflictDoUpdate })),
		db: {} as Record<string, unknown>,
	};
});
mocks.db.select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }));
mocks.db.insert = vi.fn(() => ({ values: mocks.values }));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/env", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/env")>();
	return {
		env: new Proxy(actual.env, {
			get: (target, key) => (key === "BILLING_ENABLED" ? mocks.billing : Reflect.get(target, key)),
		}),
	};
});

const { getOrganizationProfile, saveOrganizationProfile } = await import("./profile-actions");
const { prepareAvvDownload } = await import("../avv/actions");

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};
const completeProfile = {
	...EMPTY_ORGANIZATION_PROFILE,
	legalCompanyName: "Legal GmbH",
	addressLine1: "Example Street 7",
	postalCode: "10115",
	city: "Berlin",
	country: "DE",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.billing = "true";
	mocks.limit.mockResolvedValue([]);
	mocks.onConflictDoUpdate.mockResolvedValue(undefined);
});

describe("organization profile actions", () => {
	it.each([
		["getOrganizationProfile", () => getOrganizationProfile()],
		["saveOrganizationProfile", () => saveOrganizationProfile(completeProfile)],
		["prepareAvvDownload", () => prepareAvvDownload()],
	])("refuses %s to a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.limit).not.toHaveBeenCalled();
		expect(mocks.values).not.toHaveBeenCalled();
	});

	it("reads an empty profile for an organization without one", async () => {
		expect(await getOrganizationProfile()).toEqual({
			success: true,
			data: EMPTY_ORGANIZATION_PROFILE,
		});
	});

	it("saves a valid profile for the session's organization", async () => {
		expect(await saveOrganizationProfile({ ...completeProfile, country: "de" })).toEqual({
			success: true,
			data: { ok: true, profile: completeProfile },
		});
		expect(mocks.values).toHaveBeenCalledWith({ ...completeProfile, organizationId: "org-1" });
	});

	it("returns field errors as data without saving", async () => {
		expect(await saveOrganizationProfile({ vatId: "not a vat id" })).toEqual({
			success: true,
			data: { ok: false, fieldErrors: { vatId: "invalidVatId" } },
		});
		expect(mocks.values).not.toHaveBeenCalled();
	});
});

describe("prepareAvvDownload", () => {
	it("is ready once the saved profile has every required detail", async () => {
		mocks.limit.mockResolvedValue([{ ...completeProfile, organizationId: "org-1" }]);

		expect(await prepareAvvDownload()).toEqual({
			success: true,
			data: { ready: true, profile: completeProfile },
		});
	});

	it("names the missing details", async () => {
		expect(await prepareAvvDownload()).toEqual({
			success: true,
			data: {
				ready: false,
				missingFields: ["legalCompanyName", "addressLine1", "city", "country"],
			},
		});
	});

	it("is unavailable when billing is disabled", async () => {
		mocks.billing = "false";

		expect(await prepareAvvDownload()).toMatchObject({ success: false, code: "BillingError" });
		expect(mocks.limit).not.toHaveBeenCalled();
	});
});
