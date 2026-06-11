import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		env: {
			BETTER_AUTH_SECRET: "test-secret-value-with-at-least-32-characters",
			SKIP_ENV_VALIDATION: "true",
		},
		include: ["src/**/*.test.ts"],
		alias: {
			"@": path.resolve(__dirname, "../webapp/src"),
			"server-only": path.resolve(__dirname, "../webapp/src/test/server-only.ts"),
		},
	},
});
