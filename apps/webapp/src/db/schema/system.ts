import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// ============================================
// SYSTEM CONFIGURATION
// ============================================

// Global system-wide configuration (deployment ID, etc)
export const systemConfig = pgTable("system_config", {
	key: text("key").primaryKey().notNull(),
	value: text("value").notNull(),
	description: text("description"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.$onUpdate(() => currentTimestamp())
		.notNull(),
});
