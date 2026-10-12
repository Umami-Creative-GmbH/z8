import { getSessionFromCtx } from "better-auth/api";

export type BeforeHookContext = Parameters<typeof getSessionFromCtx>[0];

export interface RequestingSession {
	userId: string;
	activeOrganizationId: string | null;
}

function toRequestingSession(found: {
	user: { id: string };
	session: Record<string, unknown>;
}): RequestingSession {
	const activeOrganizationId = found.session.activeOrganizationId;
	return {
		userId: found.user.id,
		activeOrganizationId: typeof activeOrganizationId === "string" ? activeOrganizationId : null,
	};
}

/**
 * The requesting session, from the session cookie or a bearer session token.
 * Before-hooks see the request's original headers: the bearer plugin's
 * cookie is only merged in after every before-hook has run.
 */
export async function requestingSession(ctx: BeforeHookContext): Promise<RequestingSession | null> {
	const session = await getSessionFromCtx(ctx);
	if (session) return toRequestingSession(session);
	const authorization =
		ctx.headers?.get("authorization") ?? ctx.request?.headers.get("authorization");
	if (authorization?.slice(0, 7).toLowerCase() !== "bearer ") return null;
	const token = decodeURIComponent(authorization.slice(7).trim()).split(".")[0];
	if (!token) return null;
	const found = await ctx.context.internalAdapter.findSession(token);
	return found && found.session.expiresAt > new Date() ? toRequestingSession(found) : null;
}
