import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { organizationTrackingSettings } from "@/db/schema/organization-tracking-settings";
import type { AuthTransaction } from "@/lib/auth/auth-transaction";
import { instantFromDate } from "@/lib/datetime/temporal-core";

// Only creation callers supply choices; this context exposes no existing-organization update route.
const creationSetup = new AsyncLocalStorage<{
	timezone?: string;
	trackingStartDate?: string;
}>();

export function withOrganizationTrackingSetup<T>(
	setup: { timezone?: string; trackingStartDate?: string },
	create: () => Promise<T>,
): Promise<T> {
	return creationSetup.run(setup, create);
}

/** The chosen calendar date and activation commit atomically with the new organization and owner. */
export async function createOrganizationTrackingSettings(
	transaction: AuthTransaction,
	input: { organizationId: string; createdAt: Date; actorUserId: string },
): Promise<void> {
	const setup = creationSetup.getStore();
	const [created] = await transaction
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, input.organizationId));
	if (!created) throw new Error("The newly created organization was not found");
	const timezone = setup?.timezone || created.timezone || "UTC";
	const trackingStartDate =
		setup?.trackingStartDate ||
		instantFromDate(input.createdAt)
			.toZonedDateTimeISO(timezone)
			.toPlainDate()
			.toString();
	if (setup?.timezone && setup.timezone !== created.timezone) {
		await transaction
			.update(organization)
			.set({ timezone })
			.where(eq(organization.id, input.organizationId));
	}
	await transaction.insert(organizationTrackingSettings).values({
		organizationId: input.organizationId,
		trackingStartDate,
		activatedAt: input.createdAt,
		activatedBy: input.actorUserId,
		updatedBy: input.actorUserId,
	});
}
