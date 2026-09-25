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
import { queueAfterTransactionHook } from "@better-auth/core/context";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import {
	type AuthorizationMutationScope,
	protectAuthorizationMutation,
} from "@/lib/authorization/authorization-mutation";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";
import {
	type CoordinatedAuthContext,
	requireAuthTransaction,
	runCoordinatedAuthMutation,
} from "./auth-transaction";
import {
	completeRemovedMemberCleanupPostCommit,
	revokeRemovedMemberAccessInTransaction,
} from "./member-removal-cleanup";

type OrganizationHooks = NonNullable<OrganizationOptions["organizationHooks"]>;

const ORGANIZATION_LEAVE_PATH = "/organization/leave";
const GLOBAL_ACCESS_PATHS = new Set([
	"/admin/set-role",
	"/admin/ban-user",
	"/admin/unban-user",
	"/admin/update-user",
	"/admin/remove-user",
]);
const COORDINATED_AUTH_MUTATION_PATHS = new Set([
	"/organization/update-member-role",
	"/organization/remove-member",
	ORGANIZATION_LEAVE_PATH,
	"/organization/add-member",
	"/organization/accept-invitation",
	"/organization/delete",
	...GLOBAL_ACCESS_PATHS,
]);

async function protectAuthMutation(
	operation: string,
	scope: Omit<AuthorizationMutationScope, "route">,
) {
	await protectAuthorizationMutation(requireAuthTransaction(operation), scope);
}

/** Deactivates the removed member in the removal transaction; the rest runs after commit. */
async function cleanUpRemovedMember(input: { organizationId: string; userId: string }) {
	const transaction = requireAuthTransaction("organization member removal cleanup");
	const outcome = await revokeRemovedMemberAccessInTransaction(
		transaction,
		input.userId,
		input.organizationId,
	);
	await queueAfterTransactionHook(() =>
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
			await queueAfterTransactionHook(() => hooks.afterAddMember(data));
		},
		beforeAcceptInvitation: async ({ user, organization }) => {
			await protectAuthMutation("organization invitation acceptance", {
				organizationId: organization.id,
				userIds: [user.id],
			});
		},
		afterAcceptInvitation: async (data) => {
			await queueAfterTransactionHook(() => hooks.afterAcceptInvitation(data));
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

/**
 * Guards the Better Auth writers without organization hooks: leaving an
 * organization (plus its removal cleanup) and admin global access changes.
 */
export function authMutationCoordinationPlugin() {
	return {
		id: "z8-auth-mutation-coordination",
		hooks: {
			before: [
				{
					matcher: (context) => context.path === ORGANIZATION_LEAVE_PATH,
					handler: createAuthMiddleware(async (ctx) => {
						const organizationId = stringField(ctx.body, "organizationId");
						const session = await getSessionFromCtx(ctx);
						if (!organizationId || !session) return;
						await protectAuthMutation("organization leave", {
							organizationId,
							userIds: [session.user.id],
						});
					}),
				},
				{
					matcher: (context) => GLOBAL_ACCESS_PATHS.has(context.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						const userId = stringField(ctx.body, "userId");
						// Without a session the endpoint refuses before writing anything.
						if (!userId || !(await getSessionFromCtx(ctx))) return;
						await acquireExclusiveUserConfigurationAccessGuards(
							requireAuthTransaction("global user access change"),
							[userId],
						);
					}),
				},
			],
			after: [
				{
					matcher: (context) => context.path === ORGANIZATION_LEAVE_PATH,
					handler: createAuthMiddleware(async (ctx) => {
						const left = ctx.context.returned;
						const userId = stringField(left, "userId");
						const organizationId = stringField(left, "organizationId");
						if (left instanceof Error || !userId || !organizationId) return;
						await cleanUpRemovedMember({ organizationId, userId });
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
