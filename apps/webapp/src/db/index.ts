import { trace } from "@opentelemetry/api";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import * as authSchema from "./auth-schema";
import { getPostgresSslConfig } from "./postgres-ssl";
import * as schema from "./schema";

const logger = createLogger("Database");

// Combined schema for type inference
const combinedSchema = { ...authSchema, ...schema };

// Database instance type with proper schema typing
type DbInstance = ReturnType<typeof drizzle<typeof combinedSchema>>;

// Singleton pattern to prevent connection pool exhaustion during hot reloading
const globalForDb = globalThis as unknown as {
	pool: Pool | undefined;
	db: DbInstance | undefined;
};

function createPool(): Pool {
	return new Pool({
		host: env.POSTGRES_HOST!,
		port: Number(env.POSTGRES_PORT!),
		database: env.POSTGRES_DB!,
		user: env.POSTGRES_USER!,
		password: env.POSTGRES_PASSWORD!,
		ssl: getPostgresSslConfig(),
		// With PgBouncer handling connection pooling, we can use smaller app-side pools
		// PgBouncer manages the actual connections to PostgreSQL
		max: parseInt(env.POSTGRES_POOL_MAX || "10", 10),
		min: parseInt(env.POSTGRES_POOL_MIN || "2", 10),
		idleTimeoutMillis: 30000, // 30 seconds - connections return to pool faster
		connectionTimeoutMillis: 10000, // 10 seconds - more generous timeout for high load
	});
}

// PostgreSQL error codes that are expected during startup/setup
const EXPECTED_ERROR_CODES = new Set([
	"42P01", // relation does not exist (fresh DB without migrations)
]);

function createInstrumentedPool(basePool: Pool): Pool {
	return new Proxy(basePool, {
		get(target, prop) {
			// Intercept query method to add tracing
			if (prop === "query") {
				return async (...args: unknown[]) => {
					const tracer = trace.getTracer("database");
					return tracer.startActiveSpan(
						"db.query",
						{
							attributes: {
								"db.system": "postgresql",
								"db.operation": "query",
								"db.name": env.POSTGRES_DB || "unknown",
							},
						},
						async (span) => {
							try {
								const result = await (target as Pool).query(...(args as Parameters<Pool["query"]>));
								span.setStatus({ code: 1 }); // OK
								span.end();
								return result;
							} catch (error) {
								// Note: Drizzle wraps pg errors, so code may be at error.code or error.cause.code
								const pgError = error as { code?: string; cause?: { code?: string } };
								const errorCode = pgError.code || pgError.cause?.code;
								span.recordException(error as Error);
								span.setStatus({ code: 2, message: String(error) }); // ERROR
								span.end();
								// Only log unexpected errors - expected errors during setup are handled upstream
								if (!EXPECTED_ERROR_CODES.has(errorCode || "")) {
									logger.error({ error, operation: "query" }, "Database query failed");
								}
								throw error;
							}
						},
					);
				};
			}
			return target[prop as keyof typeof target];
		},
	}) as Pool;
}

function createDb(): DbInstance {
	const pool = createInstrumentedPool(createPool());
	return drizzle({ client: pool, schema: combinedSchema });
}

// Use existing instances or create new ones
const pool = globalForDb.pool ?? createInstrumentedPool(createPool());
const db: DbInstance = globalForDb.db ?? createDb();

// Store in global for reuse during hot reloading (development only)
if (env.NODE_ENV !== "production") {
	globalForDb.pool = pool;
	globalForDb.db = db;
}

// Export auth schema tables
export * from "./auth-schema";
// Export business schema tables (excludes auth schema imports to avoid duplicates)
export {
	// Absence tables
	absenceCategory,
	absenceCategoryRelations,
	absenceEntry,
	absenceEntryRelations,
	// Enums
	absenceTypeEnum,
	appAuthCode,
	appAuthCodeStatusEnum,
	appAuthTypeEnum,
	// Approval tables
	approvalRequest,
	approvalRequestRelations,
	approvalStatusEnum,
	// Audit export tables (signed packages, WORM retention)
	auditExportConfig,
	auditExportConfigRelations,
	auditExportFile,
	auditExportFileRelations,
	auditExportPackage,
	auditExportPackageRelations,
	auditExportStatusEnum,
	// Audit tables
	auditLog,
	auditLogRelations,
	// Audit pack tables
	auditPackArtifact,
	auditPackArtifactRelations,
	auditPackRequest,
	auditPackRequestRelations,
	auditPackStatusEnum,
	auditSigningKey,
	auditSigningKeyRelations,
	auditVerificationLog,
	auditVerificationLogRelations,
	// Data export tables
	dataExport,
	dataExportRelations,
	employee,
	employeeManagers,
	employeeManagersRelations,
	employeeRelations,
	employeeVacationAllowance,
	employeeVacationAllowanceRelations,
	exportStatusEnum,
	exportStorageConfig,
	exportStorageConfigRelations,
	holiday,
	holidayAssignment,
	holidayAssignmentRelations,
	// Holiday tables
	holidayCategory,
	holidayCategoryEnum,
	holidayCategoryRelations,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetAssignmentRelations,
	holidayPresetHoliday,
	holidayPresetHolidayRelations,
	holidayPresetRelations,
	holidayRelations,
	// Notification tables
	notification,
	notificationChannelEnum,
	notificationPreference,
	notificationPreferenceRelations,
	notificationRelations,
	notificationTypeEnum,
	organizationBranding,
	organizationBrandingRelations,
	// Enterprise tables
	organizationDomain,
	organizationDomainRelations,
	// Relations - CRITICAL: All relations must be exported for Drizzle queries to work
	organizationRelations,
	organizationSecret,
	organizationSecretKey,
	// Payroll export tables
	payrollExportConfig,
	payrollExportConfigRelations,
	payrollExportFormat,
	payrollExportFormatEnum,
	payrollExportFormatRelations,
	payrollExportJob,
	payrollExportJobRelations,
	payrollExportStatusEnum,
	payrollExportSyncRecord,
	payrollExportSyncRecordRelations,
	payrollWageTypeMapping,
	payrollWageTypeMappingRelations,
	// Project tables
	project,
	projectRelations,
	pushSubscription,
	pushSubscriptionRelations,
	recurrenceTypeEnum,
	roleEnum,
	type SurchargeCalculationDetails,
	// Scheduled export tables
	scheduledExport,
	scheduledExportExecution,
	scheduledExportExecutionRelations,
	scheduledExportRelations,
	secretStoreProviderEnum,
	shift,
	shiftRelations,
	shiftRequest,
	shiftRequestRelations,
	shiftRequestTypeEnum,
	// Shift scheduling enums and tables
	shiftStatusEnum,
	shiftTemplate,
	shiftTemplateRelations,
	// Surcharge tables
	surchargeCalculation,
	surchargeCalculationRelations,
	surchargeModel,
	surchargeModelAssignment,
	surchargeModelAssignmentRelations,
	surchargeModelRelations,
	surchargeRule,
	surchargeRuleRelations,
	surchargeRuleTypeEnum,
	// Core tables
	team,
	teamPermissions,
	teamPermissionsRelations,
	teamRelations,
	// Time tracking tables
	timeEntry,
	timeEntryRelations,
	timeEntryTypeEnum,
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	// Vacation tables
	vacationAllowance,
	vacationAllowanceRelations,
	vacationPolicyAssignment,
	vacationPolicyAssignmentRelations,
	verificationCheckEnum,
	// Work category tables
	workCategory,
	workCategoryRelations,
	workPeriod,
	workPeriodRelations,
	// Work policy tables (unified schedules + regulations)
	workPolicy,
	workPolicyAssignment,
	workPolicyAssignmentRelations,
	workPolicyBreakOption,
	workPolicyBreakOptionRelations,
	workPolicyBreakRule,
	workPolicyBreakRuleRelations,
	workPolicyRegulation,
	workPolicyRegulationRelations,
	workPolicyRelations,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyScheduleDayRelations,
	workPolicyScheduleRelations,
	workPolicyViolation,
	workPolicyViolationRelations,
	wormRetentionModeEnum,
} from "./schema";
export { db, pool };
