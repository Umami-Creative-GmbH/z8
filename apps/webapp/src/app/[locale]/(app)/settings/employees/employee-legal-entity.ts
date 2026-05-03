export function assertCanAssignEmployeeLegalEntity(input: {
	isOrgAdmin: boolean;
	currentLegalEntityId: string | null;
	nextLegalEntityId: string;
	allowedLegalEntityIds: string[];
}) {
	if (input.isOrgAdmin) {
		return;
	}

	if (input.currentLegalEntityId === input.nextLegalEntityId) {
		return;
	}

	throw new Error("Only organization admins can move employees between legal entities.");
}
