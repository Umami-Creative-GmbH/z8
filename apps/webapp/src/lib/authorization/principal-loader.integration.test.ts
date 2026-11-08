/**
 * Organization-level abilities follow settings access: an owner or admin who is
 * a former employee of the organization keeps none of them, while an owner or
 * admin who was never an employee there keeps them all.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { defineAbilityFor } from "./ability";
import { loadOrganizationPrincipalContext } from "./principal-loader";

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
});
