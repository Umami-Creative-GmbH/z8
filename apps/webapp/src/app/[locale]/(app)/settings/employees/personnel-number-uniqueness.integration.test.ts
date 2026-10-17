/**
 * #1196: no two employees of an organization, current or former, share a
 * personnel number. The employee save refuses a taken number with a field
 * error naming its holder, also when a concurrent save wins the race. The real
 * server action runs against a disposable database; only the request/session,
 * SSO session store, Next cache, translations and logger are replaced.
 */
import type { PoolClient } from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock(
	"@/lib/organization-mfa/organization-access",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/organization-mfa/organization-access")
		>()),
		canAccessOrganization: async () => true,
	}),
);

vi.mock("@/tolgee/server", async () => ({
	getTranslate: async () =>
		(await import("@/lib/organization/custom-fields/refusal-messages"))
			.englishDefaults,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		}),
	}),
}));

const { updateEmployeeAction } = await import("./employee-mutations.actions");

const TAKEN = {
	success: false,
	code: "ValidationError",
	refusal: "personnel_number_taken",
	error:
		"This personnel number belongs to Ada Holder. Every employee, current or former, needs their own number.",
};

describe("personnel number uniqueness on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let holderId: string;

	async function setNumber(employeeId: string, employeeNumber: string | null) {
		await fixture.pool.query(
			"update employee set employee_number = $2 where id = $1",
			[employeeId, employeeNumber],
		);
	}

	async function numberOf(employeeId: string) {
		const { rows } = await fixture.pool.query<{
			employee_number: string | null;
		}>("select employee_number from employee where id = $1", [employeeId]);
		return rows[0]?.employee_number;
	}

	function save(employeeId: string, employeeNumber: string) {
		return updateEmployeeAction(employeeId, { employeeNumber });
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const holder = await fixture.seedEmployee();
		holderId = holder.employeeId;
		await fixture.pool.query(
			`update "user" set name = 'Ada Holder' where id = $1`,
			[holder.userId],
		);
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
	});

	beforeEach(async () => {
		await fixture.pool.query(
			"update employee set employee_number = null, personnel_number_managed_by_scim = false, is_active = true where organization_id = $1",
			[fixture.organizationId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("refuses local changes to an IdP-owned number while allowing unrelated saves", async () => {
		await fixture.pool.query(
			"update employee set employee_number = 'IDP-7', personnel_number_managed_by_scim = true where id = $1",
			[fixture.employeeId],
		);
		for (const employeeNumber of ["LOCAL-1", ""]) {
			await expect(
				save(fixture.employeeId, employeeNumber),
			).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: "personnel_number_managed_by_idp",
			});
		}
		await expect(
			updateEmployeeAction(fixture.employeeId, {
				position: "Lead",
				employeeNumber: "IDP-7",
			}),
		).resolves.toMatchObject({ success: true });
		await expect(
			updateEmployeeAction(fixture.employeeId, { position: "Director" }),
		).resolves.toMatchObject({ success: true });
		expect(await numberOf(fixture.employeeId)).toBe("IDP-7");
	});
	it("refuses a number another employee holds, ignoring case and surrounding spaces", async () => {
		await setNumber(holderId, "E-42");

		await expect(save(fixture.employeeId, "  e-42 ")).resolves.toEqual(TAKEN);
		expect(await numberOf(fixture.employeeId)).toBeNull();
	});

	it("refuses the number of a former employee", async () => {
		const former = await fixture.seedEmployee({
			isActive: false,
			withPeriod: false,
		});
		await fixture.pool.query(
			`update "user" set name = 'Ada Holder' where id = $1`,
			[former.userId],
		);
		await setNumber(former.employeeId, "F-7");

		await expect(save(fixture.employeeId, "F-7")).resolves.toEqual(TAKEN);
	});

	it("allows a number that differs only in leading zeros", async () => {
		await setNumber(holderId, "42");

		await expect(save(fixture.employeeId, "0042")).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(await numberOf(fixture.employeeId)).toBe("0042");
	});

	it("allows the same number in another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const stranger = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
		});
		await setNumber(stranger.employeeId, "E-42");

		await expect(save(fixture.employeeId, "E-42")).resolves.toMatchObject({
			success: true,
		});
	});

	it("saves an employee whose number is unchanged", async () => {
		await setNumber(fixture.employeeId, "E-42");

		await expect(
			updateEmployeeAction(fixture.employeeId, {
				employeeNumber: "E-42",
				position: "Lead",
			}),
		).resolves.toMatchObject({ success: true });
		expect(await numberOf(fixture.employeeId)).toBe("E-42");
	});

	it("stores an empty number as none, for several employees", async () => {
		await setNumber(fixture.employeeId, "E-1");
		await setNumber(holderId, "E-2");

		await expect(save(fixture.employeeId, "")).resolves.toMatchObject({
			success: true,
		});
		await expect(save(holderId, "   ")).resolves.toMatchObject({
			success: true,
		});
		expect([
			await numberOf(fixture.employeeId),
			await numberOf(holderId),
		]).toEqual([null, null]);
	});

	it("gives the save that loses a race on the unique index the same field error", async () => {
		// The holder's save is in flight: its number is written but not committed, so
		// the second save's check can't see it and its write waits on the index.
		const concurrent: PoolClient = await fixture.pool.connect();
		try {
			await concurrent.query("begin");
			await concurrent.query(
				"update employee set employee_number = 'R-1' where id = $1",
				[holderId],
			);

			const loser = save(fixture.employeeId, "r-1");
			await vi.waitFor(
				async () => {
					const { rows } = await fixture.pool.query(
						`select 1 from pg_stat_activity
						 where wait_event_type = 'Lock' and query ilike 'update "employee"%'`,
					);
					expect(rows).toHaveLength(1);
				},
				{ timeout: 20_000, interval: 50 },
			);
			await concurrent.query("commit");

			await expect(loser).resolves.toEqual(TAKEN);
		} finally {
			concurrent.release();
		}
		expect([
			await numberOf(holderId),
			await numberOf(fixture.employeeId),
		]).toEqual(["R-1", null]);
	});

	it("lets exactly one of two concurrent saves of one number succeed", async () => {
		const results = await Promise.all([
			save(holderId, "C-1"),
			save(fixture.employeeId, "c-1"),
		]);

		expect(results.filter((result) => result.success)).toHaveLength(1);
		expect(results.filter((result) => !result.success)).toEqual([
			expect.objectContaining({
				code: "ValidationError",
				refusal: "personnel_number_taken",
			}),
		]);
	});
});
