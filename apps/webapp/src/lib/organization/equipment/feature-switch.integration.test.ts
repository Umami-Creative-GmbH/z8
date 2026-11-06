import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1572-owner",
	organizationId: "t1572-org",
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user" },
				session: {
					id: `session-${session.userId}`,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));

const actions = await import("./actions");
const pool = integrationAdminPool();
const setEnabled = (enabled: boolean) =>
	pool.query(
		"update organization set equipment_enabled=$1 where id='t1572-org'",
		[enabled],
	);
async function clean() {
	await pool.query("delete from organization where id like 't1572-%'");
	await pool.query('delete from "user" where id like $1', ["t1572-%"]);
}
beforeAll(async () => {
	await clean();
	await pool.query(
		"insert into organization(id,name,slug,equipment_enabled,created_at) values('t1572-org','t1572-org','t1572-org',true,now())",
	);
	await pool.query(
		`insert into "user"(id,name,email,created_at,updated_at) values('t1572-owner','t1572-owner','owner@t1572.example.test',now(),now())`,
	);
	await pool.query(
		"insert into member(id,user_id,organization_id,role,status,created_at) values('t1572-owner','t1572-owner','t1572-org','owner','approved',now())",
	);
});
afterAll(clean);
beforeEach(() => setEnabled(true));

it("refuses every equipment read and command while switched off, and keeps the records (#1572)", async () => {
	expect(
		await actions.changeEquipmentSetup({
			kind: "configure_policy",
			requestId: crypto.randomUUID(),
			expectedRevision: 0,
			retentionMonths: 24,
		}),
	).toMatchObject({ success: true, data: { ok: true } });

	await setEnabled(false);
	const refused = { success: false, code: "AuthorizationError" };
	expect(await actions.getEquipmentSetup()).toMatchObject(refused);
	expect(await actions.getEquipmentOverview({})).toMatchObject(refused);
	expect(await actions.getMyEquipment()).toMatchObject(refused);
	expect(await actions.getEquipmentOfficerGrants()).toMatchObject(refused);
	expect(
		await actions.changeEquipmentSetup({
			kind: "configure_policy",
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			retentionMonths: 36,
		}),
	).toMatchObject(refused);
	expect(
		(
			await pool.query(
				"select retention_months from equipment_policy where organization_id='t1572-org'",
			)
		).rows,
	).toEqual([{ retention_months: 24 }]);

	await setEnabled(true);
	expect(await actions.getEquipmentSetup()).toMatchObject({
		success: true,
		data: { policy: { retentionMonths: 24 } },
	});
});
