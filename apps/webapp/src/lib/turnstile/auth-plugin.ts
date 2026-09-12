import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { resolveTurnstileAuthPolicy } from "./auth-policy";
import { verifyTurnstileToken } from "./service";

const protectedPaths = new Set([
	"/sign-up/email",
	"/sign-in/email",
	"/request-password-reset",
	// Older Better Auth releases called the reset-request endpoint /forget-password.
	"/forget-password",
]);

/** Before hooks cover both HTTP and direct auth.api calls; onRequest alone does not. */
export function turnstileAuthGuard() {
	return {
		id: "z8-turnstile-auth-guard",
		hooks: {
			before: [
				{
					matcher: (ctx) =>
						!!ctx.path && protectedPaths.has(ctx.path.replace(/\/+$/, "")),
					handler: createAuthMiddleware(async (ctx) => {
						const headers = ctx.headers ?? ctx.request?.headers;
						let policy: Awaited<ReturnType<typeof resolveTurnstileAuthPolicy>>;
						try {
							// Next.js may construct request.url from its internal listening address.
							// Use the routed Host, validated against known platform/verified domains.
							const requestHost = ctx.request
								? new URL(ctx.request.url).host
								: undefined;
							const host =
								headers?.get("host") ??
								requestHost ??
								new URL(ctx.context.baseURL).host;
							policy = await resolveTurnstileAuthPolicy(host);
						} catch {
							throw new APIError("BAD_REQUEST", {
								code: "TURNSTILE_POLICY_UNAVAILABLE",
								message:
									"Unable to determine verification policy for this domain.",
							});
						}
						if (!policy.enabled) return;

						const token = headers?.get("x-captcha-response")?.trim();
						if (!token) {
							throw new APIError("BAD_REQUEST", {
								code: "TURNSTILE_REQUIRED",
								message: "Please complete the verification.",
							});
						}
						const result =
							token.length <= 2048
								? await verifyTurnstileToken(
										token,
										policy.organizationId,
										policy.isEnterprise,
										policy.hostname,
									)
								: { success: false };
						if (!result.success) {
							throw new APIError("BAD_REQUEST", {
								code: "TURNSTILE_FAILED",
								message: "Verification failed. Please try again.",
							});
						}
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
