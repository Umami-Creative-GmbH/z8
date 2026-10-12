import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { storeAppSessionPlugin } from "./store-app-session";

async function fixture() {
	const data: Record<string, Record<string, unknown>[]> = {
		user: [],
		session: [],
		account: [],
		verification: [],
	};
	const auth = betterAuth({
		baseURL: "https://app.example.test",
		secret: "test-store-app-session-secret-at-least-32-characters",
		database: memoryAdapter(data),
		plugins: [storeAppSessionPlugin()],
	});
	const ctx = await auth.$context;
	await ctx.internalAdapter.createUser({
		id: "employee",
		name: "Employee",
		email: "employee@example.test",
		emailVerified: true,
	});
	const session = await ctx.internalAdapter.createSession("employee");
	return { auth, ctx, data, session };
}

function cookieHeader(setCookies: string[]) {
	return setCookies.map((entry) => entry.split(";")[0]).join("; ");
}

describe("store app session cookie", () => {
	it("hands an exchanged session to the web view as Better Auth's own signed cookie", async () => {
		const { auth, ctx, session } = await fixture();

		const { headers } = await auth.api.setStoreAppSessionCookie({
			body: { sessionToken: session.token },
			headers: new Headers({ host: "app.example.test" }),
			returnHeaders: true,
		});

		const setCookies = headers.getSetCookie();
		const sessionCookie = setCookies.find((entry) =>
			entry.startsWith(`${ctx.authCookies.sessionToken.name}=`),
		);
		expect(sessionCookie).toBeDefined();
		expect(sessionCookie).toMatch(/HttpOnly/i);
		expect(sessionCookie).toMatch(/Secure/i);
		expect(sessionCookie).toMatch(/SameSite=Lax/i);

		const signedIn = await auth.api.getSession({
			headers: new Headers({ cookie: cookieHeader(setCookies) }),
		});
		expect(signedIn?.user.id).toBe("employee");
		// The same session row: its active organization and SSO provenance stay server-side.
		expect(signedIn?.session.id).toBe(session.id);
	});

	it("refuses a token that names no session", async () => {
		const { auth } = await fixture();

		await expect(
			auth.api.setStoreAppSessionCookie({
				body: { sessionToken: "not-a-session" },
				returnHeaders: true,
			}),
		).rejects.toMatchObject({ statusCode: 401 });
	});

	it("refuses a revoked session", async () => {
		const { auth, ctx, session } = await fixture();
		await ctx.internalAdapter.deleteSession(session.token);

		await expect(
			auth.api.setStoreAppSessionCookie({
				body: { sessionToken: session.token },
				returnHeaders: true,
			}),
		).rejects.toMatchObject({ statusCode: 401 });
	});

	it("refuses an expired session", async () => {
		const { auth, ctx, session } = await fixture();
		await ctx.internalAdapter.updateSession(session.token, {
			expiresAt: new Date(Date.now() - 1000),
		});

		await expect(
			auth.api.setStoreAppSessionCookie({
				body: { sessionToken: session.token },
				returnHeaders: true,
			}),
		).rejects.toMatchObject({ statusCode: 401 });
	});

	it("is not reachable over HTTP", async () => {
		const { auth, session } = await fixture();

		const response = await auth.handler(
			new Request("https://app.example.test/api/auth/store-app/session-cookie", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://app.example.test",
				},
				body: JSON.stringify({ sessionToken: session.token }),
			}),
		);

		expect(response.status).toBe(404);
		expect(response.headers.getSetCookie()).toEqual([]);
	});
});
