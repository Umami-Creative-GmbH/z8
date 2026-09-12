import type {
	BetterAuthPlugin,
	DBAdapter,
	DBTransactionAdapter,
} from "better-auth";
import { APIError } from "better-auth/api";
import { Temporal } from "temporal-polyfill";

type BanStatus = {
	id?: string;
	banned?: boolean | null;
	banExpires?: Date | string | null;
};

/** Ban expiry is an absolute instant, independent of the browser's timezone. */
export function isAccountBanned(user: BanStatus): boolean {
	if (!user.banned) return false;
	if (!user.banExpires) return true;
	try {
		const expiry =
			user.banExpires instanceof Date
				? Temporal.Instant.fromEpochMilliseconds(user.banExpires.getTime())
				: Temporal.Instant.from(user.banExpires);
		return Temporal.Instant.compare(expiry, Temporal.Now.instant()) > 0;
	} catch {
		// An invalid expiry must not turn a permanent ban into access.
		return true;
	}
}

async function canUseSession(
	adapter: DBTransactionAdapter,
	userId: unknown,
): Promise<boolean> {
	if (typeof userId !== "string" || !userId) return false;
	const user = await adapter.findOne<BanStatus>({
		model: "user",
		where: [{ field: "id", value: userId }],
	});
	return user != null && !isAccountBanned(user);
}

function guardSessionReads(
	adapter: DBTransactionAdapter,
): DBTransactionAdapter {
	return {
		...adapter,
		async findOne<T>(options: Parameters<DBAdapter["findOne"]>[0]) {
			const row = await adapter.findOne<T>(options);
			// Authentication reads join the user. Leave unjoined lifecycle
			// reads intact so revocation still runs session-delete hooks.
			if (options.model !== "session" || !options.join?.user || !row)
				return row;
			return (await canUseSession(
				adapter,
				(row as { userId?: unknown }).userId,
			))
				? row
				: null;
		},
		async findMany<T>(options: Parameters<DBAdapter["findMany"]>[0]) {
			const rows = await adapter.findMany<T>(options);
			if (options.model !== "session" || !options.join?.user) return rows;
			const allowed = await Promise.all(
				rows.map((row) =>
					canUseSession(adapter, (row as { userId?: unknown }).userId),
				),
			);
			return rows.filter((_, index) => allowed[index]);
		},
	};
}

/**
 * Enforce committed account bans below the endpoint-hook layer. Better Auth's
 * getSessionFromCtx invokes getSession directly, bypassing endpoint hooks; its
 * internal adapter is also rebuilt AFTER plugin init. Wrapping the underlying
 * stores here covers both paths, including a cache miss's database fallback.
 */
export function accountBanPlugin() {
	return {
		id: "z8-account-ban",
		init(context) {
			if (context.options.session?.cookieCache?.enabled) {
				throw new Error(
					"Account ban enforcement requires session.cookieCache.enabled=false",
				);
			}
			const adapter = context.adapter;
			const storage = context.options.secondaryStorage;
			if (storage) {
				// Better Auth clones the options while initializing plugins, so wrap
				// the shared storage facade in place rather than replacing options.
				const get = storage.get.bind(storage);
				storage.get = async (key) => {
					const value = await get(key);
					if (!value) return value;
					let parsed: unknown;
					try {
						parsed = typeof value === "string" ? JSON.parse(value) : value;
					} catch {
						return value;
					}
					if (!parsed || typeof parsed !== "object" || !("session" in parsed))
						return value;
					const session = parsed.session as {
						token?: unknown;
						userId?: unknown;
					} | null;
					if (
						!session ||
						session.token !== key ||
						!(await canUseSession(adapter, session.userId))
					)
						return null;
					return value;
				};
			}
			const guardedAdapter: DBAdapter = {
				...guardSessionReads(adapter),
				transaction: (callback) =>
					adapter.transaction((transaction) =>
						callback(guardSessionReads(transaction)),
					),
			};
			return {
				context: { adapter: guardedAdapter },
				options: {
					databaseHooks: {
						session: {
							create: {
								async before(session) {
									// Do not depend on ctx: server-side internalAdapter callers can
									// legitimately run without an endpoint context.
									// The internal lookup honors Better Auth's transaction context,
									// including a new user that has not committed yet.
									const user = await context.internalAdapter.findUserById(
										session.userId,
									);
									if (!user || isAccountBanned(user)) {
										throw new APIError("FORBIDDEN", {
											code: "BANNED_USER",
											message: "Account access denied",
										});
									}
								},
							},
						},
					},
				},
			};
		},
	} satisfies BetterAuthPlugin;
}
