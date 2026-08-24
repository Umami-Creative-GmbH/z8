import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { user } from "../../auth-schema";
import { roleTemplate, userLifecycleEvent } from "../identity";
import { team } from "../organization";
import * as scimSchema from "../scim";
import {
	scimConnectionStateEnum,
	scimDeprovisionActionEnum,
	scimOutboxStatusEnum,
	scimProjectionRecovery,
	scimProjectionRecoveryStatusEnum,
	scimProviderConfig,
	scimProvisioningLog,
	scimRoleProjectionState,
	scimSeatSyncOutbox,
	scimUserLifecycleState,
} from "../scim";

function columnNames(table: PgTable): string[] {
	return getTableConfig(table).columns.map((column) => column.name);
}

function expectNotNullColumns(table: PgTable, names: string[]): void {
	const columns = getTableConfig(table).columns;
	for (const name of names) {
		expect(columns.find((column) => column.name === name)?.notNull, name).toBe(
			true,
		);
	}
}

function indexColumns(table: PgTable, unique: boolean): string[][] {
	return getTableConfig(table)
		.indexes.filter((index) => index.config.unique === unique)
		.map((index) => index.config.columns.map((column) => column.name));
}

function hasForeignKey(
	table: PgTable,
	columnName: string,
	foreignTable: PgTable,
): boolean {
	return getTableConfig(table).foreignKeys.some((foreignKey) => {
		const reference = foreignKey.reference();
		return (
			reference.columns.map((column) => column.name).join(",") === columnName &&
			reference.foreignColumns.every((column) => column.table === foreignTable)
		);
	});
}

function normalizedSql(value: SQL): string {
	return new PgDialect()
		.sqlToQuery(value)
		.sql.replaceAll('"', "")
		.replace(/\s+/g, " ")
		.trim();
}

describe("managed SCIM application schema", () => {
	it("stores one organization-owned connection policy without provider credentials", () => {
		expect(scimConnectionStateEnum.enumValues).toEqual([
			"creating",
			"active",
			"decommissioning",
			"decommissioned",
		]);
		expect(scimDeprovisionActionEnum.enumValues).toEqual([
			"soft_delete",
			"suspend",
		]);
		expect(scimProviderConfig.deprovisionAction.enumValues).toEqual([
			"soft_delete",
			"suspend",
		]);
		expectNotNullColumns(scimProviderConfig, [
			"organization_id",
			"creation_request_id",
			"state",
			"auto_activate_users",
			"deprovision_action",
			"default_role_template_id",
			"decommission_attempt_count",
			"created_at",
			"created_by",
			"updated_at",
		]);
		expect(indexColumns(scimProviderConfig, true)).toEqual(
			expect.arrayContaining([
				["organization_id"],
				["creation_request_id"],
				["connection_id"],
			]),
		);
		expect(indexColumns(scimProviderConfig, false)).toContainEqual([
			"organization_id",
			"connection_id",
		]);
		expect(
			hasForeignKey(
				scimProviderConfig,
				"default_role_template_id",
				roleTemplate,
			),
		).toBe(true);
		expect(columnNames(scimProviderConfig)).toEqual(
			expect.arrayContaining([
				"decommission_retry_at",
				"decommission_last_error",
				"decommission_started_at",
				"decommission_completed_at",
			]),
		);
		expect(columnNames(scimProviderConfig)).not.toEqual(
			expect.arrayContaining(["provider_id", "scim_token", "token"]),
		);
		expect("legacyScimProvider" in scimSchema).toBe(false);
	});

	it("stores reversible organization-local user lifecycle state", () => {
		expectNotNullColumns(scimUserLifecycleState, [
			"organization_id",
			"connection_id",
			"user_id",
			"membership_revision",
			"scim_active",
			"deactivation_owned",
			"member_deactivation_owned",
			"employee_deactivation_owned",
			"created_at",
			"updated_at",
		]);
		expect(indexColumns(scimUserLifecycleState, true)).toContainEqual([
			"organization_id",
			"user_id",
		]);
		expect(columnNames(scimUserLifecycleState)).toEqual(
			expect.arrayContaining([
				"prior_member_status",
				"prior_employee_is_active",
			]),
		);
		expect(columnNames(scimUserLifecycleState)).not.toContain("external_id");
	});

	it("stores desired SCIM role projection separately from effective assignments", () => {
		expectNotNullColumns(scimRoleProjectionState, [
			"organization_id",
			"user_id",
			"role_template_id",
			"created_at",
			"updated_at",
		]);
		expect(indexColumns(scimRoleProjectionState, true)).toContainEqual([
			"organization_id",
			"user_id",
		]);
		expect(columnNames(scimRoleProjectionState)).toEqual(
			expect.arrayContaining([
				"source_group_id",
				"applied_role_template_id",
				"applied_default_team_id",
				"applied_default_team_membership_owned",
			]),
		);
		expectNotNullColumns(scimRoleProjectionState, [
			"applied_default_team_membership_owned",
		]);
		expect(
			hasForeignKey(scimRoleProjectionState, "role_template_id", roleTemplate),
		).toBe(true);
		expect(
			hasForeignKey(
				scimRoleProjectionState,
				"applied_role_template_id",
				roleTemplate,
			),
		).toBe(true);
		expect(
			hasForeignKey(scimRoleProjectionState, "applied_default_team_id", team),
		).toBe(true);
	});

	it("defines a durable organization-scoped seat sync outbox", () => {
		expect(getTableConfig(scimSeatSyncOutbox).name).toBe(
			"scim_billing_seat_sync_outbox",
		);
		expect(scimOutboxStatusEnum.enumValues).toEqual([
			"pending",
			"processing",
			"completed",
		]);
		expectNotNullColumns(scimSeatSyncOutbox, [
			"organization_id",
			"connection_id",
			"membership_revision",
			"dedupe_key",
			"status",
			"available_at",
			"attempt_count",
			"created_at",
			"updated_at",
		]);
		expect(indexColumns(scimSeatSyncOutbox, true)).toContainEqual([
			"organization_id",
			"dedupe_key",
		]);
		expect(indexColumns(scimSeatSyncOutbox, false)).toContainEqual([
			"status",
			"available_at",
		]);
		expect(columnNames(scimSeatSyncOutbox)).toEqual(
			expect.arrayContaining([
				"claimed_at",
				"claim_token",
				"last_error",
				"processed_at",
			]),
		);
		expect(scimSeatSyncOutbox.claimToken.dataType).toBe("string");
		expect(scimSeatSyncOutbox.claimToken.columnType).toBe("PgUUID");
		expect(scimSeatSyncOutbox.userId.notNull).toBe(false);
		const userForeignKey = getTableConfig(scimSeatSyncOutbox).foreignKeys.find(
			(foreignKey) => foreignKey.reference().foreignColumns.includes(user.id),
		);
		expect(userForeignKey?.reference().columns).toEqual([
			scimSeatSyncOutbox.userId,
		]);
		expect(userForeignKey?.onDelete).toBe("set null");
	});

	it("defines independent organization-scoped projection recovery leases", () => {
		expect(scimProjectionRecoveryStatusEnum.enumValues).toEqual([
			"pending",
			"processing",
			"completed",
		]);
		expectNotNullColumns(scimProjectionRecovery, [
			"organization_id",
			"status",
			"available_at",
			"attempt_count",
			"created_at",
			"updated_at",
		]);
		expect(indexColumns(scimProjectionRecovery, true)).not.toContainEqual([
			"organization_id",
		]);
		expect(indexColumns(scimProjectionRecovery, false)).toContainEqual([
			"organization_id",
			"status",
			"available_at",
		]);
		expect(columnNames(scimProjectionRecovery)).toContain("last_error_code");
		expect(columnNames(scimProjectionRecovery)).not.toContain("last_error");
		const organizationForeignKey = getTableConfig(
			scimProjectionRecovery,
		).foreignKeys.find((foreignKey) =>
			foreignKey
				.reference()
				.columns.includes(scimProjectionRecovery.organizationId),
		);
		expect(organizationForeignKey?.onDelete).toBe("cascade");
	});

	it("keeps provisioning audit metadata opaque and credential-free", () => {
		expect(columnNames(scimProvisioningLog)).toEqual(
			expect.arrayContaining([
				"connection_id",
				"scim_resource_id",
				"request_id",
			]),
		);
		expect(columnNames(scimProvisioningLog)).not.toEqual(
			expect.arrayContaining(["token", "scim_token", "request_payload"]),
		);
		type Metadata = typeof scimProvisioningLog.$inferInsert.metadata;
		const safeMetadata: Metadata = { errorCode: "invalid_user" };
		expect(safeMetadata).toEqual({ errorCode: "invalid_user" });
		expect(indexColumns(scimProvisioningLog, false)).toContainEqual([
			"organization_id",
			"created_at",
		]);
	});

	it("allows system lifecycle events without a user actor", () => {
		expect(userLifecycleEvent.actorType.enumValues).toEqual(["user", "system"]);
		expect(userLifecycleEvent.actorType.notNull).toBe(true);
		expect(userLifecycleEvent.actorType.default).toBe("user");
		expect(userLifecycleEvent.createdBy.notNull).toBe(false);
		const actorCheck = getTableConfig(userLifecycleEvent).checks.find(
			(check) => check.name === "user_lifecycle_event_actor_check",
		);
		expect(actorCheck).toBeDefined();
		const actorCheckSql = normalizedSql(actorCheck?.value as SQL);
		expect(actorCheckSql).toContain("actor_type = 'user'");
		expect(actorCheckSql).toContain("created_by IS NOT NULL");
		expect(actorCheckSql).toContain("actor_type = 'system'");
		expect(actorCheckSql).toContain("created_by IS NULL");
	});
});
