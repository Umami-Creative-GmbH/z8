/** #763 slice 5: GET /api/v1/absences and the health scope on PostgreSQL. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { callPublicApi, createTestKey, walkPublicApi } from "../testing/public-api-fixture";
import { listAbsences } from "./absences";

const ids = {
	organization: "t763a-org",
	other: "t763a-other-org",
	admin: "t763a-admin",
	ana: "t763a-ana",
	otto: "t763a-otto",
} as const;
const users = [ids.admin, ids.ana, ids.otto];
const october = "?from=2026-10-01&to=2026-10-31";

describe("absences in the Public API", () => {
	const admin = integrationAdminPool();
	const absences: Record<string, string> = {};
	const categories: Record<string, string> = {};
	let plainKey: string;
	let healthKey: string;

	async function cleanup() {
		await admin.query(
			"delete from absence_entry where employee_id in (select id from employee where organization_id = any($1::text[]))",
			[[ids.organization, ids.other]],
		);
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T763A', $1, now()), ($2, 'T763A other', $2, now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		const { rows: employees } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, role, is_active, updated_at) values
			 ($1, $3, 'employee', true, now()), ($2, $4, 'employee', true, now())
			 returning id, user_id`,
			[ids.ana, ids.otto, ids.organization, ids.other],
		);
		const ana = employees.find((row) => row.user_id === ids.ana)?.id as string;
		const otto = employees.find((row) => row.user_id === ids.otto)?.id as string;
		const { rows: categoryRows } = await admin.query<{ id: string; name: string }>(
			`insert into absence_category (organization_id, type, name, updated_at) values
			 ($1, 'vacation', 'Vacation', now()), ($1, 'sick', 'Sick leave', now()),
			 ($2, 'vacation', 'Other vacation', now())
			 returning id, name`,
			[ids.organization, ids.other],
		);
		for (const row of categoryRows) categories[row.name] = row.id;

		const absence = async (
			name: string,
			input: {
				employeeId?: string;
				category: string;
				start: string;
				end: string;
				status: string;
				startPeriod?: string;
				endPeriod?: string;
				sickDetail?: string;
			},
		) => {
			const { rows } = await admin.query<{ id: string }>(
				`insert into absence_entry (employee_id, category_id, start_date, start_period, end_date,
				   end_period, status, sick_detail, notes, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, 'private note', now()) returning id`,
				[
					input.employeeId ?? ana,
					categories[input.category],
					input.start,
					input.startPeriod ?? "full_day",
					input.end,
					input.endPeriod ?? "full_day",
					input.status,
					input.sickDetail ?? null,
				],
			);
			absences[name] = rows[0].id;
		};
		await absence("vacation", {
			category: "Vacation",
			start: "2026-10-05",
			end: "2026-10-09",
			status: "approved",
			endPeriod: "am",
		});
		await absence("sick", {
			category: "Sick leave",
			start: "2026-10-12",
			end: "2026-10-13",
			status: "approved",
			sickDetail: "with_certificate",
		});
		await absence("pending", {
			category: "Vacation",
			start: "2026-10-28",
			end: "2026-11-03",
			status: "pending",
		});
		await absence("overlapsStart", {
			category: "Vacation",
			start: "2026-09-28",
			end: "2026-10-01",
			status: "approved",
		});
		await absence("rejected", {
			category: "Vacation",
			start: "2026-10-20",
			end: "2026-10-21",
			status: "rejected",
		});
		await absence("september", {
			category: "Vacation",
			start: "2026-09-01",
			end: "2026-09-30",
			status: "approved",
		});
		await absence("foreign", {
			employeeId: otto,
			category: "Other vacation",
			start: "2026-10-05",
			end: "2026-10-06",
			status: "approved",
		});
		plainKey = await createTestKey(ids.organization, ids.admin, ["absences:read"]);
		healthKey = await createTestKey(ids.organization, ids.admin, [
			"absences:read",
			"absences:read-health",
		]);
	});
	afterAll(cleanup);

	it("returns approved and pending absences overlapping the range, as local dates", async () => {
		const rows = await walkPublicApi(listAbsences, plainKey, october);
		expect(rows.map((row) => row.id)).toEqual([
			absences.overlapsStart,
			absences.vacation,
			absences.sick,
			absences.pending,
		]);
		expect(rows[1]).toEqual({
			id: absences.vacation,
			employeeId: expect.any(String),
			status: "approved",
			startDate: "2026-10-05",
			startPeriod: "full_day",
			endDate: "2026-10-09",
			endPeriod: "am",
			type: "vacation",
			category: { id: categories.Vacation, name: "Vacation" },
			sickDetail: null,
		});
		expect(rows[3]).toMatchObject({ status: "pending", endDate: "2026-11-03" });
		expect(JSON.stringify(rows)).not.toContain("private note");
		expect(
			(await walkPublicApi(listAbsences, plainKey, `${october}&status=pending`)).map(
				(row) => row.id,
			),
		).toEqual([absences.pending]);
	});

	it("hides health detail without the health scope", async () => {
		const [plain] = (await walkPublicApi(listAbsences, plainKey, october)).filter(
			(row) => row.id === absences.sick,
		);
		expect(plain).toMatchObject({ type: "absent", category: null, sickDetail: null });
		expect(JSON.stringify(plain)).not.toMatch(/Sick leave|certificate/);

		const [health] = (await walkPublicApi(listAbsences, healthKey, october)).filter(
			(row) => row.id === absences.sick,
		);
		expect(health).toMatchObject({
			type: "sick",
			category: { id: categories["Sick leave"], name: "Sick leave" },
			sickDetail: "with_certificate",
		});
	});

	it("walks the cursor over every absence once", async () => {
		const rows = await walkPublicApi(listAbsences, plainKey, october, 1);
		expect(rows).toHaveLength(4);
		expect(new Set(rows.map((row) => row.id)).size).toBe(4);
	});

	it("needs absences:read, and a from/to range of at most 366 days", async () => {
		const healthOnly = await createTestKey(ids.organization, ids.admin, ["absences:read-health"]);
		expect((await callPublicApi(listAbsences, healthOnly, october)).status).toBe(403);
		for (const query of [
			"",
			"?from=2026-10-01",
			"?from=2026-01-01&to=2027-01-03",
			"?from=2026-10-31&to=2026-10-01",
			"?from=2026-10-01T00:00:00Z&to=2026-10-31",
		]) {
			const { status, body } = await callPublicApi(listAbsences, plainKey, query);
			expect(status, query).toBe(400);
			expect(body.type).toBe("validation_failed");
		}
	});
});
