import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import appConfig from "../../apps/webapp/vitest.config.ts";

const app = fileURLToPath(new URL("../../apps/webapp/", import.meta.url));
const appRequire = createRequire(
	new URL("../../apps/webapp/package.json", import.meta.url),
);
const packages = [
	"@opentelemetry/api",
	"@opentelemetry/exporter-trace-otlp-http",
	"@opentelemetry/resources",
	"@opentelemetry/sdk-trace-base",
];

// Reuse the existing unit environment, aliases and DB guard without changing app configuration.
export default {
	...appConfig,
	root: app,
	resolve: {
		alias: {
			...Object.fromEntries(
				packages.map((name) => [name, appRequire.resolve(name)]),
			),
		},
	},
	test: {
		...appConfig.test,
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: [
						fileURLToPath(
							new URL("./collector-open-retention.test.ts", import.meta.url),
						),
					],
					env: { Z8_TEST_PROJECT: "unit" },
					setupFiles: [
						fileURLToPath(
							new URL(
								"../../apps/webapp/src/test/unit-setup.ts",
								import.meta.url,
							),
						),
					],
				},
			},
		],
	},
};
