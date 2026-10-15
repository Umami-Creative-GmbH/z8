import type { EmploymentDateCorrectionImpact } from "./employment-date-correction-types";
import type { EmploymentDateCsvResult } from "./employment-date-upload-csv";
export interface EmploymentDateUploadRow {
	row: number;
	employeeNumber: string;
	employmentStartDate: string | null;
	suppliedEmploymentStartDate: string;
	reason: string;
	employee: {
		id: string;
		name: string;
		isActive: boolean;
		employmentStartDate: string | null;
	} | null;
	impact: EmploymentDateCorrectionImpact | null;
	errors: Array<{ code: string; message: string }>;
}
export type EmploymentDateUploadOutcome =
	| {
			status: "invalid_file";
			code: Extract<EmploymentDateCsvResult, { ok: false }>["code"];
			missingColumns?: string[];
	  }
	| { status: "has_errors"; rows: EmploymentDateUploadRow[] }
	| { status: "ready"; rows: EmploymentDateUploadRow[]; fingerprint: string }
	| {
			status: "committed";
			rows: EmploymentDateUploadRow[];
			corrected: number;
			refreshPending: boolean;
	  };
