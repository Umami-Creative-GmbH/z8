/**
 * #1197: an invitation draft follows the personnel number rule of #1196. Saving
 * a draft refuses a number held by an employee of the organization (current or
 * former) or by another pending draft there, with the employee form's field
 * error naming the holder. The real server action runs against a disposable
 * database; only the request/session, SSO session store, Next cache,
 * translations and logger are replaced.
 */
import { randomUUID } from "node:crypto";
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

const { updateEmployeeInvitationDraftAction } = await import(
	"./employee-mutations.actions"
);

function takenBy(name: string) {
	return {
		success: false,
		code: "ValidationError",
		refusal: "personnel_number_taken",
		error: `This personnel number belongs to ${name}. Every employee, current or former, needs their own number.`,
	};
}

describe("personnel number uniqueness of invitation drafts on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let holderId: string;
	let draftId: string;

	async function seedDraft(input: {
		organizationId: string;
		firstName?: string;
		lastName?: string;
		employeeNumber?: string | null;
		status?: "pending" | "canceled";
	}) {
		const invitationId = randomUUID();
		const email = `${invitationId}@invitee.test`;
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $3, 'member', $4, now() + interval '7 days', $5)`,
			[
				invitationId,
				input.organizationId,
				email,
				input.status ?? "pending",
				fixture.ownerUserId,
			],
		);
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_invitation_draft
			   (invitation_id, organization_id, normalized_email, first_name, last_name, employee_number)
			 values ($1, $2, $3, $4, $5, $6)
			 returning id`,
			[
				invitationId,
				input.organizationId,
				email,
				input.firstName ?? null,
				input.lastName ?? null,
				input.employeeNumber ?? null,
			],
		);
		return rows[0]?.id as string;
	}

	async function draftNumberOf(id: string) {
		const { rows } = await fixture.pool.query<{
			employee_number: string | null;
		}>("select employee_number from employee_invitation_draft where id = $1", [
			id,
		]);
		return rows[0]?.employee_number;
	}

	function save(employeeNumber: string) {
		return updateEmployeeInvitationDraftAction(`draft:${draftId}`, {
			employeeNumber,
		});
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
			"update employee set employee_number = null where organization_id = $1",
			[fixture.organizationId],
		);
		await fixture.pool.query(
			"delete from invitation where organization_id = $1",
			[fixture.organizationId],
		);
		draftId = await seedDraft({ organizationId: fixture.organizationId });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("refuses a number an employee holds, ignoring case and surrounding spaces", async () => {
		await fixture.pool.query(
			"update employee set employee_number = 'E-42' where id = $1",
			[holderId],
		);

		await expect(save("  e-42 ")).resolves.toEqual(takenBy("Ada Holder"));
		expect(await draftNumberOf(draftId)).toBeNull();
	});

	it("refuses the number of a former employee", async () => {
		const former = await fixture.seedEmployee({
			isActive: false,
			withPeriod: false,
		});
		await fixture.pool.query(
			`update "user" set name = 'Fred Former' where id = $1`,
			[former.userId],
		);
		await fixture.pool.query(
			"update employee set employee_number = 'F-7' where id = $1",
			[former.employeeId],
		);

		await expect(save("F-7")).resolves.toEqual(takenBy("Fred Former"));
	});

	it("refuses a number another pending draft holds", async () => {
		await seedDraft({
			organizationId: fixture.organizationId,
			firstName: "Grace",
			lastName: "Hopper",
			employeeNumber: "D-1",
		});

		await expect(save("d-1")).resolves.toEqual(takenBy("Grace Hopper"));
		expect(await draftNumberOf(draftId)).toBeNull();
	});

	it("allows a number held only by a draft whose invitation is no longer pending", async () => {
		await seedDraft({
			organizationId: fixture.organizationId,
			employeeNumber: "D-2",
			status: "canceled",
		});

		await expect(save("D-2")).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(await draftNumberOf(draftId)).toBe("D-2");
	});

	it("allows the same number on a draft and an employee in another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const stranger = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
		});
		await fixture.pool.query(
			"update employee set employee_number = 'X-1' where id = $1",
			[stranger.employeeId],
		);
		await seedDraft({
			organizationId: otherOrganizationId,
			employeeNumber: "X-1",
		});

		await expect(save("X-1")).resolves.toMatchObject({ success: true });
		expect(await draftNumberOf(draftId)).toBe("X-1");
	});

	it("saves a draft whose own number is unchanged", async () => {
		await fixture.pool.query(
			"update employee_invitation_draft set employee_number = 'S-1' where id = $1",
			[draftId],
		);

		await expect(
			updateEmployeeInvitationDraftAction(`draft:${draftId}`, {
				employeeNumber: "S-1",
				position: "Lead",
			}),
		).resolves.toMatchObject({ success: true });
		expect(await draftNumberOf(draftId)).toBe("S-1");
	});

	it("saves other fields of a draft whose unchanged number an employee took since", async () => {
		await fixture.pool.query(
			"update employee_invitation_draft set employee_number = 'S-3' where id = $1",
			[draftId],
		);
		await fixture.pool.query(
			"update employee set employee_number = 'S-3' where id = $1",
			[holderId],
		);

		await expect(
			updateEmployeeInvitationDraftAction(`draft:${draftId}`, {
				employeeNumber: " s-3",
				position: "Lead",
			}),
		).resolves.toMatchObject({ success: true });
	});

	it("lets exactly one of two concurrent draft saves of one number succeed", async () => {
		const otherDraftId = await seedDraft({
			organizationId: fixture.organizationId,
			firstName: "Grace",
			lastName: "Hopper",
		});

		for (let round = 1; round <= 5; round += 1) {
			const number = `C-${round}`;
			const results = await Promise.all([
				updateEmployeeInvitationDraftAction(`draft:${draftId}`, {
					employeeNumber: number,
				}),
				updateEmployeeInvitationDraftAction(`draft:${otherDraftId}`, {
					employeeNumber: number.toLowerCase(),
				}),
			]);

			expect(results.filter((result) => result.success)).toHaveLength(1);
			expect(results.filter((result) => !result.success)).toEqual([
				expect.objectContaining({
					code: "ValidationError",
					refusal: "personnel_number_taken",
				}),
			]);
		}
	});

	it("stores an empty number as none", async () => {
		await fixture.pool.query(
			"update employee_invitation_draft set employee_number = 'S-2' where id = $1",
			[draftId],
		);

		await expect(save("  ")).resolves.toMatchObject({ success: true });
		expect(await draftNumberOf(draftId)).toBeNull();
	});
});
