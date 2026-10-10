import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	createCapacitorConfig,
	resolveShellSettings,
	STORE_APP_USER_AGENT_MARKER,
	withAppBoundDomains,
} from "./shell-config.ts";

describe("shell settings", () => {
	it("points at production when no origin is configured", () => {
		const settings = resolveShellSettings({});

		assert.equal(settings.origin, "https://ui.z8-time.app");
		assert.deepEqual(settings.appBoundDomains, ["ui.z8-time.app", "localhost"]);
	});

	it("takes the origin of a staging build from Z8_APP_ORIGIN", () => {
		const settings = resolveShellSettings({
			Z8_APP_ORIGIN: "https://staging.z8-time.app/time-tracking?x=1",
		});

		assert.equal(settings.origin, "https://staging.z8-time.app");
		assert.deepEqual(settings.navigationHosts, []);
		assert.equal(settings.cleartext, false);
	});

	it("refuses an unencrypted origin outside local development", () => {
		assert.throws(
			() => resolveShellSettings({ Z8_APP_ORIGIN: "http://staging.z8-time.app" }),
			/https/,
		);
		assert.throws(() => resolveShellSettings({ Z8_APP_ORIGIN: "ftp://x.example" }), /https/);
		assert.throws(() => resolveShellSettings({ Z8_APP_ORIGIN: "not a url" }), /Z8_APP_ORIGIN/);
	});

	it("allows plain http to a development server on the machine or emulator host", () => {
		const settings = resolveShellSettings({ Z8_APP_ORIGIN: "http://10.0.2.2:3000" });

		assert.equal(settings.origin, "http://10.0.2.2:3000");
		assert.equal(settings.cleartext, true);
		assert.deepEqual(settings.appBoundDomains, ["10.0.2.2", "localhost"]);
	});

	it("adds extra in-app hosts to navigation and the app-bound domains", () => {
		const settings = resolveShellSettings({
			Z8_APP_ORIGIN: "https://ui.z8-time.app",
			Z8_APP_ALLOWED_HOSTS: " login.acme.example , ui.z8-time.app,LOGIN.acme.example ",
		});

		assert.deepEqual(settings.navigationHosts, ["login.acme.example"]);
		assert.deepEqual(settings.appBoundDomains, [
			"ui.z8-time.app",
			"login.acme.example",
			"localhost",
		]);
	});

	it("refuses wildcard or malformed extra hosts", () => {
		assert.throws(
			() => resolveShellSettings({ Z8_APP_ALLOWED_HOSTS: "*.z8-time.app" }),
			/Z8_APP_ALLOWED_HOSTS/,
		);
		assert.throws(
			() => resolveShellSettings({ Z8_APP_ALLOWED_HOSTS: "https://x.example/path" }),
			/Z8_APP_ALLOWED_HOSTS/,
		);
	});

	it("refuses more app-bound domains than iOS accepts", () => {
		const hosts = Array.from({ length: 9 }, (_, index) => `h${index}.example`).join(",");

		assert.throws(() => resolveShellSettings({ Z8_APP_ALLOWED_HOSTS: hosts }), /10/);
	});
});

describe("Capacitor configuration", () => {
	const config = createCapacitorConfig(
		resolveShellSettings({
			Z8_APP_ORIGIN: "https://staging.z8-time.app",
			Z8_APP_ALLOWED_HOSTS: "login.acme.example",
		}),
	);

	it("loads the live web app at the configured origin", () => {
		// The trailing slash stops iOS treating https://staging.z8-time.app.evil.example as in-app.
		assert.equal(config.server?.url, "https://staging.z8-time.app/");
		assert.deepEqual(config.server?.allowNavigation, ["login.acme.example"]);
		assert.equal(config.server?.cleartext, false);
	});

	it("shows its own offline screen instead of a web view error page", () => {
		assert.equal(config.server?.errorPath, "z8-shell-offline.html");
		assert.equal(config.webDir, "www");
		assert.ok(existsSync(new URL("www/z8-shell-offline.html", import.meta.url)));
	});

	it("tells the web app it runs in the shell through the user agent", () => {
		assert.equal(config.ios?.appendUserAgent, `${STORE_APP_USER_AGENT_MARKER}/ios`);
		assert.equal(config.android?.appendUserAgent, `${STORE_APP_USER_AGENT_MARKER}/android`);
	});

	it("keeps the service worker working on both platforms", () => {
		assert.equal(config.ios?.limitsNavigationsToAppBoundDomains, true);
		assert.equal(config.android?.resolveServiceWorkerRequests, true);
	});

	it("uses the same user-agent marker the web app looks for", () => {
		const helper = readFileSync(
			new URL("../webapp/src/lib/store-app/shell.ts", import.meta.url),
			"utf8",
		);

		assert.match(
			helper,
			new RegExp(`STORE_APP_USER_AGENT_MARKER = "${STORE_APP_USER_AGENT_MARKER}"`),
		);
	});
});

describe("app-bound domains in Info.plist", () => {
	const plist = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		"<plist version=\"1.0\">",
		"<dict>",
		"\t<key>CFBundleName</key>",
		"\t<string>Z8</string>",
		"</dict>",
		"</plist>",
		"",
	].join("\n");

	it("declares the domains when the key is missing", () => {
		const patched = withAppBoundDomains(plist, ["ui.z8-time.app", "localhost"]);

		assert.match(
			patched,
			/<key>WKAppBoundDomains<\/key>\n\t<array>\n\t\t<string>ui\.z8-time\.app<\/string>\n\t\t<string>localhost<\/string>\n\t<\/array>\n<\/dict>/,
		);
		assert.match(patched, /<key>CFBundleName<\/key>/);
	});

	it("replaces the domains of an earlier build and is stable on repeat", () => {
		const staging = withAppBoundDomains(plist, ["staging.z8-time.app", "localhost"]);
		const production = withAppBoundDomains(staging, ["ui.z8-time.app", "localhost"]);

		assert.doesNotMatch(production, /staging/);
		assert.equal(production.match(/WKAppBoundDomains/g)?.length, 1);
		assert.equal(withAppBoundDomains(production, ["ui.z8-time.app", "localhost"]), production);
	});

	it("keeps CRLF line endings of a Windows checkout", () => {
		const patched = withAppBoundDomains(plist.replaceAll("\n", "\r\n"), ["ui.z8-time.app"]);

		assert.doesNotMatch(patched, /[^\r]\n/);
	});
});
