import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
const { materializeMfaWindow, getOrganizationMfaRequirement } = await import(
	"./store"
);
const org = "t1310-mfa-org";
const person = "t1310-mfa-person";
const actor = { id: "t1310-mfa-session", userId: person };

describe("organization MFA durable membership lifecycle", () => {
	const pool = integrationAdminPool();
	async function cleanup() {
		await pool.query("DELETE FROM organization WHERE id=$1", [org]);
		await pool.query('DELETE FROM "user" WHERE id=$1', [person]);
		await pool.query('DELETE FROM "user" WHERE id=$1', [`${person}-owner`]);
	}
	beforeEach(async () => {
		await cleanup();
		await pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now())',
			[person, `${person}@example.test`],
		);
		await pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now()) ON CONFLICT DO NOTHING',
			[`${person}-owner`, `${person}-owner@example.test`],
		);
		await pool.query(
			"INSERT INTO organization(id,name,slug,created_at) VALUES ($1,$1,$1,now())",
			[org],
		);
		await pool.query(
			"INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES ($1,$2,$3,'owner','pending',now())",
			[`${person}-member`, person, org],
		);
		await pool.query(
			"INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES ($1,$2,$3,'owner','approved',now())",
			[`${person}-owner-member`, `${person}-owner`, org],
		);
		await pool.query(
			"INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES ($1,$2,$1,'2099-01-01',now(),now())",
			[actor.id, person],
		);
	});
	afterAll(cleanup);
	it("starts at approval and preserves the same deadline through edits, removal/re-add and re-enablement", async () => {
		await pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now()) ON CONFLICT DO NOTHING',
			[`${person}-owner`, `${person}-owner@example.test`],
		);
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,7,$2)",
			[org, person],
		);
		expect(await materializeMfaWindow(org, person)).toBeNull();
		await pool.query(
			"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		const first = await materializeMfaWindow(org, person);
		expect(first?.deadline).toBeTruthy();
		await pool.query(
			"UPDATE organization_mfa_policy SET enabled=false, grace_period_days=30 WHERE organization_id=$1",
			[org],
		);
		await pool.query(
			"UPDATE member SET role='member' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await pool.query(
			"DELETE FROM member WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await pool.query(
			"INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES ($1,$2,$3,'owner','approved',now())",
			[`${person}-readded`, person, org],
		);
		await pool.query(
			"UPDATE organization_mfa_policy SET enabled=true WHERE organization_id=$1",
			[org],
		);
		expect((await materializeMfaWindow(org, person))?.deadline).toBe(
			first?.deadline,
		);
	});
	it("denies an old password-only session immediately for a zero-day policy", async () => {
		await pool.query(
			"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now()) ON CONFLICT DO NOTHING',
			[`${person}-owner`, `${person}-owner@example.test`],
		);
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,0,$2)",
			[org, person],
		);
		expect(
			await getOrganizationMfaRequirement(actor, org, false),
		).toMatchObject({ allowed: false, reason: "MFA_REQUIRED" });
	});
	it("captures the first deadline when activation and membership approval race", async () => {
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,false,14,$2)",
			[org, person],
		);
		await Promise.all([
			pool.query(
				"UPDATE organization_mfa_policy SET enabled=true WHERE organization_id=$1",
				[org],
			),
			pool.query(
				"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
				[person, org],
			),
		]);
		const windows = await Promise.all(
			Array.from({ length: 4 }, () => materializeMfaWindow(org, person)),
		);
		expect(windows[0]?.deadline).toBeTruthy();
		expect(new Set(windows.map((window) => window?.deadline)).size).toBe(1);
	});
	it("keeps kiosk-only members outside scope and starts their first window when interactive access is activated", async () => {
		await pool.query('UPDATE "user" SET email=$2 WHERE id=$1', [
			person,
			`${person}@kiosk.invalid`,
		]);
		await pool.query(
			"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,14,$2)",
			[org, person],
		);
		expect(await materializeMfaWindow(org, person)).toBeNull();
		await pool.query('UPDATE "user" SET email=$2 WHERE id=$1', [
			person,
			`${person}@example.test`,
		]);
		expect((await materializeMfaWindow(org, person))?.deadline).toBeTruthy();
	});
	it("does not consume a window from an uncommitted active SCIM intermediate state", async () => {
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,14,$2)",
			[org, person],
		);
		const connection = await pool.connect();
		try {
			await connection.query("BEGIN");
			await connection.query(
				"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
				[person, org],
			);
			await connection.query(
				"INSERT INTO employee(user_id,organization_id,is_active,updated_at) VALUES ($1,$2,false,now())",
				[person, org],
			);
			await connection.query("COMMIT");
		} finally {
			connection.release();
		}
		expect(await materializeMfaWindow(org, person)).toBeNull();
		await pool.query(
			"UPDATE employee SET is_active=true WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		expect((await materializeMfaWindow(org, person))?.deadline).toBeTruthy();
	});
	it("refuses coverage after the requested organization's employee access ends", async () => {
		await pool.query(
			"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		const { getOrganizationMfaCoverage } = await import("./queries");
		expect(
			(await getOrganizationMfaCoverage(person, org)).members,
		).toHaveLength(2);
		await pool.query(
			"INSERT INTO employee(user_id,organization_id,is_active,updated_at) VALUES ($1,$2,false,now())",
			[person, org],
		);
		await expect(getOrganizationMfaCoverage(person, org)).rejects.toThrow(
			"Organization access required",
		);
	});
	it("keeps MFA materialization and access audit inside a caller's transaction", async () => {
		await pool.query(
			"UPDATE member SET status='approved' WHERE user_id=$1 AND organization_id=$2",
			[person, org],
		);
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,0,$2)",
			[org, person],
		);
		const { db } = await import("@/db");
		await expect(
			db.transaction(async (tx) => {
				expect(
					(await getOrganizationMfaRequirement(actor, org, false, tx)).allowed,
				).toBe(false);
				throw new Error("rollback MFA access");
			}),
		).rejects.toThrow("rollback MFA access");
		expect(
			(
				await pool.query(
					"SELECT deadline FROM organization_mfa_window WHERE organization_id=$1 AND user_id=$2",
					[org, person],
				)
			).rows[0].deadline,
		).toBeNull();
		expect(
			(
				await pool.query(
					"SELECT id FROM audit_log WHERE organization_id=$1 AND action='mfa.access_denied'",
					[org],
				)
			).rowCount,
		).toBe(0);
	});
});
