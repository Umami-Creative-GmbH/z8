import { describe, expect, it } from "vitest";
import { scanNotificationCreators } from "./notification-creator-scan";

describe("notification creator scan", () => {
	it("finds creators with and without translation keys, by file and function", () => {
		const sites = scanNotificationCreators(
			new Map([
				[
					"lib/example/notify.ts",
					`
export async function onThingHappened(userId: string, organizationId: string) {
	await createNotification({
		userId,
		organizationId,
		type: "thing_happened",
		title: "Thing happened",
		message: "It happened.",
	});
}
export const onOtherThing = async (userId: string) =>
	createNotification({
		userId,
		organizationId: "org",
		type: "other_thing",
		title: "Other thing",
		message: "It happened.",
		metadata: { i18n: { titleKey: "common:notifications.content.other.title" } },
	});
export function onManyThings(userIds: string[]) {
	return userIds.map((userId) => ({
		userId,
		organizationId: "org",
		type: "many",
		title: "Many",
		message: "Many.",
		metadata: i18nMetadata("k", "d", "k", "d"),
	}));
}
// Plumbing that copies a notification is not a creator.
function forward(notification: { title: string }, userId: string) {
	return { ...notification, userId, organizationId: "org", type: "x", title: notification.title, message: "m" };
}
`,
				],
			]),
		);

		expect(sites).toEqual([
			{ id: "lib/example/notify.ts::onThingHappened", hasKeys: false },
			{ id: "lib/example/notify.ts::onOtherThing", hasKeys: true },
			{ id: "lib/example/notify.ts::onManyThings", hasKeys: true },
		]);
	});

	it("does not count params without title or message keys as translation keys (#1152)", () => {
		const sites = scanNotificationCreators(
			new Map([
				[
					"lib/example/notify.ts",
					`
export async function onParamsOnly(userId: string) {
	await createNotification({
		userId,
		organizationId: "org",
		type: "params_only",
		title: "Params only",
		message: "Only data for the email.",
		metadata: { approvalSubject: "absence", i18n: { params: { days: 2 } } },
	});
}
`,
				],
			]),
		);

		expect(sites).toEqual([{ id: "lib/example/notify.ts::onParamsOnly", hasKeys: false }]);
	});

	it("finds direct pushes outside the notification module and direct notification inserts", () => {
		const sites = scanNotificationCreators(
			new Map([
				[
					"app/api/remind/route.ts",
					`
export async function POST() {
	await sendPushToUser(userId, { title: "Drink water", body: "Now." });
}
`,
				],
				[
					"app/api/remind-localized/route.ts",
					`
export async function POST() {
	await sendPushToUser(userId, { title: t("common:notifications.water.title", "Drink water") });
}
`,
				],
				[
					"lib/demo/seed.ts",
					`
export async function seedInbox(db: Database, values: unknown[]) {
	await db.insert(notification).values(values);
}
`,
				],
				[
					"lib/notifications/push-service.ts",
					`
export async function deliver() {
	await sendPushToUser(userId, payload);
}
`,
				],
			]),
		);

		expect(sites).toEqual([
			{ id: "app/api/remind/route.ts::POST", hasKeys: false },
			{ id: "app/api/remind-localized/route.ts::POST", hasKeys: true },
			{ id: "lib/demo/seed.ts::seedInbox", hasKeys: false },
		]);
	});

	it("counts a direct insert whose inserted row sets translation keys", () => {
		const sites = scanNotificationCreators(
			new Map([
				[
					"lib/demo/seed.ts",
					`
export async function seedKeyed(db: Database, userId: string) {
	const content = pendingContent();
	await db.insert(notification).values({
		userId,
		organizationId: "org",
		type: "approval_request_submitted",
		title: content.title,
		message: content.message,
		metadata: { i18n: content.i18n },
	});
}
export async function seedParamsOnly(db: Database, userId: string) {
	await db.insert(notification).values({
		userId,
		organizationId: "org",
		type: "approval_request_submitted",
		title: "Pending",
		message: "Pending.",
		metadata: { i18n: { params: { days: 2 } } },
	});
}
`,
				],
			]),
		);

		expect(sites).toEqual([
			{ id: "lib/demo/seed.ts::seedKeyed", hasKeys: true },
			{ id: "lib/demo/seed.ts::seedParamsOnly", hasKeys: false },
		]);
	});
});
