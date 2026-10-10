/**
 * Payroll export formats (#823): the one list of known format ids and their
 * kind. A file format produces a file through a formatter and carries the
 * expense lines of a payroll run (#851); an API format pushes to the provider
 * through a connector. The export service registers one implementation per id,
 * and every other list of format ids derives from this one. Free of server
 * imports so the settings UI can share it.
 */

export type PayrollExportFormatKind = "file" | "api";

type PayrollExportFormatEntry =
	| {
			id: string;
			kind: "file";
			/** Offered by the payroll workspace's export. */
			payrollWorkspace: boolean;
	  }
	| { id: string; kind: "api" };

/** In the order the export form offers them. */
export const PAYROLL_EXPORT_FORMATS = [
	{ id: "datev_lohn", kind: "file", payrollWorkspace: true },
	{ id: "lexware_lohn", kind: "file", payrollWorkspace: true },
	{ id: "sage_lohn", kind: "file", payrollWorkspace: true },
	{ id: "personio", kind: "api" },
	{ id: "successfactors_api", kind: "api" },
	{ id: "successfactors_csv", kind: "file", payrollWorkspace: false },
	{ id: "workday_api", kind: "api" },
] as const satisfies readonly PayrollExportFormatEntry[];

type PayrollExportFormat = (typeof PAYROLL_EXPORT_FORMATS)[number];

export type PayrollExportFormatId = PayrollExportFormat["id"];
export type PayrollExportFileFormatId = Extract<PayrollExportFormat, { kind: "file" }>["id"];
export type PayrollExportApiFormatId = Extract<PayrollExportFormat, { kind: "api" }>["id"];
export type PayrollWorkspaceExportFormatId = Extract<
	PayrollExportFormat,
	{ payrollWorkspace: true }
>["id"];

/** The registry widened, so lookups take any string. */
function formats(): readonly PayrollExportFormatEntry[] {
	return PAYROLL_EXPORT_FORMATS;
}

export function payrollExportFormatIds(): PayrollExportFormatId[] {
	return formats().map((format) => format.id as PayrollExportFormatId);
}

export function isPayrollExportFormatId(value: unknown): value is PayrollExportFormatId {
	return formats().some((format) => format.id === value);
}

export function payrollExportFormatKind(formatId: string): PayrollExportFormatKind | undefined {
	return formats().find((format) => format.id === formatId)?.kind;
}

export function payrollExportFileFormatIds(): PayrollExportFileFormatId[] {
	return formats()
		.filter((format) => format.kind === "file")
		.map((format) => format.id as PayrollExportFileFormatId);
}

export function payrollWorkspaceExportFormatIds(): PayrollWorkspaceExportFormatId[] {
	return formats()
		.filter((format) => format.kind === "file" && format.payrollWorkspace)
		.map((format) => format.id as PayrollWorkspaceExportFormatId);
}

export function isPayrollWorkspaceExportFormatId(
	value: unknown,
): value is PayrollWorkspaceExportFormatId {
	return payrollWorkspaceExportFormatIds().some((id) => id === value);
}
