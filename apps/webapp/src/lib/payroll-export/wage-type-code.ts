import type { WageTypeMapping } from "./types";

export type WageTypeCodeFormat = "datev" | "lexware" | "sage" | "successFactors";

/**
 * The code a mapping carries for one export format (#816).
 *
 * An organization's mappings serve every format, so each format reads only its
 * own column. A row without that code is unmapped for the format: it never
 * borrows another format's code or the legacy generic `wageTypeCode`.
 */
export function wageTypeCodeFor(
	mapping: WageTypeMapping | undefined,
	format: WageTypeCodeFormat,
): string | null {
	if (!mapping) return null;
	const code = {
		datev: mapping.datevWageTypeCode,
		lexware: mapping.lexwareWageTypeCode,
		sage: mapping.sageWageTypeCode,
		successFactors: mapping.successFactorsTimeTypeCode,
	}[format];
	return code || null;
}

/**
 * The legacy generic code, for rows that carry no format-specific code.
 *
 * The settings form fills `wageTypeCode` from the first format code it saves,
 * so on its rows the generic code is some other format's code.
 */
export function legacyOnlyWageTypeCode(mapping: WageTypeMapping | undefined): string | null {
	if (!mapping) return null;
	if (
		mapping.datevWageTypeCode ||
		mapping.lexwareWageTypeCode ||
		mapping.sageWageTypeCode ||
		mapping.successFactorsTimeTypeCode
	) {
		return null;
	}
	return mapping.wageTypeCode || null;
}
