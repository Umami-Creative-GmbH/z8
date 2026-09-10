import { trimStructuredNamePart } from "@/lib/auth/derived-user-name";

export interface AuthContextUser {
	id: string;
	email: string;
	name: string;
	firstName?: string;
	lastName?: string;
	image?: string;
	role?: string;
	canCreateOrganizations: boolean;
}

export interface SessionAuthUser {
	id: string;
	email: string;
	name: string;
	firstName?: string | null;
	lastName?: string | null;
	image?: string | null;
	role?: string | null;
	canCreateOrganizations?: boolean | null;
}

export function mapSessionUserToAuthContextUser(sessionUser: SessionAuthUser): AuthContextUser {
	return {
		id: sessionUser.id,
		email: sessionUser.email,
		name: sessionUser.name,
		firstName: trimStructuredNamePart(sessionUser.firstName),
		lastName: trimStructuredNamePart(sessionUser.lastName),
		image: sessionUser.image ?? undefined,
		role: sessionUser.role ?? undefined,
		canCreateOrganizations: sessionUser.canCreateOrganizations ?? false,
	};
}
