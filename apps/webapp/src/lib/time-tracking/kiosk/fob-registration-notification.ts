import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { type NotificationCopy, translatedContent } from "@/lib/notifications/notification-copy";
import {
	fillNotificationTemplate,
	type NotificationParamValue,
} from "@/lib/notifications/notification-params";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { KioskFobRegistration } from "./fob-store";
import { resolveIcuSelects } from "./frozen-refusal-notification";

// Each key sits next to its English default so the Tolgee extractor reads both. `replaced` is
// an ICU select, so every channel renders the replacement in the recipient's language; the
// stored English fallback picks its branch from the same default.
const employeeCopy = {
	titleKey: "common:notifications.content.kioskFobRegistered.title",
	titleDefault: "Kiosk fob registered",
	messageKey: "common:notifications.content.kioskFobRegistered.message",
	messageDefault:
		"{replaced, select, true {A kiosk fob ending in {lastFour} was registered to you on the kiosk {kioskName}. It replaced your earlier fob, which no longer works.} other {A kiosk fob ending in {lastFour} was registered to you on the kiosk {kioskName}.}} If you didn't register it, remove it in your security settings and change your kiosk PIN.",
} as const satisfies NotificationCopy;

/** To the managers of a kiosk-only employee (#860 forwarding): the message names the employee. */
const managersCopy = {
	titleKey: "common:notifications.content.kioskFobRegistered.title",
	titleDefault: "Kiosk fob registered",
	messageKey: "common:notifications.content.kioskFobRegistered.forwardedMessage",
	messageDefault:
		"{replaced, select, true {A kiosk fob ending in {lastFour} was registered to {employeeName} on the kiosk {kioskName}. It replaced their earlier fob, which no longer works.} other {A kiosk fob ending in {lastFour} was registered to {employeeName} on the kiosk {kioskName}.}} If {employeeName} didn't register it, remove it on their employee page and reset their kiosk PIN.",
} as const satisfies NotificationCopy;

export type KioskFobRegisteredNotificationInput = {
	organizationId: string;
	fobId: string;
	/** The employee's user: the notification is addressed to them, and forwarded if kiosk-only. */
	userId: string;
	kioskId: string;
	kioskName: string;
	employeeName: string;
	/** The only part of the serial number ever shown (decision O4). */
	lastFour: string;
	/** Whether the registration ended the employee's earlier fob. */
	replaced: boolean;
	/** Who will read it: the employee, or (kiosk-only employee) their managers. */
	recipient: "employee" | "managers";
};

/**
 * A kiosk fob registered to an employee (#1507, ADR 0014): the kiosk it was
 * registered on, its last four hex digits and whether it replaced their earlier
 * fob. The safeguard against someone who knows a colleague's kiosk PIN linking
 * their own card to them. Addressed to the employee's user; `createNotification`
 * forwards a kiosk-only employee's to their managers (#860), who get the copy
 * that names the employee. The employee's copy links to where they see and
 * remove their fob (decision O5).
 */
export function buildKioskFobRegisteredNotification(
	input: KioskFobRegisteredNotificationInput,
): CreateNotificationParams {
	const copy = input.recipient === "employee" ? employeeCopy : managersCopy;
	const replaced = input.replaced ? "true" : "false";
	const params: Record<string, NotificationParamValue> = {
		replaced,
		lastFour: input.lastFour,
		kioskName: input.kioskName,
		employeeName: input.employeeName,
	};
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type: "kiosk_fob_registered",
		title: copy.titleDefault,
		message: fillNotificationTemplate(resolveIcuSelects(copy.messageDefault, { replaced }), params),
		entityType: "kiosk_fob",
		entityId: input.fobId,
		actionUrl: "/settings/security",
		idempotencyKey: `kiosk-fob-registered:${input.fobId}`,
		metadata: {
			kioskId: input.kioskId,
			fobId: input.fobId,
			i18n: translatedContent(copy, params).i18n,
		},
	};
}

/**
 * Tells the employee about a fob just registered to them, after the
 * registration committed (decision O3), or, for a kiosk-only employee, their
 * managers (`createNotification` forwards it, #860). An `already_registered`
 * answer changed nothing and tells nobody (decision O2).
 */
export async function notifyKioskFobRegistered(
	registration: KioskFobRegistration,
	options: {
		client?: Pick<typeof db, "select">;
		send?: (notification: CreateNotificationParams) => Promise<unknown>;
	} = {},
): Promise<void> {
	if (registration.outcome !== "registered") return;
	const [person] = await (options.client ?? db)
		.select({
			email: user.email,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
		})
		.from(user)
		.where(eq(user.id, registration.userId))
		.limit(1);
	if (!person) return;
	await (options.send ?? createNotification)(
		buildKioskFobRegisteredNotification({
			organizationId: registration.organizationId,
			fobId: registration.fobId,
			userId: registration.userId,
			kioskId: registration.kiosk.id,
			kioskName: registration.kiosk.name,
			employeeName: buildDerivedUserName(
				person.firstName ?? "",
				person.lastName ?? "",
				person.name,
			),
			lastFour: registration.lastFour,
			replaced: registration.replacedFobId !== null,
			// A kiosk-only employee (ADR 0006) sees no channel; their managers read it.
			recipient: isReservedEmail(person.email) ? "managers" : "employee",
		}),
	);
}
