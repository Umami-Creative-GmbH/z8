import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	loadStatutorySettingsOverview: vi.fn(),
	saveOrganizationStatutoryPreferences: vi.fn(),
}));

vi.mock("@/lib/statutory/settings-overview", () => ({
	loadStatutorySettingsOverview: mocks.loadStatutorySettingsOverview,
}));

vi.mock("@/lib/statutory/preferences", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/statutory/preferences")>()),
	saveOrganizationStatutoryPreferences: mocks.saveOrganizationStatutoryPreferences,
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: vi.fn(async () => "Europe/Berlin"),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: {} }));
});

const actions = await import("./statutory-actions");

const scopedManager: StubCaller = {
	userId: "u-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-manager", role: "manager", former: false },
};

const orgAdmin: StubCaller = {
	userId: "u-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

const validPreferences = {
	warningThresholdPercent: 75,
	criticalThresholdPercent: 90,
	blockJarbschgShiftPublish: true,
};

describe("statutory settings actions (#1988)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadStatutorySettingsOverview.mockResolvedValue({ baselines: [], today: "2026-11-23" });
		mocks.saveOrganizationStatutoryPreferences.mockImplementation(async (_db, input) => ({
			...input,
			isDefault: false,
		}));
	});

	it.each([
		["getStatutorySettingsAction", () => actions.getStatutorySettingsAction()],
		[
			"updateStatutoryPreferencesAction",
			() => actions.updateStatutoryPreferencesAction(validPreferences),
		],
	])("refuses %s to scoped managers", async (_name, call) => {
		mocks.caller = scopedManager;

		expect(await call()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.loadStatutorySettingsOverview).not.toHaveBeenCalled();
		expect(mocks.saveOrganizationStatutoryPreferences).not.toHaveBeenCalled();
	});

	it("loads the overview for the organization's local today", async () => {
		mocks.caller = orgAdmin;

		expect(await actions.getStatutorySettingsAction()).toMatchObject({ success: true });
		expect(mocks.loadStatutorySettingsOverview).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
		});
	});

	it("saves preferences for the active organization as the acting admin", async () => {
		mocks.caller = orgAdmin;

		expect(await actions.updateStatutoryPreferencesAction(validPreferences)).toMatchObject({
			success: true,
		});
		expect(mocks.saveOrganizationStatutoryPreferences).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			actorUserId: "u-admin",
			...validPreferences,
		});
	});

	it("refuses a warning tier that is not below the critical tier", async () => {
		mocks.caller = orgAdmin;

		expect(
			await actions.updateStatutoryPreferencesAction({
				...validPreferences,
				warningThresholdPercent: 90,
			}),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.saveOrganizationStatutoryPreferences).not.toHaveBeenCalled();
	});
});
