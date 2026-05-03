export function assertCanAssignEmployeeLegalEntity(input: {
	isOrgAdmin: boolean;
	currentLegalEntityId: string | null;
	nextLegalEntityId: string;
	allowedLegalEntityIds: string[];
}) {
	if (input.isOrgAdmin) {
		return;
	}

	if (input.currentLegalEntityId !== input.nextLegalEntityId) {
		throw new Error("Only organization admins can move employees between legal entities.");
	}

	if (!input.allowedLegalEntityIds.includes(input.nextLegalEntityId)) {
		throw new Error("You do not have access to this legal entity.");
	}
}
