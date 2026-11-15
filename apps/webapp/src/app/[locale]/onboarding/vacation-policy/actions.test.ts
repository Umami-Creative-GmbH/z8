import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { OnboardingServiceLive } from "@/lib/effect/services/onboarding.service";
import type { SettingsAccessFacts } from "@/lib/organization-action/settings-access";
import { SETTINGS_ACCESS_FACTS_QUERY } from "@/lib/organization-action/settings-access";

const caller = vi.hoisted(() => ({
	organizationId: "org-a" as string | null,
	role: "member",
	approved: true,
	former: false,
	policies: [] as unknown[],
	progress: [] as unknown[],
}));

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/user-preferences/user-settings-mutation", () => ({
	writeUserSettings: async (_db: unknown, userId: string, values: unknown) => {
		caller.progress.push({ userId, values });
	},
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const db = {
		insert: () => ({ values: async (value: unknown) => caller.policies.push(value) }),
		query: { member: { findFirst: async () => ({ role: caller.role }) } },
	};
	const auth = Layer.succeed(
		AuthService,
		AuthService.of({
			getSession: () =>
				Effect.succeed({
					user: { id: "actor" },
					session: { activeOrganizationId: caller.organizationId },
				} as never),
		}),
	);
	const database = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: db as never,
			query: (name, query) => {
				if (name === SETTINGS_ACCESS_FACTS_QUERY) {
					const facts: SettingsAccessFacts = {
						membershipRole: caller.approved ? caller.role : null,
						employee: { id: "employee-a", role: "employee", former: caller.former },
					};
					return Effect.succeed(facts) as never;
				}
				return Effect.promise(query) as never;
			},
		}),
	);
	return runtimeModuleOver(
		OnboardingServiceLive.pipe(Layer.provide(auth), Layer.provide(database)),
	);
});

import { checkIsAdmin, createVacationPolicyOnboarding, skipVacationPolicySetup } from "./actions";

const values = {
	name: "Standard",
	defaultAnnualDays: 25,
	accrualType: "annual" as const,
	allowCarryover: true,
	maxCarryoverDays: 5,
};

beforeEach(() => {
	caller.organizationId = "org-a";
	caller.role = "member";
	caller.approved = true;
	caller.former = false;
	caller.policies = [];
	caller.progress = [];
});

describe("vacation onboarding public action authority", () => {
	it("refuses a member before policy or onboarding progress writes", async () => {
		const result = await createVacationPolicyOnboarding(values);
		expect(result.success).toBe(false);
		expect(caller.policies).toEqual([]);
		expect(caller.progress).toEqual([]);
	});

	it.each(["owner", "admin"])("preserves approved %s save semantics", async (role) => {
		caller.role = role;
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		expect(await createVacationPolicyOnboarding(values)).toMatchObject({ success: true });
		expect(caller.policies).toEqual([
			expect.objectContaining({
				organizationId: "org-a",
				defaultAnnualDays: "25",
				accrualType: "annual",
				allowCarryover: true,
				maxCarryoverDays: "5",
				carryoverExpiryMonths: 3,
				prorateInStartAndExitYear: true,
			}),
		]);
		expect(caller.progress).toEqual([
			{ userId: "actor", values: { onboardingStep: "work_templates" } },
		]);
	});

	it.each(["member", "pending", "former", "no-organization"])(
		"refuses save and Skip for %s without writes",
		async (boundary) => {
			caller.role = boundary === "member" ? "member" : "owner";
			caller.approved = boundary !== "pending";
			caller.former = boundary === "former";
			caller.organizationId = boundary === "no-organization" ? null : "org-a";
			expect(await checkIsAdmin()).toMatchObject({ success: true, data: false });
			expect(await createVacationPolicyOnboarding(values)).toMatchObject({ success: false });
			expect(await skipVacationPolicySetup()).toMatchObject({ success: false });
			expect(caller.policies).toEqual([]);
			expect(caller.progress).toEqual([]);
		},
	);

	it("checks fresh authority after successful page admission", async () => {
		caller.role = "owner";
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		caller.role = "member";
		expect(await createVacationPolicyOnboarding(values)).toMatchObject({ success: false });
		expect(await skipVacationPolicySetup()).toMatchObject({ success: false });
		expect(caller.policies).toEqual([]);
		expect(caller.progress).toEqual([]);
	});

	it("keeps an admitted Skip as progress only", async () => {
		caller.role = "admin";
		expect(await skipVacationPolicySetup()).toMatchObject({ success: true });
		expect(caller.policies).toEqual([]);
		expect(caller.progress).toEqual([
			{ userId: "actor", values: { onboardingStep: "work_templates" } },
		]);
	});

	it.each(["organization", "account"])(
		"refuses a stale %s expectation before writes",
		async (kind) => {
			caller.role = "admin";
			const expected = {
				userId: kind === "account" ? "another-actor" : "actor",
				organizationId: kind === "organization" ? "org-b" : "org-a",
			};
			expect(await createVacationPolicyOnboarding(values, expected)).toMatchObject({
				success: false,
			});
			expect(await skipVacationPolicySetup(expected)).toMatchObject({ success: false });
			expect(caller.policies).toEqual([]);
			expect(caller.progress).toEqual([]);
		},
	);

	it("admits a matching expectation without treating it as a permission grant", async () => {
		const expected = { userId: "actor", organizationId: "org-a" };
		expect(await createVacationPolicyOnboarding(values, expected)).toMatchObject({
			success: false,
		});
		caller.role = "admin";
		expect(await createVacationPolicyOnboarding(values, expected)).toMatchObject({ success: true });
		expect(caller.policies).toHaveLength(1);
	});
});
