# Sign-In Wrapper and Form Redesign

## Summary

Redesign the auth wrapper and `/sign-in` around a quiet operator direction: calm, exact, and operationally trustworthy. The page should help returning users get back into schedules, approvals, and payroll work quickly, while building a reusable shell pattern for sign-up, password recovery, and verification routes.

## Approved Direction

### Domain

- shift start
- schedule certainty
- approval handoff
- payroll readiness
- audit trail
- workspace access
- recorded time
- operational continuity

### Color World

- blue-slate desk surfaces
- indigo ink and official stamps
- fogged glass and cool daylight
- off-white timesheet paper
- muted steel separators
- amber pending-state highlights
- teal confirmation states
- sage balance and wellness indicators

### Signature

The auth shell uses a quiet readiness ledger instead of a generic illustration rail or process story. The ledger is made of compact, domain-specific trust rows that read like operational checkpoints, not marketing bullets.

### Defaults Rejected

- Generic split auth card with a stock-photo rail -> a form-led shell with a restrained readiness ledger
- Multiple equally loud auth methods at the top -> one dominant credential path with alternate methods deliberately stepped down
- Promotional hero copy -> terse operational reassurance tied to schedules, approvals, and payroll continuity

## User and Intent

### Who This Is For

Returning employees and managers signing in at the start of a shift, between approvals, or while trying to get back into a workspace quickly.

### Primary Job

Regain access to the workspace with the least possible friction and without ambiguity about the main action.

### Feel

Calm, serious, exact, and trustworthy. The page should feel like a controlled handoff into work, not a campaign page or onboarding story.

## Goals

- Keep the atmospheric auth background direction already established in the product
- Make credential sign-in the default and most legible path
- Replace the theatrical side rail with a product-specific trust surface
- Keep SSO, passkey, social auth, and recovery available without letting them compete with the main task
- Preserve continuity when 2FA is required
- Create a wrapper pattern that can extend cleanly to sign-up and other auth routes

## Intentional Flexibility

The initial `/sign-in` copy and the fine ordering of non-primary alternate auth methods remain intentionally flexible at spec stage.

Guardrails:

- the title must be direct, returning-user language
- the support sentence must be single-paragraph, operational, and non-promotional
- the readiness ledger copy must stay in workforce and record-keeping language
- email/password stays first whenever that path is enabled
- SSO only leads when credentials are unavailable for that tenant flow
- all non-primary auth methods remain visually secondary to the active lead path

Implementation planning may finalize exact copy and secondary method ordering within those constraints.

## Non-Goals

- No redesign of the full auth system or backend behavior
- No new auth methods
- No marketing-style storytelling inside auth
- No separate visual language for sign-up or recovery at this stage

## Visual System

### Palette

Use the saved Z8 design system in `.interface-design/system.md`:

- blue-slate neutrals for structure
- indigo for the single primary action and focus states
- muted off-whites for the form surface
- low-contrast steel-like borders for separation

Alternate auth should stay inside muted and border tokens so the primary credential action remains visually dominant.

### Depth

Borders-only. No dramatic auth-card shadow. The wrapper should rely on subtle surface shifts and quiet border separation, consistent with the existing Z8 system.

### Typography

Use stronger heading presence, restrained support copy, medium-weight labels, and quieter tertiary utility text. The page should read like workspace access, not onboarding.

### Spacing

Use the 4px base grid from the current system. The shell should breathe at the macro level while the credential flow stays tight and continuous.

## Wrapper Design

### Structure

The wrapper remains a two-column shell on desktop, but the emphasis changes:

- the left column is the working column
- the right column is the readiness ledger
- the shell reads as one composed instrument instead of a dramatic split card

### Left Column

The left column contains:

- brand mark or app name
- direct page title
- one short support sentence
- route-specific form content

This column should feel like a precise work surface: clear hierarchy, minimal ornament, and no duplicated reassurance blocks.

Header ownership is explicit: the wrapper owns the page title and support sentence. Route components pass those values into the wrapper, and the route form body must not render a second standalone heading block.

Required wrapper content contract:

- `title`: route heading shown at the top of the working column
- `description`: the single route support sentence shown under the title
- `children`: route-specific form content only
- `ledgerHeading`: short heading for the readiness ledger
- `ledgerDescription`: restrained explanatory sentence for the ledger
- `ledgerItems`: array of compact trust rows
- `branding`: existing org branding object
- `formProps`: existing form wiring

Future auth routes should reuse the same wrapper contract rather than inventing route-local header or rail patterns.

### Right Column: Readiness Ledger

The current image rail and any process-theater treatment are replaced by a quiet trust panel with:

- one short operational heading
- one restrained explanatory sentence
- exactly three compact readiness rows tied to the product domain

Representative row themes:

- schedules remain visible and current
- approvals stay traceable
- records remain payroll-ready

These rows should read like operational checkpoints, not feature marketing.

The ledger panel itself is text-only. It does not render standalone photography, step illustrations, or narrative artwork.

### Mobile Behavior

On small screens, the right-column trust content compresses into one quiet supporting block near the top of the working column. Do not render a stack of trust cards, pills, or repeat the desktop ledger as separate mobile sections.

The surviving mobile block should sit directly under the wrapper description and contain:

- `ledgerHeading`
- either `ledgerDescription` or one condensed checkpoint sentence

It should not render the full per-row ledger list on mobile. Mobile row count is `0`; desktop row count is `3`. Implement either conditional rendering or stable test hooks that make that distinction explicit in DOM assertions.

### Background Treatment

Keep the atmospheric auth background at the page or shell backdrop layer, not as a dedicated right-side media rail. `branding.backgroundImageUrl` may remain as an optional low-emphasis backdrop behind the overall shell, but it should not occupy its own visible split panel. If no branded backdrop is available, use the existing atmospheric background treatment without changing the shell hierarchy.

## Sign-In Form Design

### Header

The heading should use direct returning-user language, such as:

- `Sign in to your workspace`

The supporting sentence should stay short and specific, such as:

- `Use your work email to get back to schedules, approvals, and payroll records.`

The wrapper renders this header block. `login-form.tsx` should supply the sign-in values through wrapper props and then begin directly with form state and controls. The support sentence exists once. It should not be repeated in both the shell and the form body.

### Credential Path

Email and password are first. There is no divider, alternate-auth block, or decorative interruption before them.

The credential block should feel like one continuous action path:

- email
- password
- recovery utility near the password label or password group
- primary submit button

### Recovery Placement

`Forgot your password?` should move closer to the password field group so it is easier to find during the exact moment it matters. It should be visibly secondary but more discoverable than the current post-submit placement.

### Primary Action

The submit button is the first dominant action in the form and should use simpler copy:

- `Sign in`

It owns the indigo emphasis for the page.

### Alternate Auth

Passkey, social providers, and SSO appear after the primary credential action in normal flows. Their section should:

- use quieter divider copy such as `Other ways to sign in`
- use lighter visual treatment than the primary button
- read as support, not as a competing path cluster

### SSO Rule

SSO stays visible where configured, but it should not lead the page by default. The concrete rule is:

- if `ssoEnabled` is true and `emailPasswordEnabled` is false, treat the route as SSO-first
- if both `ssoEnabled` and `emailPasswordEnabled` are true, email/password is the default path and SSO moves into the alternate-auth section

This keeps the hierarchy testable using the current auth configuration source instead of visual judgment. When credentials are unavailable, any remaining passkey or social methods stay below the lead method and remain visually secondary.

### Sign-Up CTA

The sign-up CTA remains available in the footer area of the form, but it should be quieter than password recovery and clearly quieter than the primary sign-in action.

## Two-Factor Continuity

When 2FA is required, the page should feel like the same sign-in flow continuing.

Rules:

- keep the page heading in the same place
- keep the same title and support sentence used by the sign-in state
- replace the editable email field with a read-only account-context line that shows the email being verified
- remove the password field from the active layout during OTP entry rather than leaving it visible as an editable-looking control
- hide or suppress alternate auth during verification
- keep the OTP controls in the same form column without introducing a new auth mode or shell
- use continuation copy such as `Verify and sign in`
- keep top-level error and loading surfaces in the same position they occupy in the sign-in state

The 2FA state should therefore read as the same sign-in screen with a narrower active task, not as a different verification page.

## States and UX

### Error Handling

- inline field validation remains close to the related input
- the global error surface stays visible near the top of the form stack
- errors should feel serious and clear, not loud or alarming beyond necessity

### Loading

- loading labels stay tied to the current action
- the page should not visibly jump or reflow during loading

### Accessibility

- preserve semantic form structure and label associations
- keep keyboard access for recovery, alternate auth, and verification controls
- maintain obvious focus states using the indigo ring system
- preserve sufficient contrast after reducing visual intensity

## Reusable Pattern for Future Auth Routes

This redesign should establish a reusable auth wrapper pattern for `sign-up`, password recovery, and verification routes:

- same shell
- same readiness-ledger signature
- same depth strategy
- same header discipline
- route-specific form hierarchy inside the working column

Future routes can adapt the support sentence and ledger copy, but they should inherit the same calm operational framing.

Expected route-level overrides:

- `title`
- `description`
- `ledgerHeading`
- `ledgerDescription`
- `ledgerItems`

Everything else about depth, shell layout, and hierarchy remains shared.

## Files In Scope

- `apps/webapp/src/components/auth-form-wrapper.tsx`
- `apps/webapp/src/components/login-form.tsx`
- `apps/webapp/src/components/auth-form-wrapper.test.tsx`
- `apps/webapp/src/components/login-form.test.tsx`
- auth translation sources if copy changes require it

## Test Requirements

Use `apps/webapp/src/components/auth-form-wrapper.test.tsx` for shell behavior and add or update `apps/webapp/src/components/login-form.test.tsx` for sign-in hierarchy behavior.

Required DOM-level checks:

- prove the wrapper no longer renders a process-style or promotional side rail
- prove the wrapper exposes a single mobile support block rather than a duplicated trust-card stack
- prove the primary credential submit action appears before alternate auth in non-SSO-first flows
- prove SSO renders first only when `ssoEnabled === true` and `emailPasswordEnabled === false`
- prove recovery appears in or immediately adjacent to the password group
- prove 2FA preserves visible account email context in the same form column
- prove alternate auth is absent or hidden during 2FA verification
- prove any updated sign-in copy and structure

Implementation may add stable hooks such as `data-testid` or named landmarks for the mobile support block, readiness ledger, and account-context line if needed to keep these tests reliable.

## Success Criteria

- the page feels calmer and more operational than the current implementation
- the wrapper has a product-specific readiness-ledger signature instead of a generic auth rail
- the credential path is the clearest default action in standard flows
- recovery is easier to find without becoming loud
- alternate auth remains available but clearly secondary
- 2FA feels like a continuation, not a reset
- the shell can be reused for sign-up and related auth routes without redesigning the pattern again
