import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/**
 * Verification-store identifier that marks a password reset token as a
 * password setup link: the link sent when a kiosk-only employee gets a real
 * address (ADR 0006, #857). It lives next to Better Auth's own
 * `reset-password:<token>` value and holds the same user id.
 */
export function passwordSetupMarkerIdentifier(token: string): string {
	return `password-setup:${token}`;
}

function resetToken(ctx: { body?: unknown; query?: unknown }): string | null {
	for (const source of [ctx.body, ctx.query]) {
		const token =
			source && typeof source === "object" ? (source as Record<string, unknown>).token : undefined;
		if (typeof token === "string" && token) return token;
	}
	return null;
}

/**
 * An address an admin typed in proves nothing, so a former kiosk-only
 * employee's new address stays unverified until the person completes the
 * emailed password setup link (#857). Until then Better Auth refuses password
 * sign-in and implicit social or SSO account linking for the unverified user.
 *
 * After `/reset-password` succeeds with a token that carries the setup marker,
 * the marker is consumed and the user's address is marked verified: using the
 * link proves control of the address it was sent to. An ordinary reset token
 * has no marker and leaves verification to Better Auth's email verification.
 */
export function passwordSetupVerification() {
	return {
		id: "z8-password-setup-verification",
		hooks: {
			after: [
				{
					matcher: (ctx) => ctx.path === "/reset-password",
					handler: createAuthMiddleware(async (ctx) => {
						if (ctx.context.returned instanceof Error) return;
						const token = resetToken(ctx);
						if (!token) return;
						const marker = await ctx.context.internalAdapter.consumeVerificationValue(
							passwordSetupMarkerIdentifier(token),
						);
						if (!marker) return;
						await ctx.context.internalAdapter.updateUser(marker.value, { emailVerified: true });
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
