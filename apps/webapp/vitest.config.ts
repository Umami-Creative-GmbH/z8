import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Set the parent process timezone before test workers are started.
process.env.TZ ||= "UTC";

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
		// Suites are discovered by suffix: a new `*.integration.test.ts` runs
		// against PostgreSQL with no registration anywhere else.
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.test.{ts,tsx}"],
					exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
					env: { Z8_TEST_PROJECT: "unit" },
				},
			},
			{
				extends: true,
				test: {
					name: "integration",
					include: ["src/**/*.integration.test.ts"],
					fileParallelism: false,
					// REQUIRED=1 turns a missing disposable database into an error, not a skip.
					env: {
						Z8_TEST_PROJECT: "integration",
						APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED: "1",
						TZ: "UTC",
						PGOPTIONS: "-c statement_timeout=15000 -c timezone=UTC",
					},
				},
			},
		],
	},
});
