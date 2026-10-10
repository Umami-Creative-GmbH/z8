/**
 * Whether a write failed on one named database constraint, looking through the
 * causes a driver or Effect wrapper adds. `23505` is a unique violation (a
 * taken name), `23503` a foreign key violation (a row still referenced).
 */
export function isConstraintViolation(
	error: unknown,
	code: "23505" | "23503",
	constraints: string | readonly string[],
): boolean {
	const names: readonly string[] = typeof constraints === "string" ? [constraints] : constraints;
	const constraintNames = new Set(names);
	let candidate: unknown = error;
	for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (
			current.code === code &&
			typeof current.constraint === "string" &&
			constraintNames.has(current.constraint)
		) {
			return true;
		}
		candidate = current.cause;
	}
	return false;
}
