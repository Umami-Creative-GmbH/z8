import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

export const COMPLETED_WORK_OPERATION_KINDS = [
	"close_active_work",
	"import_completed_work",
	"import_open_work",
] as const;
export type CompletedWorkOperationKind = (typeof COMPLETED_WORK_OPERATION_KINDS)[number];

export const COMPLETED_WORK_WRITERS = ["web_clock_out", "reviewed_import"] as const;
export type CompletedWorkWriter = (typeof COMPLETED_WORK_WRITERS)[number];

export const COMPLETED_WORK_ACTOR_KINDS = ["human", "system", "unknown_historical"] as const;
export type CompletedWorkActorKind = (typeof COMPLETED_WORK_ACTOR_KINDS)[number];

// Committed completed-work operation receipt (#256 §5, #274). Written in the same
// transaction as the work graph it describes. The ID is the operation's originating
// identity (for a web clock-out, its submission ID, which is also the clock-out
// entry ID). Work identities are stored by value: the receipt is committed evidence
// and does not follow later business changes to the work it created. Organization
// and employee deletion cascade; partial history cleanup deletes receipts explicitly.
export const completedWorkOperation = pgTable(
	"completed_work_operation",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		kind: text("kind").$type<CompletedWorkOperationKind>().notNull(),
		writer: text("writer").$type<CompletedWorkWriter>().notNull(),
		writerVersion: integer("writer_version").notNull(),
		commandVersion: integer("command_version").notNull(),
		command: jsonb("command").$type<Record<string, unknown>>().notNull(),
		// Admission mode the operation executed under, read under the adoption gate.
		appendAdmission: text("append_admission").$type<"legacy" | "append">().notNull(),
		actorKind: text("actor_kind").$type<CompletedWorkActorKind>().notNull(),
		actorUserId: text("actor_user_id").references(() => user.id),
		workPeriodId: uuid("work_period_id").notNull(),
		resultVersion: integer("result_version").notNull(),
		result: jsonb("result").$type<Record<string, unknown>>().notNull(),
		// Provider source identity of a reviewed import (#284); one committed operation
		// per source and organization, so a re-import cannot recreate the work.
		sourceKey: text("source_key"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "completed_work_operation_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		index("completedWorkOperation_org_employee_idx").on(table.organizationId, table.employeeId),
		uniqueIndex("completedWorkOperation_org_source_idx")
			.on(table.organizationId, table.sourceKey)
			.where(sql`${table.sourceKey} IS NOT NULL`),
		check(
			"completed_work_operation_kind_check",
			sql`${table.kind} IN ('close_active_work', 'import_completed_work', 'import_open_work')`,
		),
		check(
			"completed_work_operation_writer_check",
			sql`${table.writer} IN ('web_clock_out', 'reviewed_import')`,
		),
		check(
			"completed_work_operation_source_check",
			sql`(${table.writer} = 'reviewed_import') = (${table.sourceKey} IS NOT NULL)`,
		),
		check(
			"completed_work_operation_admission_check",
			sql`${table.appendAdmission} IN ('legacy', 'append')`,
		),
		check(
			"completed_work_operation_actor_check",
			sql`(${table.actorKind} = 'human' AND ${table.actorUserId} IS NOT NULL) OR ${table.actorKind} IN ('system', 'unknown_historical')`,
		),
		check(
			"completed_work_operation_version_check",
			sql`${table.writerVersion} >= 1 AND ${table.commandVersion} >= 1 AND ${table.resultVersion} >= 1`,
		),
	],
);
