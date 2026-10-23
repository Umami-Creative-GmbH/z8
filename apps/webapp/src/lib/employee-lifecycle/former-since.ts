/**
 * The "Former since …" date a row carries (#1439): present only on a former
 * employee's row, as the organization-local `YYYY-MM-DD` they left, or `null`
 * when that date isn't recorded. A current employee's row has no key, and a
 * view that doesn't know the date leaves it out too, so the label stays
 * "Former". Kept free of server imports: client rows use it as well.
 */
export type FormerSinceField = { formerSince?: string | null };

/** The `formerSince` field for a row marked former or current. */
export function formerSinceField(
	isFormer: boolean,
	since: string | null | undefined,
): FormerSinceField {
	return isFormer ? { formerSince: since ?? null } : {};
}

/**
 * The former mark of one row from the map `formerEmployeesAmong` returns:
 * `isFormer`, and `formerSince` on a former employee only.
 */
export function formerMark(
	formerSinceById: ReadonlyMap<string, string | null> | undefined,
	employeeId: string,
): { isFormer: boolean } & FormerSinceField {
	const isFormer = formerSinceById?.has(employeeId) ?? false;
	return { isFormer, ...formerSinceField(isFormer, formerSinceById?.get(employeeId)) };
}
