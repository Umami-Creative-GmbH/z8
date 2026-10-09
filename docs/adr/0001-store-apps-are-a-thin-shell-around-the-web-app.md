---
status: accepted
---

# Store apps are a thin shell around the web app

Field and frontline employees clock on their own phones, and iOS delivers web push only to a PWA installed to the home screen, which they rarely do. A PWA alone therefore cannot give them reminders or approval pushes, and buyers also judge the product by its App Store and Play Store presence. We decided that Z8's store apps are a thin Capacitor shell that loads the live web app and adds native push, camera and (later) NFC, instead of a separate React Native app with its own UI. One UI codebase means every web feature reaches the store apps the day it ships; the Expo app removed in `4722f938f` showed what a second UI costs to keep in step (#765).

## Considered Options

- **Hardened PWA only.** Rejected: iOS push needs a home-screen install, and there is no store presence.
- **Full React Native or Expo app on `/api/mobile/*`.** Rejected: a second UI codebase that must follow every web change.
- **Native Swift and Kotlin shells.** Rejected: two shells to maintain for the same thin job Capacitor already does.

## Consequences

- The shell signs in through the phone's system browser and hands the session over with the existing app code exchange (`mobile` app type), because identity providers block sign-in in embedded web views and organizations may sign in on their own custom domain.
- Native push is sent through Firebase Cloud Messaging on both platforms, as one more delivery channel for the notifications web push already sends. Payloads carry no personal data.
- The shell must declare the app's domain to iOS (app-bound domains), or the service worker, and with it offline clocking, does not run in its web view.
- Offline clocking still follows the organization's admission: frozen clock commands are accepted only in adopted organizations (time-tracking ADR 0002). The shell does not change that.
- The `/api/mobile/*` data routes and `/api/extension/*` have no consumer and are removed.
- Z8 never tracks location in the background or by geofence on any client. Continuous location tracking needs works-council co-determination (§ 87(1) no. 6 BetrVG) and fails the GDPR proportionality test, which contradicts Z8's compliance positioning. A location stamp taken at a clock event with consent (#766) is a separate decision.
