/** Only the validated reconciliation application boundary grants exact writes on its own transaction. */
const authorized = new WeakMap<object, ReadonlySet<string>>();
export function reconciledAbsenceKey(input: {
	organizationId: string;
	employeeId: string;
	categoryId?: string;
	startDate: string;
	endDate: string;
}) {
	return JSON.stringify([
		input.organizationId,
		input.employeeId,
		input.categoryId,
		input.startDate,
		input.endDate,
	]);
}
export function isAuthorizedReconciledAbsence(
	database: object,
	input: Parameters<typeof reconciledAbsenceKey>[0],
) {
	return authorized.get(database)?.has(reconciledAbsenceKey(input)) ?? false;
}
export async function withinReconciledAbsences<T>(
	database: object,
	keys: readonly string[],
	write: () => Promise<T>,
): Promise<T> {
	if (authorized.has(database))
		throw new Error("Nested historical reconciliation is not supported");
	authorized.set(database, new Set(keys));
	try {
		return await write();
	} finally {
		authorized.delete(database);
	}
}
