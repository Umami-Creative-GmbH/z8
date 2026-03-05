export type CanonicalParityTotals = {
	organizationId?: string;
	workCount: number;
	absenceCount: number;
	durationMinutes: number;
};

export type CanonicalReconciliationInput = {
	organizationId: string;
	legacy: CanonicalParityTotals;
	canonical: CanonicalParityTotals;
};

export type CanonicalReconciliationMetrics = {
	organizationId: string;
	workCountMismatch: number;
	absenceCountMismatch: number;
	durationMismatchMinutes: number;
	hasMismatch: boolean;
};

export function reconcileCanonicalParity(
	input: CanonicalReconciliationInput,
): CanonicalReconciliationMetrics {
	assertScopedToOrganization(input.organizationId, input.legacy.organizationId, "legacy");
	assertScopedToOrganization(input.organizationId, input.canonical.organizationId, "canonical");

	const workCountMismatch = Math.abs(input.legacy.workCount - input.canonical.workCount);
	const absenceCountMismatch = Math.abs(input.legacy.absenceCount - input.canonical.absenceCount);
	const durationMismatchMinutes = Math.abs(
		input.legacy.durationMinutes - input.canonical.durationMinutes,
	);

	return {
		organizationId: input.organizationId,
		workCountMismatch,
		absenceCountMismatch,
		durationMismatchMinutes,
		hasMismatch:
			workCountMismatch > 0 || absenceCountMismatch > 0 || durationMismatchMinutes > 0,
	};
}

function assertScopedToOrganization(
	expectedOrganizationId: string,
	actualOrganizationId: string | undefined,
	label: "legacy" | "canonical",
) {
	if (actualOrganizationId && actualOrganizationId !== expectedOrganizationId) {
		throw new Error(`Organization scope mismatch for canonical reconciliation (${label})`);
	}
}
