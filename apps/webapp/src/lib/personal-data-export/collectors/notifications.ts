/**
 * Notifications category of a personal data export (#811, #1170): the
 * in-app notifications the employee's user received in this organization,
 * exported as received (rendered text unchanged, also when it names
 * colleagues). Idempotency keys and delivery or digest records are technical
 * and never exported. No withheld data: both kinds of export hold the same rows.
 */

import { and, asc, eq } from "drizzle-orm";
import { notification } from "@/db/schema";
import { type PersonalDataCollector, tablePart } from "../collector";
import { instantText } from "../values";
import { notificationsFieldGuide } from "./notifications-fields";

const NOTIFICATION_COLUMNS = [
	"type",
	"title",
	"message",
	"entity_type",
	"entity_id",
	"action_url",
	"is_read",
	"read_at",
	"metadata",
	"created_at",
] as const;

export const notificationsCollector: PersonalDataCollector = {
	category: "notifications",
	fields: notificationsFieldGuide,
	async collect(database, scope) {
		const rows = await database
			.select({
				type: notification.type,
				title: notification.title,
				message: notification.message,
				entityType: notification.entityType,
				entityId: notification.entityId,
				actionUrl: notification.actionUrl,
				isRead: notification.isRead,
				readAt: notification.readAt,
				metadata: notification.metadata,
				createdAt: notification.createdAt,
			})
			.from(notification)
			.where(
				and(
					eq(notification.organizationId, scope.organizationId),
					eq(notification.userId, scope.userId),
				),
			)
			.orderBy(asc(notification.createdAt), asc(notification.id));

		return {
			category: "notifications",
			parts: [
				tablePart(
					"notifications",
					NOTIFICATION_COLUMNS,
					rows.map((row) => ({
						type: row.type,
						title: row.title,
						message: row.message,
						entity_type: row.entityType,
						entity_id: row.entityId,
						action_url: row.actionUrl,
						is_read: row.isRead,
						read_at: instantText(row.readAt),
						metadata: row.metadata,
						created_at: instantText(row.createdAt),
					})),
				),
			],
		};
	},
};
