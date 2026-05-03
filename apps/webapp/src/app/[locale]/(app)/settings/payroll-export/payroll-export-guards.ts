export function assertSingleLegalEntityPayrollFilter(input: {
	selectedLegalEntityId: string;
	employees: { id: string; legalEntityId: string }[];
}) {
	const hasOtherEntity = input.employees.some(
		(employeeRecord) => employeeRecord.legalEntityId !== input.selectedLegalEntityId,
	);

	if (hasOtherEntity) {
		throw new Error("Payroll exports can include employees from only one legal entity.");
	}
}

export function assertPayrollConfigForMappingMutation(input: {
	config: { organizationId: string; legalEntityId: string | null } | null | undefined;
	organizationId: string;
	legalEntityId: string;
}) {
	if (
		!input.config ||
		input.config.organizationId !== input.organizationId ||
		input.config.legalEntityId !== input.legalEntityId
	) {
		throw new Error("Configuration not found or access denied");
	}
}
