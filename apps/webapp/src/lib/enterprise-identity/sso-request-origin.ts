import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { classifyDomainHost } from "@/lib/domain/platform-domain";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";

export const ssoRequestOrigin = {
	id: "z8-sso-request-origin",
	hooks: {
		before: [
			{
				matcher: (ctx) => ctx.path === "/sign-in/sso" || !!ctx.path?.startsWith("/sso/"),
				handler: createAuthMiddleware(async (ctx) => {
					const headers = ctx.headers ?? ctx.request?.headers;
					if (!headers || classifyDomainHost(headers.get("host"))?.type !== "customDomain") return;

					// Better Auth's static allowedHosts cannot include domains verified after startup.
					// Set the endpoint's request-local base URL for both authorization and code exchange.
					let origin: string;
					try {
						origin = await resolvePublicRequestOrigin({ headers, url: ctx.context.baseURL });
					} catch {
						throw new APIError("FORBIDDEN", { message: "SSO requires a verified sign-in domain." });
					}
					ctx.context.baseURL = origin + new URL(ctx.context.baseURL).pathname;
				}),
			},
		],
	},
} satisfies BetterAuthPlugin;
