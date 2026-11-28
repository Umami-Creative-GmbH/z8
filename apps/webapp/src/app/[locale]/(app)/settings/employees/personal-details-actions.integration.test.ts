/**
 * The employee page's personal details actions on PostgreSQL (#2071): a member
 * holding a payroll access grant that covers the employee reveals, changes and
 * ends their bank account through the actions, decided by the personal details
 * module alone; an uncovered member is refused.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const caller = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/email/email-service", async (importOriginal) =>
	(await import("@/test/integration-harness")).emailService(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: caller.userId, role: "user" },
				session: {
					id: "personal-details-actions-session",
					userId: caller.userId,
					activeOrganizationId: caller.organizationId,
				},
			}),
		},
	},
}));

const { changeEmployeeBankAccount, endEmployeeBankAccount, revealEmployeePersonalDetails } =
	await import("./personal-details-actions");

const ERIKA = { accountHolder: "Erika Mustermann", iban: "DE89370400440532013000", bic: null };

describe("personal details actions for a member payroll access holder", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let holder: SeededEmployee;
	let covered: SeededEmployee;
	let uncovered: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		holder = await fixture.seedEmployee();
		covered = await fixture.seedEmployee();
		uncovered = await fixture.seedEmployee();
		const grant = randomUUID();
		await fixture.pool.query(
			"insert into payroll_access_grant(id,organization_id,payroll_employee_id,scope,created_by,updated_at) values($1,$2,$3,'specific',$4,now())",
			[grant, fixture.organizationId, holder.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			"insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)",
			[fixture.organizationId, grant, covered.employeeId, fixture.ownerUserId],
		);
		caller.userId = holder.userId;
		caller.organizationId = fixture.organizationId;
	});
	afterAll(async () => {
		await fixture.close();
	});

	it("changes, reveals and ends the covered employee's bank account", async () => {
		await expect(
			changeEmployeeBankAccount({
				employeeId: covered.employeeId,
				validFrom: "2026-01-01",
				...ERIKA,
			}),
		).resolves.toMatchObject({ success: true, data: { replaced: false } });

		const revealed = await revealEmployeePersonalDetails({ employeeId: covered.employeeId });
		expect(revealed).toMatchObject({
			success: true,
			data: { viewer: { mayChange: true, revealed: true } },
		});
		expect(revealed.success && revealed.data.bankAccount.history[0]?.value?.iban).toBe(ERIKA.iban);

		await expect(
			endEmployeeBankAccount({ employeeId: covered.employeeId, validFrom: "2026-03-01" }),
		).resolves.toMatchObject({ success: true, data: { replaced: false } });
	});

	it("refuses every action on an employee the grant does not cover", async () => {
		for (const result of [
			await changeEmployeeBankAccount({
				employeeId: uncovered.employeeId,
				validFrom: "2026-01-01",
				...ERIKA,
			}),
			await revealEmployeePersonalDetails({ employeeId: uncovered.employeeId }),
			await endEmployeeBankAccount({ employeeId: uncovered.employeeId, validFrom: "2026-03-01" }),
		]) {
			expect(result.success).toBe(false);
		}
	});
});
