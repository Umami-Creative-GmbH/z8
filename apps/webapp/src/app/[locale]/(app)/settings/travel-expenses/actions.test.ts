import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	findMany: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { query: { travelExpensePolicy: { findMany: mocks.findMany } } },
		}),
	);
});

const actions = await import("./actions");

const owner: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};

describe("legacy travel expense policy actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = owner;
	});

	it("no longer offers the non-transactional legacy save (#606)", () => {
		expect(Object.keys(actions)).toEqual(["getTravelExpensePolicies"]);
	});

	it("refuses a scoped manager before reading", async () => {
		mocks.caller = {
			...owner,
			membershipRole: "member",
			employee: { id: "emp-1", role: "manager", former: false },
		};

		expect(await actions.getTravelExpensePolicies()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.findMany).not.toHaveBeenCalled();
	});

	it("lets owners without an employee record read the legacy rows with their stored dates", async () => {
		mocks.findMany.mockResolvedValueOnce([
			{
				id: "policy-1",
				organizationId: "org-1",
				effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
				effectiveTo: null,
				currency: "EUR",
				mileageRatePerKm: "0.3000",
				perDiemRatePerDay: null,
				isActive: true,
			},
		]);

		expect(await actions.getTravelExpensePolicies()).toEqual({
			success: true,
			data: [
				{
					id: "policy-1",
					effectiveFrom: "2026-03-01",
					effectiveTo: null,
					currency: "EUR",
					mileageRatePerKm: "0.3000",
					perDiemRatePerDay: null,
					isActive: true,
				},
			],
		});
	});
});
