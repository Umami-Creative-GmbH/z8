import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { currentTimestamp } from "./timestamp";

/**
 * Organization-wide approval settings (#1015, migration 0188). No row means
 * the defaults (`DEFAULT_APPROVAL_SETTINGS` in
 * `lib/approvals/approval-settings.ts`). Users who can manage approvals
 * change them on the approval escalation settings page.
 */
export const approvalSetting = pgTable("approval_setting", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	/** The audit log's target of a change (`audit_log.entity_id` is a uuid). */
	id: uuid("id").defaultRandom().notNull().unique("approval_setting_id_unique"),
	/**
	 * "Deputies can decide approvals" (Approvals ADR 0002). Off: deputies stay
	 * contacts and never cover for an absent approver.
	 */
	deputyDecisionsEnabled: boolean("deputy_decisions_enabled").default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => currentTimestamp())
		.notNull(),
	updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});
