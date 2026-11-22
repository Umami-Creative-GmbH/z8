import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	saveWorksCouncilSettings: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: {} }));
});

vi.mock("@/lib/works-council/settings", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/works-council/settings")>();
	return {
		...original,
		saveWorksCouncilSettings: mocks.saveWorksCouncilSettings,
	};
});

import { updateWorksCouncilSettings } from "./actions";

const validInput = {
	enabled: true,
	identityVisibility: "aggregated" as const,
	absenceVisibility: "hidden" as const,
	exportEnabled: false,
	minimumAggregationThreshold: 5,
	visibleTeamIds: ["team-1"],
	visibleLocationIds: ["loc-1"],
};

describe("updateWorksCouncilSettings", () => {
	beforeEach(() => {
		mocks.caller = null;
		mocks.saveWorksCouncilSettings.mockReset();
		mocks.saveWorksCouncilSettings.mockResolvedValue({ id: "wc-1" });
	});

	it("refuses a signed-out caller without saving", async () => {
		mocks.caller = null;

		const result = await updateWorksCouncilSettings(validInput);

		expect(result).toMatchObject({ success: false, code: "AuthenticationError" });
		expect(mocks.saveWorksCouncilSettings).not.toHaveBeenCalled();
	});

	it("refuses a member caller without saving", async () => {
		mocks.caller = {
			userId: "user-1",
			activeOrganizationId: "org-1",
			membershipRole: "member",
			employee: { id: "emp-1", role: "employee", former: false },
		};

		const result = await updateWorksCouncilSettings(validInput);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.saveWorksCouncilSettings).not.toHaveBeenCalled();
	});

	it("refuses a scoped manager and a former employee without saving", async () => {
		mocks.caller = {
			userId: "manager-1",
			activeOrganizationId: "org-1",
			membershipRole: "member",
			employee: { id: "emp-2", role: "manager", former: false },
		};

		expect(await updateWorksCouncilSettings(validInput)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		mocks.caller = {
			userId: "former-admin",
			activeOrganizationId: "org-1",
			membershipRole: "owner",
			employee: { id: "emp-3", role: "admin", former: true },
		};

		expect(await updateWorksCouncilSettings(validInput)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.saveWorksCouncilSettings).not.toHaveBeenCalled();
	});

	it("rejects an invalid minimum aggregation threshold before saving", async () => {
		mocks.caller = {
			userId: "admin-1",
			activeOrganizationId: "org-1",
			membershipRole: "admin",
			employee: null,
		};

		const result = await updateWorksCouncilSettings({
			...validInput,
			minimumAggregationThreshold: 4,
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.saveWorksCouncilSettings).not.toHaveBeenCalled();
	});

	it("saves works council settings scoped to the active organization for an org admin and owner", async () => {
		mocks.caller = {
			userId: "admin-1",
			activeOrganizationId: "org-1",
			membershipRole: "admin",
			employee: null,
		};

		const result = await updateWorksCouncilSettings(validInput);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.saveWorksCouncilSettings).toHaveBeenCalledWith(
			{
				...validInput,
				organizationId: "org-1",
				actorUserId: "admin-1",
			},
			expect.any(Object),
		);

		mocks.saveWorksCouncilSettings.mockClear();
		mocks.caller = {
			userId: "owner-1",
			activeOrganizationId: "org-2",
			membershipRole: "owner",
			employee: null,
		};

		expect(await updateWorksCouncilSettings(validInput)).toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.saveWorksCouncilSettings).toHaveBeenCalledWith(
			{
				...validInput,
				organizationId: "org-2",
				actorUserId: "owner-1",
			},
			expect.any(Object),
		);
	});
});
