import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/** Runs against an explicitly started, isolated production test artifact. */
export default defineConfig({
	testDir: "./e2e/instant-navigation",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: "line",
	outputDir: mkdtempSync(path.join(tmpdir(), "z8-instant-navigation-")),
	use: {
		baseURL: process.env.Z8_INSTANT_NAV_BASE_URL,
		storageState: process.env.Z8_INSTANT_NAV_STORAGE_STATE,
		// Authenticated workforce data must not be retained in screenshots/traces by default.
		screenshot: "off",
		trace: "off",
		video: "off",
	},
	projects: [
		{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
		{ name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
	],
});
