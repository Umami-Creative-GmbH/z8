import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const drizzleUrl = new URL("../../../drizzle/", import.meta.url);
const journal = JSON.parse(
	readFileSync(new URL("meta/_journal.json", drizzleUrl), "utf8"),
) as {
	entries: Array<{
		idx: number;
		version: string;
		when: number;
		tag: string;
		breakpoints: boolean;
	}>;
};
const expectedTag = "0062_better_auth_scim_storage";
const entry = journal.entries.find(({ tag }) => tag === expectedTag);
const migrationUrl = new URL(`${expectedTag}.sql`, drizzleUrl);
const snapshotUrl = new URL("meta/0062_snapshot.json", drizzleUrl);
const migration = existsSync(migrationUrl)
	? readFileSync(migrationUrl, "utf8")
	: "";
const authSchema = readFileSync(
	new URL("../auth-schema.ts", import.meta.url),
	"utf8",
);

const managedTables = [
	"scim_managed_connection",
	"scim_managed_credential",
	"scim_managed_connection_event",
	"scim_connection_binding",
	"scim_identity_tombstone",
	"scim_subject",
	"scim_user",
	"scim_projection_grant",
	"scim_group",
	"scim_group_member",
];
const applicationTables = [
	"scim_provider_config",
	"scim_user_lifecycle_state",
	"scim_role_projection_state",
	"scim_billing_seat_sync_outbox",
	"scim_projection_recovery",
	"scim_provisioning_log",
];
const createdApplicationTables = [
	"scim_user_lifecycle_state",
	"scim_role_projection_state",
	"scim_billing_seat_sync_outbox",
	"scim_projection_recovery",
];
const managedModelNames = [
	"scimManagedConnection",
	"scimManagedCredential",
	"scimManagedConnectionEvent",
	"scimConnectionBinding",
	"scimIdentityTombstone",
	"scimSubject",
	"scimUser",
	"scimProjectionGrant",
	"scimGroup",
	"scimGroupMember",
];
const expectedIndexes: Record<string, string[]> = {
	scim_connection_binding: ["scimConnectionBinding_connectionId_idx"],
	scim_group: [
		"scimGroup_connectionId_idx",
		"scimGroup_provisioningDomainId_idx",
	],
	scim_group_member: [
		"scimGroupMember_connectionId_idx",
		"scimGroupMember_groupId_idx",
		"scimGroupMember_scimUserId_idx",
	],
	scim_identity_tombstone: [
		"scimIdentityTombstone_connectionId_idx",
		"scimIdentityTombstone_provisioningDomainId_idx",
		"scimIdentityTombstone_userId_idx",
	],
	scim_managed_connection: ["scimManagedConnection_provisioningDomainId_idx"],
	scim_managed_connection_event: [
		"scimManagedConnectionEvent_connectionRecordId_idx",
	],
	scim_managed_credential: ["scimManagedCredential_connectionRecordId_idx"],
	scim_projection_grant: [
		"scimProjectionGrant_connectionId_idx",
		"scimProjectionGrant_provisioningDomainId_idx",
		"scimProjectionGrant_scimUserId_idx",
		"scimProjectionGrant_userId_idx",
	],
	scim_subject: ["scimSubject_profileSourceId_idx"],
	scim_user: [
		"scimUser_connectionId_idx",
		"scimUser_provisioningDomainId_idx",
		"scimUser_userId_idx",
	],
	scim_provider_config: [
		"scimProviderConfig_connectionId_unique_idx",
		"scimProviderConfig_creationRequestId_unique_idx",
		"scimProviderConfig_organizationId_connectionId_idx",
		"scimProviderConfig_organizationId_unique_idx",
	],
	scim_user_lifecycle_state: [
		"scimUserLifecycleState_organizationId_userId_unique_idx",
	],
	scim_role_projection_state: [
		"scimRoleProjectionState_organizationId_userId_unique_idx",
	],
	scim_billing_seat_sync_outbox: [
		"scimSeatSyncOutbox_organizationId_dedupeKey_unique_idx",
		"scimSeatSyncOutbox_status_availableAt_idx",
	],
	scim_projection_recovery: [
		"scimProjectionRecovery_organizationId_status_availableAt_idx",
	],
	scim_provisioning_log: [
		"scimProvisioningLog_connectionId_idx",
		"scimProvisioningLog_createdAt_idx",
		"scimProvisioningLog_eventType_idx",
		"scimProvisioningLog_organizationId_createdAt_idx",
		"scimProvisioningLog_organizationId_idx",
		"scimProvisioningLog_userId_idx",
	],
};
const expectedForeignKeys: Record<string, string[]> = {
	scim_group_member: [
		"scim_group_member_group_id_scim_group_id_fk",
		"scim_group_member_scim_user_id_scim_user_id_fk",
	],
	scim_identity_tombstone: ["scim_identity_tombstone_user_id_user_id_fk"],
	scim_managed_connection_event: [
		"scim_managed_connection_event_connection_record_id_scim_managed_connection_id_fk",
	],
	scim_managed_credential: [
		"scim_managed_credential_connection_record_id_scim_managed_connection_id_fk",
	],
	scim_projection_grant: [
		"scim_projection_grant_scim_user_id_scim_user_id_fk",
		"scim_projection_grant_user_id_user_id_fk",
	],
	scim_subject: ["scim_subject_user_id_user_id_fk"],
	scim_user: ["scim_user_user_id_user_id_fk"],
	scim_provider_config: [
		"scim_provider_config_created_by_user_id_fk",
		"scim_provider_config_default_role_template_id_role_template_id_fk",
		"scim_provider_config_organization_id_organization_id_fk",
		"scim_provider_config_updated_by_user_id_fk",
	],
	scim_user_lifecycle_state: [
		"scim_user_lifecycle_state_organization_id_organization_id_fk",
		"scim_user_lifecycle_state_user_id_user_id_fk",
	],
	scim_role_projection_state: [
		"scim_role_projection_state_applied_default_team_id_team_id_fk",
		"scim_role_projection_state_applied_role_template_id_role_template_id_fk",
		"scim_role_projection_state_organization_id_organization_id_fk",
		"scim_role_projection_state_role_template_id_role_template_id_fk",
		"scim_role_projection_state_user_id_user_id_fk",
	],
	scim_billing_seat_sync_outbox: [
		"scim_billing_seat_sync_outbox_organization_id_organization_id_fk",
		"scim_billing_seat_sync_outbox_user_id_user_id_fk",
	],
	scim_projection_recovery: [
		"scim_projection_recovery_organization_id_organization_id_fk",
	],
	scim_provisioning_log: [
		"scim_provisioning_log_organization_id_organization_id_fk",
		"scim_provisioning_log_user_id_user_id_fk",
	],
};

function position(fragment: string): number {
	const index = migration.indexOf(fragment);
	expect(index, `missing migration SQL: ${fragment}`).toBeGreaterThanOrEqual(0);
	return index;
}

describe("Better Auth SCIM storage migration", () => {
	it("registers the exact generated migration after every predecessor", () => {
		const entryIndex = journal.entries.findIndex(
			({ tag }) => tag === expectedTag,
		);
		const latestPriorWhen = Math.max(
			...journal.entries.slice(0, entryIndex).map(({ when }) => when),
		);

		expect(entry).toMatchObject({
			idx: 62,
			tag: expectedTag,
			version: "7",
			breakpoints: true,
		});
		expect(entry?.when ?? 0).toBeGreaterThan(latestPriorWhen);
		expect(existsSync(migrationUrl)).toBe(true);
		expect(existsSync(snapshotUrl)).toBe(true);
	});

	it("creates every managed and application SCIM table represented by the snapshot", () => {
		const snapshot = existsSync(snapshotUrl)
			? (JSON.parse(readFileSync(snapshotUrl, "utf8")) as {
					tables: Record<
						string,
						{
							indexes: Record<string, unknown>;
							foreignKeys: Record<string, unknown>;
							checkConstraints: Record<string, unknown>;
						}
					>;
					enums: Record<string, { values: string[] }>;
				})
			: { tables: {}, enums: {} };

		for (const table of [...managedTables, ...applicationTables]) {
			expect(snapshot.tables, table).toHaveProperty(`public.${table}`);
		}
		expect(snapshot.tables).not.toHaveProperty("public.scim_provider");
		expect(snapshot.enums["public.idp_type"]?.values).toEqual(["sso", "scim"]);
		expect(snapshot.enums["public.lifecycle_actor_type"]?.values).toEqual([
			"user",
			"system",
		]);
		for (const enumName of [
			"scim_connection_state",
			"scim_deprovision_action",
			"scim_outbox_status",
			"scim_projection_recovery_status",
		]) {
			expect(snapshot.enums).toHaveProperty(`public.${enumName}`);
		}
		for (const [table, indexes] of Object.entries(expectedIndexes)) {
			expect(
				Object.keys(snapshot.tables[`public.${table}`]?.indexes ?? {}).sort(),
				`${table} indexes`,
			).toEqual([...indexes].sort());
		}
		for (const [table, foreignKeys] of Object.entries(expectedForeignKeys)) {
			expect(
				Object.keys(
					snapshot.tables[`public.${table}`]?.foreignKeys ?? {},
				).sort(),
				`${table} foreign keys`,
			).toEqual([...foreignKeys].sort());
		}
		expect(
			Object.keys(
				snapshot.tables["public.user_lifecycle_event"]?.checkConstraints ?? {},
			),
		).toContain("user_lifecycle_event_actor_check");
	});

	it("creates or alters every expected SCIM table in the migration SQL", () => {
		for (const table of [...managedTables, ...createdApplicationTables]) {
			expect(migration, `${table} creation`).toContain(
				`CREATE TABLE "${table}"`,
			);
		}
		for (const table of ["scim_provider_config", "scim_provisioning_log"]) {
			expect(migration, `${table} alteration`).toContain(
				`ALTER TABLE "${table}"`,
			);
		}
		expect(migration).not.toContain('CREATE TABLE "scim_provider"');
	});

	it("keeps Better Auth's generated SCIM model names", () => {
		for (const modelName of managedModelNames) {
			expect(authSchema).toContain(`export const ${modelName} = pgTable(`);
		}
	});

	it("creates organization-scoped indexes and attribution constraints", () => {
		for (const indexName of [
			"scimProviderConfig_organizationId_unique_idx",
			"scimProviderConfig_creationRequestId_unique_idx",
			"scimProviderConfig_connectionId_unique_idx",
			"scimProviderConfig_organizationId_connectionId_idx",
			"scimUserLifecycleState_organizationId_userId_unique_idx",
			"scimRoleProjectionState_organizationId_userId_unique_idx",
			"scimSeatSyncOutbox_organizationId_dedupeKey_unique_idx",
			"scimSeatSyncOutbox_status_availableAt_idx",
			"scimProjectionRecovery_organizationId_status_availableAt_idx",
			"scimProvisioningLog_organizationId_createdAt_idx",
		]) {
			expect(migration, indexName).toContain(`"${indexName}"`);
		}
		expect(migration).toContain(
			'CONSTRAINT "user_lifecycle_event_actor_check" CHECK',
		);
		expect(migration).toContain("\"actor_type\" = 'user'");
		expect(migration).toContain('"created_by" IS NOT NULL');
		expect(migration).toContain("\"actor_type\" = 'system'");
		expect(migration).toContain('"created_by" IS NULL');
	});

	it("refuses to drop nonempty legacy SCIM storage", () => {
		const guardPosition = position("DO $scim_legacy_storage_guard$");
		const dropPosition = position('DROP TABLE "scim_provider"');
		const guard = migration.slice(guardPosition, dropPosition);

		expect(guardPosition).toBeLessThan(dropPosition);
		expect(guard).toContain("to_regclass('public.scim_provider') IS NOT NULL");
		expect(guard).toContain('FROM public."scim_provider"');
		expect(guard).toContain(
			"Legacy SCIM storage public.scim_provider is not empty",
		);
		expect(guard).toContain("no supported automatic data migration");
		expect(guard).toContain(
			"Remove or migrate those rows explicitly, then retry",
		);
		expect(guard).toContain(
			"to_regclass('public.scim_provider_config') IS NOT NULL",
		);
		expect(guard).toContain('FROM public."scim_provider_config"');
		expect(migration).not.toContain('DROP TABLE "scim_provider" CASCADE');
	});

	it("normalizes legacy enterprise SCIM setup before destructive cutover steps", () => {
		const safeScimState =
			'{"policy":{"autoActivateUsers":false,"deprovisionAction":"suspend","defaultRoleTemplateId":null},"connection":null}';
		const setupDefault = `ALTER TABLE "enterprise_identity_setup" ALTER COLUMN "scim" SET DEFAULT '${safeScimState}'::jsonb;`;
		const setupNormalization = 'UPDATE "enterprise_identity_setup"';
		const storageGuardPosition = position("DO $scim_legacy_storage_guard$");
		const firstDestructivePosition = position(
			'ALTER TABLE "scim_provider" DISABLE ROW LEVEL SECURITY',
		);

		expect(migration).toContain(setupDefault);
		expect(migration).toContain(setupNormalization);
		expect(migration).toContain(`SET "scim" = '${safeScimState}'::jsonb`);
		expect(migration).not.toContain("enabled_legacy_scim_setup_guard");
		expect(migration).not.toContain("still claims SCIM is enabled");
		expect(migration.indexOf(setupDefault)).toBeLessThan(storageGuardPosition);
		expect(migration.indexOf(setupNormalization)).toBeLessThan(
			storageGuardPosition,
		);
		expect(migration.indexOf(setupNormalization)).toBeLessThan(
			firstDestructivePosition,
		);
		expect(migration).not.toMatch(/scim_token|\btoken\b/i);
	});

	it("drops the text default before converting the deprovision action enum", () => {
		const dropDefault =
			'ALTER TABLE "scim_provider_config" ALTER COLUMN "deprovision_action" DROP DEFAULT;';
		const alterType =
			'ALTER TABLE "scim_provider_config" ALTER COLUMN "deprovision_action" SET DATA TYPE "public"."scim_deprovision_action" USING "deprovision_action"::"public"."scim_deprovision_action";';
		const setDefault =
			'ALTER TABLE "scim_provider_config" ALTER COLUMN "deprovision_action" SET DEFAULT \'suspend\'::"public"."scim_deprovision_action";';
		const dropDefaultPosition = position(dropDefault);
		const alterTypePosition = position(alterType);
		const setDefaultPosition = position(setDefault);

		expect(dropDefaultPosition).toBeLessThan(alterTypePosition);
		expect(alterTypePosition).toBeLessThan(setDefaultPosition);
	});

	it("orders types, tables, keys, indexes, and guarded legacy removal safely", () => {
		const firstEnum = position('CREATE TYPE "public"."scim_connection_state"');
		const firstManagedTable = position(
			'CREATE TABLE "scim_managed_connection"',
		);
		const dependentManagedTable = position(
			'CREATE TABLE "scim_managed_credential"',
		);
		const firstForeignKey = position(
			'ALTER TABLE "scim_managed_credential" ADD CONSTRAINT',
		);
		const firstManagedIndex = position(
			'CREATE INDEX "scimManagedConnection_provisioningDomainId_idx"',
		);
		const legacyGuard = position("DO $scim_legacy_storage_guard$");
		const legacyDrop = position('DROP TABLE "scim_provider"');

		expect(firstEnum).toBeLessThan(firstManagedTable);
		expect(firstManagedTable).toBeLessThan(dependentManagedTable);
		expect(dependentManagedTable).toBeLessThan(firstForeignKey);
		expect(firstForeignKey).toBeLessThan(firstManagedIndex);
		expect(legacyGuard).toBeLessThan(legacyDrop);
	});
});
