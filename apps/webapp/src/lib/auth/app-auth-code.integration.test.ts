import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeAppAuthCode } from "@/lib/auth/app-auth-code";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: "t780-auth-user" },
				session: { token: "fixture-session-token" },
			}),
		},
	},
}));
vi.mock("@/lib/rate-limit", () => ({
	getClientIp: () => "127.0.0.1",
	checkRateLimit: async () => ({ allowed: true }),
}));

const appLogin = await import("@/app/api/auth/app-login/route");
const desktopLogin = await import("@/app/api/auth/desktop-login/route");
const admin = integrationAdminPool();
const verifier = "desktop-auth-fixture-verifier-with-at-least-43-characters";
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function cleanup() {
	await admin.query('delete from "user" where id = $1', ["t780-auth-user"]);
}
beforeEach(async () => {
	await cleanup();
	await admin.query(
		'insert into "user"(id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
		["t780-auth-user", "t780-auth@example.test"],
	);
});
afterAll(cleanup);

describe("installed desktop sign-in on the checked-in migration chain", () => {
	it.each([
		["app-login", "application/json", appLogin.GET],
		["app-login", "text/html", appLogin.GET],
		["desktop-login", "application/json", desktopLogin.GET],
		["desktop-login", "text/html", desktopLogin.GET],
	])(
		"issues a PKCE-bound, single-use code through %s with Accept %s",
		async (path, accept, handler) => {
			const request = new NextRequest(
				`https://app.example.test/api/auth/${path}?app=desktop&redirect=z8://auth/callback&challenge=${challenge}`,
			);
			request.headers.set("accept", accept);
			const response = await handler(request);
			expect(response.status).toBe(accept === "text/html" ? 200 : 307);
			const href =
				accept === "text/html"
					? /id="open-z8" href="([^"]+)"/
							.exec(await response.text())?.[1]
							?.replaceAll("&amp;", "&")
					: response.headers.get("location");
			const callback = new URL(href ?? "");
			expect(callback.protocol).toBe("z8:");
			const code = callback.searchParams.get("code") ?? "";
			expect(code).toMatch(/^[A-F0-9]{32}$/);
			expect(callback.searchParams.get("token")).toBeNull();
			expect(
				await consumeAppAuthCode({
					app: "desktop",
					code,
					verifier: "incorrect-verifier",
				}),
			).toEqual({ status: "invalid_code" });
			expect(
				await consumeAppAuthCode({ app: "desktop", code, verifier }),
			).toEqual({ status: "success", sessionToken: "fixture-session-token" });
			expect(
				await consumeAppAuthCode({ app: "desktop", code, verifier }),
			).toEqual({ status: "invalid_code" });
		},
	);

	it.each(["application/json", "text/html"])(
		"issues a store app code with Accept %s that only its verifier redeems, once",
		async (accept) => {
			const request = new NextRequest(
				`https://app.example.test/api/auth/app-login?app=mobile&redirect=z8mobile://auth/callback&challenge=${challenge}`,
			);
			request.headers.set("accept", accept);
			const response = await appLogin.GET(request);
			const href =
				accept === "text/html"
					? /id="open-z8" href="([^"]+)"/
							.exec(await response.text())?.[1]
							?.replaceAll("&amp;", "&")
					: response.headers.get("location");
			const callback = new URL(href ?? "");
			expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(
				"z8mobile://auth/callback",
			);
			const code = callback.searchParams.get("code") ?? "";
			expect(code).toMatch(/^[A-F0-9]{32}$/);

			// A desktop exchange cannot redeem a store app code.
			expect(await consumeAppAuthCode({ app: "desktop", code, verifier })).toEqual({
				status: "invalid_code",
			});
			expect(
				await consumeAppAuthCode({ app: "mobile", code, verifier: "incorrect-verifier" }),
			).toEqual({ status: "invalid_code" });
			expect(await consumeAppAuthCode({ app: "mobile", code, verifier })).toEqual({
				status: "success",
				sessionToken: "fixture-session-token",
			});
			// Replaying the used code is refused.
			expect(await consumeAppAuthCode({ app: "mobile", code, verifier })).toEqual({
				status: "invalid_code",
			});
		},
	);

	it("recovers an old table repeatedly without changing existing auth-code evidence", async () => {
		const migration = await readFile(
			new URL(
				"../../../drizzle/0141_app_auth_code_pkce_recovery.sql",
				import.meta.url,
			),
			"utf8",
		);
		const client = await admin.connect();
		try {
			await client.query("begin");
			// The transaction is rolled back: other suites retain the full migrated schema.
			await client.query(
				"alter table public.app_auth_code drop column code_challenge",
			);
			const before = await client.query(
				`insert into app_auth_code(user_id,app,code,session_token,expires_at)
         values ($1,'desktop','legacy-fixture-code','legacy-fixture-session',now()+interval '5 minutes')
         returning id,user_id,app,code,session_token,status,expires_at,used_at,created_at`,
				["t780-auth-user"],
			);
			await client.query(migration);
			await client.query(migration);
			const after = await client.query(
				`select id,user_id,app,code,session_token,status,expires_at,used_at,created_at
         from app_auth_code where id=$1`,
				[before.rows[0].id],
			);
			expect(after.rows).toEqual(before.rows);
			const column = await client.query(
				"select data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='app_auth_code' and column_name='code_challenge'",
			);
			expect(column.rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
			const legacy = await client.query(
				"select code_challenge from app_auth_code where id=$1",
				[before.rows[0].id],
			);
			expect(legacy.rows).toEqual([{ code_challenge: null }]);
		} finally {
			await client.query("rollback");
			client.release();
		}
	});

	it("refuses to exchange legacy codes whose PKCE challenge cannot be reconstructed", async () => {
		await admin.query(
			`insert into app_auth_code(user_id,app,code,session_token,expires_at)
       values ($1,'desktop','legacy-fixture-code','legacy-fixture-session',now()+interval '5 minutes')`,
			["t780-auth-user"],
		);
		expect(
			await consumeAppAuthCode({
				app: "desktop",
				code: "legacy-fixture-code",
				verifier,
			}),
		).toEqual({ status: "invalid_code" });
		const legacy = await admin.query(
			"select status from app_auth_code where code='legacy-fixture-code'",
		);
		expect(legacy.rows).toEqual([{ status: "pending" }]);
	});
});
