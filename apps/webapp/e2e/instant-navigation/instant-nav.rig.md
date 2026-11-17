# Z8 instant-navigation rig

This suite guards rendered shells under the framework's dynamic-content lock. It does not measure latency, replace the release-budget operators, or authorize weakening authentication. The app layout deliberately serves its shared application shell until authorization completes on a hard load. Sibling navigations reuse that admitted layout and must show the destination's local loading UI.

- BUILD: From `apps/webapp`, run the normal production build with `CI=true` and `Z8_INSTANT_NAV_TEST=1`. That explicit flag selects `.next-instant-nav` and exposes the testing API only in this isolated artifact. Normal builds omit the testing API. Keep the flag set when starting the matching server so Next selects the same output directory.
- RUN: Start that artifact on an unused loopback port. Set `Z8_INSTANT_NAV_BASE_URL` to its origin, `Z8_INSTANT_NAV_STORAGE_STATE` to an absolute private Playwright storage-state file, and `Z8_INSTANT_NAV_BUILD_HASH` to the expected `/api/app-version` build hash. Then run `pnpm test:navigation`. `pnpm test:navigation --list` lists the matrix without credentials or a running server.
- TEST USER: An operator-created, approved org-admin account with a current employee record, completed onboarding and at least one managed employee. Supply an authenticated storage state before the measured page navigates. Never commit cookies/storage-state files. The account must pass billing, MFA and SSO admission for the selected organization. No login bypass is implemented.
- DRIFT: Active organization, membership approval, current employment, manager assignments, settings access, subscription/trial state, MFA/SSO requirements, feature settings, locale and supported browser. The default locale is `en`; `Z8_INSTANT_NAV_LOCALE` may select another built locale. The suite uses an explicit URL locale and stable data markers rather than translated names.
- LOOP: Build, start, test, inspect failures, stop the owned server. Run only against the owned loopback test artifact; the suite rejects other hostnames. No automatic `webServer` is configured, so it cannot start a process with missing Phase configuration or reuse an unrelated server. Establish an unlocked baseline for each exact fixture/navigation before treating a locked failure as a shell bug. Never add retries, manual cache warming or relaxed assertions to make it green.
- LIVENESS: The suite requires the expected build hash and checks `/api/app-version` before testing. Confirm the owned listener and newly built artifact separately; a build hash alone does not prove transitive dependency identity. Preserve exact artifact/source qualification for release evidence.
- WALLS: The real app needs Phase-managed database and service configuration, a configured organization and authenticated test account. Those are unavailable in the agent environment. Listing/typechecking and focused unit checks can run offline; no runtime RED/GREEN or before/after differential has been established here. A normal build with the testing API absent must fail the held-content assertions when real deferred content completes. Verify that negative control on the same qualified fixture before accepting these tests as release evidence.

Example in PowerShell, with the normal Phase configuration already injected by the operator:

```powershell
# Terminal 1: isolated test artifact and server; leave any existing next dev output alone.
$env:CI = 'true'
$env:Z8_INSTANT_NAV_TEST = '1'
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3128

# Terminal 2: use the exact expected buildHash and a private storage-state file.
$env:Z8_INSTANT_NAV_BASE_URL = 'http://127.0.0.1:3128'
$env:Z8_INSTANT_NAV_STORAGE_STATE = 'C:/private/z8-test-admin.json'
$env:Z8_INSTANT_NAV_BUILD_HASH = '<expected-build-hash>'
pnpm test:navigation
```

Both Chromium viewport projects run hard and soft navigation for Time Tracking, Dashboard, Team and employee settings. Soft checks click an actual application Link and reject document replacement. Hard checks confirm the shared application loading shell and absence of protected route content, then reload unlocked to prove the fixture reaches the real page. Soft checks prove the local fallback appears while dynamic content is absent and real content appears after release.

The framework testing cookie is hostname-scoped, not port-scoped. Use fresh Playwright contexts and keep other apps/Navigation Inspector sessions off the same hostname while running the suite. Screenshots, video and traces are disabled by default to avoid retaining workforce data. Runtime test results remain outside the checkout under the OS temporary directory.
