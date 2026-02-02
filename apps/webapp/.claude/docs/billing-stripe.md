# Billing & Stripe Configuration

This guide covers setting up Stripe for per-seat organization billing.

## Environment Variables

Add these to your environment (via Phase CLI for production):

```bash
# Enable billing (set to "true" to activate)
BILLING_ENABLED=true

# Stripe API Keys (from Stripe Dashboard > Developers > API keys)
STRIPE_SECRET_KEY=sk_live_...        # Use sk_test_... for development
STRIPE_WEBHOOK_SECRET=whsec_...      # From webhook endpoint configuration

# Price IDs (from Stripe Dashboard > Products)
STRIPE_PRICE_MONTHLY_ID=price_...    # Monthly per-seat price
STRIPE_PRICE_YEARLY_ID=price_...     # Yearly per-seat price
```

## Stripe Dashboard Setup

### 1. Create Product & Prices

1. Go to **Products** > **Add product**
2. Create a product (e.g., "Z8 Subscription")
3. Add two prices:

| Price | Type | Billing | Amount | Usage Type |
|-------|------|---------|--------|------------|
| Monthly | Recurring | Monthly | €4.00 | Per unit (seat) |
| Yearly | Recurring | Yearly | €36.00 | Per unit (seat) |

4. Copy the Price IDs (`price_...`) to your environment variables

### 2. Configure Webhook

1. Go to **Developers** > **Webhooks** > **Add endpoint**
2. Set endpoint URL:
   - Production: `https://yourdomain.com/api/billing/webhook`
   - Development: Use [Stripe CLI](#local-development) for local testing
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`) to `STRIPE_WEBHOOK_SECRET`

### 3. Configure Customer Portal

1. Go to **Settings** > **Billing** > **Customer portal**
2. Enable these features:
   - **Payment methods**: Allow customers to update payment methods
   - **Invoices**: Show invoice history
   - **Subscriptions**: Allow cancel/resume (optional: allow plan switching)
   - **Billing information**: Allow updating billing address & tax ID
3. Set redirect link: `https://yourdomain.com/settings/billing`
4. Save changes

### 4. Configure Tax Collection (Optional)

1. Go to **Settings** > **Tax**
2. Enable **Stripe Tax** for automatic VAT/tax calculation
3. Set your business address for tax origin

## Local Development

### Using Stripe CLI

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login: `stripe login`
3. Forward webhooks to local server:
   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```
4. Copy the webhook signing secret from CLI output to `STRIPE_WEBHOOK_SECRET`

### Test Mode

- Use test API keys (`sk_test_...`, `pk_test_...`)
- Use [test card numbers](https://stripe.com/docs/testing#cards):
  - Success: `4242 4242 4242 4242`
  - Decline: `4000 0000 0000 0002`
  - Requires auth: `4000 0025 0000 3155`

## How It Works

### Subscription Flow

1. Org admin clicks "Subscribe" on `/settings/billing`
2. App creates Stripe Customer (linked to org) and Checkout Session
3. User completes payment on Stripe Checkout
4. Webhook receives `checkout.session.completed`
5. Subscription record created in database

### Seat Sync

Seats are automatically synced when organization members change:

- **Member added**: Seat count increases, Stripe subscription quantity updated (prorated)
- **Member removed**: Seat count decreases, Stripe subscription quantity updated (prorated)

This happens via Better Auth hooks in `src/lib/auth.ts`.

### Access Control

When `BILLING_ENABLED=true`:
- Organizations without active subscription cannot modify data
- Blocked statuses: `canceled`, `unpaid`, `past_due`
- Check via `subscriptionService.canMutateData(organizationId)`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/billing/checkout` | POST | Create Stripe Checkout session |
| `/api/billing/portal` | POST | Create Stripe Customer Portal session |
| `/api/billing/webhook` | POST | Stripe webhook handler |

## Database Tables

| Table | Purpose |
|-------|---------|
| `subscription` | Org subscription state (synced from Stripe) |
| `stripe_event` | Webhook event log (idempotency & audit) |
| `billing_seat_audit` | Seat change history |

## Pricing

Current pricing (defined in `billing-page-client.tsx`):

| Plan | Price | Effective Monthly |
|------|-------|-------------------|
| Monthly | €4/seat/month | €4/seat |
| Yearly | €36/seat/year | €3/seat (25% off) |

Trial: 14 days free

## Troubleshooting

### Webhook not receiving events
- Verify endpoint URL is publicly accessible
- Check webhook signing secret matches
- Review Stripe Dashboard > Webhooks > endpoint > Recent deliveries

### Subscription not updating
- Check `stripe_event` table for processing errors
- Verify webhook events are selected correctly
- Check application logs for `StripeWebhook` entries

### Seats not syncing
- Verify `BILLING_ENABLED=true`
- Check `billing_seat_audit` table for sync history
- Review logs for `SeatSyncService` errors
