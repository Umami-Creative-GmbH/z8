import { NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { count, eq, sql, and, gte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { subscription, stripeEvent } from "@/db/schema";

// Prices in EUR (net)
const MONTHLY_PRICE = 4;
const YEARLY_PRICE_PER_MONTH = 3;

/**
 * Get platform billing metrics for superadmin dashboard
 * Endpoint: GET /api/admin/billing
 *
 * Requires: Platform admin role (user.role === "admin")
 * Returns: MRR, total seats, active subscriptions, trial conversions, etc.
 */
export async function GET() {
	await connection();

	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		return NextResponse.json({
			enabled: false,
			metrics: null,
		});
	}

	// Auth check
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Platform admin check
	if (session.user.role !== "admin") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	try {
		// Get total subscriptions by status
		const subscriptionsByStatus = await db
			.select({
				status: subscription.status,
				count: count(),
				totalSeats: sql<number>`COALESCE(SUM(${subscription.currentSeats}), 0)`,
			})
			.from(subscription)
			.groupBy(subscription.status);

		// Calculate metrics
		let totalActiveSeats = 0;
		let activeSubscriptions = 0;
		let trialingSubscriptions = 0;
		let pastDueSubscriptions = 0;
		let canceledSubscriptions = 0;

		for (const row of subscriptionsByStatus) {
			const seats = Number(row.totalSeats) || 0;
			const subscriptionCount = Number(row.count) || 0;

			switch (row.status) {
				case "active":
					totalActiveSeats += seats;
					activeSubscriptions = subscriptionCount;
					break;
				case "trialing":
					totalActiveSeats += seats;
					trialingSubscriptions = subscriptionCount;
					break;
				case "past_due":
					pastDueSubscriptions = subscriptionCount;
					break;
				case "canceled":
					canceledSubscriptions = subscriptionCount;
					break;
			}
		}

		// Calculate MRR (Monthly Recurring Revenue)
		// Get breakdown by billing interval
		const revenueBreakdown = await db
			.select({
				billingInterval: subscription.billingInterval,
				totalSeats: sql<number>`COALESCE(SUM(${subscription.currentSeats}), 0)`,
			})
			.from(subscription)
			.where(eq(subscription.status, "active"))
			.groupBy(subscription.billingInterval);

		let mrr = 0;
		for (const row of revenueBreakdown) {
			const seats = Number(row.totalSeats) || 0;
			if (row.billingInterval === "year") {
				mrr += seats * YEARLY_PRICE_PER_MONTH;
			} else {
				mrr += seats * MONTHLY_PRICE;
			}
		}

		// Trial conversion rate (last 30 days)
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		// Count trials that converted to active in last 30 days
		// We look at checkout.session.completed events
		const [conversionData] = await db
			.select({
				total: count(),
			})
			.from(stripeEvent)
			.where(
				and(
					eq(stripeEvent.type, "checkout.session.completed"),
					gte(stripeEvent.receivedAt, thirtyDaysAgo),
				),
			);

		const totalConversions = conversionData?.total ?? 0;

		// Get recent payment failures for alerts
		const [paymentFailures] = await db
			.select({ count: count() })
			.from(subscription)
			.where(eq(subscription.status, "past_due"));

		const paymentFailureCount = paymentFailures?.count ?? 0;

		// Calculate ARR (Annual Recurring Revenue)
		const arr = mrr * 12;

		// Yearly subscribers breakdown
		const [yearlyData] = await db
			.select({
				count: count(),
				seats: sql<number>`COALESCE(SUM(${subscription.currentSeats}), 0)`,
			})
			.from(subscription)
			.where(
				and(
					eq(subscription.billingInterval, "year"),
					eq(subscription.status, "active"),
				),
			);

		const [monthlyData] = await db
			.select({
				count: count(),
				seats: sql<number>`COALESCE(SUM(${subscription.currentSeats}), 0)`,
			})
			.from(subscription)
			.where(
				and(
					eq(subscription.billingInterval, "month"),
					eq(subscription.status, "active"),
				),
			);

		return NextResponse.json({
			enabled: true,
			metrics: {
				// Revenue
				mrr,
				arr,

				// Seats
				totalActiveSeats,
				monthlySeats: Number(monthlyData?.seats) || 0,
				yearlySeats: Number(yearlyData?.seats) || 0,

				// Subscriptions
				activeSubscriptions,
				trialingSubscriptions,
				pastDueSubscriptions,
				canceledSubscriptions,
				monthlySubscriptions: Number(monthlyData?.count) || 0,
				yearlySubscriptions: Number(yearlyData?.count) || 0,

				// Health
				paymentFailureCount,
				trialConversionsLast30Days: totalConversions,

				// Pricing reference
				pricing: {
					monthly: MONTHLY_PRICE,
					yearlyPerMonth: YEARLY_PRICE_PER_MONTH,
					yearlyTotal: YEARLY_PRICE_PER_MONTH * 12,
					currency: "EUR",
				},
			},
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to get billing metrics" },
			{ status: 500 },
		);
	}
}
