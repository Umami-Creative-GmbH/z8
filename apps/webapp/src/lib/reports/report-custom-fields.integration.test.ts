/**
 * #820: the employee report carries the employee's custom fields on PostgreSQL:
 * the active fields the requester's base role sees, in order, with values as
 * of the report period's last day. Only the schedule-based expected hours are stubbed.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/effect/runtime", () => ({
	runtime: {
		runPromise: async () => ({ totalMinutes: 0, workDays: 0, scheduleInfo: null }),
	},
}));
vi.mock("@/lib/time-tracking/calculations", () => ({
	calculateExpectedWorkHoursForEmployee: () => null,
}));

const { db } = await import("@/db");
const { changeCustomFields } = await import("@/lib/organization/custom-fields/definitions");
const { writeCustomFieldValues } = await import("@/lib/organization/custom-fields/values");
const { generateEmployeeReport } = await import("./report-generator");

const ids = {
	organization: "t820r-org",
	other: "t820r-other-org",
	admin: "t820r-admin",
	manager: "t820r-manager",
	worker: "t820r-worker",
	otherOwner: "t820r-other-owner",
} as const;
const users = [ids.admin, ids.manager, ids.worker, ids.otherOwner];

describe("employee report custom fields on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let workerEmployeeId: string;

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function define(
		organizationId: string,
		change: Record<string, unknown>,
	): Promise<{ id: string; options: { id: string; label: string }[] }> {
		const outcome = await changeCustomFields(db, {
			organizationId,
			actorUserId: organizationId === ids.other ? ids.otherOwner : ids.admin,
			change: {
				kind: "create",
				entity: "employee",
				type: "text",
				required: false,
				tracked: false,
				visibility: "manager",
				editLevel: "manager",
				...change,
			},
		});
		if (!outcome.ok) throw new Error(`define refused: ${outcome.reason}`);
		const field = outcome.fields.find((f) => f.name === change.name && !f.archived);
		if (!field) throw new Error("field missing");
		return field;
	}

	async function write(values: Record<string, unknown>) {
		await db.transaction((tx) =>
			writeCustomFieldValues(tx, {
				organizationId: ids.organization,
				actorUserId: ids.admin,
				level: "admin",
				entity: "employee",
				recordId: workerEmployeeId,
				values,
				requireComplete: false,
			}),
		);
	}

	function report(requester: string, endDate = "2026-03-31") {
		return generateEmployeeReport(
			workerEmployeeId,
			ids.organization,
			new Date("2026-03-01T00:00:00Z"),
			new Date(`${endDate}T23:59:59Z`),
			{ startDate: "2026-03-01", endDate, timezone: "UTC" },
			{ customFieldViewer: { kind: "actor", userId: requester } },
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T820R', $1, 'UTC', now()), ($2, 'T820R other', $2, 'UTC', now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t820r-m-admin', $1, $3, 'admin', 'approved', now()),
			 ('t820r-m-manager', $1, $4, 'member', 'approved', now()),
			 ('t820r-m-worker', $1, $5, 'member', 'approved', now()),
			 ('t820r-m-other', $2, $6, 'owner', 'approved', now())`,
			[ids.organization, ids.other, ids.admin, ids.manager, ids.worker, ids.otherOwner],
		);
		const { rows } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, role, is_active, updated_at) values
			 ($1, $4, 'manager', true, now()),
			 ($2, $4, 'employee', true, now()),
			 ($3, $5, 'admin', true, now())
			 returning id, user_id`,
			[ids.manager, ids.worker, ids.otherOwner, ids.organization, ids.other],
		);
		workerEmployeeId = rows.find((row) => row.user_id === ids.worker)!.id;
	});
	afterAll(cleanup);

	it("shows the fields the requester sees, in order, and leaves out archived and other organizations' fields", async () => {
		const salaryBand = await define(ids.organization, {
			name: "Salary band",
			visibility: "admin",
			editLevel: "admin",
		});
		const badge = await define(ids.organization, { name: "Badge", visibility: "employee" });
		const union = await define(ids.organization, { name: "Union member", type: "boolean" });
		const tier = await define(ids.organization, {
			name: "Tier",
			type: "select",
			options: ["Gold", "Silver"],
		});
		const retired = await define(ids.organization, { name: "Retired field" });
		await define(ids.other, { name: "Foreign field", visibility: "employee" });
		await write({
			[salaryBand.id]: "B2",
			[badge.id]: "42",
			[union.id]: true,
			[tier.id]: tier.options[1].id,
			[retired.id]: "gone",
		});
		const archived = await changeCustomFields(db, {
			organizationId: ids.organization,
			actorUserId: ids.admin,
			change: { kind: "archive", fieldId: retired.id },
		});
		expect(archived.ok).toBe(true);

		expect((await report(ids.admin)).employee.customFields).toEqual([
			{ fieldId: salaryBand.id, name: "Salary band", type: "text", value: "B2" },
			{ fieldId: badge.id, name: "Badge", type: "text", value: "42" },
			{ fieldId: union.id, name: "Union member", type: "boolean", value: true },
			{ fieldId: tier.id, name: "Tier", type: "select", value: "Silver" },
		]);
		// A manager never sees admin-only fields; an employee only employee-visible ones.
		expect((await report(ids.manager)).employee.customFields.map((field) => field.name)).toEqual([
			"Badge",
			"Union member",
			"Tier",
		]);
		expect((await report(ids.worker)).employee.customFields.map((field) => field.name)).toEqual([
			"Badge",
		]);
		// Another organization's owner is no member here and sees nothing.
		expect((await report(ids.otherOwner)).employee.customFields).toEqual([]);
	});

	it("lists a visible field without a value as empty", async () => {
		const badge = await define(ids.organization, { name: "Badge" });

		expect((await report(ids.admin)).employee.customFields).toEqual([
			{ fieldId: badge.id, name: "Badge", type: "text", value: null },
		]);
	});

	it("reads a tracked value as of the period's last day", async () => {
		const grade = await define(ids.organization, { name: "Grade", tracked: true });
		// The tracked value's history (#819): "G1" from March 1st, "G2" from March 15th.
		await write({
			[grade.id]: {
				history: [
					{ op: "add", validFrom: "2026-03-01", value: "G1" },
					{ op: "add", validFrom: "2026-03-15", value: "G2" },
				],
			},
		});

		expect((await report(ids.admin, "2026-03-10")).employee.customFields[0]?.value).toBe("G1");
		expect((await report(ids.admin, "2026-03-31")).employee.customFields[0]?.value).toBe("G2");
	});
});
