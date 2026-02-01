/**
 * Core types for payroll export system
 */
import type { DateTime } from "luxon";

// ============================================
// CONFIGURATION TYPES
// ============================================

/**
 * DATEV Lohn & Gehalt specific configuration
 */
export interface DatevLohnConfig {
	/** Client number (Mandantennummer) - 1-5 digits */
	mandantennummer: string;
	/** Consultant number (Beraternummer) - 1-7 digits */
	beraternummer: string;
	/** Personnel number type - which field to use as employee identifier */
	personnelNumberType: "employeeNumber" | "employeeId";
	/** Whether to include rows with zero hours */
	includeZeroHours: boolean;
}

/**
 * Default DATEV Lohn configuration
 */
export const DEFAULT_DATEV_CONFIG: DatevLohnConfig = {
	mandantennummer: "",
	beraternummer: "",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};

// ============================================
// WAGE TYPE MAPPING TYPES
// ============================================

/**
 * Special categories for wage type mapping (not work/absence categories)
 */
export const SPECIAL_WAGE_CATEGORIES = [
	"overtime",
	"holiday_compensation",
	"overtime_reduction",
] as const;

export type SpecialWageCategory = (typeof SPECIAL_WAGE_CATEGORIES)[number];

/**
 * Default DATEV wage type codes (Lohnarten)
 */
export const DEFAULT_DATEV_LOHNARTEN: Record<string, { code: string; name: string }> = {
	// Work time
	arbeitszeit: { code: "1000", name: "Arbeitszeit" },
	// Overtime
	ueberstunden: { code: "1900", name: "Überstunden" },
	// Holiday compensation
	feiertagsausgleich: { code: "1012", name: "Feiertagsausgleich" },
	// Vacation
	urlaub: { code: "1600", name: "Urlaub" },
	// Overtime reduction
	ueberstunden_abbau: { code: "1910", name: "Überstunden-Abbau" },
	// Special leave (paid)
	sonderurlaub: { code: "1000", name: "Sonderurlaub" },
	// Special leave (unpaid)
	sonderurlaub_unbezahlt: { code: "", name: "Sonderurlaub (unbezahlt)" },
	// Training
	weiterbildung: { code: "1000", name: "Schule/Weiterbildung" },
	// Military/alternative service
	militaer: { code: "", name: "Militär-/Ersatzdienst" },
	// Maternity protection
	mutterschutz: { code: "", name: "Mutterschutz" },
	// Quarantine
	quarantaene: { code: "", name: "Quarantäne" },
	// Illness
	krankheit: { code: "1650", name: "Krankheit" },
	// Illness with sick pay
	krankheit_krankengeld: { code: "", name: "Krankheit (Krankengeld)" },
	// Illness (unpaid)
	krankheit_unbezahlt: { code: "", name: "Krankheit (unbezahlt)" },
	// Child illness
	krankheit_kind: { code: "1000", name: "Krankheit eines Kindes" },
	// Child illness (unpaid)
	krankheit_kind_unbezahlt: { code: "", name: "Krankheit eines Kindes (unbezahlt)" },
};

/**
 * Wage type mapping used in export
 */
export interface WageTypeMapping {
	id: string;
	workCategoryId: string | null;
	workCategoryName?: string | null;
	absenceCategoryId: string | null;
	absenceCategoryName?: string | null;
	specialCategory: string | null;
	wageTypeCode: string;
	wageTypeName: string | null;
	factor: string;
	isActive: boolean;
}

// ============================================
// EXPORT FILTER TYPES
// ============================================

/**
 * Export filters for payroll export
 */
export interface PayrollExportFilters {
	dateRange: {
		start: DateTime;
		end: DateTime;
	};
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

/**
 * Serialized filters for database storage
 */
export interface SerializedPayrollExportFilters {
	dateRange: {
		start: string; // ISO string
		end: string; // ISO string
	};
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

// ============================================
// WORK PERIOD DATA TYPES
// ============================================

/**
 * Work period data for export processing
 */
export interface WorkPeriodData {
	id: string;
	employeeId: string;
	employeeNumber: string | null;
	firstName: string | null;
	lastName: string | null;
	startTime: DateTime;
	endTime: DateTime | null;
	durationMinutes: number | null;
	workCategoryId: string | null;
	workCategoryName: string | null;
	workCategoryFactor: string | null;
	projectId: string | null;
	projectName: string | null;
}

/**
 * Absence data for export processing
 */
export interface AbsenceData {
	id: string;
	employeeId: string;
	employeeNumber: string | null;
	firstName: string | null;
	lastName: string | null;
	startDate: string; // ISO date string
	endDate: string; // ISO date string
	absenceCategoryId: string;
	absenceCategoryName: string | null;
	absenceType: string | null;
	status: string;
}

// ============================================
// EXPORT RESULT TYPES
// ============================================

/**
 * Result of export transformation
 */
export interface ExportResult {
	fileName: string;
	content: Buffer | string;
	mimeType: string;
	encoding: BufferEncoding;
	metadata: {
		workPeriodCount: number;
		employeeCount: number;
		dateRange: { start: string; end: string };
	};
}

/**
 * Export job status
 */
export type PayrollExportStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Export job summary
 */
export interface PayrollExportJobSummary {
	id: string;
	status: PayrollExportStatus;
	fileName: string | null;
	fileSizeBytes: number | null;
	workPeriodCount: number | null;
	employeeCount: number | null;
	createdAt: Date;
	completedAt: Date | null;
	errorMessage: string | null;
	filters: SerializedPayrollExportFilters;
}

// ============================================
// FORMATTER INTERFACE
// ============================================

/**
 * Base interface for payroll export formatters
 * Allows for different export formats (DATEV, SAGE, etc.)
 */
export interface IPayrollExportFormatter {
	/** Unique identifier for this format */
	readonly formatId: string;
	/** Human-readable name */
	readonly formatName: string;
	/** Format version */
	readonly version: string;

	/**
	 * Validate configuration for this format
	 */
	validateConfig(config: Record<string, unknown>): { valid: boolean; errors?: string[] };

	/**
	 * Transform work periods and absences to export format
	 */
	transform(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
		mappings: WageTypeMapping[],
		config: Record<string, unknown>,
	): ExportResult;

	/**
	 * Get maximum work periods for synchronous export
	 */
	getSyncThreshold(): number;
}

// ============================================
// API-BASED EXPORTER TYPES (Personio, etc.)
// ============================================

/**
 * Employee matching strategy for API-based exports
 */
export type EmployeeMatchStrategy = "employeeNumber" | "email";

/**
 * Sync record status for individual records in API exports
 */
export type SyncRecordStatus = "pending" | "synced" | "failed" | "skipped";

/**
 * API export result with record-level tracking
 */
export interface ApiExportResult {
	success: boolean;
	totalRecords: number;
	syncedRecords: number;
	failedRecords: number;
	skippedRecords: number;
	errors: Array<{
		recordId: string;
		recordType: "attendance" | "absence";
		employeeId: string;
		errorMessage: string;
		isRetryable: boolean;
	}>;
	metadata: {
		employeeCount: number;
		dateRange: { start: string; end: string };
		apiCallCount: number;
		durationMs: number;
	};
}

/**
 * Base interface for API-based payroll exporters
 * Used for systems that require pushing data via API (Personio, BambooHR, etc.)
 */
export interface IPayrollExporter {
	/** Unique identifier for this exporter */
	readonly exporterId: string;
	/** Human-readable name */
	readonly exporterName: string;
	/** Exporter version */
	readonly version: string;

	/**
	 * Validate configuration for this exporter
	 */
	validateConfig(config: Record<string, unknown>): Promise<{
		valid: boolean;
		errors?: string[];
	}>;

	/**
	 * Test connection and credentials
	 */
	testConnection(
		organizationId: string,
		config: Record<string, unknown>,
	): Promise<{
		success: boolean;
		error?: string;
	}>;

	/**
	 * Transform and push work periods and absences via API
	 * Implements record-level tracking for partial success scenarios
	 */
	export(
		organizationId: string,
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
		mappings: WageTypeMapping[],
		config: Record<string, unknown>,
	): Promise<ApiExportResult>;

	/**
	 * Get maximum work periods for synchronous export
	 */
	getSyncThreshold(): number;
}
