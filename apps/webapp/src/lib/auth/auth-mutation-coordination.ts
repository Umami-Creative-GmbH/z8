/**
 * Better Auth membership, role and global access writers under the #264
 * configuration/access protocol (#314).
 *
 * Manual creation reads the actor's and target's membership (role, status),
 * employee active state and the user's global role and ban while holding the
 * shared organization and user configuration/access guards. Better Auth owns
 * the writes of those facts, so each one takes the exclusive counterpart
 * (#313's `protectAuthorizationMutation`) in the before-hook of its endpoint,
 * inside the transaction that also commits the write:
 *
 * - role update, member removal, member addition and invitation acceptance:
 *   the member's user;
 * - organization deletion (it cascades every membership): the organization;
 * - leaving an organization (no Better Auth hook): the leaving user, from this
 *   module's plugin;
 * - admin role, ban, update and removal: the user, globally.
 *
 * Organization creation (#359) is one coordinated transaction: the
 * organization, its owner membership (guarded like any member addition) and
 * one approval rollout row per workflow type commit together or not at all.
 *
 * Every hook fails closed outside a coordinated transaction
 * (`requireAuthTransaction`): server callers wrap the call in
 * `runCoordinatedAuthMutation`, and `/api/auth` wraps these paths with
 * `handleCoordinatedAuthRequest`. A failed coordinated request rolls back.
 *
 * Removal cleanup is part of the removal: the employee is deactivated and the
 * organization's session rows are deleted in the same transaction, and only
 * the secondary-storage session deletion and billing reconciliation wait for
 * the commit. Provisioning after a membership is added or accepted keeps its
 * existing after-commit timing.
 */
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { type OrganizationOptions, organization } from "better-auth/plugins/organization";
import { createOrganizationApprovalRollouts } from "@/lib/approvals/workflow/organization-rollout";
import {
	type AuthorizationMutationScope,
	protectAuthorizationMutation,
} from "@/lib/authorization/authorization-mutation";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";
import {
	type CoordinatedAuthContext,
	queueAfterAuthTransactionCommit,
	requireAuthTransaction,
	runCoordinatedAuthMutation,
	UncoordinatedAuthMutationError,
} from "./auth-transaction";
import {
	completeRemovedMemberCleanupPostCommit,
	revokeRemovedMemberAccessInTransaction,
} from "./member-removal-cleanup";

type OrganizationHooks = NonNullable<OrganizationOptions["organizationHooks"]>;

// Paths come from Better Auth's own endpoint definitions, so a renamed
// endpoint cannot silently fall out of coordination. `addMember` is
// server-only (no HTTP path); its callers use `runCoordinatedAuthMutation`.
const organizationEndpoints = organization().endpoints;
const adminEndpoints = admin().endpoints;
const ORGANIZATION_LEAVE_PATH = organizationEndpoints.leaveOrganization.path;
const GLOBAL_ACCESS_PATHS = new Set<string>([
	adminEndpoints.setRole.path,
	adminEndpoints.banUser.path,
	adminEndpoints.unbanUser.path,
	adminEndpoints.adminUpdateUser.path,
	adminEndpoints.removeUser.path,
]);
const COORDINATED_AUTH_MUTATION_PATHS = new Set<string>([
	organizationEndpoints.createOrganization.path,
	organizationEndpoints.updateMemberRole.path,
	organizationEndpoints.removeMember.path,
	ORGANIZATION_LEAVE_PATH,
	organizationEndpoints.acceptInvitation.path,
	organizationEndpoints.deleteOrganization.path,
	...GLOBAL_ACCESS_PATHS,
]);

/** Users whose exclusive guard each coordinated transaction took before writing. */
const protectedUsers = new WeakMap<object, Set<string>>();

function recordProtectedUsers(transaction: object, userIds: readonly string[]) {
	const users = protectedUsers.get(transaction) ?? new Set<string>();
	for (const userId of userIds) users.add(userId);
	protectedUsers.set(transaction, users);
}

async function protectAuthMutation(
	operation: string,
	scope: Omit<AuthorizationMutationScope, "route">,
) {
	const transaction = requireAuthTransaction(operation);
	await protectAuthorizationMutation(transaction, scope);
	recordProtectedUsers(transaction, scope.userIds ?? []);
}

/** Refuses (rolling back) a write whose user was not guarded before it. */
function assertProtected(operation: string, userId: string) {
	const transaction = requireAuthTransaction(operation);
	if (!protectedUsers.get(transaction)?.has(userId)) {
		throw new UncoordinatedAuthMutationError(operation);
	}
}

/**
 * Deactivates the removed member in the removal transaction; the rest runs
 * after commit. Refuses (rolling the removal back) unless the removal took
 * the member's guard before deleting the membership.
 */
async function cleanUpRemovedMember(input: { organizationId: string; userId: string }) {
	assertProtected("organization member removal", input.userId);
	const transaction = requireAuthTransaction("organization member removal cleanup");
	const outcome = await revokeRemovedMemberAccessInTransaction(
		transaction,
		input.userId,
		input.organizationId,
	);
	await queueAfterAuthTransactionCommit(() =>
		completeRemovedMemberCleanupPostCommit({
			organizationId: input.organizationId,
			sessionTokens: outcome.sessionTokens,
		}),
	);
}

export function createCoordinatedOrganizationHooks(
	hooks: Required<
		Pick<OrganizationHooks, "beforeUpdateOrganization" | "afterAcceptInvitation" | "afterAddMember">
	>,
): OrganizationHooks {
	return {
		// Refuses before the organization row is written, so an uncoordinated
		// creation cannot leave an organization without its owner or rollout rows.
		beforeCreateOrganization: async () => {
			requireAuthTransaction("organization creation");
		},
		afterCreateOrganization: async ({ organization }) => {
			const transaction = requireAuthTransaction("organization creation");
			await createOrganizationApprovalRollouts(transaction, organization.id);
		},
		beforeUpdateOrganization: hooks.beforeUpdateOrganization,
		beforeUpdateMemberRole: async ({ member, organization }) => {
			await protectAuthMutation("organization member role update", {
				organizationId: organization.id,
				userIds: [member.userId],
			});
		},
		beforeRemoveMember: async ({ member, organization }) => {
			await protectAuthMutation("organization member removal", {
				organizationId: organization.id,
				userIds: [member.userId],
			});
		},
		afterRemoveMember: async ({ member, organization }) => {
			await cleanUpRemovedMember({ organizationId: organization.id, userId: member.userId });
		},
		beforeAddMember: async ({ member, organization }) => {
			await protectAuthMutation("organization member addition", {
				organizationId: organization.id,
				userIds: [member.userId],
			});
		},
		afterAddMember: async (data) => {
			await queueAfterAuthTransactionCommit(() => hooks.afterAddMember(data));
		},
		beforeAcceptInvitation: async ({ user, organization }) => {
			await protectAuthMutation("organization invitation acceptance", {
				organizationId: organization.id,
				userIds: [user.id],
			});
		},
		afterAcceptInvitation: async (data) => {
			await queueAfterAuthTransactionCommit(() => hooks.afterAcceptInvitation(data));
		},
		beforeDeleteOrganization: async ({ organization }) => {
			await protectAuthMutation("organization deletion", {
				organizationId: organization.id,
				organizationWide: true,
			});
		},
	};
}

function stringField(body: unknown, field: string): string | null {
	if (!body || typeof body !== "object") return null;
	const value = (body as Record<string, unknown>)[field];
	return typeof value === "string" && value ? value : null;
}

type BeforeHookContext = Parameters<typeof getSessionFromCtx>[0];

/**
 * The requesting user, from the session cookie or a bearer session token.
 * Before-hooks see the request's original headers: the bearer plugin's
 * cookie is only merged in after every before-hook has run.
 */
async function requestingUserId(ctx: BeforeHookContext): Promise<string | null> {
	const session = await getSessionFromCtx(ctx);
	if (session) return session.user.id;
	const authorization =
		ctx.headers?.get("authorization") ?? ctx.request?.headers.get("authorization");
	if (authorization?.slice(0, 7).toLowerCase() !== "bearer ") return null;
	const token = decodeURIComponent(authorization.slice(7).trim()).split(".")[0];
	if (!token) return null;
	const found = await ctx.context.internalAdapter.findSession(token);
	return found && found.session.expiresAt > new Date() ? found.user.id : null;
}

/**
 * Guards the Better Auth writers without organization hooks: leaving an
 * organization (plus its removal cleanup) and admin global access changes.
 * Both require the coordinated transaction before anything else, lock only
 * for a resolved caller, and refuse a successful write whose user was not
 * guarded first (for a caller this hook could not resolve).
 */
export function authMutationCoordinationPlugin() {
	return {
		id: "z8-auth-mutation-coordination",
		hooks: {
			before: [
				{
					matcher: (context) => context.path === ORGANIZATION_LEAVE_PATH,
					handler: createAuthMiddleware(async (ctx) => {
						requireAuthTransaction("organization leave");
						const organizationId = stringField(ctx.body, "organizationId");
						const userId = await requestingUserId(ctx);
						// Unresolved here, the removal cleanup refuses the unguarded leave.
						if (!organizationId || !userId) return;
						await protectAuthMutation("organization leave", { organizationId, userIds: [userId] });
					}),
				},
				{
					matcher: (context) => GLOBAL_ACCESS_PATHS.has(context.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const transaction = requireAuthTransaction("global user access change");
						const userId = stringField(ctx.body, "userId");
						// An anonymous request is refused by the endpoint and locks nothing.
						if (!userId || !(await requestingUserId(ctx))) return;
						await acquireExclusiveUserConfigurationAccessGuards(transaction, [userId]);
						recordProtectedUsers(transaction, [userId]);
					}),
				},
			],
			after: [
				{
					matcher: (context) => context.path === ORGANIZATION_LEAVE_PATH,
					handler: createAuthMiddleware(async (ctx) => {
						const leaveResult = ctx.context.returned;
						const userId = stringField(leaveResult, "userId");
						const organizationId = stringField(leaveResult, "organizationId");
						if (leaveResult instanceof Error || !userId || !organizationId) return;
						await cleanUpRemovedMember({ organizationId, userId });
					}),
				},
				{
					matcher: (context) => GLOBAL_ACCESS_PATHS.has(context.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const userId = stringField(ctx.body, "userId");
						if (ctx.context.returned instanceof Error || !userId) return;
						assertProtected("global user access change", userId);
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}

function authPath(request: Request, basePath: string) {
	const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
	return pathname.startsWith(basePath) ? pathname.slice(basePath.length) : null;
}

export function isCoordinatedAuthMutationPath(path: string) {
	return COORDINATED_AUTH_MUTATION_PATHS.has(path);
}

class RolledBackAuthResponse extends Error {
	constructor(readonly response: Response) {
		super("Coordinated auth request failed");
	}
}

/**
 * Runs a coordinated `/api/auth` mutation request in one transaction; a
 * response with an error status rolls the transaction back.
 */
export async function handleCoordinatedAuthRequest<Options extends BetterAuthOptions>(
	authContext: CoordinatedAuthContext<Options>,
	request: Request,
	handle: (request: Request) => Promise<Response>,
	basePath = "/api/auth",
): Promise<Response> {
	const path = authPath(request, basePath);
	if (request.method !== "POST" || !path || !isCoordinatedAuthMutationPath(path)) {
		return handle(request);
	}
	try {
		return await runCoordinatedAuthMutation(authContext, async () => {
			const response = await handle(request);
			if (response.status >= 400) throw new RolledBackAuthResponse(response);
			return response;
		});
	} catch (error) {
		if (error instanceof RolledBackAuthResponse) return error.response;
		throw error;
	}
}
