import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth-schema";

export const appAuthTypeEnum = pgEnum("app_auth_type", ["mobile", "desktop"]);
export const appAuthCodeStatusEnum = pgEnum("app_auth_code_status", [
	"pending",
	"used",
	"expired",
]);

export const appAuthCode = pgTable(
	"app_auth_code",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		app: appAuthTypeEnum("app").notNull(),
		code: text("code").notNull(),
		sessionToken: text("session_token").notNull(),
		status: appAuthCodeStatusEnum("status").default("pending").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("appAuthCode_userId_idx").on(table.userId),
		index("appAuthCode_app_status_idx").on(table.app, table.status),
		index("appAuthCode_code_idx").on(table.code),
	],
);
