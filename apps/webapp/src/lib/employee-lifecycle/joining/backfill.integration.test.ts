/**
 * #1671 (spec #1664 decision 9): a one-time backfill joins every approved
 * member who has no employee, and never touches an existing employee.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => ({ ...quiet, child: () => quiet }) };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { backfillMembersWithoutEmployee } = await import("./backfill");
const { createLifecycleDatabaseFixture } = await import("../testing/database.test.fixture");
type LifecycleDatabaseFixture = import("../testing/database.test.fixture").LifecycleDatabaseFixture;

type MemberStatus = "approved" | "pending";

describe("backfilling members without an employee (#1671)", () => {
	let fixture: LifecycleDatabaseFixture;
	let otherOrganizationId: string;
	const userIds: string[] = [];

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		otherOrganizationId = await fixture.createOrganization();
	});
	afterAll(async () => {
		await fixture?.close();
		await fixture?.pool.query(`delete from "user" where id = any($1::text[])`, [userIds]);
	});

	/** A membership with no employee row, as the Better Auth paths could leave one. */
	async function memberWithoutEmployee(
		organizationId: string,
		role: "owner" | "admin" | "member",
		status: MemberStatus = "approved",
	) {
		const userId = randomUUID();
		const memberId = randomUUID();
		await fixture.pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, now(), now())`,
			[userId, `Missing ${role}`, `${userId}@backfill.test`],
		);
		userIds.push(userId);
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[memberId, organizationId, userId, role, status],
		);
		return { userId, memberId };
	}

	async function employeeRows(organizationIds: string[]) {
		const { rows } = await fixture.pool.query(
			`select * from employee where organization_id = any($1::text[]) order by id`,
			[organizationIds],
		);
		return rows;
	}

	async function approvedMembersWithoutEmployee(organizationIds: string[]) {
		const { rows } = await fixture.pool.query<{ user_id: string }>(
			`select m.user_id from member m
			 where m.organization_id = any($1::text[]) and m.status = 'approved'
			   and not exists (
			     select 1 from employee e
			     where e.user_id = m.user_id and e.organization_id = m.organization_id
			   )`,
			[organizationIds],
		);
		return rows.map((row) => row.user_id);
	}

	it("joins every approved member without an employee, once, and leaves every employee as it was", async () => {
		const organizationIds = [fixture.organizationId, otherOrganizationId];
		// An existing employee, switched off: the backfill must not switch them back on.
		const deactivated = await fixture.seedEmployee({ isActive: false });
		const admin = await memberWithoutEmployee(fixture.organizationId, "admin");
		const member = await memberWithoutEmployee(fixture.organizationId, "member");
		const elsewhere = await memberWithoutEmployee(otherOrganizationId, "owner");
		const pending = await memberWithoutEmployee(fixture.organizationId, "member", "pending");
		const before = await employeeRows(organizationIds);

		const dryRun = await backfillMembersWithoutEmployee(db, { organizationIds });

		expect(await employeeRows(organizationIds)).toEqual(before);
		expect(dryRun).toEqual([
			expect.objectContaining({
				organizationId: fixture.organizationId,
				mode: "dry_run",
				failed: [],
				members: expect.arrayContaining([
					expect.objectContaining({ userId: admin.userId, employeeId: null }),
					expect.objectContaining({ userId: member.userId, employeeId: null }),
				]),
			}),
			expect.objectContaining({
				organizationId: otherOrganizationId,
				members: [expect.objectContaining({ userId: elsewhere.userId })],
			}),
		]);
		expect(dryRun[0]?.members).toHaveLength(2);

		const applied = await backfillMembersWithoutEmployee(db, { organizationIds, apply: true });

		expect(applied.map((report) => [report.organizationId, report.members.length])).toEqual([
			[fixture.organizationId, 2],
			[otherOrganizationId, 1],
		]);
		expect(applied.flatMap((report) => report.failed)).toEqual([]);
		expect(await approvedMembersWithoutEmployee(organizationIds)).toEqual([]);
		// Every row that was there is unchanged; only the joined members are new.
		const after = await employeeRows(organizationIds);
		expect(after).toEqual(expect.arrayContaining(before));
		const joined = after.filter((row) => !before.some((old) => old.id === row.id));
		expect(
			joined
				.map((row) => [row.user_id, row.role, row.is_active])
				.sort(([a], [b]) => (a < b ? -1 : 1)),
		).toEqual(
			[
				[admin.userId, "admin", true],
				[member.userId, "employee", true],
				[elsewhere.userId, "admin", true],
			].sort(([a], [b]) => ((a as string) < (b as string) ? -1 : 1)),
		);
		expect(after.find((row) => row.id === deactivated.employeeId)).toMatchObject({
			is_active: false,
		});
		expect(after.some((row) => row.user_id === pending.userId)).toBe(false);

		const again = await backfillMembersWithoutEmployee(db, { organizationIds, apply: true });

		expect(again.flatMap((report) => report.members)).toEqual([]);
		expect(await employeeRows(organizationIds)).toEqual(after);
	});

	it("finds every organization with a member to join when none is named, and a dry run writes nothing", async () => {
		const member = await memberWithoutEmployee(otherOrganizationId, "member");

		const reports = await backfillMembersWithoutEmployee(db);

		expect(reports).toContainEqual(
			expect.objectContaining({
				organizationId: otherOrganizationId,
				mode: "dry_run",
				members: [expect.objectContaining({ userId: member.userId, employeeId: null })],
			}),
		);
		expect(await approvedMembersWithoutEmployee([otherOrganizationId])).toEqual([member.userId]);
	});
});
