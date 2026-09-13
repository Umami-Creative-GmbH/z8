import { runWithTransaction } from "@better-auth/core/context";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { describe, expect, it, vi } from "vitest";

async function setup(enforce = true, guardFirst = true) {
	const data = { user: [], session: [], account: [], verification: [] };
	const cache = new Map<string, string>();
	const onDeleteSession = vi.fn();
	const { accountBanPlugin } = enforce
		? await import("./account-ban")
		: { accountBanPlugin: () => ({ id: "no-ban-guard" }) };
	const auth = betterAuth({
		baseURL: "https://app.example.com",
		secret: "synthetic-ban-test-secret-at-least-32-characters",
		database: (options) => {
			const adapter = memoryAdapter(data)(options);
			return {
				...adapter,
				transaction: async (callback) => {
					// An isolated transaction snapshot models uncommitted user rows:
					// an out-of-transaction adapter cannot see them before commit.
					const pending = structuredClone(data);
					const result = await callback(memoryAdapter(pending)(options));
					Object.assign(data, pending);
					return result;
				},
			};
		},
		plugins: guardFirst
			? [accountBanPlugin(), admin(), bearer()]
			: [admin(), accountBanPlugin(), bearer()],
		session: { storeSessionInDatabase: true },
		databaseHooks: { session: { delete: { after: onDeleteSession } } },
		secondaryStorage: {
			get: async (key) => cache.get(key) ?? null,
			set: async (key, value) => {
				cache.set(key, value);
			},
			delete: async (key) => {
				cache.delete(key);
			},
			getAndDelete: async (key) => {
				const value = cache.get(key) ?? null;
				cache.delete(key);
				return value;
			},
		},
	});
	const context = await auth.$context;
	const user = await context.internalAdapter.createUser({
		name: "Person",
		email: "person@example.com",
		emailVerified: true,
	});
	const session = await context.internalAdapter.createSession(user.id);
	const headers = new Headers({ authorization: `Bearer ${session.token}` });
	const ban = (banExpires: Date | null = null) =>
		context.adapter.update({
			model: "user",
			where: [{ field: "id", value: user.id }],
			update: { banned: true, banExpires },
		});
	return { auth, context, cache, user, session, headers, ban, onDeleteSession };
}

describe("current account bans", () => {
	it("reproduces the upstream cached-session bypass without the guard", async () => {
		const { auth, ban, headers } = await setup(false);
		await ban();
		expect(await auth.api.getSession({ headers })).not.toBeNull();
	});
	it.each(["cached", "database fallback"])(
		"rejects an existing %s session using the committed ban",
		async (source) => {
			const { auth, ban, headers, cache, session } = await setup();
			await ban();
			if (source === "database fallback") cache.delete(session.token);
			expect(await auth.api.getSession({ headers })).toBeNull();
		},
	);
	it.each(["cached", "database fallback"])(
		"blocks authenticated operations with a %s banned session",
		async (source) => {
			const { auth, ban, headers, cache, session } = await setup();
			await ban();
			if (source === "database fallback") cache.delete(session.token);
			await expect(
				auth.api.listUserAccounts({ headers }),
			).rejects.toMatchObject({ status: "UNAUTHORIZED" });
		},
	);
	it("rejects session creation even without an endpoint context", async () => {
		const { context, ban, user } = await setup();
		await ban();
		await expect(
			context.internalAdapter.createSession(user.id),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
	});
	it("honors an expired ban for existing sessions and new issuance", async () => {
		const { auth, context, ban, headers, user } = await setup();
		await ban(new Date("2020-01-01T00:00:00Z"));
		expect(await auth.api.getSession({ headers })).not.toBeNull();
		expect(await context.internalAdapter.createSession(user.id)).toBeTruthy();
	});
	it("allows an unbanned user's authenticated operations", async () => {
		const { auth, headers } = await setup();
		expect(await auth.api.listUserAccounts({ headers })).toEqual([]);
	});
	it("preserves deletion hooks when revoking a banned user's sessions", async () => {
		const { context, ban, user, session, onDeleteSession, cache } =
			await setup();
		const otherUser = await context.internalAdapter.createUser({
			email: "other@example.com",
			name: "Other",
			emailVerified: true,
		});
		const otherSession = await context.internalAdapter.createSession(
			otherUser.id,
		);
		await ban();
		await context.internalAdapter.deleteUserSessions(user.id);
		expect(onDeleteSession.mock.calls[0]?.[0]).toMatchObject({
			token: session.token,
		});
		expect(cache.has(session.token)).toBe(false);
		expect(
			await context.internalAdapter.findSession(otherSession.token),
		).not.toBeNull();
	});
	it("composes with plugins that initialize options before the ban guard", async () => {
		const { auth, ban, headers } = await setup(true, false);
		await ban();
		expect(await auth.api.getSession({ headers })).toBeNull();
	});
	it("supports session issuance for an uncommitted new user in a transaction", async () => {
		const { context } = await setup();
		const session = await runWithTransaction(context.adapter, async () => {
			const user = await context.internalAdapter.createUser({
				email: "new@example.com",
				name: "New",
				emailVerified: true,
			});
			return context.internalAdapter.createSession(user.id);
		});
		expect(session).toBeTruthy();
	});
	it("enforces fallback reads inside Better Auth transactions", async () => {
		const { context, ban, cache, session } = await setup();
		await ban();
		cache.delete(session.token);
		expect(
			await runWithTransaction(context.adapter, () =>
				context.internalAdapter.findSession(session.token),
			),
		).toBeNull();
	});
	it("rejects cookie-only caching that would bypass authoritative ban reads", async () => {
		const { accountBanPlugin } = await import("./account-ban");
		const auth = betterAuth({
			baseURL: "https://app.example.com",
			secret: "synthetic-ban-test-secret-at-least-32-characters",
			database: memoryAdapter({}),
			plugins: [accountBanPlugin(), admin()],
			session: { cookieCache: { enabled: true } },
		});
		await expect(auth.$context).rejects.toThrow(
			"session.cookieCache.enabled=false",
		);
	});
	it.each([null, new Date("2099-01-01T00:00:00Z"), "invalid-expiry"])(
		"treats an active or invalid ban expiry %s as banned",
		async (banExpires) => {
			const { isAccountBanned } = await import("./account-ban");
			expect(isAccountBanned({ banned: true, banExpires })).toBe(true);
		},
	);
});
