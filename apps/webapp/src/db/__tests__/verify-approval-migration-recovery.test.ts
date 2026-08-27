import { describe, expect, it } from "vitest";
import {
	type ApprovalCatalog,
	assertApprovalCatalog,
	assertDisposableDatabasePreflight,
	assertMigrationLedgerUnchanged,
	buildCatalogNamespaceCountQuery,
	filterIncidentJournal,
	formatMigrationVerificationFailure,
	normalizeMigrationLedger,
	sumCatalogNamespaceCounts,
} from "../../../scripts/verify-approval-migration-recovery";
import { parseApprovalWorkflowRepositoryTestDatabaseUrl } from "../../lib/approvals/workflow/repository-integration-harness";

describe("destructive database safety", () => {
	it.each([
		"postgresql://postgres:secret@127.0.0.1:5432/approval_workflow_repository_test_local",
		"postgresql://postgres:secret@localhost:5432/approval_workflow_repository_test_local",
		"postgresql://postgres:secret@[::1]:5432/approval_workflow_repository_test_local",
	])("accepts an isolated loopback PostgreSQL URL", (databaseUrl) => {
		expect(
			parseApprovalWorkflowRepositoryTestDatabaseUrl(databaseUrl),
		).toMatchObject({
			databaseUrl,
			databaseName: "approval_workflow_repository_test_local",
		});
	});

	it("rejects a remote database without exposing URL credentials", () => {
		const databaseUrl =
			"postgresql://postgres:do-not-log@example.com/approval_workflow_repository_test_remote";
		let message = "";
		try {
			parseApprovalWorkflowRepositoryTestDatabaseUrl(databaseUrl);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("loopback");
		expect(message).not.toContain("do-not-log");
	});

	it("rejects a non-PostgreSQL protocol", () => {
		expect(() =>
			parseApprovalWorkflowRepositoryTestDatabaseUrl(
				"https://localhost/approval_workflow_repository_test_local",
			),
		).toThrow("PostgreSQL protocol");
	});

	it.each([
		"?host=db.example.com",
		"?application_name=approval-migration-verifier",
	])("rejects database URL query parameters: %s", (search) => {
		expect(() =>
			parseApprovalWorkflowRepositoryTestDatabaseUrl(
				`postgresql://postgres:secret@127.0.0.1:5432/approval_workflow_repository_test_local${search}`,
			),
		).toThrow("must not include query parameters");
	});

	it("accepts matching empty database catalog evidence", () => {
		expect(() =>
			assertDisposableDatabasePreflight({
				expectedDatabaseName: "approval_workflow_repository_test_expected",
				currentDatabaseName: "approval_workflow_repository_test_expected",
				drizzleSchemaExists: false,
				publicSchemaObjectCount: BigInt(0),
				unexpectedUserSchemaCount: BigInt(0),
			}),
		).not.toThrow();
	});

	it.each([
		{
			name: "wrong current database",
			evidence: {
				expectedDatabaseName: "approval_workflow_repository_test_expected",
				currentDatabaseName: "approval_workflow_repository_test_other",
				drizzleSchemaExists: false,
				publicSchemaObjectCount: BigInt(0),
				unexpectedUserSchemaCount: BigInt(0),
			},
		},
		{
			name: "public schema object",
			evidence: {
				expectedDatabaseName: "approval_workflow_repository_test_expected",
				currentDatabaseName: "approval_workflow_repository_test_expected",
				drizzleSchemaExists: false,
				publicSchemaObjectCount: BigInt(1),
				unexpectedUserSchemaCount: BigInt(0),
			},
		},
		{
			name: "preexisting drizzle schema",
			evidence: {
				expectedDatabaseName: "approval_workflow_repository_test_expected",
				currentDatabaseName: "approval_workflow_repository_test_expected",
				drizzleSchemaExists: true,
				publicSchemaObjectCount: BigInt(0),
				unexpectedUserSchemaCount: BigInt(0),
			},
		},
		{
			name: "unexpected user schema",
			evidence: {
				expectedDatabaseName: "approval_workflow_repository_test_expected",
				currentDatabaseName: "approval_workflow_repository_test_expected",
				drizzleSchemaExists: false,
				publicSchemaObjectCount: BigInt(0),
				unexpectedUserSchemaCount: BigInt(1),
			},
		},
	])("rejects $name", ({ evidence }) => {
		expect(() => assertDisposableDatabasePreflight(evidence)).toThrow(
			"Refusing destructive approval migration verification",
		);
	});

	it("builds a parameterized count for validated discovered catalog identifiers", () => {
		expect(
			buildCatalogNamespaceCountQuery({
				tableName: "pg_collation",
				columnName: "collnamespace",
			}),
		).toBe(
			'select count(*)::text as count from pg_catalog."pg_collation" where "collnamespace" = $1::oid',
		);
	});

	it.each([
		{ tableName: "pg_class; drop table users", columnName: "relnamespace" },
		{ tableName: "public_table", columnName: "relnamespace" },
		{ tableName: "pg_class", columnName: 'relnamespace"' },
		{ tableName: "pg_class", columnName: "relowner" },
	])(
		"rejects untrusted discovered catalog identifiers: $tableName.$columnName",
		(reference) => {
			expect(() => buildCatalogNamespaceCountQuery(reference)).toThrow(
				"Invalid pg_catalog namespace reference",
			);
		},
	);

	it("sums discovered catalog counts without numeric precision loss", () => {
		expect(
			sumCatalogNamespaceCounts([
				{ count: "9007199254740993" },
				{ count: BigInt(2) },
				{ count: 4 },
			]),
		).toBe(BigInt("9007199254740999"));
	});
});

describe("filterIncidentJournal", () => {
	it("builds the incident state through 0059 without later migrations", () => {
		const journal = {
			version: "7",
			dialect: "postgresql",
			entries: [
				{ tag: "0054_employee_invitation_draft_identity" },
				{ tag: "0055_approval_workflow_expand" },
				{ tag: "0056_approval_workflow_cycle_identity" },
				{ tag: "0057_team_permissions_uniqueness" },
				{ tag: "0058_employee_clock_activity_index" },
				{ tag: "0059_payroll_blocker_dismissal" },
				{ tag: "0060_approval_workflow_recovery" },
				{ tag: "0061_better_auth_account_issuers" },
				{ tag: "0062_better_auth_scim_storage" },
			],
		};

		expect(
			filterIncidentJournal(journal).entries.map((entry) => entry.tag),
		).toEqual([
			"0054_employee_invitation_draft_identity",
			"0057_team_permissions_uniqueness",
			"0058_employee_clock_activity_index",
			"0059_payroll_blocker_dismissal",
		]);
	});

	it("builds the recovery state through 0060 without later migrations", () => {
		const journal = {
			version: "7",
			dialect: "postgresql",
			entries: [
				{ tag: "0054_employee_invitation_draft_identity" },
				{ tag: "0055_approval_workflow_expand" },
				{ tag: "0056_approval_workflow_cycle_identity" },
				{ tag: "0057_team_permissions_uniqueness" },
				{ tag: "0058_employee_clock_activity_index" },
				{ tag: "0059_payroll_blocker_dismissal" },
				{ tag: "0060_approval_workflow_recovery" },
				{ tag: "0061_better_auth_account_issuers" },
				{ tag: "0062_better_auth_scim_storage" },
			],
		};

		expect(
			filterIncidentJournal(journal, "0060_approval_workflow_recovery").entries.map(
				(entry) => entry.tag,
			),
		).toEqual([
			"0054_employee_invitation_draft_identity",
			"0057_team_permissions_uniqueness",
			"0058_employee_clock_activity_index",
			"0059_payroll_blocker_dismissal",
			"0060_approval_workflow_recovery",
		]);
	});
});

describe("migration ledger retry comparison", () => {
	const ledger = [
		{ id: 1, hash: "first", created_at: BigInt("1785493929039") },
		{
			id: "2",
			hash: "second",
			created_at: new Date("2026-07-31T12:00:00.000Z"),
		},
	];

	it("normalizes bigint and timestamp representations deterministically", () => {
		expect(normalizeMigrationLedger(ledger)).toEqual([
			{ id: "1", hash: "first", createdAt: "1785493929039" },
			{
				id: "2",
				hash: "second",
				createdAt: "2026-07-31T12:00:00.000Z",
			},
		]);
	});

	it.each(["id", "hash", "created_at"] as const)(
		"rejects a changed %s after migration replay",
		(field) => {
			const replayed = ledger.map((row) => ({ ...row }));
			replayed[1] = { ...replayed[1], [field]: "changed" };

			expect(() => assertMigrationLedgerUnchanged(ledger, replayed)).toThrow(
				"Retry changed the Drizzle migration ledger",
			);
		},
	);
});

describe("migration recovery failure output", () => {
	it("retains PostgreSQL code and detail without including unrelated error properties", () => {
		expect(
			formatMigrationVerificationFailure({
				message: 'column reference "provider" is ambiguous',
				code: "42702",
				detail: "It could refer to either a PL/pgSQL variable or a table column.",
				connectionString: "postgresql://postgres:do-not-log@localhost/test",
			}),
		).toBe(
			'column reference "provider" is ambiguous (PostgreSQL code 42702; detail: It could refer to either a PL/pgSQL variable or a table column.)',
		);
	});
});

describe("assertApprovalCatalog", () => {
	const validCatalog: ApprovalCatalog = {
		tables: [
			"approval_inbox_projection",
			"approval_outbox",
			"approval_outbox_delivery",
			"approval_requester_projection",
			"approval_stage_assignment",
			"approval_workflow",
			"approval_workflow_command",
			"approval_workflow_event",
			"approval_workflow_migration_issue",
			"approval_workflow_rollout",
			"approval_workflow_stage",
		],
		columns: [
			{ table: "absence_entry", name: "approval_workflow_id", type: "uuid" },
			{
				table: "compliance_exception",
				name: "approval_workflow_id",
				type: "uuid",
			},
			{ table: "shift_request", name: "approval_workflow_id", type: "uuid" },
			{
				table: "travel_expense_claim",
				name: "approval_workflow_id",
				type: "uuid",
			},
			{ table: "work_period", name: "approval_workflow_id", type: "uuid" },
		],
		indexes: [
			{
				name: "approvalWorkflow_org_source_pending_idx",
				table: "approval_workflow",
				unique: true,
				columns: [
					"organization_id",
					"workflow_type",
					"source_type",
					"source_id",
				],
				predicate: "(status = 'pending'::approval_workflow_status)",
			},
		],
	};

	it("accepts the canonical approval tables, source UUIDs, and pending identity index", () => {
		expect(() => assertApprovalCatalog(validCatalog)).not.toThrow();
	});

	it("rejects a pending identity index with the legacy column order", () => {
		expect(() =>
			assertApprovalCatalog({
				...validCatalog,
				indexes: [
					{
						...validCatalog.indexes[0],
						columns: ["organization_id", "source_type", "source_id"],
					},
				],
			}),
		).toThrow("approvalWorkflow_org_source_pending_idx");
	});
});
