/**
 * Payroll Export Module
 * Re-exports all public APIs
 */

// Types
export * from "./types";
export * from "./connectors/types";
export * from "./connectors/registry";

// Data fetcher functions
export {
	fetchWorkPeriodsForExport,
	fetchAbsencesForExport,
	getPayrollExportConfig,
	getWageTypeMappings,
	getWorkCategories,
	getAbsenceCategories,
	getEmployeesForFilter,
	getTeamsForFilter,
	getProjectsForFilter,
	countWorkPeriods,
} from "./data-fetcher";

// Export service
export {
	getFormatter,
	getAvailableFormatters,
	getExporter,
	getAvailableExporters,
	isApiBasedExport,
	createExportJob,
	processExportJob,
	getPendingExportJobs,
	getExportJobHistory,
	getExportDownloadUrl,
} from "./export-service";

// File-based formatters
export { DatevLohnFormatter, datevLohnFormatter } from "./formatters/datev-lohn-formatter";
export { LexwareLohnFormatter, lexwareLohnFormatter } from "./formatters/lexware-lohn-formatter";
export { SageLohnFormatter, sageLohnFormatter } from "./formatters/sage-lohn-formatter";

// API-based exporters
export { PersonioExporter, personioExporter } from "./exporters/personio";
export type {
	PersonioConfig,
	PersonioCredentials,
} from "./exporters/personio";

// SAP SuccessFactors exporter (API and CSV modes)
export {
	SuccessFactorsExporter,
	successFactorsExporter,
	SuccessFactorsFormatter,
	successFactorsFormatter,
} from "./exporters/successfactors";
export type {
	SuccessFactorsConfig,
	SuccessFactorsCredentials,
} from "./exporters/successfactors";

// Workday API connector
export { WorkdayConnector, workdayConnector } from "./exporters/workday";
export type { WorkdayConfig } from "./exporters/workday";
