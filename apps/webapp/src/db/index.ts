import { trace } from "@opentelemetry/api";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createLogger } from "@/lib/logger";
import * as authSchema from "./auth-schema";
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
		host: process.env.POSTGRES_HOST!,
		port: Number(process.env.POSTGRES_PORT!),
		database: process.env.POSTGRES_DB!,
		user: process.env.POSTGRES_USER!,
		password: process.env.POSTGRES_PASSWORD!,
		max: 10, // Reduced from 20 to prevent exhaustion
		idleTimeoutMillis: 60000, // 60 seconds - Increased from 30 to reduce connection churn
		connectionTimeoutMillis: 5000, // 5 seconds - Increased from 2 for more reliability
	});
}

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
								"db.name": process.env.POSTGRES_DB || "unknown",
							},
						},
						async (span) => {
							try {
								const result = await (target as Pool).query(
									...(args as Parameters<Pool["query"]>),
								);
								span.setStatus({ code: 1 }); // OK
								span.end();
								return result;
							} catch (error) {
								span.recordException(error as Error);
								span.setStatus({ code: 2, message: String(error) }); // ERROR
								span.end();
								logger.error(
									{ error, operation: "query" },
									"Database query failed",
								);
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
if (process.env.NODE_ENV !== "production") {
	globalForDb.pool = pool;
	globalForDb.db = db;
}

export { db, pool };
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
	// Approval tables
	approvalRequest,
	approvalRequestRelations,
	approvalStatusEnum,
	// Audit tables
	auditLog,
	auditLogRelations,
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
	pushSubscription,
	pushSubscriptionRelations,
	recurrenceTypeEnum,
	roleEnum,
	type SurchargeCalculationDetails,
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
	// Vacation tables
	vacationAllowance,
	vacationAllowanceRelations,
	vacationPolicyAssignment,
	vacationPolicyAssignmentRelations,
	workPeriod,
	workPeriodRelations,
	workScheduleAssignment,
	workScheduleAssignmentRelations,
	// Work schedule tables
	workScheduleTemplate,
	workScheduleTemplateDays,
	workScheduleTemplateDaysRelations,
	workScheduleTemplateRelations,
} from "./schema";
