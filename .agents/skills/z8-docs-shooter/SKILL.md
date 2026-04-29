---
name: z8-docs-shooter
description: Capture and maintain screenshots for Z8 documentation. Use this whenever the user asks to add, update, refresh, audit, or automate screenshots in `apps/docs`, docs MDX files, guide pages, documentation images, product docs, or references to `plan-docs-shooter.md`. Prefer this skill when the task involves mapping docs to app routes, using browser automation to capture Z8 UI screenshots, placing screenshots in docs image folders, or updating MDX image references.
---

# Docs Shooter

Automate screenshots for Z8 documentation by reading the MDX page, finding the matching app route, capturing representative UI states, and inserting image references where they help the docs.

This skill is repo-specific. It assumes the Z8 app and docs live in this workspace and that docs screenshots should be stable, English-locale, product-first images suitable for the public guide.

## Preconditions

- Confirm the app dev server is available at `http://localhost:3000` before browser work.
- Use the English locale for all app screenshots: `/en/...`.
- Demo data must already exist. If the target screen is empty or blocked by auth/setup, report that clearly instead of fabricating screenshots.
- Use browser automation for screenshots. Do not use `curl` or static HTML as evidence that a UI screenshot is correct.
- Keep secrets, private tenant data, tokens, and personal data out of screenshots.

## Source And Output Paths

- Docs MDX source: `apps/docs/content/docs/guide/`
- Screenshot output root: `apps/docs/public/images/`
- User-facing guide images: `apps/docs/public/images/user-guide/`
- Admin/settings guide images: `apps/docs/public/images/admin-guide/`
- Onboarding/getting-started images: `apps/docs/public/images/getting-started/`

Create missing image subdirectories only when needed.

## Workflow

1. Discover the target docs.
2. Read each relevant MDX file fully enough to understand the feature, route, and described interactions.
3. Map the documentation topic to an app route.
4. Open the app in a real browser at the English route.
5. Wait until the page is usable: no loading spinner, skeleton, pending navigation state, or obviously incomplete data.
6. Capture the main full-page screenshot.
7. Capture additional interactive states only when the MDX describes them or they materially clarify the workflow.
8. Save screenshots with stable kebab-case names in the matching section folder.
9. Add or update MDX image references near the text they illustrate.
10. Verify changed MDX references point to existing files.

## Route Mapping

Infer routes from the docs content and existing app navigation rather than guessing from filenames alone.

Use these defaults:

| Doc Type | Route Pattern | Image Folder |
| --- | --- | --- |
| User guide / main workflow | `/en/{feature}` | `user-guide` |
| Admin guide / settings | `/en/settings/{feature}` | `admin-guide` |
| Getting started / profile / onboarding | `/en/{profile-or-onboarding-route}` | `getting-started` |

Signals to inspect in MDX:

- Navigation text such as `Go to **X**`, `Open **X**`, or sidebar labels.
- Settings text such as `Go to **Settings** -> **Feature**`.
- Action text such as `Click **Create**`, `Open the filter`, or `Select a date range`.
- Existing image paths and nearby headings.

If route mapping remains ambiguous, inspect app route files or navigation config before asking the user. Ask only when multiple plausible routes would produce different screenshots.

## Screenshot Rules

- Prefer a desktop viewport wide enough for clear docs images unless the MDX specifically documents mobile behavior.
- Capture full-page screenshots for overview images.
- Use focused element/dialog screenshots only when full-page capture would hide the relevant state or create excessive noise.
- Wait briefly after clicks for menus, dialogs, animation, and async content to settle.
- Close or avoid transient browser UI, debug overlays, toasts, and dev-only artifacts unless the doc is about them.
- Do not capture private account identifiers, real names, real email addresses, tokens, billing details, or sensitive organization data.

## Interactive State Selection

Capture extra screenshots when docs mention:

- Popovers, dropdowns, menus, or filters
- Dialogs, sheets, modals, confirmations, or drawers
- Forms, validation, setup flows, or input-heavy pages
- Multi-step processes where one overview screenshot is insufficient
- Empty, error, approval, or status states that the user must recognize

Avoid screenshot bloat. If the text is clear without another image, skip it.

## Naming Convention

- Main page screenshot: `{feature}-page.png`
- Specific state: `{feature}-{state-or-element}.png`
- Use lowercase kebab-case.
- Keep names stable when refreshing an existing screenshot so MDX references do not churn.
- Use names that describe the product concept, not implementation details.

Examples:

- `time-tracking-page.png`
- `absences-request-dialog.png`
- `team-members-filter-menu.png`

## MDX Updates

Use normal Markdown image syntax unless the file already uses a different local convention:

```mdx
![Clear description of the UI state](/images/{section}/{filename}.png)
```

Placement guidelines:

- Put the image immediately after the paragraph or list that introduces the screen or interaction.
- Use alt text that identifies the screen and state, not generic text like `Screenshot`.
- Replace outdated image references when refreshing the same UI state.
- Keep docs prose changes minimal unless the screenshot reveals stale instructions.

## Verification

Before reporting completion:

- Confirm every added or changed image file exists under `apps/docs/public/images/`.
- Confirm every added or changed MDX image path starts with `/images/` and points to the saved file.
- Run the most targeted docs check available if it does not require unavailable secrets. If no practical check is available, state that verification was limited to file/path checks.
- If screenshots could not be captured because the app was not running, auth was unavailable, or demo data was missing, leave MDX unchanged unless the user explicitly asked for placeholders.

## When Updating New Docs

For a newly added MDX page, run the same workflow on that page only unless the user asks for a broad refresh. Identify the app route, capture the minimum useful screenshot set, save images in the appropriate section folder, and add image references where they help the reader complete the workflow.
