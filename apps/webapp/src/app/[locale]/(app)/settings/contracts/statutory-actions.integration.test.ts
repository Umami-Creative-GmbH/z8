/**
 * #2017: org admins set the working-student daytime band in Settings → Contracts → statutory
 * limits; the change is audited, other members are refused and other organizations keep theirs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { loadOrganizationStatutoryPreferences } from "@/lib/statutory/preferences";
import { integrationAdminPool } from "@/test/integration-database";
import { updateStatutoryPreferencesAction } from "./statutory-actions";

const request = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (original) => ({
	...(await original<object>()),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: request.userId, email: "statutory-fixture@example.test", name: "Fixture" },
				session: {
					id: "statutory-dummy-session",
					token: "statutory-dummy-session-value",
					userId: request.userId,
					activeOrganizationId: request.organizationId,
					expiresAt: new Date("2099-01-01T00:00:00Z"),
				},
			}),
		},
	},
}));

const run = randomUUID();
const orgA = `t2017-a-${run}`;
const orgB = `t2017-b-${run}`;
const adminA = `t2017-admin-a-${run}`;
const memberA = `t2017-member-a-${run}`;
const adminB = `t2017-admin-b-${run}`;

const lateBand = {
	warningThresholdPercent: 80,
	criticalThresholdPercent: 95,
	blockJarbschgShiftPublish: false,
	workingStudentDaytimeStartMinute: 7 * 60,
	workingStudentDaytimeEndMinute: 19 * 60,
};

describe("updateStatutoryPreferencesAction: working-student daytime band (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	beforeAll(async () => {
		for (const organizationId of [orgA, orgB]) {
			await pool.query(
				"insert into organization (id,name,slug,created_at) values ($1,$1,$1,now())",
				[organizationId],
			);
		}
		for (const [userId, organizationId, role] of [
			[adminA, orgA, "admin"],
			[memberA, orgA, "member"],
			[adminB, orgB, "admin"],
		] as const) {
			await pool.query(
				'insert into "user" (id,name,email,email_verified,created_at,updated_at) values ($1,$1,$2,true,now(),now())',
				[userId, `${userId}@example.test`],
			);
			await pool.query(
				"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
				[randomUUID(), organizationId, userId, role],
			);
		}
	});

	beforeEach(async () => {
		await pool.query(
			"delete from organization_statutory_preference where organization_id = any($1::text[])",
			[[orgA, orgB]],
		);
		await pool.query("delete from audit_log where organization_id = any($1::text[])", [
			[orgA, orgB],
		]);
	});

	afterAll(async () => {
		await pool.query("delete from audit_log where organization_id = any($1::text[])", [
			[orgA, orgB],
		]);
		await pool.query("delete from member where organization_id = any($1::text[])", [[orgA, orgB]]);
		await pool.query("delete from organization where id = any($1::text[])", [[orgA, orgB]]);
		await pool.query('delete from "user" where id = any($1::text[])', [[adminA, memberA, adminB]]);
	});

	function as(userId: string, organizationId: string) {
		request.userId = userId;
		request.organizationId = organizationId;
	}

	it("lets an org admin set the band for their own organization only, and audits the change", async () => {
		as(adminA, orgA);

		expect(await updateStatutoryPreferencesAction(lateBand)).toMatchObject({
			success: true,
			data: { workingStudentDaytimeStartMinute: 420, workingStudentDaytimeEndMinute: 1140 },
		});

		expect(await loadOrganizationStatutoryPreferences(db, orgA)).toMatchObject({
			workingStudentDaytimeStartMinute: 420,
			workingStudentDaytimeEndMinute: 1140,
			isDefault: false,
		});
		expect(await loadOrganizationStatutoryPreferences(db, orgB)).toMatchObject({
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
			isDefault: true,
		});
		const { rows } = await pool.query<{
			action: string;
			performed_by: string;
			entity_type: string;
			changes: string;
		}>(
			"select action, performed_by, entity_type, changes from audit_log where organization_id = $1",
			[orgA],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			action: "statutory.preferences_updated",
			performed_by: adminA,
			entity_type: "organization",
		});
		expect(JSON.parse(rows[0]?.changes ?? "null")).toMatchObject({
			before: { workingStudentDaytimeStartMinute: 360, workingStudentDaytimeEndMinute: 1080 },
			after: { workingStudentDaytimeStartMinute: 420, workingStudentDaytimeEndMinute: 1140 },
		});
	});

	it("refuses a member who is not an org admin and keeps the band", async () => {
		as(adminA, orgA);
		await updateStatutoryPreferencesAction(lateBand);
		as(memberA, orgA);

		expect(
			await updateStatutoryPreferencesAction({
				...lateBand,
				workingStudentDaytimeStartMinute: 0,
				workingStudentDaytimeEndMinute: 1440,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });

		expect(await loadOrganizationStatutoryPreferences(db, orgA)).toMatchObject({
			workingStudentDaytimeStartMinute: 420,
			workingStudentDaytimeEndMinute: 1140,
		});
		const { rows } = await pool.query(
			"select 1 from audit_log where organization_id = $1 and performed_by = $2",
			[orgA, memberA],
		);
		expect(rows).toEqual([]);
	});

	it("refuses an invalid band before saving or auditing anything", async () => {
		as(adminB, orgB);

		expect(
			await updateStatutoryPreferencesAction({
				...lateBand,
				workingStudentDaytimeStartMinute: 19 * 60,
				workingStudentDaytimeEndMinute: 7 * 60,
			}),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(
			await updateStatutoryPreferencesAction({
				...lateBand,
				workingStudentDaytimeEndMinute: 19 * 60 + 5,
			}),
		).toMatchObject({ success: false, code: "ValidationError" });

		expect((await loadOrganizationStatutoryPreferences(db, orgB)).isDefault).toBe(true);
		const { rows } = await pool.query("select 1 from audit_log where organization_id = $1", [orgB]);
		expect(rows).toEqual([]);
	});
});
