import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { roleTemplate } from "./identity";
import { team } from "./organization";
import { currentTimestamp } from "./timestamp";

export const scimConnectionStateEnum = pgEnum("scim_connection_state", [
	"creating",
	"active",
	"decommissioning",
	"decommissioned",
]);

export const scimDeprovisionActionEnum = pgEnum("scim_deprovision_action", [
	"soft_delete",
	"suspend",
]);

export const scimProviderConfig = pgTable(
	"scim_provider_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		creationRequestId: text("creation_request_id").notNull(),
		connectionId: text("connection_id"),
		state: scimConnectionStateEnum("state").default("creating").notNull(),
		autoActivateUsers: boolean("auto_activate_users").default(false).notNull(),
		deprovisionAction: scimDeprovisionActionEnum("deprovision_action")
			.default("suspend")
			.notNull(),
		defaultRoleTemplateId: uuid("default_role_template_id")
			.notNull()
			.references(() => roleTemplate.id),
		decommissionRetryAt: timestamp("decommission_retry_at"),
		decommissionAttemptCount: integer("decommission_attempt_count")
			.default(0)
			.notNull(),
		decommissionLastError: text("decommission_last_error"),
		decommissionStartedAt: timestamp("decommission_started_at"),
		decommissionCompletedAt: timestamp("decommission_completed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		uniqueIndex("scimProviderConfig_organizationId_unique_idx").on(
			table.organizationId,
		),
		uniqueIndex("scimProviderConfig_creationRequestId_unique_idx").on(
			table.creationRequestId,
		),
		uniqueIndex("scimProviderConfig_connectionId_unique_idx").on(
			table.connectionId,
		),
		index("scimProviderConfig_organizationId_connectionId_idx").on(
			table.organizationId,
			table.connectionId,
		),
	],
);

export const scimUserLifecycleState = pgTable(
	"scim_user_lifecycle_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		connectionId: text("connection_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		membershipRevision: integer("membership_revision").notNull(),
		scimActive: boolean("scim_active").notNull(),
		priorMemberStatus: text("prior_member_status"),
		priorEmployeeIsActive: boolean("prior_employee_is_active"),
		deactivationOwned: boolean("deactivation_owned").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("scimUserLifecycleState_organizationId_userId_unique_idx").on(
			table.organizationId,
			table.userId,
		),
	],
);

export const scimRoleProjectionState = pgTable(
	"scim_role_projection_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		roleTemplateId: uuid("role_template_id")
			.notNull()
			.references(() => roleTemplate.id),
		sourceGroupId: text("source_group_id"),
		appliedRoleTemplateId: uuid("applied_role_template_id").references(
			() => roleTemplate.id,
		),
		appliedDefaultTeamId: uuid("applied_default_team_id").references(
			() => team.id,
			{ onDelete: "set null" },
		),
		appliedDefaultTeamMembershipOwned: boolean(
			"applied_default_team_membership_owned",
		)
			.default(false)
			.notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("scimRoleProjectionState_organizationId_userId_unique_idx").on(
			table.organizationId,
			table.userId,
		),
	],
);

export const scimOutboxStatusEnum = pgEnum("scim_outbox_status", [
	"pending",
	"processing",
	"completed",
]);

export const scimSeatSyncOutbox = pgTable(
	"scim_billing_seat_sync_outbox",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		connectionId: text("connection_id").notNull(),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		membershipRevision: integer("membership_revision").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		status: scimOutboxStatusEnum("status").default("pending").notNull(),
		availableAt: timestamp("available_at").defaultNow().notNull(),
		claimedAt: timestamp("claimed_at"),
		claimToken: uuid("claim_token"),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		processedAt: timestamp("processed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("scimSeatSyncOutbox_organizationId_dedupeKey_unique_idx").on(
			table.organizationId,
			table.dedupeKey,
		),
		index("scimSeatSyncOutbox_status_availableAt_idx").on(
			table.status,
			table.availableAt,
		),
	],
);

export const scimProvisioningEventTypeEnum = pgEnum(
	"scim_provisioning_event_type",
	[
		"user_created",
		"user_updated",
		"user_deactivated",
		"user_reactivated",
		"user_deleted",
		"group_created",
		"group_updated",
		"group_deleted",
		"group_member_added",
		"group_member_removed",
		"role_template_applied",
		"error",
	],
);

export const scimProvisioningLog = pgTable(
	"scim_provisioning_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		connectionId: text("connection_id"),
		eventType: scimProvisioningEventTypeEnum("event_type").notNull(),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		teamId: uuid("team_id"),
		externalId: text("external_id"),
		scimResourceId: text("scim_resource_id"),
		requestId: text("request_id"),
		metadata: jsonb("metadata").$type<{
			scimUserName?: string;
			scimDisplayName?: string;
			scimExternalId?: string;
			scimGroupId?: string;
			roleTemplateId?: string;
			roleTemplateName?: string;
			autoActivated?: boolean;
			deprovisionAction?: "soft_delete" | "suspend";
			errorCode?: string;
			errorMessage?: string;
			idpProvider?: string;
		}>(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("scimProvisioningLog_organizationId_idx").on(table.organizationId),
		index("scimProvisioningLog_organizationId_createdAt_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("scimProvisioningLog_connectionId_idx").on(table.connectionId),
		index("scimProvisioningLog_eventType_idx").on(table.eventType),
		index("scimProvisioningLog_userId_idx").on(table.userId),
		index("scimProvisioningLog_createdAt_idx").on(table.createdAt),
	],
);
