import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
	buildMigrationStagePlan,
	evaluateUniqueIndexAttachability,
	isRetryableLockOrTimeoutError,
	parseDrainGateConfig,
	runCommandWithLockRetry,
	withLockTimeoutRetry,
} from "../../scripts/boundary-migration-engine.js";

describe("boundary-migration-engine", () => {
	describe("buildMigrationStagePlan", () => {
		it("commits historical prefix 0000-0317 before pre-0318 index builds and isolates 0318-0321, 0322, 0323, 0324, 0325, 0326, 0327 across separate transaction boundaries", () => {
			const migrations = [
				{ tag: "0000_init", prefix: 0, folderMillis: 1000, hash: "h0", sql: ["select 1"] },
				{ tag: "0317_settled", prefix: 317, folderMillis: 2000, hash: "h317", sql: ["select 1"] },
				{
					tag: "0318_policy_ver",
					prefix: 318,
					folderMillis: 3000,
					hash: "h318",
					sql: ["select 1"],
				},
				{ tag: "0319_defaults", prefix: 319, folderMillis: 4000, hash: "h319", sql: ["select 1"] },
				{ tag: "0320_terms", prefix: 320, folderMillis: 5000, hash: "h320", sql: ["select 1"] },
				{ tag: "0321_batch", prefix: 321, folderMillis: 6000, hash: "h321", sql: ["select 1"] },
				{
					tag: "0322_assign_con",
					prefix: 322,
					folderMillis: 7000,
					hash: "h322",
					sql: ["select 1"],
				},
				{ tag: "0323_terms_con", prefix: 323, folderMillis: 8000, hash: "h323", sql: ["select 1"] },
				{
					tag: "0324_policy_prep",
					prefix: 324,
					folderMillis: 9000,
					hash: "h324",
					sql: ["select 1"],
				},
				{
					tag: "0325_policy_val",
					prefix: 325,
					folderMillis: 10000,
					hash: "h325",
					sql: ["select 1"],
				},
				{
					tag: "0326_policy_cut",
					prefix: 326,
					folderMillis: 11000,
					hash: "h326",
					sql: ["select 1"],
				},
				{
					tag: "0327_policy_seal",
					prefix: 327,
					folderMillis: 12000,
					hash: "h327",
					sql: ["select 1"],
				},
				{ tag: "0328_future", prefix: 328, folderMillis: 13000, hash: "h328", sql: ["select 1"] },
			];

			const plan = buildMigrationStagePlan(migrations);
			expect(
				plan.map((stage) => ({ id: stage.id, tags: stage.migrations.map((m) => m.tag) })),
			).toEqual([
				{ id: "historical_prefix_0000_0317", tags: ["0000_init", "0317_settled"] },
				{
					id: "phase1_expand_0318_0321",
					tags: ["0318_policy_ver", "0319_defaults", "0320_terms", "0321_batch"],
				},
				{ id: "phase2_0322", tags: ["0322_assign_con"] },
				{ id: "phase2_0323", tags: ["0323_terms_con"] },
				{ id: "phase2_0324", tags: ["0324_policy_prep"] },
				{ id: "phase2_0325", tags: ["0325_policy_val"] },
				{ id: "phase2_0326", tags: ["0326_policy_cut"] },
				{ id: "phase2_0327", tags: ["0327_policy_seal"] },
				{ id: "post_0327", tags: ["0328_future"] },
			]);
		});
	});

	describe("parseDrainGateConfig", () => {
		it("defaults both drain gates to false and lock retries to 20", () => {
			expect(parseDrainGateConfig({})).toEqual({
				allowContractConstraints: false,
				allowPolicyV1Seal: false,
				lockRetries: 20,
			});
		});

		it("only enables drain gates when explicitly set to 'true'", () => {
			expect(
				parseDrainGateConfig({
					DB_ALLOW_CONTRACT_CONSTRAINTS: "true",
					DB_ALLOW_POLICY_V1_SEAL: "1",
					DB_MIGRATION_LOCK_RETRIES: "7",
				}),
			).toEqual({
				allowContractConstraints: true,
				allowPolicyV1Seal: false,
				lockRetries: 7,
			});
		});

		it("rejects non-integer or negative DB_MIGRATION_LOCK_RETRIES", () => {
			expect(() => parseDrainGateConfig({ DB_MIGRATION_LOCK_RETRIES: "-1" })).toThrow(
				/DB_MIGRATION_LOCK_RETRIES/,
			);
			expect(() => parseDrainGateConfig({ DB_MIGRATION_LOCK_RETRIES: "abc" })).toThrow(
				/DB_MIGRATION_LOCK_RETRIES/,
			);
		});
	});

	describe("evaluateUniqueIndexAttachability", () => {
		const validRow = {
			index_relkind: "i",
			table_schema: "public",
			table_name: "work_policy",
			access_method: "btree",
			indisunique: true,
			indimmediate: true,
			indnullsnotdistinct: false,
			indisvalid: true,
			indnkeyatts: 2,
			indnatts: 2,
			has_expressions: false,
			is_partial: false,
			key_columns: [
				{
					pos: 1,
					attnum: 1,
					attname: "id",
					indoption: 0,
					indcollation: 0,
					attcollation: 0,
					opclass_is_default: true,
					opclass_name: "uuid_ops",
				},
				{
					pos: 2,
					attnum: 2,
					attname: "organization_id",
					indoption: 0,
					indcollation: 100,
					attcollation: 100,
					opclass_is_default: true,
					opclass_name: "text_ops",
				},
			],
		};

		const spec = {
			schema: "public",
			tableName: "work_policy",
			indexName: "work_policy_id_org_uidx",
			columns: ["id", "organization_id"],
		};

		it("accepts a valid attachable PostgreSQL 16 unique btree index", () => {
			expect(evaluateUniqueIndexAttachability(validRow, spec)).toEqual({
				status: "attachable",
				reasons: [],
			});
		});

		it("marks a structurally matching invalid index for concurrent rebuild", () => {
			expect(evaluateUniqueIndexAttachability({ ...validRow, indisvalid: false }, spec)).toEqual({
				status: "rebuild_invalid",
				reasons: ["index is invalid (indisvalid = false)"],
			});
		});

		it("rejects mismatched owning table, non-btree AM, non-unique, deferrable, nulls-not-distinct, expression, partial, wrong columns, DESC ordering, non-default opclass, and mismatched collation", () => {
			const badCases: Array<[string, Record<string, unknown>, RegExp]> = [
				["wrong table", { ...validRow, table_name: "team" }, /owning table/i],
				["non-btree", { ...validRow, access_method: "hash" }, /btree/i],
				["non-unique", { ...validRow, indisunique: false }, /indisunique/i],
				["deferrable", { ...validRow, indimmediate: false }, /indimmediate/i],
				["nulls not distinct", { ...validRow, indnullsnotdistinct: true }, /indnullsnotdistinct/i],
				["expression", { ...validRow, has_expressions: true }, /expression/i],
				["partial", { ...validRow, is_partial: true }, /partial/i],
				[
					"wrong column order",
					{
						...validRow,
						key_columns: [validRow.key_columns[1], validRow.key_columns[0]],
					},
					/column/i,
				],
				[
					"DESC sort order (indoption != 0)",
					{
						...validRow,
						key_columns: [validRow.key_columns[0], { ...validRow.key_columns[1], indoption: 1 }],
					},
					/indoption|sort/i,
				],
				[
					"non-default operator class",
					{
						...validRow,
						key_columns: [
							validRow.key_columns[0],
							{
								...validRow.key_columns[1],
								opclass_is_default: false,
								opclass_name: "text_pattern_ops",
							},
						],
					},
					/operator class/i,
				],
				[
					"mismatched collation",
					{
						...validRow,
						key_columns: [
							validRow.key_columns[0],
							{ ...validRow.key_columns[1], indcollation: 950, attcollation: 100 },
						],
					},
					/collation/i,
				],
			];

			for (const [label, row, pattern] of badCases) {
				const result = evaluateUniqueIndexAttachability(row, spec);
				expect(result.status, label).toBe("incompatible");
				expect(result.reasons.join("; "), label).toMatch(pattern);
			}
		});
	});

	describe("SQLSTATE 55P03/57014 retries and child stdio mirroring", () => {
		it("retries on 55P03 and 57014 with jittered backoff and fails fast on non-retryable errors", async () => {
			let attempts = 0;
			const delays: number[] = [];
			const value = await withLockTimeoutRetry(
				async () => {
					attempts += 1;
					if (attempts === 1) {
						throw Object.assign(new Error("could not obtain lock"), { code: "55P03" });
					}
					if (attempts === 2) {
						throw Object.assign(new Error("canceling statement due to statement timeout"), {
							code: "57014",
						});
					}
					return "ok";
				},
				{
					stepName: "test-step",
					maxRetries: 5,
					baseDelayMs: 10,
					maxDelayMs: 50,
					sleep: async (ms: number) => {
						delays.push(ms);
					},
				},
			);

			expect(value).toBe("ok");
			expect(attempts).toBe(3);
			expect(delays).toHaveLength(2);

			expect(isRetryableLockOrTimeoutError({ code: "55P03" })).toBe(true);
			expect(isRetryableLockOrTimeoutError({ cause: { code: "57014" } })).toBe(true);
			expect(isRetryableLockOrTimeoutError({ code: "23505" })).toBe(false);
		});

		it("mirrors child stdout/stderr while retrying SQLSTATE 55P03/57014", async () => {
			let runs = 0;
			const stdoutChunks: string[] = [];
			const stderrChunks: string[] = [];
			const mockSpawn = vi.fn(() => {
				runs += 1;
				if (runs === 1) {
					return {
						status: 1,
						stdout: "attempt 1\n",
						stderr: "ERROR: 55P03 lock_not_available\n",
					};
				}
				return {
					status: 0,
					stdout: "attempt 2 succeeded\n",
					stderr: "",
				};
			});

			await runCommandWithLockRetry(
				{ command: "node", args: ["-v"], shell: false },
				{
					maxRetries: 3,
					baseDelayMs: 1,
					maxDelayMs: 5,
					sleep: async () => {},
					spawnSyncImpl: mockSpawn,
					stdoutWrite: (chunk: string) => {
						stdoutChunks.push(chunk);
					},
					stderrWrite: (chunk: string) => {
						stderrChunks.push(chunk);
					},
				},
			);

			expect(runs).toBe(2);
			expect(stdoutChunks.join("")).toContain("attempt 1");
			expect(stdoutChunks.join("")).toContain("attempt 2 succeeded");
			expect(stderrChunks.join("")).toContain("55P03");
		});
	});

	describe("packaged deployment manifests", () => {
		it("wire DB_ALLOW_CONTRACT_CONSTRAINTS, DB_ALLOW_POLICY_V1_SEAL, and DB_MIGRATION_LOCK_RETRIES into Compose and Kubernetes manifests", async () => {
			const [compose, k8sMigration, k8sConfigMap] = await Promise.all([
				readFile(new URL("../../../../deploy/compose/docker-compose.yml", import.meta.url), "utf8"),
				readFile(new URL("../../../../deploy/k8s/migration.yaml", import.meta.url), "utf8"),
				readFile(new URL("../../../../deploy/k8s/configmap.yaml", import.meta.url), "utf8"),
			]);

			expect(compose).toContain(
				"DB_ALLOW_CONTRACT_CONSTRAINTS: ${DB_ALLOW_CONTRACT_CONSTRAINTS:-false}",
			);
			expect(compose).toContain("DB_ALLOW_POLICY_V1_SEAL: ${DB_ALLOW_POLICY_V1_SEAL:-false}");
			expect(compose).toContain("DB_MIGRATION_LOCK_RETRIES: ${DB_MIGRATION_LOCK_RETRIES:-20}");

			expect(k8sMigration).toContain("name: DB_ALLOW_CONTRACT_CONSTRAINTS");
			expect(k8sMigration).toContain("name: DB_ALLOW_POLICY_V1_SEAL");
			expect(k8sMigration).toContain("name: DB_MIGRATION_LOCK_RETRIES");

			expect(k8sConfigMap).toContain('db-allow-contract-constraints: "false"');
			expect(k8sConfigMap).toContain('db-allow-policy-v1-seal: "false"');
			expect(k8sConfigMap).toContain('db-migration-lock-retries: "20"');
		});
	});
});
