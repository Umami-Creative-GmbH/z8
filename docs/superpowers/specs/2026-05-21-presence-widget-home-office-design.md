# Presence Widget Home Office Redesign

## Context

The current dashboard Presence widget only displays on-site attendance progress as `actual/required`. That does not answer the employee question this widget should answer: how many home-office days are still available this week, and how many office days are still required.

The existing policy model already contains the source of truth:

- `workPolicy.presenceEnabled` controls whether presence rules apply.
- `workPolicyPresence.presenceMode` is either `minimum_count` or `fixed_days`.
- `requiredOnsiteDays` defines flexible office-day requirements for `minimum_count`.
- `requiredOnsiteFixedDays` defines fixed office weekdays for `fixed_days`.
- `evaluationPeriod` can be `weekly`, `biweekly`, or `monthly`.
- Work periods tagged `office` count as on-site. `home`, `remote`, and `other` do not count as on-site.

The current server action also always loads current-week work periods even though the policy may evaluate biweekly or monthly. The redesign should fix the data contract rather than trying to infer policy semantics in the client.

## Goals

- Show two equal primary stats in the widget: home-office days left and office days still required.
- Read the employee's effective organization-scoped work policy and presence configuration.
- Support both flexible office-day policies and fixed office-day policies.
- Use the active evaluation period correctly, including weekly, biweekly, and monthly policies.
- Keep the widget hidden when no presence policy is enabled for the employee.
- Avoid misleading zero states when policy data is malformed or incomplete.

## Non-Goals

- Do not introduce a new tenant-specific environment variable or external service.
- Do not redesign the work policy editor.
- Do not change how clock-in location tagging works.
- Do not change compliance violation generation in this pass, except where shared helper extraction is needed to keep widget math consistent.

## Recommended Approach

Replace the Presence widget's server data contract with a home-office-aware summary returned by `getPresenceStatus`. The server should compute the policy period, read the relevant work periods, apply policy mode semantics, and return directly displayable values.

This keeps policy interpretation on the server, where organization scoping, effective policy lookup, time zone handling, and schedule data are available. The widget should only render the returned status.

## Data Contract

`getPresenceStatus(employeeId)` should continue enforcing that the requested employee belongs to the active organization. On success, it should return a structure shaped around display needs:

```ts
type PresenceStatus = {
  presenceEnabled: boolean;
  available: boolean;
  period: "weekly" | "biweekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  mode: "minimum_count" | "fixed_days";
  homeOfficeDaysLeft: number;
  officeDaysRequiredLeft: number;
  officeDaysCompleted: number;
  homeOfficeDaysUsed: number;
  workingDaysRemaining: number;
  requiredOfficeDays: number;
  fixedOfficeDays: PresenceDayOfWeek[];
  message: string | null;
};
```

When `presenceEnabled` is false, the widget can keep returning a disabled summary and the client should hide the widget. When `presenceEnabled` is true but the config cannot be interpreted, return `available: false` and a neutral message so the widget does not display misleading counts.

## Period Calculation

The action should compute the current policy period before querying work periods:

- `weekly`: use the user's configured week start day via the existing `getUserWeekStartDay` and `getWeekBounds` flow.
- `biweekly`: use a stable two-week period aligned to the user's week start. The implementation should choose one deterministic anchor and document it in the helper so current and future compliance views agree.
- `monthly`: use the current calendar month in the employee or user time zone.

All date grouping should use Luxon. Native `Date` should only be used at database boundaries.

## Counting Rules

Only completed or started work periods in the current period should contribute to counts. A date counts once regardless of multiple work periods on that date.

`officeDaysCompleted` is the count of distinct period dates with at least one `office` work period.

`homeOfficeDaysUsed` is the count of distinct period dates with at least one `home` work period and no office work period on the same date. `remote` remains distinct from `home` and should not automatically count as home office unless the existing product definition changes later.

`workingDaysRemaining` should count still-unworked workdays in the current policy period from today through the period end, based on policy schedule days where available. A date that already has any work period in the period should not count as remaining, so the widget does not double-count today after the employee has already clocked in. If schedule data is not available, fall back to Monday through Friday rather than showing no allowance.

## Flexible Policy Mode

For `minimum_count`, the policy means the employee has flexible office days.

Calculations:

- `requiredOfficeDays = requiredOnsiteDays` capped to available working days in the period.
- `officeDaysRequiredLeft = max(requiredOfficeDays - officeDaysCompleted, 0)`.
- `homeOfficeDaysLeft = max(workingDaysRemaining - officeDaysRequiredLeft, 0)` using only still-unworked remaining workdays.

This answers whether the employee can still choose home office while preserving the remaining office obligation.

## Fixed Policy Mode

For `fixed_days`, the policy means listed weekdays are required office days.

Calculations:

- `fixedOfficeDays` returns the configured weekdays for display.
- `requiredOfficeDays` is the count of fixed office dates inside the current period.
- `officeDaysRequiredLeft` is the count of remaining fixed office dates without an office work period.
- `homeOfficeDaysLeft` is the count of still-unworked remaining scheduled workdays that are not fixed office days.

The widget should include a small policy note such as `Fixed office days: Mon, Wed`.

## Widget UI

The widget should be renamed visually from a generic Presence progress card to a clearer work-location status card while keeping the existing dashboard widget id if possible.

Layout:

- Title: `Work location` or localized equivalent.
- Description: current evaluation period, for example `This week`.
- Primary stats: two equal compact panels, `Home office left` and `Office still required`.
- Secondary note: flexible policy note or fixed weekday list.
- Status hint: warn only when `officeDaysRequiredLeft > workingDaysRemaining`, because that means the employee can no longer satisfy the requirement in the remaining period.

The widget should remain restrained and consistent with the dashboard card system. It should not use a progress bar as the primary element because the user asked for remaining options, not completion percentage.

## Error Handling

- Invalid employee IDs should keep returning a failed server action.
- Cross-organization employee access must remain blocked.
- Missing effective policy or disabled presence should hide the widget.
- Enabled presence with malformed config should render an unavailable state with a neutral message.
- JSON parsing of fixed days should be defensive and validate weekday names before use.

## Testing

Unit tests should cover the pure counting helper for:

- Flexible policy with office days completed and home days used.
- Flexible policy where office requirements consume all remaining workdays.
- Fixed policy with required weekdays remaining.
- Fixed policy with completed fixed office days.
- Multiple work periods on the same date.
- `home` distinct from `remote`.
- Malformed fixed-day JSON.

Server action tests should cover:

- Disabled presence hides the widget data.
- Organization scoping remains enforced.
- Weekly policy period queries the correct range.
- Biweekly and monthly policies do not accidentally query only the current week.

Component tests should cover:

- Two equal stats render with returned values.
- Fixed policy note renders configured weekdays.
- Unavailable enabled policy state does not show misleading zero counts.

## Implementation Boundary

The implementation should be focused on the existing Presence widget path:

- `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
- `apps/webapp/src/hooks/use-presence-status.ts`
- `apps/webapp/src/components/dashboard/presence-status-widget.tsx`
- Existing tests next to those files

If shared presence-period or counting logic is extracted, it should stay small and only serve the widget and existing presence compliance concepts. No unrelated dashboard or policy-editor refactor should be included.
