import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { readApiKeysForView, readWebhooksForView } from "./view-actions";

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
				user: { id: request.userId, email: "public-fixture@example.test", name: "Alias fixture" },
				session: {
					id: "public-dummy-session",
					token: "public-dummy-session-value",
					userId: request.userId,
					activeOrganizationId: request.organizationId,
					expiresAt: new Date("2099-01-01T00:00:00Z"),
				},
			}),
		},
	},
}));

const organizationId = `r096-alias-${randomUUID()}`;
const adminId = `r096-admin-${randomUUID()}`;
const memberId = `r096-member-${randomUUID()}`;
beforeAll(async () => {
	const pool = integrationAdminPool();
	await pool.query("insert into organization (id,name,slug,created_at) values ($1,$2,$1,now())", [
		organizationId,
		"R096 alias fixture",
	]);
	for (const [id, role] of [
		[adminId, "admin"],
		[memberId, "member"],
	]) {
		await pool.query(
			'insert into "user" (id,name,email,email_verified,created_at,updated_at) values ($1,$2,$3,true,now(),now())',
			[id, "Alias fixture", `${id}@example.test`],
		);
		await pool.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[randomUUID(), organizationId, id, role],
		);
	}
	request.organizationId = organizationId;
});
afterAll(async () => {
	const pool = integrationAdminPool();
	await pool.query("delete from member where organization_id=$1", [organizationId]);
	await pool.query("delete from organization where id=$1", [organizationId]);
	await pool.query('delete from "user" where id=any($1::text[])', [[adminId, memberId]]);
});

it("lets an approved org admin without an employee retry the existing public read projections", async () => {
	request.userId = adminId;
	const expected = { userId: adminId, organizationId };
	expect(await readApiKeysForView(expected)).toEqual({ success: true, data: [] });
	expect(await readWebhooksForView(expected)).toEqual({ success: true, data: [] });
});

it("refuses retired actor and organization expectations without returning another scope", async () => {
	request.userId = adminId;
	expect(await readApiKeysForView({ userId: memberId, organizationId })).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(
		await readWebhooksForView({ userId: adminId, organizationId: "retired-organization" }),
	).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
});

it("retains canonical read refusal for an ordinary member despite matching display expectations", async () => {
	request.userId = memberId;
	const expected = { userId: memberId, organizationId };
	expect(await readApiKeysForView(expected)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(await readWebhooksForView(expected)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
});
