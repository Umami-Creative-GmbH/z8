import type {
	SCIMIdentityResolution,
	SCIMIdentityResolutionContext,
	SCIMIdentityResolutionInput,
} from "@better-auth/scim";
import { APIError } from "better-auth/api";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { createSCIMReadStore } from "./transaction-store";

const SCIM_IDENTITY_CONFLICT = {
	schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
	status: "409",
	detail: "The SCIM identity cannot be linked",
} as const;

/** A kiosk-only placeholder address is never an SSO or SCIM identity (ADR 0006, #857). */
function namesReservedEmail(resource: SCIMIdentityResolutionInput["resource"]): boolean {
	return (
		isReservedEmail(resource.userName) ||
		isReservedEmail(resource.primaryEmail) ||
		(resource.emails ?? []).some((email) => isReservedEmail(email?.value))
	);
}

export async function resolveSCIMIdentity(
	input: SCIMIdentityResolutionInput,
	context: SCIMIdentityResolutionContext,
): Promise<SCIMIdentityResolution> {
	const externalId = input.resource.externalId;
	if (!externalId?.trim() || namesReservedEmail(input.resource)) {
		throw new APIError("CONFLICT", SCIM_IDENTITY_CONFLICT);
	}

	const store = createSCIMReadStore(context.database);
	const userIds = await store.findUserIdsByProviderSubject(
		input.provisioningDomainId,
		externalId,
	);
	if (userIds.length === 1) {
		const userId = userIds[0];
		const member = await store.findOrganizationMember(
			userId,
			input.provisioningDomainId,
		);
		if (member) {
			return { action: "link", userId, profile: "preserve" };
		}
	}

	throw new APIError("CONFLICT", SCIM_IDENTITY_CONFLICT);
}
