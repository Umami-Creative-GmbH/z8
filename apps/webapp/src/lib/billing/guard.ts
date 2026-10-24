import { Effect } from "effect";
import { NextResponse } from "next/server";
import { runtime } from "@/lib/effect/runtime";
import type { BillingAccessResult } from "@/lib/effect/services/billing/billing-enforcement.service";

type BillingAccessForGuard = Pick<BillingAccessResult, "canAccess" | "reason">;

export function isBillingMutationAllowed(
	access: BillingAccessForGuard,
): boolean {
	return access.canAccess;
}

export function createBillingForbiddenResponse(access: BillingAccessForGuard) {
	return NextResponse.json(
		{
			error: "billing_required",
			reason: access.reason ?? "subscription_required",
		},
		{ status: 402 },
	);
}

export async function requireBillingForMutation(
	organizationId: string,
): Promise<BillingAccessResult> {
	return checkBilling(organizationId, true);
}

/** Public reads enforce current billing without becoming trial-provisioning commands. */
export async function requireBillingForRead(
	organizationId: string,
): Promise<BillingAccessResult> {
	return checkBilling(organizationId, false);
}

async function checkBilling(
	organizationId: string,
	createTrialIfMissing: boolean,
): Promise<BillingAccessResult> {
	// Billing is imported on first use, keeping Stripe out of every mutation's module graph.
	const { BillingEnforcementService, BillingServicesLive } = await import(
		"@/lib/effect/services/billing"
	);
	return runtime.runPromise(
		Effect.gen(function* () {
			const billingEnforcementService = yield* BillingEnforcementService;
			return yield* billingEnforcementService.checkBillingAccess(
				organizationId,
				{
					createTrialIfMissing,
				},
			);
		}).pipe(Effect.provide(BillingServicesLive)),
	);
}
