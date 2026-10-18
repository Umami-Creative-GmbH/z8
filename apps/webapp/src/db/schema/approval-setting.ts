import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { currentTimestamp } from "./timestamp";

/**
 * Organization-wide approval settings (#1015, migration 0199). No row means
 * the defaults (`DEFAULT_APPROVAL_SETTINGS` in
 * `lib/approvals/approval-settings.ts`). Users who can manage approvals
 * change deputy decisions on the approval escalation settings page; only
 * organization admins configure triage thresholds.
 */
export const approvalSetting = pgTable(
	"approval_setting",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Stable audit target for changes to these approval settings. */
		id: uuid("id")
			.defaultRandom()
			.notNull()
			.unique("approval_setting_id_unique"),
		/**
		 * "Deputies can decide approvals" (Approvals ADR 0002). Off: deputies stay
		 * contacts and never cover for an absent approver.
		 */
		deputyDecisionsEnabled: boolean("deputy_decisions_enabled")
			.default(true)
			.notNull(),
		staleAfterHours: integer("stale_after_hours").default(72).notNull(),
		smallCorrectionMinutes: integer("small_correction_minutes")
			.default(15)
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		check(
			"approval_setting_stale_after_hours_check",
			sql`${table.staleAfterHours} BETWEEN 1 AND 720`,
		),
		check(
			"approval_setting_small_correction_minutes_check",
			sql`${table.smallCorrectionMinutes} BETWEEN 0 AND 60`,
		),
	],
);
