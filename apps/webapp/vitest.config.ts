import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@/db": path.resolve(__dirname, "./src/db"),
			"@/lib": path.resolve(__dirname, "./src/lib"),
		},
	},
});
