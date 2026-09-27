import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "./repository-integration-harness";

const enabledDatabaseUrl =
	"postgresql://postgres:test@localhost:5432/approval_workflow_repository_test_a1b2c3d4";

describe("approval workflow repository integration database guard", () => {
	// This file runs in the `unit` project; the gate itself refuses that project.
	beforeEach(() => {
		vi.stubEnv("Z8_TEST_PROJECT", "integration");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("called from the unit test project", () => {
		beforeEach(() => {
			vi.stubEnv("Z8_TEST_PROJECT", "unit");
		});

		it("refuses to resolve a configuration, even an enabled one", () => {
			expect(() =>
				resolveApprovalWorkflowRepositoryTestConfiguration({
					databaseUrl: enabledDatabaseUrl,
					required: true,
					sentinel: "approval-workflow-repository-test",
				}),
			).toThrow("database suites must be named `*.integration.test.ts`");
		});

		it("refuses to verify the database without connecting", async () => {
			const currentDatabase = vi.fn();

			await expect(
				verifyApprovalWorkflowRepositoryTestDatabase({
					databaseUrl: undefined,
					required: false,
					sentinel: undefined,
					currentDatabase,
				}),
			).rejects.toThrow("database suites must be named `*.integration.test.ts`");
			expect(currentDatabase).not.toHaveBeenCalled();
		});
	});

	it("skips without opening a database connection when the URL or opt-in sentinel is absent", async () => {
		const currentDatabase = vi.fn();

		await expect(
			verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl: undefined,
				required: false,
				sentinel: undefined,
				currentDatabase,
			}),
		).resolves.toEqual({
			status: "unavailable",
			reason: "disposable PostgreSQL URL and sentinel are not configured",
		});

		expect(currentDatabase).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "URL without sentinel",
			databaseUrl: "postgres://ignored",
			sentinel: undefined,
			required: false,
		},
		{
			name: "wrong sentinel",
			databaseUrl: "postgres://ignored",
			sentinel: "wrong",
			required: false,
		},
		{
			name: "required suite without disposable configuration",
			databaseUrl: undefined,
			sentinel: undefined,
			required: true,
		},
	])("fails for $name", async ({ databaseUrl, sentinel, required }) => {
		const currentDatabase = vi.fn();
		await expect(
			verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl,
				required,
				sentinel,
				currentDatabase,
			}),
		).rejects.toThrow(
			"Invalid approval workflow repository test configuration",
		);
		expect(currentDatabase).not.toHaveBeenCalled();
	});

	it("rejects a sentinel-enabled URL when current_database is not disposable", async () => {
		const currentDatabase = vi.fn().mockResolvedValue("z8_production");

		await expect(
			verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl:
					"postgresql://postgres:test@127.0.0.1:5432/approval_workflow_repository_test_guard",
				required: false,
				sentinel: "approval-workflow-repository-test",
				currentDatabase,
			}),
		).rejects.toThrow(
			"current_database() is not an approval workflow repository test database",
		);

		expect(currentDatabase).toHaveBeenCalledOnce();
	});

	it.each([
		{
			name: "remote host",
			databaseUrl:
				"postgresql://postgres:test@database.example.com:5432/approval_workflow_repository_test_guard",
			reason: "loopback host",
		},
		{
			name: "non-disposable database name",
			databaseUrl: "postgresql://postgres:test@127.0.0.1:5432/z8_development",
			reason: "non-isolated approval workflow test DB",
		},
		{
			name: "non-PostgreSQL protocol",
			databaseUrl: "https://127.0.0.1/approval_workflow_repository_test_guard",
			reason: "PostgreSQL protocol",
		},
		{
			name: "query parameters",
			databaseUrl:
				"postgresql://postgres:test@127.0.0.1:5432/approval_workflow_repository_test_guard?sslmode=disable",
			reason: "must not include query parameters",
		},
	])("refuses $name before connecting", async ({ databaseUrl, reason }) => {
		const currentDatabase = vi.fn();

		await expect(
			verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl,
				required: false,
				sentinel: "approval-workflow-repository-test",
				currentDatabase,
			}),
		).rejects.toThrow(reason);
		expect(currentDatabase).not.toHaveBeenCalled();
	});

	it("enables only the explicit sentinel and disposable database naming convention", async () => {
		const databaseUrl = enabledDatabaseUrl;
		await expect(
			verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl,
				required: false,
				sentinel: "approval-workflow-repository-test",
				currentDatabase: async () =>
					"approval_workflow_repository_test_a1b2c3d4",
			}),
		).resolves.toEqual({
			status: "enabled",
			databaseUrl,
			databaseName: "approval_workflow_repository_test_a1b2c3d4",
		});
	});
});
