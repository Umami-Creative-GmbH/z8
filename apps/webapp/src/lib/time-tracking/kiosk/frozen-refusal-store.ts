import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, kiosk, kioskFrozenRefusal } from "@/db/schema";
import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import {
	type Clock,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { KioskTimeSource } from "../clocking/types";
import type { KioskFrozenAction, KioskFrozenRefusalReason } from "./frozen-command";
import { buildKioskFrozenRefusalNotification } from "./frozen-refusal-notification";
import type {
	KioskFrozenRefusalLedger,
	KioskFrozenRefusalNotice,
	RecordedKioskFrozenRefusal,
} from "./frozen-refusals";

type RefusalClient = Pick<typeof db, "select" | "insert" | "update">;

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
	refusal: KioskFrozenRefusalNotice,
	options: {
		client?: Pick<typeof db, "select">;
		send?: (notification: CreateNotificationParams) => Promise<unknown>;
	} = {},
): Promise<void> {
	if (!refusal.employee) return;
	const client = options.client ?? db;
	const [[device], [person]] = await Promise.all([
		client
			.select({ name: kiosk.name })
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
			timezone: refusal.timezone,
			employeeName: displayName(person),
			action: refusal.action,
			claimedAt: refusal.claimedAt,
			reason: refusal.reason,
			// A kiosk-only employee (ADR 0006) sees no channel; their managers read it.
			recipient: isReservedEmail(person.email) ? "managers" : "employee",
		}),
	);
}

/** The refusal's notification could not be handed over; it is sent again when the kiosk asks. */
export class KioskRefusalNotificationError extends Error {
	constructor(cause: unknown) {
		super("Could not notify about a refused kiosk command", { cause });
	}
}

/**
 * The refusal ledger of frozen kiosk commands (#1290) on PostgreSQL: one row
 * per organization, kiosk and operation. A refusal is recorded once; recording
 * it again (a concurrent resend judged twice) keeps the first and tells nobody
 * again.
 *
 * Nobody may walk away believing they clocked, so the notification is owed
 * until it was handed over (`notified_at`): a failed one never undoes the
 * record, but answers the kiosk `unknown`, and every later question of the
 * kiosk about the command (a resend or its lookup, `recall`) sends it again
 * before answering. The notification's idempotency key keeps a retry that
 * races another from telling anyone twice.
 */
export function createKioskFrozenRefusalLedger(
	deps: {
		client?: RefusalClient;
		notify?: (refusal: KioskFrozenRefusalNotice) => Promise<void>;
		clock?: Clock;
	} = {},
): KioskFrozenRefusalLedger {
	const client = deps.client ?? db;
	const clock = deps.clock ?? systemClock;
	const notify = deps.notify ?? ((refusal) => notifyKioskFrozenRefusal(refusal, { client }));
	const recordKey = (
		refusal: Pick<KioskFrozenRefusalNotice, "organizationId" | "kioskId" | "operationId">,
	) =>
		and(
			eq(kioskFrozenRefusal.organizationId, refusal.organizationId),
			eq(kioskFrozenRefusal.kioskId, refusal.kioskId),
			eq(kioskFrozenRefusal.operationId, refusal.operationId),
		);

	/** Hands the owed notification over and marks it sent; throws when it cannot. */
	async function deliver(refusal: KioskFrozenRefusalNotice) {
		try {
			await notify(refusal);
		} catch (error) {
			logger.error(
				{ error, operationId: refusal.operationId, kioskId: refusal.kioskId },
				"Could not notify about a refused kiosk command",
			);
			throw new KioskRefusalNotificationError(error);
		}
		await client
			.update(kioskFrozenRefusal)
			.set({ notifiedAt: dateFromInstant(clock.nowInstant()) })
			.where(and(recordKey(refusal), isNull(kioskFrozenRefusal.notifiedAt)));
	}

	return {
		async recall({ organizationId, kioskId, operationId }) {
			const [row] = await client
				.select({
					reason: kioskFrozenRefusal.reason,
					detail: kioskFrozenRefusal.detail,
					command: kioskFrozenRefusal.command,
					action: kioskFrozenRefusal.action,
					claimedAt: kioskFrozenRefusal.claimedAt,
					timezone: kioskFrozenRefusal.timezone,
					notifiedAt: kioskFrozenRefusal.notifiedAt,
					employeeId: employee.id,
					userId: employee.userId,
				})
				.from(kioskFrozenRefusal)
				.leftJoin(
					employee,
					and(
						eq(employee.id, kioskFrozenRefusal.employeeId),
						eq(employee.organizationId, kioskFrozenRefusal.organizationId),
					),
				)
				.where(recordKey({ organizationId, kioskId, operationId }))
				.limit(1);
			if (!row) return null;
			if (row.notifiedAt === null) {
				await deliver({
					organizationId,
					kioskId,
					operationId,
					employee:
						row.employeeId && row.userId ? { id: row.employeeId, userId: row.userId } : null,
					action: row.action,
					claimedAt: instantFromDate(row.claimedAt),
					timezone: row.timezone,
					reason: row.reason,
				});
			}
			return {
				reason: row.reason,
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
					timezone: refusal.timezone,
					timeSource: refusal.timeSource,
					reason: refusal.reason,
					detail: refusal.detail,
					command: refusal.command,
					refusedAt: dateFromInstant(refusal.refusedAt),
					// Nobody to tell about a command naming no employee of the organization.
					notifiedAt: refusal.employee ? null : dateFromInstant(refusal.refusedAt),
				})
				.onConflictDoNothing({
					target: [
						kioskFrozenRefusal.organizationId,
						kioskFrozenRefusal.kioskId,
						kioskFrozenRefusal.operationId,
					],
				})
				.returning({ id: kioskFrozenRefusal.id });
			if (inserted.length === 0 || !refusal.employee) return;
			await deliver(refusal);
		},
	};
}

/** A refused frozen kiosk command as owners and admins see it in the kiosk settings. */
export type ListedKioskFrozenRefusal = {
	id: string;
	kioskId: string;
	kioskName: string;
	/** Null when the command named no employee of the organization. */
	employeeName: string | null;
	action: KioskFrozenAction;
	claimedAt: Date;
	/** The zone the kiosk recorded the command in; the claimed time is shown in it. */
	timezone: string;
	timeSource: KioskTimeSource;
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
			userName: user.name,
			userFirstName: user.firstName,
			userLastName: user.lastName,
			action: kioskFrozenRefusal.action,
			claimedAt: kioskFrozenRefusal.claimedAt,
			timezone: kioskFrozenRefusal.timezone,
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
		employeeName:
			row.userName === null
				? null
				: displayName({
						firstName: row.userFirstName,
						lastName: row.userLastName,
						name: row.userName,
					}),
		action: row.action,
		claimedAt: row.claimedAt,
		timezone: row.timezone,
		timeSource: row.timeSource,
		reason: row.reason,
		refusedAt: row.refusedAt,
	}));
}
