export interface LegalEntityAccessScope {
	isOrgAdmin: boolean;
	allowedLegalEntityIds: string[];
}

export function canAccessLegalEntity(scope: LegalEntityAccessScope, legalEntityId: string) {
	return scope.isOrgAdmin || scope.allowedLegalEntityIds.includes(legalEntityId);
}

export interface ResolveSelectedLegalEntityIdInput extends LegalEntityAccessScope {
	requestedLegalEntityId: string | null;
	defaultLegalEntityId: string;
}

export function resolveSelectedLegalEntityId(input: ResolveSelectedLegalEntityIdInput) {
	if (input.requestedLegalEntityId) {
		if (!canAccessLegalEntity(input, input.requestedLegalEntityId)) {
			throw new Error("You do not have access to this legal entity.");
		}

		return input.requestedLegalEntityId;
	}

	if (input.isOrgAdmin) {
		return input.defaultLegalEntityId;
	}

	const [firstAllowedEntity] = input.allowedLegalEntityIds;
	if (!firstAllowedEntity) {
		throw new Error("No legal entity access is available for this user.");
	}

	return firstAllowedEntity;
}
