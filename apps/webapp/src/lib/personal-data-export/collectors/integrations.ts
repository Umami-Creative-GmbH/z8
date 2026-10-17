/**
 * Integrations category of a personal data export (#811, #1170): calendar
 * connections (provider and account), the employee's own calendar feeds,
 * linked Slack, Teams, Telegram and Discord accounts, whether a kiosk PIN is
 * set, the kiosk PIN attempts and unlocks its lockout is judged from
 * (#1288), and the employee's offline kiosk clockings Z8 refused (#1290). No
 * withheld data: both kinds of export hold the same rows.
 *
 * Never exported: calendar tokens and OAuth details, sync errors, synced
 * events, calendar feed secret digests, team feeds, PIN hashes, OAuth state,
 * link codes, chat conversations and bot messages.
 */

import { and, asc, eq } from "drizzle-orm";
import {
	calendarConnection,
	discordUserMapping,
	employeeKioskPin,
	employeeKioskPinEvent,
	icsFeed,
	kiosk,
	kioskFrozenRefusal,
	slackUserMapping,
	teamsUserMapping,
	telegramUserMapping,
} from "@/db/schema";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataRow,
	recordPart,
	tablePart,
} from "../collector";
import { instantText, loadSubjectEmployee, loadUserNames, nameOf } from "../values";
import { integrationsFieldGuide } from "./integrations-fields";

const CALENDAR_COLUMNS = [
	"provider",
	"account",
	"calendar_id",
	"is_active",
	"push_enabled",
	"conflict_detection_enabled",
	"last_sync_at",
	"created_at",
	"updated_at",
] as const;

const ICS_FEED_COLUMNS = [
	"is_active",
	"include_approved",
	"include_pending",
	"created_at",
	"last_used_at",
	"revoked_at",
] as const;

const KIOSK_PIN_EVENT_COLUMNS = ["event", "occurred_at", "offline"] as const;

const KIOSK_REFUSAL_COLUMNS = [
	"kiosk",
	"action",
	"claimed_at",
	"time_source",
	"reason",
	"refused_at",
] as const;

const CHAT_ACCOUNT_COLUMNS = [
	"platform",
	"account_id",
	"username",
	"display_name",
	"email",
	"workspace_id",
	"is_active",
	"linked_at",
	"last_seen_at",
] as const;

export const integrationsCollector: PersonalDataCollector = {
	category: "integrations",
	collect: collectIntegrations,
	fields: integrationsFieldGuide,
};

async function collectIntegrations(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	await loadSubjectEmployee(database, scope);

	const [calendars, feeds, { pin, pinSetters }, chatAccounts, pinEvents] = await Promise.all([
		database
			.select({
				provider: calendarConnection.provider,
				account: calendarConnection.providerAccountId,
				calendarId: calendarConnection.calendarId,
				isActive: calendarConnection.isActive,
				pushEnabled: calendarConnection.pushEnabled,
				conflictDetectionEnabled: calendarConnection.conflictDetectionEnabled,
				lastSyncAt: calendarConnection.lastSyncAt,
				createdAt: calendarConnection.createdAt,
				updatedAt: calendarConnection.updatedAt,
			})
			.from(calendarConnection)
			.where(
				and(
					eq(calendarConnection.organizationId, organizationId),
					eq(calendarConnection.employeeId, employeeId),
				),
			)
			.orderBy(asc(calendarConnection.createdAt), asc(calendarConnection.id)),

		database
			.select({
				includeApproved: icsFeed.includeApproved,
				includePending: icsFeed.includePending,
				createdAt: icsFeed.createdAt,
				lastUsedAt: icsFeed.lastUsedAt,
				revokedAt: icsFeed.revokedAt,
			})
			.from(icsFeed)
			.where(
				and(
					eq(icsFeed.organizationId, organizationId),
					eq(icsFeed.employeeId, employeeId),
					eq(icsFeed.feedType, "user"),
				),
			)
			.orderBy(asc(icsFeed.createdAt), asc(icsFeed.id)),
		(async () => {
			const [pin] = await database
				.select({
					updatedAt: employeeKioskPin.updatedAt,
					setByUserId: employeeKioskPin.setByUserId,
				})
				.from(employeeKioskPin)
				.where(
					and(
						eq(employeeKioskPin.organizationId, organizationId),
						eq(employeeKioskPin.employeeId, employeeId),
					),
				)
				.limit(1);
			const pinSetters = await loadUserNames(database, [pin?.setByUserId]);
			return { pin, pinSetters };
		})(),
		chatAccountRows(database, scope),
		database
			.select({
				kind: employeeKioskPinEvent.kind,
				occurredAt: employeeKioskPinEvent.occurredAt,
				offline: employeeKioskPinEvent.offline,
			})
			.from(employeeKioskPinEvent)
			.where(
				and(
					eq(employeeKioskPinEvent.organizationId, organizationId),
					eq(employeeKioskPinEvent.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeKioskPinEvent.occurredAt), asc(employeeKioskPinEvent.sequence)),
	]);
	const refusals = await kioskRefusalRows(database, scope);

	return {
		category: "integrations",
		parts: [
			tablePart(
				"calendar_connections",
				CALENDAR_COLUMNS,
				calendars.map((row) => ({
					provider: row.provider,
					account: row.account,
					calendar_id: row.calendarId,
					is_active: row.isActive,
					push_enabled: row.pushEnabled,
					conflict_detection_enabled: row.conflictDetectionEnabled,
					last_sync_at: instantText(row.lastSyncAt),
					created_at: instantText(row.createdAt),
					updated_at: instantText(row.updatedAt),
				})),
			),
			tablePart(
				"ics_feeds",
				ICS_FEED_COLUMNS,
				feeds.map((row) => ({
					is_active: row.revokedAt === null,
					include_approved: row.includeApproved,
					include_pending: row.includePending,
					created_at: instantText(row.createdAt),
					last_used_at: instantText(row.lastUsedAt),
					revoked_at: instantText(row.revokedAt),
				})),
			),
			tablePart("chat_accounts", CHAT_ACCOUNT_COLUMNS, chatAccounts),
			recordPart("kiosk_pin", {
				pin_set: Boolean(pin),
				set_at: instantText(pin?.updatedAt),
				set_by: nameOf(pinSetters, pin?.setByUserId),
			}),
			tablePart(
				"kiosk_pin_events",
				KIOSK_PIN_EVENT_COLUMNS,
				pinEvents.map((row) => ({
					event: row.kind,
					occurred_at: instantText(row.occurredAt),
					offline: row.offline,
				})),
			),
			tablePart(
				"kiosk_refused_clockings",
				KIOSK_REFUSAL_COLUMNS,
				refusals.map((row) => ({
					kiosk: row.kiosk,
					action: row.action,
					claimed_at: instantText(row.claimedAt),
					time_source: row.timeSource,
					reason: row.reason,
					refused_at: instantText(row.refusedAt),
				})),
			),
		],
	};
}

/** The employee's refused offline kiosk clockings (#1290); the frozen command is not exported. */
function kioskRefusalRows(database: PersonalDataExportDatabase, scope: PersonalDataExportScope) {
	return database
		.select({
			kiosk: kiosk.name,
			action: kioskFrozenRefusal.action,
			claimedAt: kioskFrozenRefusal.claimedAt,
			timeSource: kioskFrozenRefusal.timeSource,
			reason: kioskFrozenRefusal.reason,
			refusedAt: kioskFrozenRefusal.refusedAt,
		})
		.from(kioskFrozenRefusal)
		.innerJoin(
			kiosk,
			and(
				eq(kiosk.id, kioskFrozenRefusal.kioskId),
				eq(kiosk.organizationId, kioskFrozenRefusal.organizationId),
			),
		)
		.where(
			and(
				eq(kioskFrozenRefusal.organizationId, scope.organizationId),
				eq(kioskFrozenRefusal.employeeId, scope.employeeId),
			),
		)
		.orderBy(asc(kioskFrozenRefusal.claimedAt), asc(kioskFrozenRefusal.id));
}

/** The user's linked chat accounts in this organization: Slack, Teams, Telegram, Discord. */
async function chatAccountRows(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<PersonalDataRow[]> {
	const { organizationId, userId } = scope;
	const [slack, teams, telegram, discord] = await Promise.all([
		database
			.select()
			.from(slackUserMapping)
			.where(
				and(
					eq(slackUserMapping.organizationId, organizationId),
					eq(slackUserMapping.userId, userId),
				),
			)
			.orderBy(asc(slackUserMapping.createdAt)),
		database
			.select()
			.from(teamsUserMapping)
			.where(
				and(
					eq(teamsUserMapping.organizationId, organizationId),
					eq(teamsUserMapping.userId, userId),
				),
			)
			.orderBy(asc(teamsUserMapping.createdAt)),
		database
			.select()
			.from(telegramUserMapping)
			.where(
				and(
					eq(telegramUserMapping.organizationId, organizationId),
					eq(telegramUserMapping.userId, userId),
				),
			)
			.orderBy(asc(telegramUserMapping.createdAt)),
		database
			.select()
			.from(discordUserMapping)
			.where(
				and(
					eq(discordUserMapping.organizationId, organizationId),
					eq(discordUserMapping.userId, userId),
				),
			)
			.orderBy(asc(discordUserMapping.createdAt)),
	]);

	const times = (row: { isActive: boolean; createdAt: Date; lastSeenAt: Date | null }) => ({
		is_active: row.isActive,
		linked_at: instantText(row.createdAt),
		last_seen_at: instantText(row.lastSeenAt),
	});
	return [
		...slack.map((row) => ({
			platform: "slack",
			account_id: row.slackUserId,
			username: row.slackUsername,
			display_name: row.slackDisplayName,
			email: null,
			workspace_id: row.slackTeamId,
			...times(row),
		})),
		...teams.map((row) => ({
			platform: "teams",
			account_id: row.teamsUserId,
			username: row.teamsUserPrincipalName,
			display_name: row.teamsDisplayName,
			email: row.teamsEmail,
			workspace_id: row.teamsTenantId,
			...times(row),
		})),
		...telegram.map((row) => ({
			platform: "telegram",
			account_id: row.telegramUserId,
			username: row.telegramUsername,
			display_name: row.telegramDisplayName,
			email: null,
			workspace_id: null,
			...times(row),
		})),
		...discord.map((row) => ({
			platform: "discord",
			account_id: row.discordUserId,
			username: row.discordUsername,
			display_name: row.discordDisplayName,
			email: null,
			workspace_id: null,
			...times(row),
		})),
	];
}
