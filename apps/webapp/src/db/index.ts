import { trace } from "@opentelemetry/api";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { createLogger } from "@/lib/logger";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

const logger = createLogger("Database");

const baseSql = new SQL({
	host: process.env.POSTGRES_HOST!,
	port: Number(process.env.POSTGRES_PORT!),
	database: process.env.POSTGRES_DB!,
	username: process.env.POSTGRES_USER!,
	password: process.env.POSTGRES_PASSWORD!,
	max: 20, // Maximum number of connections in pool (default: 10)
	idleTimeout: 30, // Close idle connections after 30 seconds
	connectionTimeout: 2, // Timeout when establishing new connections (seconds)
});

// Wrap SQL client with OTEL instrumentation
const sql = new Proxy(baseSql, {
	get(target, prop) {
		// Intercept query methods to add tracing
		if (prop === "query" || prop === "run" || prop === "all" || prop === "get") {
			return (...args: any[]) => {
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
});

const db = drizzle({ client: sql, schema: { ...authSchema, ...schema } });

export { db, sql };
// Export auth schema tables
export * from "./auth-schema";
// Export business schema tables (excludes auth schema imports to avoid duplicates)
export {
	absenceCategory,
	absenceCategoryRelations,
	absenceEntry,
	absenceEntryRelations,
	absenceTypeEnum,
	approvalRequest,
	approvalRequestRelations,
	approvalStatusEnum,
	auditLog,
	auditLogRelations,
	employee,
	employeeRelations,
	employeeVacationAllowance,
	employeeVacationAllowanceRelations,
	holiday,
	holidayCategory,
	holidayCategoryEnum,
	holidayCategoryRelations,
	holidayRelations,
	recurrenceTypeEnum,
	roleEnum,
	team,
	// Export relations
	teamRelations,
	timeEntry,
	timeEntryRelations,
	timeEntryTypeEnum,
	vacationAllowance,
	vacationAllowanceRelations,
	workPeriod,
	workPeriodRelations,
	// Notification tables
	notification,
	notificationRelations,
	notificationPreference,
	notificationPreferenceRelations,
	pushSubscription,
	pushSubscriptionRelations,
	notificationTypeEnum,
	notificationChannelEnum,
} from "./schema";
