import { describe, expect, it, vi } from "vitest";
import { requirePostgresIntegrationDatabase } from "./postgres-integration.global-setup";

const databaseUrl =
	"postgresql://postgres:test@127.0.0.1:5432/approval_workflow_repository_test_s0";

describe("PostgreSQL integration project gate", () => {
	it.each([
		{ name: "no database configured", environment: {} },
		{
			name: "no sentinel",
			environment: { APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: databaseUrl },
		},
		{
			name: "a non-disposable database",
			environment: {
				APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL:
					"postgresql://postgres:test@127.0.0.1:5432/z8_development",
				APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL: "approval-workflow-repository-test",
			},
		},
	])("fails instead of skipping with $name", async ({ environment }) => {
		const currentDatabase = vi.fn();

		await expect(requirePostgresIntegrationDatabase(environment, currentDatabase)).rejects.toThrow(
			"test:approval-workflow-repository:integration",
		);
		expect(currentDatabase).not.toHaveBeenCalled();
	});

	it("fails when the connected database is not the disposable one", async () => {
		await expect(
			requirePostgresIntegrationDatabase(
				{
					APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: databaseUrl,
					APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL: "approval-workflow-repository-test",
				},
				async () => "z8_production",
			),
		).rejects.toThrow("test:approval-workflow-repository:integration");
	});

	it("admits the disposable database", async () => {
		const currentDatabase = vi.fn().mockResolvedValue("approval_workflow_repository_test_s0");

		await expect(
			requirePostgresIntegrationDatabase(
				{
					APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: databaseUrl,
					APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL: "approval-workflow-repository-test",
				},
				currentDatabase,
			),
		).resolves.toMatchObject({
			status: "enabled",
			databaseName: "approval_workflow_repository_test_s0",
		});
		expect(currentDatabase).toHaveBeenCalledWith(databaseUrl);
	});
});
