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
	push: {
		filesTemplate: "./messages/{languageTag}.json",
		language: ["en", "de", "fr", "es", "it", "pt"],
	},
	pull: {
		path: "./messages",
	},
};
