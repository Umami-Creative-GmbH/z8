import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Set the parent process timezone before test workers are started.
process.env.TZ ||= "UTC";

// Every PostgreSQL suite is found by this glob; the Redis suite has its own opt-in gate.
const postgresIntegrationSuites = "src/**/!(*.redis).integration.test.ts";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		env: {
			BETTER_AUTH_SECRET: "test-secret-value-with-at-least-32-characters",
			SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
			SKIP_ENV_VALIDATION: "true",
		},
		alias: {
			"@/data/licenses.json": path.resolve(
				__dirname,
				"./src/test/licenses.ts",
			),
			"@": path.resolve(__dirname, "./src"),
			"@/db": path.resolve(__dirname, "./src/db"),
			"@/lib": path.resolve(__dirname, "./src/lib"),
			"server-only": path.resolve(__dirname, "./src/test/server-only.ts"),
		},
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.test.{ts,tsx}"],
					exclude: [...configDefaults.exclude, postgresIntegrationSuites],
				},
			},
			{
				// Runs against the disposable database that
				// scripts/run-approval-workflow-repository-integration.sh (or CI) creates,
				// and fails before any suite runs when that database is not configured.
				extends: true,
				test: {
					name: "integration",
					include: [postgresIntegrationSuites],
					globalSetup: ["./src/test/postgres-integration.global-setup.ts"],
					fileParallelism: false,
					env: {
						APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED: "1",
						PGOPTIONS: "-c statement_timeout=15000 -c timezone=UTC",
					},
				},
			},
		],
	},
});
