# Z8 store app

The iOS and Android app of Z8. It is a thin [Capacitor](https://capacitorjs.com) shell: it loads the live web app from the configured origin and adds what a browser cannot do. It does not bundle a copy of the web app, because Z8 is a server-rendered Next.js app. See ADR [0001 "Store apps are a thin shell around the web app"](../../docs/adr/0001-store-apps-are-a-thin-shell-around-the-web-app.md).

## Requirements

| Tool | Version |
|---|---|
| Node.js | 24 or newer (Capacitor reads `capacitor.config.ts` through Node's built-in type stripping) |
| pnpm | the repository's `packageManager` version |
| Xcode (iOS, macOS only) | 26 or newer, with an iOS 26 simulator (Capacitor 8 minimum; the app targets iOS 15+) |
| Android Studio | Otter (2025.2.1) or newer, with its bundled JDK 21, Android SDK 36 and an emulator image |

`ANDROID_HOME` (or `android/local.properties`) must point at the Android SDK, and `JAVA_HOME` at JDK 21 (Android Studio's `jbr` works).

## Build from a clean checkout

Run from the repository root:

~~~sh
pnpm install --frozen-lockfile

# Android debug APK: android/app/build/outputs/apk/debug/app-debug.apk
pnpm --filter mobile build:android

# iOS debug build for the simulator (macOS): ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
pnpm --filter mobile build:ios

# Or open the project and run it on a simulator, emulator or device
pnpm --filter mobile sync
pnpm --filter mobile open:ios
pnpm --filter mobile open:android
~~~

Every build first runs `sync`, which applies the origin below to both native projects. Run `sync` again after changing the origin, a plugin or anything in `www/`.

Checks: `pnpm --filter mobile test` and `pnpm --filter mobile typecheck`.

## Origin per build

| Variable | Default | Meaning |
|---|---|---|
| `Z8_APP_ORIGIN` | `https://ui.z8-time.app` | The web app the shell loads. Must be https. Plain http is accepted only for `localhost`, `127.0.0.1` and `10.0.2.2` (the Android emulator's host), for development. |
| `Z8_APP_ALLOWED_HOSTS` | none | Comma-separated extra host names that stay inside the app, for example a custom sign-in domain. No scheme, path or wildcard. |

~~~sh
Z8_APP_ORIGIN=https://staging.example.com pnpm --filter mobile build:android
~~~

`sync` writes the iOS app-bound domains into `ios/App/App/Info.plist`. Do not commit a staging origin there: sync with the default origin before committing.

Service workers need a secure context, which `http://10.0.2.2` is not. For offline tests against a development server, use an https tunnel to it.

## How the shell works

- **Live web app.** `server.url` is the origin. Navigation to the origin and to `Z8_APP_ALLOWED_HOSTS` stays in the web view. Every other origin (identity providers, payment, external links) opens in the system browser. Capacitor does this on both platforms. On iOS, a link with `target="_blank"` opens in the system browser even on the app origin.
- **Service worker.** iOS runs service workers in WKWebView only for app-bound domains, so `sync` lists the origin, the extra hosts and `localhost` (the offline page) in `WKAppBoundDomains`, and the config sets `limitsNavigationsToAppBoundDomains`. iOS accepts at most 10 entries. On Android, `resolveServiceWorkerRequests` routes service worker requests through Capacitor's bridge, which passes them to the network unchanged. The service worker, the cached app shell and frozen clock commands are the web app's own (`apps/webapp/public/sw.js`), as in the PWA.
- **Shell detection.** The shell appends `Z8StoreApp/ios` or `Z8StoreApp/android` to the web view's user agent. The web app checks it with `isStoreAppShell()` and `getStoreAppPlatform()` from `apps/webapp/src/lib/store-app/shell.ts`. Both return `false`/`null` during server rendering. Use them for presentation and channel choices only, never for authorization. A test in this app checks that the token matches the helper.
- **Camera.** File inputs with `capture` (the travel-expense receipt) open the camera. iOS needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` in `Info.plist`. Android launches the camera app through `ACTION_IMAGE_CAPTURE`, declared under `<queries>` in `AndroidManifest.xml`, and needs no camera permission.
- **Offline screen.** When the web app cannot be loaded and the service worker has nothing cached, Capacitor shows `www/z8-shell-offline.html` (`server.errorPath`) instead of a web view error page. It retries when the device comes back online or the user taps the button. On Android, `ShellWebViewClient` keeps the web app's own 404 and error pages: Capacitor would otherwise show the offline screen for every HTTP error status.
- **Icons and splash.** Generated from the web app's brand icon (`apps/webapp/public/android-chrome-512x512.png`) by `pnpm --filter mobile generate-assets`. The outputs are committed.

## Adding a native plugin

Sign-in through the system browser and native push add plugins here:

1. Add the plugin to this package with an exact version, for example `pnpm --filter mobile add --save-exact @capacitor/browser@<version>`.
2. Configure it in `createCapacitorConfig()` in `shell-config.ts` (under `plugins`), and add any `Info.plist` or `AndroidManifest.xml` entries it requires.
3. Run `pnpm --filter mobile sync`, which registers the plugin in both native projects.
4. In the web app, call the plugin only when `isStoreAppShell()` is true. The shell injects `window.Capacitor` into pages on the app origin; add `@capacitor/core` and the plugin's JavaScript package to `apps/webapp` to call it with types. Plugins that are not npm packages are registered in `android/app/src/main/java/com/z8/app/MainActivity.java` and in the iOS project.

If a plugin registers a `WebViewListener` on Android, check `ShellWebViewClient`: it does not forward HTTP-error callbacks.

## Native project changes

The native projects were generated by `cap add` and are committed. These parts were changed by hand and must survive a regeneration:

- `android/app/src/main/AndroidManifest.xml`: camera `<queries>`, `allowBackup="false"` (the web view holds the session).
- `android/app/src/main/java/com/z8/app/`: `MainActivity` and `ShellWebViewClient`.
- `android/app/src/main/res/values/`: brand background for the launcher icon and the Android 12+ splash.
- `ios/App/App/Info.plist`: camera and photo descriptions, `WKAppBoundDomains` (written by `sync`).

## Manual checks per release

1. A simulator or emulator opens the configured origin, and a signed-in session survives an app restart.
2. After a reload, `navigator.serviceWorker.controller` is set (Safari Web Inspector or `chrome://inspect`).
3. Offline in an adopted organization, clocking in shows a held frozen command, which is sent after reconnecting.
4. A link to another origin opens in the system browser.
5. A travel-expense receipt can be photographed.
6. First launch in airplane mode shows the offline screen; a missing web page shows the web app's 404 page.
