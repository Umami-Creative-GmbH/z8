import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import {
	canAccessOrganizationWithSso,
	type SessionSsoStore,
	SsoRequiredError,
} from "./session-sso";

type VerifiedLogin = {
	userId: string;
	organizationId: string;
	providerId: string;
};
const verifiedLogins = new WeakMap<object, VerifiedLogin>();
const ssoManagementPaths = new Set([
	"/sso/register",
	"/sso/get-provider",
	"/sso/update-provider",
	"/sso/delete-provider",
	"/sso/request-domain-verification",
	"/sso/verify-domain",
]);

function isSsoCallback(path: string | undefined) {
	return (
		path === "/sso/callback" ||
		path === "/sso/callback/:providerId" ||
		path === "/sso/saml2/sp/acs/:providerId"
	);
}

/** Call ONLY from @better-auth/sso's provisionUser, with provisionUserOnEveryLogin enabled.
 * That callback runs after IdP validation and successful authentication. Request input,
 * linked accounts, social OAuth and credential logins must never call this function.
 */
export async function recordVerifiedSsoLogin(input: {
	user: { id: string };
	provider: { providerId: string; organizationId?: string | null };
}): Promise<void> {
	const ctx = getCurrentAuthEndpointContext();
	if (!isSsoCallback(ctx.path))
		throw new Error("SSO provenance requires a verified SSO callback");
	if (!input.provider.organizationId) return;
	verifiedLogins.set(ctx.context, {
		userId: input.user.id,
		organizationId: input.provider.organizationId,
		providerId: input.provider.providerId,
	});
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function denySso(): never {
	throw new APIError("FORBIDDEN", {
		code: "SSO_REQUIRED",
		message: new SsoRequiredError().message,
	});
}

/** Runs for both HTTP and auth.api calls, independently of session cookie/Redis caching. */
export function createSsoEnforcementPlugin(
	store: SessionSsoStore,
): BetterAuthPlugin {
	return {
		id: "z8-sso-enforcement",
		hooks: {
			before: [
				{
					matcher: (ctx) =>
						!!ctx.path &&
						(ctx.path.startsWith("/organization/") ||
							ssoManagementPaths.has(ctx.path)),
					handler: createAuthMiddleware(async (ctx) => {
						// Organization discovery and creation must remain available for reauthentication/switching.
						if (
							[
								"/organization/list",
								"/organization/create",
								"/organization/check-slug",
								"/organization/list-user-invitations",
							].includes(ctx.path)
						)
							return;
						const session = await getSessionFromCtx(ctx);
						if (!session) return; // Better Auth enforces authentication, including server-only endpoints.
						const body = object(ctx.body);
						const query = object(ctx.query);
						const scopes = new Set<string>();
						const switching = ctx.path === "/organization/set-active";
						if (switching && body.organizationId === null) return;
						const activeId = object(session.session).activeOrganizationId;
						if (!switching && typeof activeId === "string")
							scopes.add(activeId);
						const inputs = [
							body,
							query,
							object(body.data),
							...(ctx.path === "/organization/get-invitation"
								? [{ invitationId: query.id }]
								: []),
						];
						for (const input of inputs) {
							if (
								ssoManagementPaths.has(ctx.path) &&
								typeof input.providerId === "string"
							) {
								const provider = await ctx.context.adapter.findOne<{
									organizationId: string | null;
								}>({
									model: "ssoProvider",
									where: [{ field: "providerId", value: input.providerId }],
								});
								if (provider?.organizationId)
									scopes.add(provider.organizationId);
							}
							if (
								typeof input.organizationId === "string" &&
								input.organizationId
							)
								scopes.add(input.organizationId);
							if (
								typeof input.organizationSlug === "string" &&
								input.organizationSlug
							) {
								const org = await ctx.context.adapter.findOne<{ id: string }>({
									model: "organization",
									where: [{ field: "slug", value: input.organizationSlug }],
								});
								if (org) scopes.add(org.id);
							}
							for (const [field, model] of [
								["invitationId", "invitation"],
								["teamId", "team"],
								["memberId", "member"],
							] as const) {
								const id = input[field];
								if (typeof id !== "string" || !id) continue;
								const resource = await ctx.context.adapter.findOne<{
									organizationId: string;
								}>({ model, where: [{ field: "id", value: id }] });
								if (resource) scopes.add(resource.organizationId);
							}
						}
						// list-team-members falls back to activeTeamId rather than the active organization.
						if (
							ctx.path === "/organization/list-team-members" &&
							!query.teamId
						) {
							const id = object(session.session).activeTeamId;
							if (typeof id === "string") {
								const team = await ctx.context.adapter.findOne<{
									organizationId: string;
								}>({ model: "team", where: [{ field: "id", value: id }] });
								if (team) scopes.add(team.organizationId);
							}
						}
						if (switching && scopes.size === 0 && typeof activeId === "string")
							scopes.add(activeId);
						for (const organizationId of scopes) {
							if (
								!(await canAccessOrganizationWithSso(
									store,
									session.session,
									organizationId,
								))
							)
								denySso();
						}
					}),
				},
			],
			after: [
				{
					matcher: (ctx) =>
						isSsoCallback(ctx.path) ||
						ctx.path === "/get-session" ||
						ctx.path === "/organization/list-user-invitations" ||
						ctx.path === "/organization/list-user-teams" ||
						ctx.path === "/sso/providers",
					handler: createAuthMiddleware(async (ctx) => {
						if (isSsoCallback(ctx.path)) {
							const verified = verifiedLogins.get(ctx.context);
							verifiedLogins.delete(ctx.context);
							const fresh = ctx.context.newSession;
							if (
								!verified ||
								!fresh ||
								fresh.user.id !== verified.userId ||
								fresh.session.userId !== verified.userId
							)
								return;
							await store.saveProvenance({
								...verified,
								sessionId: fresh.session.id,
							});
							return;
						}
						if (ctx.path === "/sso/providers") {
							const result = object(ctx.context.returned);
							if (!Array.isArray(result.providers)) return;
							const session = await getSessionFromCtx(ctx);
							const allowed = await Promise.all(
								result.providers.map(
									async (provider) =>
										!provider.organizationId ||
										(await canAccessOrganizationWithSso(
											store,
											session?.session,
											provider.organizationId,
										)),
								),
							);
							return ctx.json({
								...result,
								providers: result.providers.filter(
									(_, index) => allowed[index],
								),
							});
						}
						if (
							ctx.path === "/organization/list-user-invitations" ||
							ctx.path === "/organization/list-user-teams"
						) {
							const result = ctx.context.returned;
							if (!Array.isArray(result)) return;
							const session = await getSessionFromCtx(ctx);
							const allowed = await Promise.all(
								result.map(
									async (resource) =>
										typeof resource.organizationId === "string" &&
										(await canAccessOrganizationWithSso(
											store,
											session?.session,
											resource.organizationId,
										)),
								),
							);
							return ctx.json(result.filter((_, index) => allowed[index]));
						}
						const returned = object(ctx.context.returned);
						const session = object(returned.session);
						const organizationId = session.activeOrganizationId;
						if (typeof organizationId !== "string") return;
						if (
							await canAccessOrganizationWithSso(
								store,
								{
									id: String(session.id ?? ""),
									userId: String(session.userId ?? ""),
								},
								organizationId,
							)
						)
							return;
						// Keep identity available for SSO reauthentication and switching to non-SSO orgs,
						// but never expose an unauthorized active tenant to application API consumers.
						return ctx.json({
							...returned,
							ssoRequired: true,
							session: {
								...session,
								activeOrganizationId: null,
								activeTeamId: null,
							},
						});
					}),
				},
			],
		},
	};
}
