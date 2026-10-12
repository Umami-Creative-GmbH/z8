import "server-only";

import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";

/** The signed-in user and their active organization. */
export type OrganizationActor = { userId: string; organizationId: string };

/**
 * The signed-in user and their active organization; without either, throws the
 * caller's refusal (spec #761 server actions).
 */
export async function requireOrganizationActor(refusal: () => Error): Promise<OrganizationActor> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId) throw refusal();
	return { userId: authContext.user.id, organizationId };
}

/**
 * The signed-in user and their active organization when they may manage its
 * settings (owners and admins, `canManageCurrentOrganizationSettings`);
 * otherwise throws the caller's refusal.
 */
export async function requireOrganizationAdmin(refusal: () => Error): Promise<OrganizationActor> {
	const actor = await requireOrganizationActor(refusal);
	if (!(await canManageCurrentOrganizationSettings())) throw refusal();
	return actor;
}
