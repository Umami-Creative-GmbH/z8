import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { installEmployeeDepartureAccess } from "@/db/install-employee-departure-access";
import {
	integrationAdminPool,
	openIntegrationPool,
} from "@/test/integration-database";

const databaseName = `approval_workflow_repository_test_departure_${randomBytes(6).toString("hex")}`;
let pool: Pool;
let created = false;
const targetId = "00000000-0000-0000-0000-000000000001";
const ownerId = "00000000-0000-0000-0000-000000000002";
const at = "2026-10-16T13:00:00Z";

beforeAll(async () => {
	await integrationAdminPool().query(`CREATE DATABASE "${databaseName}"`);
	created = true;
	pool = openIntegrationPool({ databaseName });
	// A schema-pushed database has the tables, but none of migration 0072's functions.
	await pool.query(`
		CREATE TABLE public.member (organization_id text, user_id text, status text, role text);
		CREATE TABLE public.employee (id uuid, organization_id text, user_id text, is_active boolean);
		CREATE TABLE public.employee_departure (
			organization_id text, employee_id uuid, status text, cutoff_at timestamptz, created_by text
		);
		INSERT INTO public.member VALUES ('org-a', 'owner', 'approved', 'owner'),
			('org-a', 'target', 'approved', 'employee');
		INSERT INTO public.employee VALUES ('${targetId}', 'org-a', 'target', true),
			('${ownerId}', 'org-a', 'owner', true);
		INSERT INTO public.employee_departure VALUES
			('org-a', '${targetId}', 'pending', '${at}', 'owner'),
			('org-a', '${ownerId}', 'pending', '${at}', 'owner');
	`);
});

afterAll(async () => {
	if (pool) await pool.end();
	if (created)
		await integrationAdminPool().query(
			`DROP DATABASE "${databaseName}" WITH (FORCE)`,
		);
});

const denied = async (
	organizationId: string,
	employeeId: string,
	instant = at,
) => {
	const result = await pool.query<{ denied: boolean }>(
		"SELECT employee_departure_denies_access($1::text, $2::uuid, $3::timestamptz) AS denied",
		[organizationId, employeeId, instant],
	);
	return result.rows[0]?.denied;
};

it("repairs the setup query after schema push and safely repeats without changing access rules", async () => {
	await expect(denied("org-a", targetId)).rejects.toMatchObject({
		code: "42883",
		message:
			"function employee_departure_denies_access(text, uuid, timestamp with time zone) does not exist",
	});
	await installEmployeeDepartureAccess(pool);
	await installEmployeeDepartureAccess(pool);
	expect(await denied("org-a", targetId)).toBe(true);
	expect(await denied("org-b", targetId)).toBe(false);
	expect(await denied("org-a", targetId, "2026-10-16T12:59:59Z")).toBe(false);
	// The final accessible owner must remain admitted, even at their departure cutoff.
	expect(await denied("org-a", ownerId)).toBe(false);
	await pool.query(
		"UPDATE member SET status = 'pending' WHERE user_id = 'owner'",
	);
	expect(await denied("org-a", targetId)).toBe(false);
	await pool.query(
		"UPDATE member SET status = 'approved' WHERE user_id = 'owner'",
	);
	await pool.query("UPDATE employee_departure SET status = 'cancelled'");
	expect(await denied("org-a", targetId)).toBe(false);
	// Installing routines must not claim that the full SQL migration chain ran.
	expect(
		(
			await pool.query(
				"SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger",
			)
		).rows,
	).toEqual([{ ledger: null }]);
});

it("rolls back both functions if a required table is missing", async () => {
	await pool.query(`
		DROP FUNCTION public.employee_departure_denies_access(text, uuid, timestamptz);
		DROP FUNCTION public.employee_departure_blocked_reason(text, text, text);
		ALTER TABLE public.employee_departure RENAME TO missing_departure;
	`);
	await expect(installEmployeeDepartureAccess(pool)).rejects.toMatchObject({
		code: "42P01",
	});
	expect(
		(
			await pool.query(`SELECT
		to_regprocedure('public.employee_departure_blocked_reason(text,text,text)') AS blocked,
		to_regprocedure('public.employee_departure_denies_access(text,uuid,timestamptz)') AS denied
	`)
		).rows,
	).toEqual([{ blocked: null, denied: null }]);
});
