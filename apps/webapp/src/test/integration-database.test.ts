import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	integrationAdminPool,
	integrationDatabaseSentinel,
	integrationDbModule,
	openIntegrationPool,
	parseIntegrationDatabaseUrl,
	verifyIntegrationDatabase,
} from "./integration-database";

const databaseUrl =
	"postgresql://postgres:test@localhost:5432/approval_workflow_repository_test_a1b2c3d4";

describe("integration database gate", () => {
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
			vi.stubEnv("APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL", databaseUrl);
			vi.stubEnv("APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL", integrationDatabaseSentinel);
		});

		it("refuses to verify the database without connecting, even when configured", async () => {
			const currentDatabase = vi.fn();

			await expect(
				verifyIntegrationDatabase({
					databaseUrl,
					sentinel: integrationDatabaseSentinel,
					currentDatabase,
				}),
			).rejects.toThrow("database suites must be named `*.integration.test.ts`");
			expect(currentDatabase).not.toHaveBeenCalled();
		});

		it.each([
			["the admin pool", () => integrationAdminPool()],
			["a dedicated pool", () => openIntegrationPool()],
		])("refuses to open %s", (_name, open) => {
			expect(open).toThrow("database suites must be named `*.integration.test.ts`");
		});

		it("refuses to bind @/db", async () => {
			await expect(integrationDbModule()).rejects.toThrow(
				"database suites must be named `*.integration.test.ts`",
			);
		});
	});

	it.each([
		{ name: "missing URL and sentinel", databaseUrl: undefined, sentinel: undefined },
		{ name: "URL without sentinel", databaseUrl: "postgres://ignored", sentinel: undefined },
		{ name: "wrong sentinel", databaseUrl: "postgres://ignored", sentinel: "wrong" },
	])("fails for $name instead of skipping", async ({ databaseUrl, sentinel }) => {
		const currentDatabase = vi.fn();

		await expect(
			verifyIntegrationDatabase({ databaseUrl, sentinel, currentDatabase }),
		).rejects.toThrow("Invalid integration database configuration");
		expect(currentDatabase).not.toHaveBeenCalled();
	});

	it("rejects a sentinel-enabled URL when current_database is not disposable", async () => {
		const currentDatabase = vi.fn().mockResolvedValue("z8_production");

		await expect(
			verifyIntegrationDatabase({
				databaseUrl:
					"postgresql://postgres:test@127.0.0.1:5432/approval_workflow_repository_test_guard",
				sentinel: integrationDatabaseSentinel,
				currentDatabase,
			}),
		).rejects.toThrow("current_database() is not a disposable integration test database");
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
			reason: "non-isolated integration test database",
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
			verifyIntegrationDatabase({
				databaseUrl,
				sentinel: integrationDatabaseSentinel,
				currentDatabase,
			}),
		).rejects.toThrow(reason);
		expect(currentDatabase).not.toHaveBeenCalled();
	});

	it("enables only the explicit sentinel and disposable database naming convention", async () => {
		await expect(
			verifyIntegrationDatabase({
				databaseUrl,
				sentinel: integrationDatabaseSentinel,
				currentDatabase: async () => "approval_workflow_repository_test_a1b2c3d4",
			}),
		).resolves.toEqual({
			databaseUrl,
			databaseName: "approval_workflow_repository_test_a1b2c3d4",
		});
	});

	it("does not need the test project marker to parse a URL for the migration verifier", () => {
		vi.stubEnv("Z8_TEST_PROJECT", "unit");

		expect(parseIntegrationDatabaseUrl(databaseUrl)).toEqual({
			databaseUrl,
			databaseName: "approval_workflow_repository_test_a1b2c3d4",
		});
	});
});
