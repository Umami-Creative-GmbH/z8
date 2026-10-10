import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { isReservedEmail } from "./reserved-email";

function reservedEmailRefusal() {
	return new APIError("FORBIDDEN", {
		code: "RESERVED_EMAIL",
		message: "This address cannot be used to sign in or receive email.",
	});
}

/** Endpoints that name an address in their body, and the field that holds it. */
const emailBodyFields = new Map<string, string>([
	["/sign-in/email", "email"],
	["/sign-up/email", "email"],
	["/request-password-reset", "email"],
	// Older Better Auth releases called the reset-request endpoint /forget-password.
	["/forget-password", "email"],
	["/send-verification-email", "email"],
	["/sign-in/magic-link", "email"],
	["/organization/invite-member", "email"],
	["/change-email", "newEmail"],
	// The admin plugin's user creation and update are refused by the user database hooks below.
]);

/** Endpoints that act for the signed-in user, refused when that user's address is reserved. */
const sessionPaths = new Set([
	"/passkey/generate-register-options",
	"/passkey/verify-registration",
]);

function normalizedPath(path: string | undefined) {
	return path ? path.replace(/\/+$/, "") : "";
}

function bodyEmail(body: unknown, field: string): unknown {
	return body && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
}

/**
 * Kiosk-only employees' reserved addresses never sign in, never receive mail
 * and never become someone's identity (ADR 0006, #857). Endpoint hooks refuse
 * them early with a stable `RESERVED_EMAIL` code; the database hooks refuse a
 * session for, or a user created or renamed to, a reserved address on every
 * path, including social, SSO, passkey and server-side calls. The kiosk-only
 * writer inserts its users directly and is not subject to these hooks.
 *
 * The passkey check reads the browser's session cookie; a bearer token only
 * becomes a session after all before hooks, but the session hook already
 * refuses every session for a reserved address.
 */
export function reservedEmailGuard() {
	return {
		id: "z8-reserved-email-guard",
		hooks: {
			before: [
				{
					matcher: (ctx) => emailBodyFields.has(normalizedPath(ctx.path)),
					handler: createAuthMiddleware(async (ctx) => {
						const field = emailBodyFields.get(normalizedPath(ctx.path));
						const email = field ? bodyEmail(ctx.body, field) : undefined;
						if (typeof email === "string" && isReservedEmail(email)) {
							throw reservedEmailRefusal();
						}
					}),
				},
				{
					matcher: (ctx) => sessionPaths.has(normalizedPath(ctx.path)),
					handler: createAuthMiddleware(async (ctx) => {
						const session = await getSessionFromCtx(ctx);
						if (session && isReservedEmail(session.user.email)) {
							throw reservedEmailRefusal();
						}
					}),
				},
			],
		},
		init(context) {
			return {
				options: {
					databaseHooks: {
						user: {
							create: {
								async before(user) {
									if (isReservedEmail(user.email)) throw reservedEmailRefusal();
								},
							},
							update: {
								async before(user) {
									if (isReservedEmail(user.email)) throw reservedEmailRefusal();
								},
							},
						},
						session: {
							create: {
								async before(session) {
									const user = await context.internalAdapter.findUserById(session.userId);
									if (user && isReservedEmail(user.email)) throw reservedEmailRefusal();
								},
							},
						},
					},
				},
			};
		},
	} satisfies BetterAuthPlugin;
}
