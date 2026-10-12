/**
 * #1015: the organization's approval settings ("Deputies can decide
 * approvals") against a disposable PostgreSQL database.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { loadApprovalSettings, saveDeputyDecisionsEnabled } from "./approval-settings";

const ORG = "t1015-settings-org";
const OTHER_ORG = "t1015-settings-other-org";
const ADMIN_USER = "t1015-settings-admin";
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id = $1', [ADMIN_USER]);
}

async function settingAudit() {
	const { rows } = await admin.query<{
		performed_by: string;
		entity_type: string;
		entity_id: string;
		changes: string;
	}>(
		"select performed_by, entity_type, entity_id, changes from audit_log where organization_id = $1 and action = 'approval_setting.deputy_decisions_changed' order by timestamp, id",
		[ORG],
	);
	return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
}

describe("approval settings (#1015)", () => {
	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, $1, $1, $3), ($2, $2, $2, $3)`,
			[ORG, OTHER_ORG, SEEDED_AT],
		);
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$1,$2,$3,$3)',
			[ADMIN_USER, `${ADMIN_USER}@example.test`, SEEDED_AT],
		);
	});
	afterAll(cleanup);

	it("lets deputies decide approvals by default, without a settings row", async () => {
		expect(await loadApprovalSettings(db, ORG)).toEqual({ deputyDecisionsEnabled: true });
	});

	it("turns deputy decisions off and on for one organization, auditing each change", async () => {
		expect(
			await saveDeputyDecisionsEnabled(db, {
				organizationId: ORG,
				enabled: false,
				actorUserId: ADMIN_USER,
			}),
		).toEqual({ changed: true, deputyDecisionsEnabled: false });
		expect(await loadApprovalSettings(db, ORG)).toEqual({ deputyDecisionsEnabled: false });
		expect(await loadApprovalSettings(db, OTHER_ORG)).toEqual({ deputyDecisionsEnabled: true });

		expect(
			await saveDeputyDecisionsEnabled(db, {
				organizationId: ORG,
				enabled: false,
				actorUserId: ADMIN_USER,
			}),
		).toEqual({ changed: false, deputyDecisionsEnabled: false });
		await saveDeputyDecisionsEnabled(db, {
			organizationId: ORG,
			enabled: true,
			actorUserId: ADMIN_USER,
		});
		expect(await loadApprovalSettings(db, ORG)).toEqual({ deputyDecisionsEnabled: true });

		const { rows } = await admin.query<{ id: string }>(
			"select id from approval_setting where organization_id = $1",
			[ORG],
		);
		const settingId = rows[0]?.id;
		expect(settingId).toEqual(expect.any(String));
		expect(await settingAudit()).toEqual([
			{
				performed_by: ADMIN_USER,
				entity_type: "approval_setting",
				entity_id: settingId,
				changes: { deputyDecisionsEnabled: { from: true, to: false } },
			},
			{
				performed_by: ADMIN_USER,
				entity_type: "approval_setting",
				entity_id: settingId,
				changes: { deputyDecisionsEnabled: { from: false, to: true } },
			},
		]);
	});
});
