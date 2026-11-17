import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../apps/webapp/", import.meta.url));
const inspectConfig = `
  const loadConfig = require('next/dist/server/config').default;
  const { PHASE_PRODUCTION_BUILD } = require('next/constants');
  loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { silent: true }).then(config => {
    process.stdout.write(JSON.stringify({
			output: config.output ?? null,
      distDir: config.distDir,
      exposeTestingApi: config.experimental.exposeTestingApiInProductionBuild === true,
      cacheComponents: config.cacheComponents,
      partialPrefetching: config.partialPrefetching,
      workers: config.experimental.cpus,
    }));
  }).catch(error => { console.error(error); process.exitCode = 1; });
`;

test("shipping builds exclude the navigation testing API; explicit test builds use isolated output", () => {
	for (const flag of ["", "0", "1"]) {
		const config = JSON.parse(
			execFileSync(process.execPath, ["-e", inspectConfig], {
				cwd: app,
				timeout: 20_000,
				encoding: "utf8",
				env: {
					...process.env,
					NODE_ENV: "production",
					NEXT_DEPLOYMENT_ID: "config-test",
					POSTHOG_API_KEY: "",
					POSTHOG_PROJECT_ID: "",
					Z8_INSTANT_NAV_TEST: flag,
				},
			}),
		);
		const { workers, ...rendering } = config;
		assert.ok(workers >= 1 && workers <= 4, "prerender workers stay bounded");
		assert.deepEqual(rendering, {
			output: flag === "1" ? null : "standalone",
			distDir: flag === "1" ? ".next-instant-nav" : ".next",
			exposeTestingApi: flag === "1",
			cacheComponents: true,
			partialPrefetching: true,
		});
	}
});
