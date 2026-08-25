import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const drizzleUrl = new URL("../../../drizzle/", import.meta.url);
const tag = "0064_safe_scim_setup_state";
const migrationUrl = new URL(`${tag}.sql`, drizzleUrl);
const cutoverMigrationUrl = new URL(
	"0062_better_auth_scim_storage.sql",
	drizzleUrl,
);
const snapshotUrl = new URL("meta/0064_snapshot.json", drizzleUrl);
const journal = JSON.parse(
	readFileSync(new URL("meta/_journal.json", drizzleUrl), "utf8"),
) as { entries: Array<{ idx: number; when: number; tag: string }> };
const migration = existsSync(migrationUrl)
	? readFileSync(migrationUrl, "utf8")
	: "";
const cutoverMigration = readFileSync(cutoverMigrationUrl, "utf8");

describe("safe enterprise identity SCIM setup migration", () => {
	it("is a forward migration with generated journal and snapshot metadata", () => {
		const entry = journal.entries.find((candidate) => candidate.tag === tag);
		const prior = journal.entries.find(
			(candidate) => candidate.tag === "0063_scim_creation_recovery",
		);

		expect(existsSync(migrationUrl)).toBe(true);
		expect(existsSync(snapshotUrl)).toBe(true);
		expect(entry).toMatchObject({ idx: 64, tag });
		expect(entry?.when).toBeGreaterThan(prior?.when ?? 0);
	});

	it("sets the safe JSON default before normalizing legacy setup state", () => {
		const defaultSql =
			'ALTER TABLE "enterprise_identity_setup" ALTER COLUMN "scim" SET DEFAULT \'{"policy":{"autoActivateUsers":false,"deprovisionAction":"suspend","defaultRoleTemplateId":null},"connection":null}\'::jsonb;';
		const normalizeSql = 'UPDATE "enterprise_identity_setup"';

		expect(migration).toContain(defaultSql);
		expect(migration).toContain(normalizeSql);
		expect(migration.indexOf(defaultSql)).toBeLessThan(
			migration.indexOf(normalizeSql),
		);
	});

	it("normalizes only explicitly disabled legacy values and invalidates all other legacy state", () => {
		expect(migration).toContain("WHEN \"scim\" = 'false'::jsonb THEN true");
		expect(migration).toContain(
			"WHEN \"scim\" -> 'enabled' = 'false'::jsonb THEN true",
		);
		expect(migration).toContain(
			"lower(btrim(\"scim\" ->> 'enabled')) IN ('false', 'f', '0', 'no', 'n', 'off', 'disabled')",
		);
		expect(migration).toContain(
			"WHEN \"scim\" -> 'enabled' = 'null'::jsonb THEN true",
		);
		expect(migration).toContain("ELSE false");
		expect(migration).toContain(
			"-- Enabled or ambiguous legacy state is invalidated, never activated.",
		);
	});

	it("does not preserve a legacy token or claim a managed connection", () => {
		expect(migration).not.toMatch(/scim_token|\btoken\b/i);
		expect(migration).not.toContain("connectionId");
		expect(migration).toContain('"connection":null');
	});

	it("keeps 0064 as an idempotent default recovery after the 0062 cutover scrub", () => {
		const safeState =
			'{"policy":{"autoActivateUsers":false,"deprovisionAction":"suspend","defaultRoleTemplateId":null},"connection":null}';
		const cutoverNormalization = cutoverMigration.indexOf(
			'UPDATE "enterprise_identity_setup"',
		);
		const cutoverDrop = cutoverMigration.indexOf('DROP TABLE "scim_provider"');

		expect(cutoverNormalization).toBeGreaterThan(-1);
		expect(cutoverNormalization).toBeLessThan(cutoverDrop);
		expect(cutoverMigration).toContain(`SET "scim" = '${safeState}'::jsonb`);
		expect(migration).toContain(`SET "scim" = '${safeState}'::jsonb`);
		expect(cutoverMigration).not.toMatch(/scim_token|\btoken\b/i);
	});
});
