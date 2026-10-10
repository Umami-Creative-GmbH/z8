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
| `Z8_APP_ALLOWED_HOSTS` | none | Comma-separated extra host names that stay inside the app. No scheme, path or wildcard. Custom sign-in domains do not belong here: sign-in runs in the system browser. |

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
- **Sign-in.** Signed out, the web app's `/sign-in` shows an email screen in the shell (it reads the user-agent marker). The email's domain picks where sign-in runs: the organization's verified custom sign-in domain, or the app origin. Sign-in then runs in the system browser with that domain's methods (password, passkey, SSO, social). On iOS this is an ephemeral `ASWebAuthenticationSession` (the app's `Z8AuthSession` plugin), which keeps no browser cookie afterwards. On Android it is a Custom Tab (`@capacitor/browser`). The browser returns a one-time code to `z8mobile://auth/callback`: iOS's session intercepts it, Android routes it to `MainActivity` and `@capacitor/app`'s `appUrlOpen`. The web view exchanges the code and its PKCE verifier at its own origin's `/api/auth/app-exchange`, which sets the session cookie. Sign-out in the web app ends that session, so the next launch shows the email screen again. Code: `apps/webapp/src/lib/store-app/` (`store-app-sign-in.ts`, `native-auth-session.ts`, `sign-out.ts`).
- **Native push.** `@capacitor-firebase/messaging` gets an FCM token on both platforms (on iOS the plain push plugin would return an APNs token). The web app calls it through `apps/webapp/src/lib/store-app/native-push.ts`. Details are in the next section.
- **Icons and splash.** Generated from the web app's brand icon (`apps/webapp/public/android-chrome-512x512.png`) by `pnpm --filter mobile generate-assets`. The outputs are committed.

## Native push (Firebase Cloud Messaging)

Native push is one more channel for the notifications web push already sends. The user's "Push" setting governs both. Each push carries only a generic, localized title and body, the notification type, the in-app path and the organization id. It never carries names, times, amounts or organization names.

- **Registration.** In the shell, the web app's push toggle (onboarding, notification settings, and the push prompt) registers for native push instead of web push. The prompt does not appear on launch. It waits until the user opens approvals, absences, my requests, scheduling or travel expenses. The token is saved for the signed-in user at `/api/notifications/push/native-token` and remembered on the device. Each app start re-registers it, and a rotated token replaces the old one.
- **No token before opt-in.** FCM auto-init is off (`firebase_messaging_auto_init_enabled` in `AndroidManifest.xml`, `FirebaseMessagingAutoInitEnabled` in `Info.plist`). Google gets no device token until the user turns push on.
- **Sign-out and opt-out** remove the token on the server and on the device. A token that FCM reports as invalid is deactivated when a send fails.
- **Tap.** A tapped notification opens its path. When the notification belongs to another organization than the active one, the app goes through `/init?organizationId=…`, the existing organization switch, first.
- **Off without credentials.** Without the server variables below, the web app offers no push in the shell, and web push in browsers is unchanged.

Server variables (in `apps/webapp/src/env.ts`), from a Firebase service account with the Cloud Messaging API:

| Variable | Value |
|---|---|
| `FCM_PROJECT_ID` | Firebase project id |
| `FCM_CLIENT_EMAIL` | `client_email` of the service account |
| `FCM_PRIVATE_KEY` | `private_key` of the service account (PEM; `\n` escapes are accepted) |

App setup, done once per Firebase project (#840):

1. **Android:** put `google-services.json` into `android/app/`. `android/app/build.gradle` applies the Google services plugin only when that file exists. Without it the app builds, but push stays off.
2. **iOS:** add `GoogleService-Info.plist` to the `App` target in Xcode (Copy Bundle Resources). Without it the plugin logs that Firebase is not configured, and push stays off.
3. **iOS:** turn on the Push Notifications capability for `com.z8.app` and upload an APNs auth key to the Firebase project. `App/App.entitlements` already declares `aps-environment`, and `Info.plist` declares the `remote-notification` background mode.
4. Keep the Firebase files out of git if the repository is public. They identify the project but contain no server secret.

On macOS, `cap sync` links the plugin into `ios/App/CapApp-SPM/symlinks/` (`experimental.ios.spm.packageOptions`, which avoids a SwiftPM package identity collision). That folder is not committed. On Windows, creating the link fails without Developer Mode, but the committed `Package.swift` already points at it.

## Adding a native plugin

Sign-in through the system browser and native push add plugins here:

1. Add the plugin to this package with an exact version, for example `pnpm --filter mobile add --save-exact @capacitor/browser@<version>`.
2. Configure it in `createCapacitorConfig()` in `shell-config.ts` (under `plugins`), and add any `Info.plist` or `AndroidManifest.xml` entries it requires.
3. Run `pnpm --filter mobile sync`, which registers the plugin in both native projects.
4. In the web app, call the plugin only when `isStoreAppShell()` is true. The shell injects `window.Capacitor` into pages on the app origin. `apps/webapp` depends on `@capacitor/core`; load it with a dynamic `import()` so browsers outside the shell never download it, and use `registerPlugin()` or the plugin's JavaScript package. Plugins that are not npm packages are registered in `android/app/src/main/java/com/z8/app/MainActivity.java` and, on iOS, in `Z8BridgeViewController.capacitorDidLoad()` (`ios/App/App/Z8AuthSessionPlugin.swift`); add new Swift files to the App target in `project.pbxproj`.

If a plugin registers a `WebViewListener` on Android, check `ShellWebViewClient`: it does not forward HTTP-error callbacks.

## Native project changes

The native projects were generated by `cap add` and are committed. These parts were changed by hand and must survive a regeneration:

- `android/app/src/main/AndroidManifest.xml`: camera `<queries>`, `allowBackup="false"` (the web view holds the session), the `z8mobile://auth/callback` intent filter.
- `android/app/src/main/java/com/z8/app/`: `MainActivity` and `ShellWebViewClient`.
- `android/app/src/main/res/values/`: brand background for the launcher icon and the Android 12+ splash.
- `ios/App/App/Info.plist`: camera and photo descriptions, `WKAppBoundDomains` (written by `sync`).
- `ios/App/App/Z8AuthSessionPlugin.swift` (in the App target's sources), `SceneDelegate.swift` and `Base.lproj/Main.storyboard`: the `Z8BridgeViewController` that registers the sign-in plugin.
- `ios/App/App/Info.plist`: camera and photo descriptions, `WKAppBoundDomains` (written by `sync`), FCM auto-init off and the `remote-notification` background mode.
- `ios/App/App/AppDelegate.swift`: forwards APNs registration and remote notifications to Capacitor for the Firebase plugin.
- `ios/App/App/App.entitlements` and `CODE_SIGN_ENTITLEMENTS` in `project.pbxproj`: `aps-environment` for push.
- `android/app/src/main/AndroidManifest.xml`: FCM auto-init and Analytics collection off.

## Manual checks per release

1. A simulator or emulator opens the configured origin, and a signed-in session survives an app restart.
2. After a reload, `navigator.serviceWorker.controller` is set (Safari Web Inspector or `chrome://inspect`).
3. Offline in an adopted organization, clocking in shows a held frozen command, which is sent after reconnecting.
4. A link to another origin opens in the system browser.
5. A travel-expense receipt can be photographed.
6. First launch in airplane mode shows the offline screen; a missing web page shows the web app's 404 page.
7. Signed out, the app shows the email screen. An email of an organization without a custom domain signs in with password, passkey and Google in the system browser and lands signed in in the web view. An email whose domain matches a verified custom sign-in domain opens that domain and its SSO.
8. Closing the system browser without signing in returns to the email screen without an error.
9. Sign-out in the web app, then a relaunch, shows the email screen. Revoking the session elsewhere (Security settings on another device) also returns to the email screen on the next page load.
10. With FCM configured, on a real device (the iOS simulator gets no APNs pushes): turn push on in notification settings, then submit an absence request as an employee whose approver uses the device. The approver gets "You have a request to review", and tapping it opens the approvals inbox. A push for another organization switches the organization first.
11. After signing out, the device gets no more pushes for that user.
