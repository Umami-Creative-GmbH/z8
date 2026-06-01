# Local Trial Billing Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show full monthly and yearly checkout pricing cards for local-only trial organizations on `/settings/billing`.

**Architecture:** Keep the change inside the existing billing page client component. Extract the duplicated monthly/yearly pricing card JSX into a local render helper, then reuse it for the no-subscription state and the local-only trial state. Existing checkout and portal API routes remain unchanged.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Testing Library, shadcn-style UI components, Tolgee translations.

---

## File Structure

- Modify `apps/webapp/src/components/billing/billing-page-client.tsx`: add a local `renderPricingCards` helper inside `BillingPageClientContent`, remove the compact local-trial upgrade buttons, and render full pricing cards below the trial/current-plan card when `subscription.isTrialing && !subscription.hasStripeCustomer`.
- Modify `apps/webapp/src/components/billing/billing-page-client.test.tsx`: update the local-only trial regression test so it asserts full pricing cards and checkout buttons are visible while `Manage Billing` is absent.

## Task 1: Update Local-Only Trial Pricing UI

**Files:**
- Modify: `apps/webapp/src/components/billing/billing-page-client.test.tsx`
- Modify: `apps/webapp/src/components/billing/billing-page-client.tsx`

- [ ] **Step 1: Write the failing local-only trial pricing test**

Replace the existing test named `offers checkout instead of the Stripe portal for local-only trials` in `apps/webapp/src/components/billing/billing-page-client.test.tsx` with:

```tsx
it("shows full pricing cards instead of the Stripe portal for local-only trials", () => {
	render(
		<BillingPageClient
			subscription={{
				id: "sub_123",
				hasStripeCustomer: false,
				status: "trialing",
				isActive: true,
				isTrialing: true,
				isPastDue: false,
				currentSeats: 4,
				trialEnd: "2026-06-01T00:00:00.000Z",
				currentPeriodEnd: null,
				billingInterval: null,
				cancelAt: null,
			}}
			accessResult={{ canAccess: true, status: "trialing" }}
			isOwner={true}
		/>,
	);

	expect(screen.queryByText("Manage Billing")).toBeNull();
	expect(screen.getByText("Monthly")).toBeTruthy();
	expect(screen.getByText("Yearly")).toBeTruthy();
	expect(screen.getByText("€4")).toBeTruthy();
	expect(screen.getByText("€3")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Upgrade Monthly" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Upgrade Yearly" })).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run src/components/billing/billing-page-client.test.tsx
```

Expected: the local-only trial test fails because the component only renders compact `Upgrade Monthly` and `Upgrade Yearly` buttons, not the full `Monthly` and `Yearly` pricing cards.

- [ ] **Step 3: Add a pricing-card render helper**

In `apps/webapp/src/components/billing/billing-page-client.tsx`, inside `BillingPageClientContent` after `getStatusBadge`, add this helper:

```tsx
const renderPricingCards = (buttonLabels: { monthly: string; yearly: string }) => (
	<Card>
		<CardHeader>
			<CardTitle>{t("billing.choosePlan", "Choose Your Plan")}</CardTitle>
			<CardDescription>
				{t(
					"billing.choosePlanDescription",
					"Start with a 14-day free trial. No credit card required to start.",
				)}
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div className="grid gap-6 md:grid-cols-2">
				<Card className="border-2">
					<CardHeader>
						<CardTitle>{t("billing.plans.monthly.title", "Monthly")}</CardTitle>
						<CardDescription>
							{t("billing.plans.monthly.description", "Flexible month-to-month billing")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<span className="text-4xl font-bold">€{MONTHLY_PRICE}</span>
							<span className="text-muted-foreground">
								{t("billing.perSeatMonth", "/seat/month")}
							</span>
						</div>
						<ul className="space-y-2 text-sm">
							<li className="flex items-center gap-2">
								<IconCheck className="size-4 text-green-600" />
								{t("billing.features.trial", "14-day free trial")}
							</li>
							<li className="flex items-center gap-2">
								<IconCheck className="size-4 text-green-600" />
								{t("billing.features.cancelAnytime", "Cancel anytime")}
							</li>
							<li className="flex items-center gap-2">
								<IconCheck className="size-4 text-green-600" />
								{t("billing.features.allFeatures", "All features included")}
							</li>
						</ul>
						<Button
							className="w-full"
							variant="outline"
							onClick={() => handleSubscribe("month")}
							disabled={isLoading}
						>
							{isLoading ? t("billing.starting", "Starting...") : buttonLabels.monthly}
						</Button>
					</CardContent>
				</Card>

				<Card className="border-2 border-primary">
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>{t("billing.plans.yearly.title", "Yearly")}</CardTitle>
								<CardDescription>
									{t("billing.plans.yearly.description", "Save 25% with annual billing")}
								</CardDescription>
							</div>
							<Badge>{t("billing.bestValue", "Best Value")}</Badge>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<span className="text-4xl font-bold">€{YEARLY_PRICE_PER_MONTH}</span>
							<span className="text-muted-foreground">
								{t("billing.perSeatMonth", "/seat/month")}
							</span>
							<p className="text-sm text-muted-foreground">
								{t("billing.seatBilledAnnually", "€{price}/seat billed annually", {
									price: YEARLY_PRICE_TOTAL,
								})}
							</p>
						</div>
						<ul className="space-y-2 text-sm">
							<li className="flex items-center gap-2">
								<IconCheck className="size-4 text-green-600" />
								{t("billing.features.trial", "14-day free trial")}
							</li>
							<li className="flex items-center gap-2">
								<IconCheck className="size-4 text-green-600" />
								{t("billing.features.yearlyDiscount", "25% discount vs monthly")}
							</li>
							<li className="flex items-center gap-2">
								<IconCheck className="size-4 text-green-600" />
								{t("billing.features.allFeatures", "All features included")}
							</li>
						</ul>
						<Button className="w-full" onClick={() => handleSubscribe("year")} disabled={isLoading}>
							{isLoading ? t("billing.starting", "Starting...") : buttonLabels.yearly}
						</Button>
					</CardContent>
				</Card>
			</div>
		</CardContent>
	</Card>
);
```

- [ ] **Step 4: Replace the compact local-only trial action buttons**

In the current-plan card header in `apps/webapp/src/components/billing/billing-page-client.tsx`, replace the existing ternary that renders `Manage Billing` or the compact two-button `div` with:

```tsx
{canManageBilling && (
	<Button variant="outline" onClick={handleManageBilling} disabled={isPortalLoading}>
		{isPortalLoading
			? t("billing.opening", "Opening...")
			: t("billing.manageBilling", "Manage Billing")}
	</Button>
)}
```

- [ ] **Step 5: Render full pricing cards for local-only trials**

In `apps/webapp/src/components/billing/billing-page-client.tsx`, after the current-plan `Card` and before the existing trial clarification `Alert`, add:

```tsx
{subscription.isTrialing && !canManageBilling &&
	renderPricingCards({
		monthly: t("billing.upgradeMonthly", "Upgrade Monthly"),
		yearly: t("billing.upgradeYearly", "Upgrade Yearly"),
	})}
```

- [ ] **Step 6: Reuse the helper for the no-subscription state**

In the `subscription ? ... : ...` branch, replace the current no-subscription pricing card JSX with:

```tsx
<div className="space-y-6">
	{renderPricingCards({
		monthly: t("billing.startTrial", "Start Free Trial"),
		yearly: t("billing.startTrial", "Start Free Trial"),
	})}

	<p className="text-center text-sm text-muted-foreground">
		{t(
			"billing.vatNotice",
			"Prices shown are net prices excluding VAT. VAT will be added where applicable.",
		)}
	</p>
</div>
```

- [ ] **Step 7: Run focused component tests**

Run:

```bash
pnpm vitest run src/components/billing/billing-page-client.test.tsx
```

Expected: all billing page component tests pass.

- [ ] **Step 8: Run focused billing regression tests**

Run:

```bash
pnpm vitest run src/components/billing/billing-page-client.test.tsx src/lib/effect/services/billing/stripe.service.test.ts
```

Expected: both test files pass.

- [ ] **Step 9: Run production build verification**

Run:

```bash
CI=true pnpm build
```

Expected: Next.js build exits successfully. Existing build-time warnings about missing local secrets or database setup checks may appear, but there must be no TypeScript or compilation failure.

## Self-Review

- Spec coverage: The plan renders full pricing cards for local-only trials, keeps portal-only behavior for Stripe customers, preserves no-subscription pricing, and relies on existing checkout error handling.
- Placeholder scan: No placeholders, TODOs, or deferred implementation steps remain.
- Type consistency: The plan uses the existing `hasStripeCustomer`, `isTrialing`, `handleSubscribe`, `canManageBilling`, pricing constants, and Tolgee `t` function names from `BillingPageClientContent`.
