import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		env: {
			BETTER_AUTH_SECRET: "test-secret-value-with-at-least-32-characters",
			SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
			SKIP_ENV_VALIDATION: "true",
		},
		include: ["src/**/*.test.{ts,tsx}"],
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
	},
});
