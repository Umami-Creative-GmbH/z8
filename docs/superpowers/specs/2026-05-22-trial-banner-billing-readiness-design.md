<!-- Design spec for trial banner billing readiness behavior. -->

# Trial Banner Billing Readiness

## Context

The app layout currently shows `TrialBanner` for every organization whose billing access evaluates to `trialing` with days remaining. The banner always includes an upgrade link to `/settings/billing`.

Users want two changes:

- Only organization owners and admins should see the trial banner upgrade button.
- The trial banner should disappear once the organization has a Stripe-backed subscription prepared to collect payment after the trial.

## Behavior

The app should continue showing trial messaging while an organization is on a local trial and has not completed subscription setup.

The banner should be hidden when the current subscription row is in `trialing` status and has a non-null `stripeSubscriptionId`. This local state means Stripe has created the subscription through checkout, so payment collection is expected when the trial ends.

The upgrade link should render only when the active user's organization membership role is `owner` or `admin`. Non-admin users may still see the trial banner if the organization has not prepared a Stripe subscription, but they should not see a billing action they cannot use.

## Implementation Shape

Update the app layout billing flow to fetch the active user's membership for `activeOrganizationId`, alongside the existing billing access check. The layout should derive:

- `trialDaysRemaining` from `billingAccess.daysRemaining` as it does today.
- `canManageBilling` from membership role `owner` or `admin`.
- `hasPreparedTrialSubscription` from the subscription row where `status === "trialing"` and `stripeSubscriptionId` is present.
- `showTrialBanner` only when billing access is `trialing`, days remain, and `hasPreparedTrialSubscription` is false.

Extend `TrialBanner` with a `showUpgradeButton` prop and conditionally render the existing localized `Upgrade` link.

## Testing

Update component tests to cover the upgrade button being present for billing managers and absent for non-admin users. Update layout/source tests or add focused tests around the layout logic so the code path verifies the prepared subscription check uses `stripeSubscriptionId` and hides the banner for prepared trial subscriptions.

## Scope

This change does not add a new database column or webhook field. If Stripe readiness needs to distinguish a subscription without a usable payment method later, add an explicit persisted readiness field from Stripe webhook data in a separate billing-state change.
