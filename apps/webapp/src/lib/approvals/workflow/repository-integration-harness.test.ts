import { describe, expect, it, vi } from "vitest";
import { verifyApprovalWorkflowRepositoryTestDatabase } from "./repository-integration-harness";

describe("approval workflow repository integration database guard", () => {
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
				databaseUrl: "postgres://ignored",
				required: false,
				sentinel: "approval-workflow-repository-test",
				currentDatabase,
			}),
		).rejects.toThrow(
			"current_database() is not an approval workflow repository test database",
		);

		expect(currentDatabase).toHaveBeenCalledOnce();
	});

	it("enables only the explicit sentinel and disposable database naming convention", async () => {
		await expect(
			verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl: "postgres://ignored",
				required: false,
				sentinel: "approval-workflow-repository-test",
				currentDatabase: async () =>
					"approval_workflow_repository_test_a1b2c3d4",
			}),
		).resolves.toEqual({
			status: "enabled",
			databaseUrl: "postgres://ignored",
			databaseName: "approval_workflow_repository_test_a1b2c3d4",
		});
	});
});
