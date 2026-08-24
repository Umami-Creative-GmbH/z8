import type { SCIMIdentityResolutionContext } from "@better-auth/scim";

const SCIM_READ_MODEL = {
	user: "user",
	member: "member",
} as const;

export interface SCIMReadUser {
	id: string;
	emailVerified: boolean;
}

export interface SCIMReadMember {
	id: string;
}

export interface SCIMReadStore {
	findUserByEmail(email: string): Promise<SCIMReadUser | null>;
	findOrganizationMember(
		userId: string,
		organizationId: string,
	): Promise<SCIMReadMember | null>;
}

type SCIMReadDatabase = SCIMIdentityResolutionContext["database"];

export function createSCIMReadStore(database: SCIMReadDatabase): SCIMReadStore {
	return {
		findUserByEmail: (email) =>
			database.findOne<SCIMReadUser>({
				model: SCIM_READ_MODEL.user,
				select: ["id", "emailVerified"],
				where: [{ field: "email", value: email, mode: "insensitive" }],
			}),
		findOrganizationMember: (userId, organizationId) =>
			database.findOne<SCIMReadMember>({
				model: SCIM_READ_MODEL.member,
				select: ["id"],
				where: [
					{ field: "userId", value: userId },
					{ field: "organizationId", value: organizationId },
				],
			}),
	};
}
