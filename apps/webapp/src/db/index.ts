import { trace } from "@opentelemetry/api";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
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
	sql: SQL | undefined;
	db: DbInstance | undefined;
};

function createSqlClient(): SQL {
	return new SQL({
		host: process.env.POSTGRES_HOST!,
		port: Number(process.env.POSTGRES_PORT!),
		database: process.env.POSTGRES_DB!,
		username: process.env.POSTGRES_USER!,
		password: process.env.POSTGRES_PASSWORD!,
		max: 10, // Reduced from 20 to prevent exhaustion
		idleTimeout: 60, // Increased from 30 to reduce connection churn
		connectionTimeout: 5, // Increased from 2 for more reliability
	});
}

function createInstrumentedSql(baseSql: SQL): SQL {
	return new Proxy(baseSql, {
		get(target, prop) {
			// Intercept query methods to add tracing
			if (prop === "query" || prop === "run" || prop === "all" || prop === "get") {
				return (...args: unknown[]) => {
					const tracer = trace.getTracer("database");
					return tracer.startActiveSpan(
						`db.${String(prop)}`,
						{
							attributes: {
								"db.system": "postgresql",
								"db.operation": String(prop),
								"db.name": process.env.POSTGRES_DB || "unknown",
							},
						},
						(span) => {
							try {
								const result = (target as any)[prop](...args);
								span.setStatus({ code: 1 }); // OK
								span.end();
								return result;
							} catch (error) {
								span.recordException(error as Error);
								span.setStatus({ code: 2, message: String(error) }); // ERROR
								span.end();
								logger.error({ error, operation: String(prop) }, "Database query failed");
								throw error;
							}
						},
					);
				};
			}
			return target[prop as keyof typeof target];
		},
	}) as SQL;
}

function createDb(): DbInstance {
	const sqlClient = createInstrumentedSql(createSqlClient());
	return drizzle({ client: sqlClient, schema: combinedSchema });
}

// Use existing instances or create new ones
const sql = globalForDb.sql ?? createInstrumentedSql(createSqlClient());
const db: DbInstance = globalForDb.db ?? createDb();

// Store in global for reuse during hot reloading (development only)
if (process.env.NODE_ENV !== "production") {
	globalForDb.sql = sql;
	globalForDb.db = db;
}

export { db, sql };
// Export auth schema tables
export * from "./auth-schema";
// Export business schema tables (excludes auth schema imports to avoid duplicates)
export {
	// Enums
	absenceTypeEnum,
	approvalStatusEnum,
	holidayCategoryEnum,
	notificationChannelEnum,
	notificationTypeEnum,
	recurrenceTypeEnum,
	roleEnum,
	timeEntryTypeEnum,

	// Core tables
	team,
	employee,
	employeeManagers,
	teamPermissions,

	// Work schedule tables
	workScheduleTemplate,
	workScheduleTemplateDays,
	workScheduleAssignment,

	// Holiday tables
	holidayCategory,
	holiday,
	holidayPreset,
	holidayPresetHoliday,
	holidayPresetAssignment,
	holidayAssignment,

	// Time tracking tables
	timeEntry,
	workPeriod,

	// Absence tables
	absenceCategory,
	absenceEntry,

	// Vacation tables
	vacationAllowance,
	employeeVacationAllowance,
	vacationPolicyAssignment,

	// Approval tables
	approvalRequest,

	// Audit tables
	auditLog,

	// Notification tables
	notification,
	notificationPreference,
	pushSubscription,

	// Enterprise tables
	organizationDomain,
	organizationBranding,

	// Shift scheduling enums and tables
	shiftStatusEnum,
	shiftRequestTypeEnum,
	shiftTemplate,
	shift,
	shiftRequest,

	// Relations - CRITICAL: All relations must be exported for Drizzle queries to work
	organizationRelations,
	teamRelations,
	employeeRelations,
	employeeManagersRelations,
	teamPermissionsRelations,
	workScheduleTemplateRelations,
	workScheduleTemplateDaysRelations,
	workScheduleAssignmentRelations,
	holidayCategoryRelations,
	holidayRelations,
	holidayPresetRelations,
	holidayPresetHolidayRelations,
	holidayPresetAssignmentRelations,
	holidayAssignmentRelations,
	timeEntryRelations,
	workPeriodRelations,
	absenceCategoryRelations,
	absenceEntryRelations,
	vacationAllowanceRelations,
	employeeVacationAllowanceRelations,
	vacationPolicyAssignmentRelations,
	approvalRequestRelations,
	auditLogRelations,
	notificationRelations,
	notificationPreferenceRelations,
	pushSubscriptionRelations,
	organizationDomainRelations,
	organizationBrandingRelations,
	shiftTemplateRelations,
	shiftRelations,
	shiftRequestRelations,
} from "./schema";
