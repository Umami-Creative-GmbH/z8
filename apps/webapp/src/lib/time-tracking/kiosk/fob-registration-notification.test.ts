import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import {
	buildKioskFobRegisteredNotification,
	notifyKioskFobRegistered,
} from "./fob-registration-notification";
import type { KioskFobRegistration } from "./fob-store";

const SERIAL = "04A1B2C3D4E5F6";

const base = {
	organizationId: "org-1",
	fobId: "fob-1",
	userId: "user-1",
	employeeId: "employee-1",
	kioskId: "kiosk-1",
	kioskName: "Front door",
	employeeName: "Wanda Worker",
	lastFour: "E5F6",
};

describe("buildKioskFobRegisteredNotification", () => {
	it("tells the employee which fob was registered on which kiosk and where to remove it", () => {
		const notification = buildKioskFobRegisteredNotification({
			...base,
			replaced: false,
			recipient: "employee",
		});

		expect(notification).toMatchObject({
			userId: "user-1",
			organizationId: "org-1",
			type: "kiosk_fob_registered",
			title: "Kiosk fob registered",
			message:
				"A kiosk fob ending in E5F6 was registered to you on the kiosk Front door. If you didn't register it, remove it in your security settings and change your kiosk PIN.",
			entityType: "kiosk_fob",
			entityId: "fob-1",
			actionUrl: "/settings/security",
			idempotencyKey: "kiosk-fob-registered:fob-1",
		});
		expect(notification.forwardedActionUrl).toBeUndefined();
		expect(notification.metadata).toMatchObject({
			kioskId: "kiosk-1",
			fobId: "fob-1",
			i18n: {
				titleKey: "common:notifications.content.kioskFobRegistered.title",
				messageKey: "common:notifications.content.kioskFobRegistered.message",
				params: {
					replaced: "false",
					lastFour: "E5F6",
					kioskName: "Front door",
					employeeName: "Wanda Worker",
				},
			},
		});
	});

	it("says that the new fob replaced the employee's earlier one", () => {
		const notification = buildKioskFobRegisteredNotification({
			...base,
			replaced: true,
			recipient: "employee",
		});

		expect(notification.message).toBe(
			"A kiosk fob ending in E5F6 was registered to you on the kiosk Front door. It replaced your earlier fob, which no longer works. If you didn't register it, remove it in your security settings and change your kiosk PIN.",
		);
		expect(notification.metadata?.i18n).toMatchObject({ params: { replaced: "true" } });
	});

	it("names the employee for managers of a kiosk-only employee", () => {
		const first = buildKioskFobRegisteredNotification({
			...base,
			employeeName: "Kim Kiosk",
			replaced: false,
			recipient: "managers",
		});
		expect(first.message).toBe(
			"A kiosk fob ending in E5F6 was registered to Kim Kiosk on the kiosk Front door. If Kim Kiosk didn't register it, remove it on their employee page and reset their kiosk PIN.",
		);
		// The kiosk-only employee has no link of their own; their managers get the employee's page.
		expect(first.actionUrl).toBeUndefined();
		expect(first.forwardedActionUrl).toBe("/settings/employees/employee-1");
		expect(first.metadata?.i18n).toMatchObject({
			titleKey: "common:notifications.content.kioskFobRegistered.title",
			messageKey: "common:notifications.content.kioskFobRegistered.forwardedMessage",
		});

		const replacing = buildKioskFobRegisteredNotification({
			...base,
			employeeName: "Kim Kiosk",
			replaced: true,
			recipient: "managers",
		});
		expect(replacing.message).toContain(
			"was registered to Kim Kiosk on the kiosk Front door. It replaced their earlier fob, which no longer works.",
		);
	});
});

describe("notifyKioskFobRegistered", () => {
	const registration: KioskFobRegistration = {
		outcome: "registered",
		fobId: "fob-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		userId: "user-1",
		kiosk: { id: "kiosk-1", name: "Front door" },
		lastFour: "E5F6",
		registeredAt: parseInstant("2026-11-02T08:00:00Z"),
		replacedFobId: null,
	};

	function personClient(person: {
		email: string;
		name: string;
		firstName: string | null;
		lastName: string | null;
	}) {
		const chain = {
			from: () => chain,
			where: () => chain,
			limit: async () => [person],
		};
		return { select: () => chain } as never;
	}

	async function sent(
		input: KioskFobRegistration,
		email = "wanda@example.test",
	): Promise<CreateNotificationParams[]> {
		const notifications: CreateNotificationParams[] = [];
		await notifyKioskFobRegistered(input, {
			client: personClient({ email, name: "Wanda Worker", firstName: null, lastName: null }),
			send: async (notification) => {
				notifications.push(notification);
			},
		});
		return notifications;
	}

	it("addresses the employee's own user with the employee copy", async () => {
		const [notification, ...rest] = await sent({ ...registration, replacedFobId: "fob-0" });
		expect(rest).toEqual([]);
		expect(notification).toMatchObject({
			userId: "user-1",
			organizationId: "org-1",
			type: "kiosk_fob_registered",
		});
		expect(notification?.message).toContain("registered to you on the kiosk Front door");
		expect(notification?.message).toContain("It replaced your earlier fob");
	});

	it("picks the managers' copy for a kiosk-only employee, still addressed to their user", async () => {
		const [notification] = await sent(registration, "kim@kiosk.invalid");
		expect(notification?.userId).toBe("user-1");
		expect(notification?.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.kioskFobRegistered.forwardedMessage",
		});
	});

	it("sends nothing when the fob was already the employee's", async () => {
		expect(await sent({ ...registration, outcome: "already_registered" })).toEqual([]);
	});

	it("never carries more of the serial number than its last four hex digits", async () => {
		const [notification] = await sent({ ...registration, replacedFobId: "fob-0" });
		const text = JSON.stringify(notification);
		expect(text).toContain("E5F6");
		expect(text).not.toContain(SERIAL);
		expect(text).not.toContain("D4E5F6");
	});
});
