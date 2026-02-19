import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organization, user } from "../auth-schema";
import { auditExportPackage } from "./audit-export";

export const auditPackStatusEnum = pgEnum("audit_pack_status", [
	"requested",
	"collecting",
	"lineage_expanding",
	"assembling",
	"hardening",
	"completed",
	"failed",
]);

export const auditPackRequest = pgTable(
	"audit_pack_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestedById: text("requested_by_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		startDate: timestamp("start_date").notNull(),
		endDate: timestamp("end_date").notNull(),
		status: auditPackStatusEnum("status").notNull().default("requested"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("auditPackRequest_organizationId_idx").on(table.organizationId),
		index("auditPackRequest_status_idx").on(table.status),
		index("auditPackRequest_createdAt_idx").on(table.createdAt),
	],
);

export const auditPackArtifact = pgTable(
	"audit_pack_artifact",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		requestId: uuid("request_id")
			.notNull()
			.unique()
			.references(() => auditPackRequest.id, { onDelete: "cascade" }),
		auditExportPackageId: uuid("audit_export_package_id").references(() => auditExportPackage.id, {
			onDelete: "set null",
		}),
		s3Key: text("s3_key"),
		entryCount: integer("entry_count").notNull().default(0),
		correctionNodeCount: integer("correction_node_count").notNull().default(0),
		approvalEventCount: integer("approval_event_count").notNull().default(0),
		timelineEventCount: integer("timeline_event_count").notNull().default(0),
		expandedNodeCount: integer("expanded_node_count").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("auditPackArtifact_requestId_idx").on(table.requestId),
		index("auditPackArtifact_auditExportPackageId_idx").on(table.auditExportPackageId),
	],
);
