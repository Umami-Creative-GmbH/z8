/**
 * `organizationAction` against PostgreSQL: who has which settings access (ADR
 * 0002), the current-roster check of `addsEmployees` and the owner step-up.
 * Only the request/session, the SSO/MFA organization gate and the redirect are
 * replaced; the membership and employee rows are real.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	activeOrganizationId: null as string | null,
	organizationAccessRefused: false,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: {
								id: harness.userId,
								role: "user",
								name: "Caller",
								email: "caller@example.test",
							},
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.activeOrganizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => !harness.organizationAccessRefused,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: async (href: string) => {
		throw new Error(`redirect:${href}`);
	},
}));

const { organizationAction, noInput } = await import("./organization-action");
const { FORMER_EMPLOYEE_REFUSAL } = await import("@/lib/employee-lifecycle/current-roster-guard");
const { requireOrgAdminSettingsAccess } = await import("@/lib/auth-helpers");

const LEVELS = ["member", "scopedManager", "orgAdmin", "owner"] as const;
type Level = (typeof LEVELS)[number];

const actionFor = Object.fromEntries(
	LEVELS.map((level) => [
		level,
		organizationAction(
			{ name: `test.requires.${level}`, requires: level, schema: noInput },
			({ actor, organizationId }) =>
				Effect.succeed({ organizationId, settingsAccess: actor.settingsAccess }),
		),
	]),
) as Record<Level, () => ReturnType<ReturnType<typeof organizationAction>>>;

type Caller = {
	userId: () => string;
	activeOrganizationId?: () => string | null;
	organizationAccessRefused?: boolean;
};

describe("organizationAction on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	const users: Record<string, string> = {};
	let formerEmployeeId: string;
	let currentEmployeeId: string;

	async function setEmployeeRole(employeeId: string, role: "admin" | "manager") {
		await fixture.pool.query(`update employee set role = $2 where id = $1`, [employeeId, role]);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		users.owner = fixture.ownerUserId;
		users.admin = (await fixture.seedEmployee({ role: "admin" })).userId;

		const workforceAdmin = await fixture.seedEmployee();
		await setEmployeeRole(workforceAdmin.employeeId, "admin");
		users.workforceAdmin = workforceAdmin.userId;

		const scopedManager = await fixture.seedEmployee();
		await setEmployeeRole(scopedManager.employeeId, "manager");
		users.scopedManager = scopedManager.userId;

		const orgMember = await fixture.seedEmployee();
		users.orgMember = orgMember.userId;
		currentEmployeeId = orgMember.employeeId;

		const pendingAdmin = await fixture.seedEmployee({ role: "admin" });
		await fixture.pool.query(`update member set status = 'pending' where id = $1`, [
			pendingAdmin.memberId,
		]);
		users.pendingAdmin = pendingAdmin.userId;

		users.formerOwner = (await fixture.seedEmployee({ role: "owner", isActive: false })).userId;
		users.formerAdmin = (await fixture.seedEmployee({ role: "admin", isActive: false })).userId;
		const formerManager = await fixture.seedEmployee({ isActive: false });
		await setEmployeeRole(formerManager.employeeId, "manager");
		users.formerManager = formerManager.userId;
		formerEmployeeId = formerManager.employeeId;

		const ownerWithoutEmployee = await fixture.seedEmployee({ role: "owner", withPeriod: false });
		await fixture.pool.query(`delete from employee where id = $1`, [
			ownerWithoutEmployee.employeeId,
		]);
		users.ownerWithoutEmployee = ownerWithoutEmployee.userId;

		const otherOrganizationId = await fixture.createOrganization();
		users.otherOrganizationOwner = (
			await fixture.seedEmployee({ organizationId: otherOrganizationId, role: "owner" })
		).userId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function signIn(caller: Caller) {
		harness.userId = caller.userId();
		harness.activeOrganizationId = caller.activeOrganizationId
			? caller.activeOrganizationId()
			: fixture.organizationId;
		harness.organizationAccessRefused = caller.organizationAccessRefused ?? false;
	}

	const cases: Array<[string, Caller, Level | null]> = [
		["an owner", { userId: () => users.owner }, "owner"],
		["an owner without an employee record", { userId: () => users.ownerWithoutEmployee }, "owner"],
		["an admin", { userId: () => users.admin }, "orgAdmin"],
		["a workforce admin", { userId: () => users.workforceAdmin }, "scopedManager"],
		["a scoped manager", { userId: () => users.scopedManager }, "scopedManager"],
		["an org member", { userId: () => users.orgMember }, "member"],
		["a pending admin membership", { userId: () => users.pendingAdmin }, null],
		["an owner who is a former employee", { userId: () => users.formerOwner }, null],
		["an admin who is a former employee", { userId: () => users.formerAdmin }, null],
		["a manager who is a former employee", { userId: () => users.formerManager }, null],
		["a user of another organization", { userId: () => users.otherOrganizationOwner }, null],
		[
			"an owner without an active organization",
			{ userId: () => users.owner, activeOrganizationId: () => null },
			null,
		],
		[
			"an owner whose session the SSO/MFA gate refuses",
			{ userId: () => users.owner, organizationAccessRefused: true },
			null,
		],
	];

	describe.each(cases)("%s", (_name, caller, settingsAccess) => {
		it.each(LEVELS)(
			"is served by an action requiring %s only when their settings access qualifies",
			async (level) => {
				signIn(caller);
				const qualifies =
					settingsAccess !== null && LEVELS.indexOf(settingsAccess) >= LEVELS.indexOf(level);

				const result = await actionFor[level]();

				if (qualifies) {
					expect(result).toEqual({
						success: true,
						data: { organizationId: fixture.organizationId, settingsAccess },
					});
				} else {
					expect(result).toMatchObject({ success: false });
					expect(["AuthorizationError", "AuthenticationError"]).toContain(
						result.success ? null : result.code,
					);
				}
			},
		);

		it("agrees with the page guard on org admin settings access", async () => {
			signIn(caller);
			const moduleAgrees = (await actionFor.orgAdmin()).success;

			const pageGuardAdmits = await requireOrgAdminSettingsAccess().then(
				() => true,
				() => false,
			);

			expect(pageGuardAdmits).toBe(moduleAgrees);
		});
	});

	describe("adding employees", () => {
		const assign = organizationAction(
			{
				name: "test.assignEmployees",
				requires: "orgAdmin",
				schema: z.strictObject({ employeeIds: z.array(z.string()) }),
				addsEmployees: (input) => input.employeeIds,
			},
			({ input }) => Effect.succeed(input.employeeIds.length),
		);

		it("refuses to add a former employee with the former_employee refusal", async () => {
			signIn({ userId: () => users.admin });

			await expect(
				assign({ employeeIds: [currentEmployeeId, formerEmployeeId] }),
			).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: FORMER_EMPLOYEE_REFUSAL,
			});
		});

		it("refuses an employee of no organization the same way", async () => {
			signIn({ userId: () => users.admin });

			await expect(assign({ employeeIds: [randomUUID()] })).resolves.toMatchObject({
				success: false,
				refusal: FORMER_EMPLOYEE_REFUSAL,
			});
		});

		it("adds employees on the current roster", async () => {
			signIn({ userId: () => users.admin });

			await expect(assign({ employeeIds: [currentEmployeeId] })).resolves.toEqual({
				success: true,
				data: 1,
			});
		});
	});

	describe("the managed scope", () => {
		const readScope = organizationAction(
			{ name: "test.readManagedScope", requires: "scopedManager", schema: noInput },
			({ actor }) =>
				actor
					.managedScope()
					.pipe(
						Effect.map((scope) =>
							scope.organizationWide
								? "organization"
								: { employeeIds: [...scope.employeeIds], teamIds: [...scope.teamIds] },
						),
					),
		);
		const teamId = randomUUID();
		const otherTeamId = randomUUID();

		beforeAll(async () => {
			const manager = await fixture.pool.query<{ id: string }>(
				`select id from employee where user_id = $1`,
				[users.scopedManager],
			);
			const managerId = manager.rows[0]?.id;
			await fixture.pool.query(
				`insert into team (id, organization_id, name, updated_at)
				 values ($1, $3, 'Ops', now()), ($2, $3, 'Sales', now())`,
				[teamId, otherTeamId, fixture.organizationId],
			);
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[currentEmployeeId, managerId, users.owner],
			);
			await fixture.pool.query(
				`insert into team_permissions
				 (employee_id, organization_id, team_id, can_manage_team_members, granted_by, updated_at)
				 values ($1, $2, $3, true, $4, now())`,
				[managerId, fixture.organizationId, teamId, fixture.ownerEmployeeId],
			);
		});

		it("is the scoped manager's employees and the teams they may manage", async () => {
			signIn({ userId: () => users.scopedManager });

			await expect(readScope()).resolves.toEqual({
				success: true,
				data: { employeeIds: [currentEmployeeId], teamIds: [teamId] },
			});
		});

		it("is the whole organization for an org admin", async () => {
			signIn({ userId: () => users.admin });

			await expect(readScope()).resolves.toEqual({ success: true, data: "organization" });
		});
	});

	describe("stepping up to owner", () => {
		const toggle = organizationAction(
			{
				name: "test.toggleOwnerFeature",
				requires: "orgAdmin",
				schema: z.strictObject({ ownerOnly: z.boolean() }),
			},
			({ actor, input }) =>
				Effect.gen(function* () {
					if (input.ownerOnly) yield* actor.require("owner");
					return "toggled";
				}),
		);

		it("refuses an admin once the input needs an owner", async () => {
			signIn({ userId: () => users.admin });

			await expect(toggle({ ownerOnly: true })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			await expect(toggle({ ownerOnly: false })).resolves.toEqual({
				success: true,
				data: "toggled",
			});
		});

		it("lets an owner through", async () => {
			signIn({ userId: () => users.owner });

			await expect(toggle({ ownerOnly: true })).resolves.toEqual({
				success: true,
				data: "toggled",
			});
		});
	});
});
