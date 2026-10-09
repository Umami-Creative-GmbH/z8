/**
 * Matches a payslip batch file to employees by personnel number (#868). Pure:
 * the caller passes the candidates, which are only the employees in the
 * actor's scope for payslips (former employees included, for final payslips).
 *
 * A personnel number matches when it appears in the file's base name (folders
 * and the file extension removed) as a whole token: delimited on both sides by
 * a non-alphanumeric character or the start or end of the name. Numbers are
 * trimmed, leading zeros stay significant and letters compare
 * case-insensitively. Employees without a personnel number never match.
 */

export interface PayslipMatchCandidate {
	employeeId: string;
	personnelNumber: string | null;
}

export type PayslipFileMatch =
	| { kind: "matched"; employeeId: string }
	| { kind: "unmatched" }
	/** Several employees share the number, or tokens match different employees. */
	| { kind: "ambiguous"; employeeIds: string[] };

const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/** The base name without folders and without a trailing extension such as `.pdf`. */
export function payslipMatchName(fileName: string): string {
	const baseName = fileName.split(/[/\\]/).pop() ?? "";
	return baseName.replace(/\.[A-Za-z][A-Za-z0-9]{0,4}$/, "");
}

function isBoundary(character: string | undefined): boolean {
	return character === undefined || !ALPHANUMERIC.test(character);
}

function containsToken(name: string, token: string): boolean {
	let from = 0;
	while (from <= name.length - token.length) {
		const at = name.indexOf(token, from);
		if (at < 0) return false;
		if (isBoundary(name[at - 1]) && isBoundary(name[at + token.length])) return true;
		from = at + 1;
	}
	return false;
}

export function matchPayslipFile(
	fileName: string,
	candidates: readonly PayslipMatchCandidate[],
): PayslipFileMatch {
	const name = payslipMatchName(fileName).toLocaleLowerCase("en");
	const matched = new Set<string>();
	for (const candidate of candidates) {
		const number = candidate.personnelNumber?.trim().toLocaleLowerCase("en");
		if (!number) continue;
		if (containsToken(name, number)) matched.add(candidate.employeeId);
	}
	const employeeIds = [...matched].sort();
	if (employeeIds.length === 0) return { kind: "unmatched" };
	if (employeeIds.length === 1) return { kind: "matched", employeeId: employeeIds[0] as string };
	return { kind: "ambiguous", employeeIds };
}
