# Prompt for the implementation session

Paste the following into a new session opened in this checkout after the design handoff is available on its branch.

```text
Implement the approved Z8 dashboard and /time-tracking redesign.

Read AGENTS.md and docs/design/2026-11-14-dashboard-time-tracking-redesign.md first. Open the linked prototype in a browser and inspect the desktop, mobile and dark-theme reference captures before changing UI code. I approved this visual direction and module reorganization; proceed with the production conversion using your judgment for routine details.

The brief and its linked assets are the design source of truth. Preserve its hierarchy and information organization while rebuilding with our existing React/Next.js components, tokens, translations, real data and real actions. Implement both routes and the shared navigation/header treatment. Follow the brief's role, widget-preference, timekeeping and behavior requirements. Other routes retain their content and workflows.

Follow the repository's GitHub ticket and dedicated feature-branch workflow before investigation/implementation. Find the matching issue or establish the needed spec/ticket using docs/agents/issue-tracker.md; claim the implementation ticket, comment that work has started, and verify ownership. Preserve concurrent changes. If the design handoff is on a separate local branch, bring its documentation/assets into the feature branch explicitly.

Start with a short map of the current components, data owners and behaviors, then implement in reviewable increments. Continue through the dashboard, time tracking, runtime verification and fixes; a plan alone is not completion. Reuse authoritative organization-scoped reads and existing domain helpers. Keep clocking, breaks, workplace selection, corrections, timezone handling, widget customization and permission-based visibility working. The prototype's hardcoded data, demo interactions and review toolbar are reference-only.

Inspect the real monthly-target discrepancy noted in the brief and retain authoritative calculation semantics. Verify employee and manager states, light/dark themes, mobile/desktop layouts, loading/empty/error states, and active clock/break behavior. Use the required repository quality skills and appropriate checks. If a required environment is unavailable, finish independent work and report exactly what remains unverified.

Finish with the implemented changes, browser screenshots of both routes, checks performed, material limitations and the feature-branch commit(s). Do not publish, merge or deploy without the authorization required by the repository workflow.
```
