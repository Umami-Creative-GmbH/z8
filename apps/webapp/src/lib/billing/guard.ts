import { Effect } from "effect";
import { NextResponse } from "next/server";
import {
	BillingEnforcementService,
	BillingEnforcementServiceLive,
	type BillingAccessResult,
} from "@/lib/effect/services/billing/billing-enforcement.service";

type BillingAccessForGuard = Pick<BillingAccessResult, "canAccess" | "reason">;

export function isBillingMutationAllowed(access: BillingAccessForGuard): boolean {
	return access.canAccess;
}

export function createBillingForbiddenResponse(access: BillingAccessForGuard) {
	return NextResponse.json(
		{ error: "billing_required", reason: access.reason ?? "subscription_required" },
		{ status: 402 },
	);
}

export async function requireBillingForMutation(organizationId: string): Promise<BillingAccessResult> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const billingEnforcementService = yield* BillingEnforcementService;
			return yield* billingEnforcementService.checkBillingAccess(organizationId, {
				createTrialIfMissing: true,
			});
		}).pipe(Effect.provide(BillingEnforcementServiceLive)),
	);
}
