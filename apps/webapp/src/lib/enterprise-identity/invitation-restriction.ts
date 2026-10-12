/**
 * Enforces the enterprise identity "Restrict invites" rule on Better Auth's
 * `/organization/invite-member` endpoint, for HTTP requests and `auth.api`
 * calls alike (#1024). The settings server actions check it too, for a
 * field-level error; this is the boundary a direct request cannot skip.
 *
 * The endpoint has two branches. A new invitation runs the organization
 * plugin's `beforeCreateInvitation` hook after Better Auth's membership and
 * permission checks. Resending a pending invitation (`resend: true`) returns
 * before that hook, so a before-hook covers it.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { type OrganizationOptions, organization } from "better-auth/plugins/organization";
import { requestingSession } from "@/lib/auth/requesting-session";
import {
	assertEnterpriseIdentityInvitationAllowed,
	EnterpriseIdentityEmailNotAllowedError,
} from "./enforcement";

type BeforeCreateInvitation = NonNullable<
	NonNullable<OrganizationOptions["organizationHooks"]>["beforeCreateInvitation"]
>;

const INVITE_MEMBER_PATH = organization().endpoints.createInvitation.path;

async function refuseOutsideEnterpriseIdentityDomain(organizationId: string, email: string) {
	try {
		await assertEnterpriseIdentityInvitationAllowed({ organizationId, email });
	} catch (error) {
		if (error instanceof EnterpriseIdentityEmailNotAllowedError) {
			throw new APIError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
}

export const refuseInvitationOutsideEnterpriseIdentity: BeforeCreateInvitation = async ({
	invitation,
	organization,
}) => {
	await refuseOutsideEnterpriseIdentityDomain(organization.id, invitation.email);
};

function stringField(body: unknown, field: string): string | null {
	if (!body || typeof body !== "object") return null;
	const value = (body as Record<string, unknown>)[field];
	return typeof value === "string" && value ? value : null;
}

export function enterpriseIdentityInvitationResendPlugin() {
	return {
		id: "z8-enterprise-identity-invitation-resend",
		hooks: {
			before: [
				{
					matcher: (context) =>
						context.path === INVITE_MEMBER_PATH &&
						(context.body as { resend?: unknown } | undefined)?.resend === true,
					handler: createAuthMiddleware(async (ctx) => {
						const email = stringField(ctx.body, "email");
						const session = await requestingSession(ctx);
						if (!email || !session) return;
						// Better Auth's own fallback when the body names no organization.
						const organizationId =
							stringField(ctx.body, "organizationId") ?? session.activeOrganizationId;
						if (!organizationId) return;
						// Better Auth refuses non-members itself; only members learn the domain.
						const membership = await ctx.context.adapter.findOne({
							model: "member",
							where: [
								{ field: "organizationId", value: organizationId },
								{ field: "userId", value: session.userId },
							],
						});
						if (!membership) return;
						await refuseOutsideEnterpriseIdentityDomain(organizationId, email);
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
