import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, kiosk, kioskFrozenRefusal } from "@/db/schema";
import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { KioskFrozenAction, KioskFrozenRefusalReason } from "./frozen-command";
import { buildKioskFrozenRefusalNotification } from "./frozen-refusal-notification";
import type {
	KioskFrozenRefusal,
	KioskFrozenRefusalLedger,
	RecordedKioskFrozenRefusal,
} from "./frozen-refusals";

type RefusalClient = Pick<typeof db, "select" | "insert">;

const logger = createLogger("KioskFrozenRefusals");

const displayName = (row: { firstName: string | null; lastName: string | null; name: string }) =>
	buildDerivedUserName(row.firstName ?? "", row.lastName ?? "", row.name);

/**
 * Tells the employee about their refused command, or, for a kiosk-only
 * employee, their managers (`createNotification` forwards it, #860). Nobody is
 * told about a command naming no employee of the organization; owners and
 * admins still see it in the kiosk settings.
 */
export async function notifyKioskFrozenRefusal(
	refusal: KioskFrozenRefusal,
	options: {
		client?: Pick<typeof db, "select">;
		send?: (notification: CreateNotificationParams) => Promise<unknown>;
	} = {},
): Promise<void> {
	if (!refusal.employee) return;
	const client = options.client ?? db;
	const [[device], [person]] = await Promise.all([
		client
			.select({ name: kiosk.name, timezone: kiosk.timezone })
			.from(kiosk)
			.where(and(eq(kiosk.id, refusal.kioskId), eq(kiosk.organizationId, refusal.organizationId)))
			.limit(1),
		client
			.select({
				email: user.email,
				name: user.name,
				firstName: user.firstName,
				lastName: user.lastName,
			})
			.from(user)
			.where(eq(user.id, refusal.employee.userId))
			.limit(1),
	]);
	if (!device || !person) return;
	await (options.send ?? createNotification)(
		buildKioskFrozenRefusalNotification({
			organizationId: refusal.organizationId,
			kioskId: refusal.kioskId,
			operationId: refusal.operationId,
			userId: refusal.employee.userId,
			kioskName: device.name,
			kioskTimezone: device.timezone,
			employeeName: displayName(person),
			action: refusal.action,
			claimedAt: refusal.claimedAt,
			reason: refusal.reason,
			// A kiosk-only employee (ADR 0006) sees no channel; their managers read it.
			recipient: isReservedEmail(person.email) ? "managers" : "employee",
		}),
	);
}

/**
 * The refusal ledger of frozen kiosk commands (#1290) on PostgreSQL: one row
 * per organization, kiosk and operation. A refusal is recorded once; recording
 * it again (a concurrent resend judged twice) keeps the first and tells nobody
 * again. Only a newly recorded refusal notifies, and a failed notification
 * never undoes the record.
 */
export function createKioskFrozenRefusalLedger(
	deps: { client?: RefusalClient; notify?: (refusal: KioskFrozenRefusal) => Promise<void> } = {},
): KioskFrozenRefusalLedger {
	const client = deps.client ?? db;
	const notify = deps.notify ?? ((refusal) => notifyKioskFrozenRefusal(refusal, { client }));
	return {
		async recall({ organizationId, kioskId, operationId }) {
			const [row] = await client
				.select({
					reason: kioskFrozenRefusal.reason,
					detail: kioskFrozenRefusal.detail,
					command: kioskFrozenRefusal.command,
				})
				.from(kioskFrozenRefusal)
				.where(
					and(
						eq(kioskFrozenRefusal.organizationId, organizationId),
						eq(kioskFrozenRefusal.kioskId, kioskId),
						eq(kioskFrozenRefusal.operationId, operationId),
					),
				)
				.limit(1);
			if (!row) return null;
			return {
				reason: row.reason as KioskFrozenRefusalReason,
				detail: row.detail ?? {},
				command: row.command,
			} satisfies RecordedKioskFrozenRefusal;
		},

		async record(refusal) {
			const inserted = await client
				.insert(kioskFrozenRefusal)
				.values({
					organizationId: refusal.organizationId,
					kioskId: refusal.kioskId,
					operationId: refusal.operationId,
					employeeId: refusal.employee?.id ?? null,
					action: refusal.action,
					claimedAt: dateFromInstant(refusal.claimedAt),
					timeSource: refusal.timeSource,
					reason: refusal.reason,
					detail: refusal.detail,
					command: refusal.command,
					refusedAt: dateFromInstant(refusal.refusedAt),
				})
				.onConflictDoNothing({
					target: [
						kioskFrozenRefusal.organizationId,
						kioskFrozenRefusal.kioskId,
						kioskFrozenRefusal.operationId,
					],
				})
				.returning({ id: kioskFrozenRefusal.id });
			if (inserted.length === 0) return;
			try {
				await notify(refusal);
			} catch (error) {
				logger.error(
					{ error, operationId: refusal.operationId, kioskId: refusal.kioskId },
					"Could not notify about a refused kiosk command",
				);
			}
		},
	};
}

/** A refused frozen kiosk command as owners and admins see it in the kiosk settings. */
export type ListedKioskFrozenRefusal = {
	id: string;
	kioskId: string;
	kioskName: string;
	kioskTimezone: string;
	/** Null when the command named no employee of the organization. */
	employeeName: string | null;
	action: KioskFrozenAction;
	claimedAt: Date;
	timeSource: string;
	reason: KioskFrozenRefusalReason;
	refusedAt: Date;
};

export const KIOSK_FROZEN_REFUSAL_LIST_LIMIT = 200;

/** The organization's refused frozen kiosk commands, newest refusal first. */
export async function listKioskFrozenRefusals(
	client: Pick<typeof db, "select">,
	input: { organizationId: string; limit?: number },
): Promise<ListedKioskFrozenRefusal[]> {
	const rows = await client
		.select({
			id: kioskFrozenRefusal.id,
			kioskId: kioskFrozenRefusal.kioskId,
			kioskName: kiosk.name,
			kioskTimezone: kiosk.timezone,
			userName: user.name,
			userFirstName: user.firstName,
			userLastName: user.lastName,
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
		.leftJoin(
			employee,
			and(
				eq(employee.id, kioskFrozenRefusal.employeeId),
				eq(employee.organizationId, kioskFrozenRefusal.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(eq(kioskFrozenRefusal.organizationId, input.organizationId))
		.orderBy(desc(kioskFrozenRefusal.refusedAt), desc(kioskFrozenRefusal.id))
		.limit(input.limit ?? KIOSK_FROZEN_REFUSAL_LIST_LIMIT);
	return rows.map((row) => ({
		id: row.id,
		kioskId: row.kioskId,
		kioskName: row.kioskName,
		kioskTimezone: row.kioskTimezone,
		employeeName:
			row.userName === null
				? null
				: displayName({
						firstName: row.userFirstName,
						lastName: row.userLastName,
						name: row.userName,
					}),
		action: row.action as KioskFrozenAction,
		claimedAt: row.claimedAt,
		timeSource: row.timeSource,
		reason: row.reason as KioskFrozenRefusalReason,
		refusedAt: row.refusedAt,
	}));
}
