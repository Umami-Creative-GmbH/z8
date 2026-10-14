import { defineRequestState, hasRequestState } from "@better-auth/core/context";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getIP, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import type { SecurityEventType } from "@/lib/email/templates/security-alert";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SecurityAlerts");

/** A security event on a user's account, as the request that caused it saw it. */
export interface SecurityAlert {
	event: SecurityEventType;
	userId: string;
	ipAddress?: string;
	userAgent?: string;
}

export type SecurityAlertNotifier = (alert: SecurityAlert) => Promise<void>;

/** What a request's own writes tell the hooks that run after them. */
interface PendingSecurityWrites {
	/** Whose password this request may replace, known before the endpoint runs. */
	passwordSubject?: string;
	/** The account update being written replaces a password. */
	passwordWritten?: boolean;
	/** The two-factor state the user update being written sets, and the signed-in user's before it. */
	twoFactorWrite?: { enabled: boolean; sessionUser?: { id: string; enabled: boolean } };
}

const pendingWrites = defineRequestState<PendingSecurityWrites>(() => ({}));

/** The request's writes, or none outside a Better Auth request (server-side adapter calls). */
async function pending(): Promise<PendingSecurityWrites | undefined> {
	return (await hasRequestState()) ? pendingWrites.get() : undefined;
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The endpoint context a database hook runs in, when a request caused the write. */
type WriteContext = {
	request?: Request;
	headers?: Headers;
	context: {
		options: BetterAuthOptions;
		session?: { user: { id: string; twoFactorEnabled?: boolean | null } } | null;
	};
} | null;

function field(source: unknown, name: string): string | undefined {
	const value =
		source && typeof source === "object" ? (source as Record<string, unknown>)[name] : undefined;
	return typeof value === "string" && value ? value : undefined;
}

/** The user whose password an endpoint may replace. */
const passwordSubjects: Record<string, (ctx: HookContext) => Promise<string | undefined>> = {
	"/change-password": async (ctx) => (await getSessionFromCtx(ctx))?.user.id,
	// The reset token names the user; the endpoint consumes it, so it is read first.
	"/reset-password": async (ctx) => {
		const token = field(ctx.body, "token") ?? field(ctx.query, "token");
		if (!token) return undefined;
		const verification = await ctx.context.internalAdapter.findVerificationValue(
			`reset-password:${token}`,
		);
		return verification?.value;
	},
	// The admin plugin's endpoint authorizes the admin itself and names the user.
	[admin().endpoints.setUserPassword.path]: async (ctx) => field(ctx.body, "userId"),
};

function normalizedPath(path: string | undefined) {
	return path ? path.replace(/\/+$/, "") : "";
}

/** The IP address (as Better Auth resolves it for sessions) and user agent of the request. */
function clientOf(ctx: WriteContext | undefined) {
	const source = ctx?.request ?? ctx?.headers;
	return {
		ipAddress: (ctx && source && getIP(source, ctx.context.options)) || undefined,
		userAgent:
			ctx?.headers?.get("user-agent") || ctx?.request?.headers.get("user-agent") || undefined,
	};
}

/**
 * Alerts a user when their password is replaced or two-factor authentication is
 * turned on or off (#1180), with the IP address and user agent of the request that
 * did it. The database hooks see each write; their after hooks run once it has
 * committed, so only a change that happened is alerted. Choosing a first password
 * creates a credential instead of replacing one and is not alerted.
 */
export function securityAlerts(notify: SecurityAlertNotifier) {
	async function alert(event: SecurityEventType, userId: string, ctx: WriteContext | undefined) {
		try {
			await notify({ event, userId, ...clientOf(ctx) });
		} catch (error) {
			logger.error({ error, event, userId }, "Failed to send security alert");
		}
	}

	return {
		id: "z8-security-alerts",
		hooks: {
			before: [
				{
					matcher: (ctx) => normalizedPath(ctx.path) in passwordSubjects,
					handler: createAuthMiddleware(async (ctx) => {
						const subject = await passwordSubjects[normalizedPath(ctx.path)]?.(ctx);
						if (subject) (await pendingWrites.get()).passwordSubject = subject;
					}),
				},
			],
		},
		init() {
			return {
				options: {
					databaseHooks: {
						// Better Auth writes the flag on the first verified code after enabling and
						// on every disable, even of two-factor that was never on. The signed-in
						// user's state before the write tells a change from a rewrite.
						user: {
							update: {
								async before(user, ctx: WriteContext) {
									const writes = await pending();
									if (!writes || typeof user.twoFactorEnabled !== "boolean") return;
									const sessionUser = ctx?.context.session?.user;
									writes.twoFactorWrite = {
										enabled: user.twoFactorEnabled,
										...(sessionUser
											? {
													sessionUser: {
														id: sessionUser.id,
														enabled: Boolean(sessionUser.twoFactorEnabled),
													},
												}
											: {}),
									};
								},
								async after(user, ctx: WriteContext) {
									const writes = await pending();
									const write = writes?.twoFactorWrite;
									if (!writes || !write) return;
									writes.twoFactorWrite = undefined;
									const { enabled, sessionUser } = write;
									if (sessionUser?.id === user.id && sessionUser.enabled === enabled) return;
									await alert(enabled ? "two_factor_enabled" : "two_factor_disabled", user.id, ctx);
								},
							},
						},
						account: {
							update: {
								async before(account) {
									const writes = await pending();
									if (writes && account.password !== undefined) writes.passwordWritten = true;
								},
								// A password update is an update-many: its result names no user.
								async after(_result, ctx) {
									const writes = await pending();
									if (!writes?.passwordWritten || !writes.passwordSubject) return;
									const userId = writes.passwordSubject;
									writes.passwordWritten = false;
									writes.passwordSubject = undefined;
									await alert("password_changed", userId, ctx);
								},
							},
						},
					},
				},
			};
		},
	} satisfies BetterAuthPlugin;
}
