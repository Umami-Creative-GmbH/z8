import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";

export const implementationChecklistManualStatusEnum = pgEnum(
	"implementation_checklist_manual_status",
	["complete", "incomplete"],
);

export const implementationChecklistManualState = pgTable(
	"implementation_checklist_manual_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		itemId: text("item_id").notNull(),
		status: implementationChecklistManualStatusEnum("status").default("complete").notNull(),
		completedAt: timestamp("completed_at"),
		completedByUserId: text("completed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("implementationChecklistManualState_org_item_idx").on(
			table.organizationId,
			table.itemId,
		),
		index("implementationChecklistManualState_organizationId_idx").on(table.organizationId),
	],
);
