"use strict";

/** @type {import('@tolgee/cli').TolgeeConfig} */
module.exports = {
	$schema: "https://docs.tolgee.io/cli-schema.json",
	projectId: process.env.TOLGEE_PROJECT_ID,
	format: "JSON_TOLGEE",
	apiUrl: process.env.TOLGEE_API_URL,
	apiKey: process.env.TOLGEE_API_KEY,
	patterns: ["./src/**/*.ts?(x)"],
	extractor: "./tolgee-extractor.mjs",
	defaultNamespace: "common",
	push: {
		filesTemplate: "./messages/{namespace}/{languageTag}.json",
		// Must equal ALL_LANGUAGES in src/tolgee/shared.ts (guarded by language-coverage.test.ts).
		language: [
			"en",
			"de",
			"fr",
			"es",
			"it",
			"pt",
			"el",
			"pl",
			"tr",
			"gsw",
			"no",
			"sv",
		],
	},
	pull: {
		path: "./messages",
		filesTemplate: "./{namespace}/{languageTag}.json",
	},
};
