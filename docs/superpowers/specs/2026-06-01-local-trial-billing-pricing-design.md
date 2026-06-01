# Local Trial Billing Pricing Design

## Context

The billing settings page currently has two billing states:

- Organizations without a subscription row see full monthly and yearly pricing cards.
- Organizations with a subscription row see the current-plan card and, when a Stripe customer exists, a `Manage Billing` button.

Local trial organizations have a subscription row but no Stripe customer. They need an explicit checkout choice before the Stripe customer portal becomes useful.

## Goal

Show monthly and yearly checkout options on `/settings/billing` for local-only trial organizations. After checkout creates a Stripe customer/subscription, plan changes should be handled in the Stripe customer portal.

## User Experience

For `subscription.isTrialing && !subscription.hasStripeCustomer`:

- Keep the current trial status card so admins can see seats, trial end, and estimated cost.
- Replace the small header action buttons with the full existing monthly/yearly pricing cards.
- The pricing cards start checkout with the existing `/api/billing/checkout` endpoint using `interval: "month"` or `interval: "year"`.
- Keep the trial clarification alert that explains checkout collects payment details while preserving remaining trial time.

For organizations with a Stripe customer:

- Keep `Manage Billing` as the only plan-management action.
- Do not show monthly/yearly checkout cards, because switching cadence belongs in the Stripe portal.

For organizations without any subscription row:

- Keep the existing pricing-card experience unchanged.

## Implementation Shape

Extract the existing pricing-card JSX into a small local render helper inside `BillingPageClientContent`. This avoids duplicating the monthly/yearly cards between the no-subscription and local-only trial states while keeping the change scoped to the billing page component.

The helper will accept button copy so the no-subscription state can keep `Start Free Trial` while the local-only trial state can use upgrade-oriented copy.

## Error Handling

Checkout failures continue to use the existing `handleSubscribe` toast handling. The Stripe portal endpoint is not called for local-only trials.

## Testing

Update the billing page component tests to verify that local-only trials render full monthly/yearly pricing cards and do not render `Manage Billing`.

Keep the existing Stripe service price-id guard tests unchanged.
