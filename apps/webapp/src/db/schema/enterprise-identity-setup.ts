import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import type { EnterpriseIdentitySetupState } from "@/lib/enterprise-identity/setup-state";

import { organization, user } from "../auth-schema";

export const enterpriseIdentityPresetEnum = pgEnum("enterprise_identity_preset", [
	"okta",
	"microsoft-entra",
	"google-workspace",
	"generic",
]);

export const enterpriseIdentityProtocolEnum = pgEnum("enterprise_identity_protocol", [
	"oidc",
	"saml",
]);

export const enterpriseIdentitySetupStepEnum = pgEnum("enterprise_identity_setup_step", [
	"provider",
	"domain",
	"sso",
	"ssoTest",
	"scim",
	"accessPolicy",
	"review",
]);

export const enterpriseIdentitySetup = pgTable(
	"enterprise_identity_setup",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		preset: enterpriseIdentityPresetEnum("preset"),
		protocol: enterpriseIdentityProtocolEnum("protocol"),
		providerId: text("provider_id"),
		currentStep: enterpriseIdentitySetupStepEnum("current_step").default("provider").notNull(),

		domain: text("domain"),
		domainVerified: boolean("domain_verified").default(false).notNull(),

		ssoTest: jsonb("sso_test").$type<EnterpriseIdentitySetupState["ssoTest"]>().notNull(),
		scim: jsonb("scim").$type<EnterpriseIdentitySetupState["scim"]>().notNull(),
		enforcement: jsonb("enforcement")
			.$type<EnterpriseIdentitySetupState["enforcement"]>()
			.notNull(),

		activated: boolean("activated").default(false).notNull(),
		activatedAt: timestamp("activated_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("enterpriseIdentitySetup_organizationId_idx").on(table.organizationId),
		index("enterpriseIdentitySetup_providerId_idx").on(table.providerId),
		index("enterpriseIdentitySetup_currentStep_idx").on(table.currentStep),
	],
);
