import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	BRAND_COLOR,
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

	it("leaves every safe-area inset to the web app on iOS (#846)", () => {
		// The web app draws edge to edge and pads with env(safe-area-inset-*); a native inset
		// on top would double the gap on pages whose document scrolls.
		assert.equal(config.ios?.contentInset, "never");
		const rootLayout = readFileSync(
			new URL("../webapp/src/app/[locale]/layout.tsx", import.meta.url),
			"utf8",
		);
		assert.match(rootLayout, /viewportFit: "cover"/);
	});

	it("uses one brand color for the splash screen and the offline page", () => {
		const offlinePage = readFileSync(new URL("www/z8-shell-offline.html", import.meta.url), "utf8");

		assert.equal(config.plugins?.SplashScreen?.backgroundColor, BRAND_COLOR);
		assert.match(offlinePage, new RegExp(`--brand: ${BRAND_COLOR};`));
	});

	it("keeps the service worker working on both platforms", () => {
		assert.equal(config.ios?.limitsNavigationsToAppBoundDomains, true);
		assert.equal(config.android?.resolveServiceWorkerRequests, true);
	});

	it("shows native push in the foreground and links the Firebase package for SwiftPM (#843)", () => {
		assert.deepEqual(config.plugins?.FirebaseMessaging, {
			presentationOptions: ["alert", "badge", "sound"],
		});
		assert.deepEqual(config.experimental?.ios?.spm?.packageOptions, {
			"@capacitor-firebase/messaging": { symlink: true },
		});
	});

	it("registers the web app's native push plugin under the name the web app calls", () => {
		const client = readFileSync(
			new URL("../webapp/src/lib/store-app/native-push.ts", import.meta.url),
			"utf8",
		);
		const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

		assert.match(client, /registerPlugin<NativePushPlugin>\("FirebaseMessaging"\)/);
		assert.match(pkg.dependencies["@capacitor-firebase/messaging"], /^\d+\.\d+\.\d+$/);
	});

	it("keeps FCM from creating a device token before the user turns push on", () => {
		const manifest = readFileSync(
			new URL("android/app/src/main/AndroidManifest.xml", import.meta.url),
			"utf8",
		);
		const plist = readFileSync(new URL("ios/App/App/Info.plist", import.meta.url), "utf8");

		assert.match(
			manifest,
			/android:name="firebase_messaging_auto_init_enabled"\s+android:value="false"/,
		);
		assert.match(plist, /<key>FirebaseMessagingAutoInitEnabled<\/key>\s*<false\/>/);
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

describe("system-browser sign-in (#842)", () => {
	const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
	const webappCallback = /mobile: "([^"]+)"/.exec(
		read("../webapp/src/lib/auth/app-redirect.ts"),
	)?.[1];

	it("routes the web app's mobile callback to the Android app", () => {
		assert.ok(webappCallback, "app-redirect.ts names the mobile callback");
		const callback = new URL(webappCallback);
		const manifest = read("android/app/src/main/AndroidManifest.xml");
		const filter = /<intent-filter>(?:(?!<\/intent-filter>)[\s\S])*android\.intent\.action\.VIEW[\s\S]*?<\/intent-filter>/.exec(
			manifest,
		)?.[0];

		assert.ok(filter, "MainActivity has a VIEW intent filter");
		assert.match(filter, /android\.intent\.category\.BROWSABLE/);
		assert.match(filter, new RegExp(`android:scheme="${callback.protocol.slice(0, -1)}"`));
		assert.match(filter, new RegExp(`android:host="${callback.host}"`));
		assert.match(filter, new RegExp(`android:path="${callback.pathname}"`));
	});

	it("registers the iOS auth session plugin under the name the web app calls", () => {
		const bridge = read("../webapp/src/lib/store-app/native-auth-session.ts");
		const plugin = read("ios/App/App/Z8AuthSessionPlugin.swift");
		const jsName = /registerPlugin<IosAuthSessionPlugin>\("([^"]+)"\)/.exec(bridge)?.[1];

		assert.ok(jsName);
		assert.match(plugin, new RegExp(`jsName = "${jsName}"`));
		assert.match(plugin, /registerPluginInstance\(Z8AuthSessionPlugin\(\)\)/);
		assert.match(read("ios/App/App/SceneDelegate.swift"), /Z8BridgeViewController\(\)/);
		assert.match(
			read("ios/App/App/Base.lproj/Main.storyboard"),
			/customClass="Z8BridgeViewController" customModule="App"/,
		);
		assert.match(
			read("ios/App/App.xcodeproj/project.pbxproj"),
			/Z8AuthSessionPlugin\.swift in Sources \*\/,/,
		);
	});

	it("installs the Android browser and app-link plugins the web app calls", () => {
		const manifest = JSON.parse(read("package.json")) as {
			dependencies: Record<string, string>;
		};

		assert.match(manifest.dependencies["@capacitor/browser"] ?? "", /^\d+\.\d+\.\d+$/);
		assert.match(manifest.dependencies["@capacitor/app"] ?? "", /^\d+\.\d+\.\d+$/);
	});
});

describe("app-bound domains in Info.plist", () => {
	const plist = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<plist version="1.0">',
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
