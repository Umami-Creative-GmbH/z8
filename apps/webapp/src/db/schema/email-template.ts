import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";

export const EMAIL_TEMPLATE_KEYS = [
	"email-verification",
	"password-reset",
	"organization-invitation",
	"absence-request-submitted",
	"absence-request-pending-approval",
	"absence-request-approved",
	"absence-request-rejected",
	"time-correction-pending-approval",
	"time-correction-approved",
	"time-correction-rejected",
	"team-member-added",
	"team-member-removed",
	"security-alert",
	"export-ready",
	"export-failed",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export type EmailTemplateEditorDocument = Record<string, unknown>;

export const organizationEmailTemplate = pgTable(
	"organization_email_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		templateKey: text("template_key").$type<EmailTemplateKey>().notNull(),
		subject: text("subject").notNull(),
		editorDocument: jsonb("editor_document").$type<EmailTemplateEditorDocument>().notNull(),
		html: text("html").notNull(),
		plainText: text("plain_text"),
		isEnabled: boolean("is_enabled").default(true).notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedByUserId: text("updated_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("organizationEmailTemplate_org_template_idx").on(
			table.organizationId,
			table.templateKey,
		),
		index("organizationEmailTemplate_organizationId_idx").on(table.organizationId),
	],
);
