/**
 * #1012: what a viewer sees of absence deputies, against PostgreSQL: the
 * "Covering for" duties of the signed-in deputy (organization-scoped, approved
 * only, the absent employee's timezone) and whether a deputy's name links to
 * their profile.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("server-only", () => ({}));

const { db } = await import("@/db");
const { loadCoverDuties, loadDeputyDisplays, loadDeputyViewer } = await import(
	"./deputy-display-store"
);

const ORG = "t1012-org";
const OTHER_ORG = "t1012-other-org";
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
// 11:30 UTC on 10 Oct: already 11 Oct in Kiritimati.
const NOW = Temporal.Instant.from("2026-10-10T11:30:00Z");

const ids = {
	owner: "e1012000-0000-4000-8000-000000000001",
	manager: "e1012000-0000-4000-8000-000000000002",
	anna: "e1012000-0000-4000-8000-000000000003",
	ben: "e1012000-0000-4000-8000-000000000004",
	carla: "e1012000-0000-4000-8000-000000000005",
	dora: "e1012000-0000-4000-8000-000000000006",
	leaver: "e1012000-0000-4000-8000-000000000007",
	benElsewhere: "e1012000-0000-4000-8000-000000000008",
	outsider: "e1012000-0000-4000-8000-000000000009",
	vacation: "e1012100-0000-4000-8000-000000000001",
	otherVacation: "e1012100-0000-4000-8000-000000000002",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1012-%"]);
}

async function seedUser(userId: string, name: string, timezone: string | null) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userId, name, `${userId}@example.test`, SEEDED_AT],
	);
	if (timezone) {
		await admin.query(
			"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', $2, '24h', $3)",
			[userId, timezone, SEEDED_AT],
		);
	}
}

async function seedEmployee(input: {
	id: string;
	userId: string;
	organizationId?: string;
	memberRole?: string;
	role?: string;
	isActive?: boolean;
}) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[
			`t1012-member-${input.id}`,
			organizationId,
			input.userId,
			input.memberRole ?? "member",
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,$5,$6)",
		[
			input.id,
			input.userId,
			organizationId,
			input.role ?? "employee",
			input.isActive ?? true,
			SEEDED_AT,
		],
	);
}

async function seedAbsence(input: {
	employeeId: string;
	deputyEmployeeId: string | null;
	startDate: string;
	endDate: string;
	status?: string;
	organizationId?: string;
	categoryId?: string;
	sickDetail?: string;
}): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into absence_entry
		 (employee_id, organization_id, category_id, start_date, end_date, status, deputy_employee_id,
		  notes, sick_detail, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, 'private note', $8, $9) returning id`,
		[
			input.employeeId,
			input.organizationId ?? ORG,
			input.categoryId ?? ids.vacation,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			input.deputyEmployeeId,
			input.sickDetail ?? null,
			SEEDED_AT,
		],
	);
	const [row] = rows;
	if (!row) throw new Error("absence not inserted");
	return row.id;
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', $3), ($2, $2, $2, 'UTC', $3)`,
		[ORG, OTHER_ORG, SEEDED_AT],
	);
	await seedUser("t1012-owner", "Olga Owner", "UTC");
	await seedUser("t1012-manager", "Mia Manager", "UTC");
	await seedUser("t1012-anna", "Anna Example", "America/Los_Angeles");
	await seedUser("t1012-ben", "Ben Example", "UTC");
	await seedUser("t1012-carla", "Carla Example", "Pacific/Kiritimati");
	await seedUser("t1012-dora", "Dora Example", null);
	await seedUser("t1012-leaver", "Lea Leaver", "UTC");
	await seedUser("t1012-outsider", "Oscar Outsider", "UTC");
	await seedEmployee({ id: ids.owner, userId: "t1012-owner", memberRole: "owner", role: "admin" });
	await seedEmployee({ id: ids.manager, userId: "t1012-manager", role: "manager" });
	await seedEmployee({ id: ids.anna, userId: "t1012-anna" });
	await seedEmployee({ id: ids.ben, userId: "t1012-ben" });
	await seedEmployee({ id: ids.carla, userId: "t1012-carla" });
	await seedEmployee({ id: ids.dora, userId: "t1012-dora" });
	await seedEmployee({ id: ids.leaver, userId: "t1012-leaver", isActive: false });
	// Ben also works for another organization.
	await seedEmployee({ id: ids.benElsewhere, userId: "t1012-ben", organizationId: OTHER_ORG });
	await seedEmployee({ id: ids.outsider, userId: "t1012-outsider", organizationId: OTHER_ORG });
	await admin.query(
		`insert into employee_managers
		 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't1012-owner', $3, $3)`,
		[ids.anna, ids.manager, SEEDED_AT],
	);
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $3, 'vacation', 'Vacation', true, false, true, $5),
		        ($2, $4, 'vacation', 'Other vacation', true, false, true, $5)`,
		[ids.vacation, ids.otherVacation, ORG, OTHER_ORG, SEEDED_AT],
	);
}

describe("deputy display store on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(seed);
	afterAll(cleanup);

	async function viewerOf(userId: string, organizationId = ORG) {
		const viewer = await loadDeputyViewer(db, { organizationId, userId });
		if (!viewer) throw new Error(`no viewer for ${userId}`);
		return viewer;
	}

	it("lists the signed-in deputy's running and upcoming approved cover in their organization", async () => {
		const annaRunning = await seedAbsence({
			employeeId: ids.anna,
			deputyEmployeeId: ids.ben,
			startDate: "2026-10-08",
			endDate: "2026-10-10",
		});
		const carlaUpcoming = await seedAbsence({
			employeeId: ids.carla,
			deputyEmployeeId: ids.ben,
			startDate: "2026-10-20",
			endDate: "2026-10-22",
		});
		await seedAbsence({
			employeeId: ids.dora,
			deputyEmployeeId: ids.ben,
			startDate: "2026-10-09",
			endDate: "2026-10-12",
			status: "pending",
		});
		await seedAbsence({
			employeeId: ids.dora,
			deputyEmployeeId: ids.carla,
			startDate: "2026-10-13",
			endDate: "2026-10-14",
		});
		// Ben's cover in the other organization stays there.
		await seedAbsence({
			employeeId: ids.outsider,
			deputyEmployeeId: ids.benElsewhere,
			organizationId: OTHER_ORG,
			categoryId: ids.otherVacation,
			startDate: "2026-10-09",
			endDate: "2026-10-12",
		});

		const duties = await loadCoverDuties(db, {
			organizationId: ORG,
			viewer: await viewerOf("t1012-ben"),
			now: NOW,
		});

		expect(duties).toEqual({
			running: [
				{
					absenceId: annaRunning,
					employeeId: ids.anna,
					employeeName: "Anna Example",
					startDate: "2026-10-08",
					endDate: "2026-10-10",
					category: null,
				},
			],
			upcoming: [
				{
					absenceId: carlaUpcoming,
					employeeId: ids.carla,
					employeeName: "Carla Example",
					startDate: "2026-10-20",
					endDate: "2026-10-22",
					category: null,
				},
			],
		});
	});

	it("uses each absent employee's own timezone for running cover", async () => {
		// 10 Oct ended in Kiritimati (Carla) but still runs in Los Angeles (Anna).
		const anna = await seedAbsence({
			employeeId: ids.anna,
			deputyEmployeeId: ids.dora,
			startDate: "2026-10-10",
			endDate: "2026-10-10",
		});
		await seedAbsence({
			employeeId: ids.carla,
			deputyEmployeeId: ids.dora,
			startDate: "2026-10-10",
			endDate: "2026-10-10",
		});

		const duties = await loadCoverDuties(db, {
			organizationId: ORG,
			viewer: await viewerOf("t1012-dora"),
			now: NOW,
		});

		expect(duties.running.map((duty) => duty.absenceId)).toEqual([anna]);
		expect(duties.upcoming).toEqual([]);
	});

	it("shows the category to a deputy who manages the absent employee, never sick details", async () => {
		await seedAbsence({
			employeeId: ids.anna,
			deputyEmployeeId: ids.manager,
			startDate: "2026-10-09",
			endDate: "2026-10-12",
			sickDetail: "with_certificate",
		});

		const duties = await loadCoverDuties(db, {
			organizationId: ORG,
			viewer: await viewerOf("t1012-manager"),
			now: NOW,
		});

		expect(duties.running).toHaveLength(1);
		expect(duties.running[0]).toMatchObject({ category: { name: "Vacation" } });
		expect(JSON.stringify(duties)).not.toMatch(/certificate|private note/);
	});

	it("has no viewer for an inactive employee or one outside the organization", async () => {
		expect(await loadDeputyViewer(db, { organizationId: ORG, userId: "t1012-leaver" })).toBeNull();
		expect(
			await loadDeputyViewer(db, { organizationId: ORG, userId: "t1012-outsider" }),
		).toBeNull();
	});

	it("names deputies of the organization and links them for admins and their managers", async () => {
		const deputies = [ids.anna, ids.ben, ids.outsider];

		const byOwner = await loadDeputyDisplays(db, {
			organizationId: ORG,
			viewer: await viewerOf("t1012-owner"),
			deputyEmployeeIds: deputies,
		});
		expect([...byOwner.values()]).toEqual(
			expect.arrayContaining([
				{ id: ids.anna, name: "Anna Example", canOpenProfile: true },
				{ id: ids.ben, name: "Ben Example", canOpenProfile: true },
			]),
		);
		expect(byOwner.has(ids.outsider)).toBe(false);

		const byManager = await loadDeputyDisplays(db, {
			organizationId: ORG,
			viewer: await viewerOf("t1012-manager"),
			deputyEmployeeIds: deputies,
		});
		expect(byManager.get(ids.anna)?.canOpenProfile).toBe(true);
		expect(byManager.get(ids.ben)?.canOpenProfile).toBe(false);

		const byEmployee = await loadDeputyDisplays(db, {
			organizationId: ORG,
			viewer: await viewerOf("t1012-ben"),
			deputyEmployeeIds: deputies,
		});
		expect(byEmployee.get(ids.anna)).toEqual({
			id: ids.anna,
			name: "Anna Example",
			canOpenProfile: false,
		});
	});
});
