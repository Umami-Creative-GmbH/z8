/**
 * Organization-level abilities follow settings access: an owner or admin who is
 * a former employee of the organization keeps none of them, while an owner or
 * admin who was never an employee there keeps them all.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { type AppAbility, canOpenApprovalInbox, defineAbilityFor } from "./ability";
import {
	loadOrganizationPrincipalContext,
	loadOrganizationPrincipalContexts,
	loadOrganizationSessionPrincipalContexts,
	platformAdminPrincipalContext,
} from "./principal-loader";
import type { PrincipalContext } from "./types";

describe("organization principal loader on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let inactiveOwnerUserId: string;
	let inactiveAdminUserId: string;
	let ownerWithoutEmployeeUserId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		inactiveOwnerUserId = (
			await fixture.seedEmployee({ role: "owner", isActive: false })
		).userId;
		inactiveAdminUserId = (
			await fixture.seedEmployee({ role: "admin", isActive: false })
		).userId;
		const ownerWithoutEmployee = await fixture.seedEmployee({
			role: "owner",
			withPeriod: false,
		});
		ownerWithoutEmployeeUserId = ownerWithoutEmployee.userId;
		await fixture.pool.query(`delete from employee where id = $1`, [
			ownerWithoutEmployee.employeeId,
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function abilityOf(userId: string) {
		return defineAbilityFor(
			await loadOrganizationPrincipalContext(fixture.db, {
				userId,
				organizationId: fixture.organizationId,
			}),
		);
	}

	it.each([
		["owner", () => inactiveOwnerUserId],
		["admin", () => inactiveAdminUserId],
	])(
		"gives an %s who is a former employee no organization-level abilities",
		async (_role, userId) => {
			const ability = await abilityOf(userId());

			expect(ability.can("manage", "OrgSettings")).toBe(false);
			expect(ability.can("manage", "OrgBilling")).toBe(false);
			expect(ability.can("manage", "OrgMembers")).toBe(false);
			expect(ability.can("manage", "PayrollExport")).toBe(false);
		},
	);

	it.each([
		["an active owner", () => fixture.ownerUserId],
		["an owner without an employee record", () => ownerWithoutEmployeeUserId],
	])("lets %s manage the organization settings", async (_case, userId) => {
		const ability = await abilityOf(userId());

		expect(ability.can("manage", "OrgSettings")).toBe(true);
	});

	describe("loading several users at once (#1977)", () => {
		type Person = {
			name: string;
			userId: string;
			/** Null for a user with no employee row in the organization. */
			employee: {
				id: string;
				organizationId: string;
				role: "admin" | "manager" | "employee";
			} | null;
			/** What their inbox gate and compliance access are, from the role model. */
			opensInbox: boolean;
			managesCompliance: boolean;
		};
		type Employed = Person & { employee: NonNullable<Person["employee"]> };
		let people: Person[];
		let platformAdminUserId: string;

		async function person(
			name: string,
			expected: Pick<Person, "opensInbox" | "managesCompliance">,
			input: Parameters<LifecycleDatabaseFixture["seedEmployee"]>[0] = {},
		): Promise<Employed> {
			const seeded = await fixture.seedEmployee(input);
			return {
				name,
				userId: seeded.userId,
				employee: {
					id: seeded.employeeId,
					organizationId: fixture.organizationId,
					role: input.role === "admin" || input.role === "owner" ? "admin" : "employee",
				},
				...expected,
			};
		}

		async function customRole(
			holder: Employed,
			input: { organizationId: string; isActive: boolean },
		) {
			const roleId = randomUUID();
			await fixture.pool.query(
				`insert into custom_role (id, organization_id, name, is_active, created_by, updated_at)
				 values ($1, $2, $3, $4, $5, now())`,
				[
					roleId,
					input.organizationId,
					`Compliance desk ${roleId}`,
					input.isActive,
					fixture.ownerUserId,
				],
			);
			await fixture.pool.query(
				`insert into custom_role_permission (custom_role_id, action, subject)
				 values ($1, 'manage', 'Compliance'), ($1, 'read', 'Report')`,
				[roleId],
			);
			await fixture.pool.query(
				`insert into employee_custom_role (employee_id, custom_role_id, assigned_by)
				 values ($1, $2, $3)`,
				[holder.employee.id, roleId, fixture.ownerUserId],
			);
		}

		beforeAll(async () => {
			const no = { opensInbox: false, managesCompliance: false };
			const plain = await person("a plain employee", no);
			const lead = await person("a manager with direct reports", {
				opensInbox: true,
				managesCompliance: false,
			});
			lead.employee.role = "manager";
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				lead.employee.id,
			]);
			for (const report of [plain, await person("a second report", no)]) {
				await fixture.pool.query(
					`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
					 values ($1, $2, true, $3)`,
					[report.employee.id, lead.employee.id, fixture.ownerUserId],
				);
			}
			await fixture.pool.query(
				`insert into team_permissions
				 (employee_id, organization_id, can_create_teams, can_approve_team_requests, granted_by,
				  updated_at)
				 values ($1, $2, true, true, $3, now())`,
				[lead.employee.id, fixture.organizationId, fixture.ownerEmployeeId],
			);
			const admin = await person(
				"an org admin",
				{ opensInbox: true, managesCompliance: true },
				{ role: "admin" },
			);
			const complianceDesk = await person("a holder of a role granting manage Compliance", {
				opensInbox: true,
				managesCompliance: true,
			});
			await customRole(complianceDesk, { organizationId: fixture.organizationId, isActive: true });
			const foreignRole = await person("a holder of another organization's role", no);
			await customRole(foreignRole, {
				organizationId: await fixture.createOrganization(),
				isActive: true,
			});
			const inactiveRole = await person("a holder of an inactive role", no);
			await customRole(inactiveRole, { organizationId: fixture.organizationId, isActive: false });
			const unapproved = await person("an admin whose membership awaits approval", no, {
				role: "admin",
			});
			await fixture.pool.query(
				"update member set status = 'pending' where user_id = $1 and organization_id = $2",
				[unapproved.userId, fixture.organizationId],
			);
			const departed = await person("a departed admin", no, { role: "admin", isActive: false });
			const platformAdmin = await person("a platform admin", no);
			platformAdminUserId = platformAdmin.userId;
			await fixture.pool.query(`update "user" set role = 'admin' where id = $1`, [
				platformAdminUserId,
			]);
			// An approved admin who was never employed here keeps the admin role, but opens no
			// inbox: the inbox needs an employee.
			const neverEmployed: Person = await person(
				"an admin who was never an employee",
				{ opensInbox: false, managesCompliance: true },
				{ role: "admin", withPeriod: false },
			);
			await fixture.pool.query(`delete from employee where id = $1`, [neverEmployed.employee?.id]);
			neverEmployed.employee = null;
			const outsider: Person = await person("a member of another organization only", no, {
				role: "admin",
				organizationId: await fixture.createOrganization(),
			});
			outsider.employee = null;
			people = [
				plain,
				lead,
				admin,
				complianceDesk,
				foreignRole,
				inactiveRole,
				unapproved,
				departed,
				platformAdmin,
				neverEmployed,
				outsider,
			];
		});

		async function singly(userId: string) {
			return loadOrganizationPrincipalContext(fixture.db, {
				userId,
				organizationId: fixture.organizationId,
			});
		}

		/** Row order is not meaning: order the principal's lists before comparing. */
		function ordered(principal: PrincipalContext | undefined) {
			if (!principal) return principal;
			return {
				...principal,
				managedEmployeeIds: [...principal.managedEmployeeIds].sort(),
				customRoles: [...principal.customRoles]
					.sort((a, b) => a.roleId.localeCompare(b.roleId))
					.map((role) => ({
						...role,
						permissions: [...role.permissions].sort((a, b) =>
							`${a.action}:${a.subject}`.localeCompare(`${b.action}:${b.subject}`),
						),
					})),
			};
		}

		it("gives every user the principal the single-user loader gives them", async () => {
			const batched = await loadOrganizationPrincipalContexts(fixture.db, {
				organizationId: fixture.organizationId,
				userIds: people.map((p) => p.userId),
			});

			expect([...batched.keys()].sort()).toEqual(people.map((p) => p.userId).sort());
			for (const p of people) {
				expect(ordered(batched.get(p.userId)), p.name).toEqual(ordered(await singly(p.userId)));
			}
		});

		it("derives abilities that agree on opening the inbox and managing Compliance", async () => {
			const batched = await loadOrganizationPrincipalContexts(fixture.db, {
				organizationId: fixture.organizationId,
				userIds: people.map((p) => p.userId),
			});

			for (const p of people) {
				const single = defineAbilityFor(await singly(p.userId));
				const principal = batched.get(p.userId);
				if (!principal) throw new Error(`no principal for ${p.name}`);
				const together = defineAbilityFor(principal);
				const decisions = (ability: AppAbility) => ({
					opensInbox: p.employee !== null && canOpenApprovalInbox(ability, p.employee),
					managesCompliance: ability.can("manage", "Compliance"),
				});

				expect(decisions(together), p.name).toEqual(decisions(single));
				expect(decisions(together), p.name).toEqual({
					opensInbox: p.opensInbox,
					managesCompliance: p.managesCompliance,
				});
			}
		});

		it("ignores team permissions recorded under another organization", async () => {
			const holder = await person("a holder of another organization's team permissions", {
				opensInbox: false,
				managesCompliance: false,
			});
			await fixture.pool.query(
				`insert into team_permissions
				 (employee_id, organization_id, can_create_teams, can_approve_team_requests, granted_by,
				  updated_at)
				 values ($1, $2, true, true, $3, now())`,
				[holder.employee.id, await fixture.createOrganization(), fixture.ownerEmployeeId],
			);
			const noPermissions = { orgWide: null, byTeamId: new Map() };

			expect((await singly(holder.userId)).permissions).toEqual(noPermissions);
			const batched = await loadOrganizationPrincipalContexts(fixture.db, {
				organizationId: fixture.organizationId,
				userIds: [holder.userId],
			});
			expect(batched.get(holder.userId)?.permissions).toEqual(noPermissions);
		});

		it("gives a platform admin a session's platform admin principal, and everyone else theirs", async () => {
			const sessions = await loadOrganizationSessionPrincipalContexts(fixture.db, {
				organizationId: fixture.organizationId,
				userIds: people.map((p) => p.userId),
			});

			for (const p of people) {
				const principal = sessions.get(p.userId);
				if (p.userId === platformAdminUserId) {
					expect(principal).toEqual(
						platformAdminPrincipalContext(platformAdminUserId, fixture.organizationId),
					);
					const ability = defineAbilityFor(principal as PrincipalContext);
					expect(p.employee && canOpenApprovalInbox(ability, p.employee)).toBe(true);
					expect(ability.can("manage", "Compliance")).toBe(true);
				} else {
					expect(ordered(principal), p.name).toEqual(ordered(await singly(p.userId)));
				}
			}
		});
	});
});
