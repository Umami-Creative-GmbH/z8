import { personioExporter } from "../exporters/personio";
import type {
	AbsenceData,
	ApiExportResult,
	IPayrollExporter,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";

export function createPersonioConnector(exporter: IPayrollExporter = personioExporter): IPayrollExporter {
	return {
		exporterId: exporter.exporterId,
		exporterName: exporter.exporterName,
		version: exporter.version,
		validateConfig(config: Record<string, unknown>): Promise<{ valid: boolean; errors?: string[] }> {
			return exporter.validateConfig(config);
		},
		testConnection(
			organizationId: string,
			config: Record<string, unknown>,
		): Promise<{ success: boolean; error?: string }> {
			return exporter.testConnection(organizationId, config);
		},
		export(
			organizationId: string,
			workPeriods: WorkPeriodData[],
			absences: AbsenceData[],
			mappings: WageTypeMapping[],
			config: Record<string, unknown>,
		): Promise<ApiExportResult> {
			return exporter.export(organizationId, workPeriods, absences, mappings, config);
		},
		getSyncThreshold(): number {
			return exporter.getSyncThreshold();
		},
	};
}

export const personioConnector = createPersonioConnector();
