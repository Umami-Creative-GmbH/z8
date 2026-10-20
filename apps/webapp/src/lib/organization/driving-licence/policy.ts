import "server-only";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import {
	drivingLicencePolicy,
	drivingLicencePolicyRevision,
} from "@/db/schema/driving-licence-policy";
import { drivingLicenceReminderDelivery } from "@/db/schema/driving-licence-reminders";
import {
	dateFromInstant,
	type Instant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import {
	collectDrivingLicenceReactivationSuspensions,
	deliverDrivingLicenceOccasion,
	readDrivingLicenceOffPeriods,
} from "./reminders";
import { reconcileDrivingLicenceTasks } from "./tasks";
import type {
	DrivingLicenceDatabase,
	DrivingLicenceTransaction,
} from "./verifiers";

const intervalMonthsInput = z.number().int().min(1).max(120);
/** An explicit IANA zone (or UTC); deadlines never follow the viewer's zone. */
const deadlineTimezoneInput = z
	.string()
	.max(100)
	.refine((zone) => {
		try {
			Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(zone);
			return zone.includes("/") || zone === "UTC";
		} catch {
			return false;
		}
	});
/**
 * The policy tab's form. It never switches control on or off: the Features switch is the only
 * activation (#1421), and the form saves only while control is on.
 */
export const drivingLicencePolicyInput = z.strictObject({
	intervalMonths: intervalMonthsInput,
	timezone: deadlineTimezoneInput,
	reminderLeadDays: z
		.array(z.number().int().min(0).max(365))
		.min(1)
		.max(12)
		.refine((days) => new Set(days).size === days.length),
	retentionMonths: z.number().int().min(1).max(120).nullable(),
	retentionJustification: z.string().trim().max(2000).nullable(),
});
export type DrivingLicencePolicyInput = z.infer<
	typeof drivingLicencePolicyInput
>;
export async function readDrivingLicencePolicy(organizationId: string) {
	const [policy] = await db
		.select()
		.from(drivingLicencePolicy)
		.where(eq(drivingLicencePolicy.organizationId, organizationId));
	return policy ?? null;
}
export async function saveDrivingLicencePolicy(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = drivingLicencePolicyInput.parse(raw);
	return db.transaction(async (tx) => {
		// Serialize configuration with checks, reports and lifecycle transitions.
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const [previous] = await tx
			.select()
			.from(drivingLicencePolicy)
			.where(eq(drivingLicencePolicy.organizationId, actor.organizationId));
		// Saved only while control is on; switching is the Features card's job.
		if (!previous?.enabled) throw new Error("not_enabled");
		const policy = { ...input, enabled: true };
		// Once established, a finite policy survives deactivation and cannot be erased.
		if (
			previous?.retentionMonths &&
			(policy.retentionMonths === null ||
				(policy.retentionJustification?.length ?? 0) < 10)
		)
			throw new Error("retention_required");
		if (previous && previous.intervalMonths !== policy.intervalMonths)
			throw new Error("interval_preview_required");
		if (previous && previous.timezone !== policy.timezone)
			throw new Error("timezone_fixed");
		const now = systemClock.nowInstant();
		await materializeExpiredDrivingAuthorizations(
			tx,
			actor.organizationId,
			now,
		);
		await writeDrivingLicencePolicy(tx, actor, previous, policy, now);
		return policy;
	});
}

type DrivingLicencePolicyRow = typeof drivingLicencePolicy.$inferSelect;
type DrivingLicencePolicyValues =
	typeof drivingLicencePolicyRevision.$inferSelect.policy;

/** Writes the next policy version and its append-only revision. Caller holds the organization lock. */
async function writeDrivingLicencePolicy(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	previous: DrivingLicencePolicyRow | undefined,
	policy: DrivingLicencePolicyValues,
	now: Instant,
) {
	const changedAt = dateFromInstant(now);
	const version = (previous?.version ?? 0) + 1;
	await tx
		.insert(drivingLicencePolicy)
		.values({
			...policy,
			organizationId: actor.organizationId,
			version,
			updatedAt: changedAt,
			updatedBy: actor.userId,
		})
		.onConflictDoUpdate({
			target: drivingLicencePolicy.organizationId,
			set: {
				...policy,
				version,
				updatedAt: changedAt,
				updatedBy: actor.userId,
			},
		});
	await tx.insert(drivingLicencePolicyRevision).values({
		organizationId: actor.organizationId,
		version,
		policy,
		changedAt,
		changedBy: actor.userId,
	});
}

function policyValues(row: DrivingLicencePolicyRow): DrivingLicencePolicyValues {
	return {
		enabled: row.enabled,
		intervalMonths: row.intervalMonths,
		timezone: row.timezone,
		reminderLeadDays: row.reminderLeadDays,
		retentionMonths: row.retentionMonths,
		retentionJustification: row.retentionJustification,
	};
}

/** Reminder lead times a first activation starts with; admins change them on the policy tab. */
export const DRIVING_LICENCE_DEFAULT_REMINDER_LEAD_DAYS = [30, 7];

/** What the first switch-on asks for: activation needs a justified, finite retention period. */
export const drivingLicenceSetupInput = z.strictObject({
	intervalMonths: intervalMonthsInput,
	timezone: deadlineTimezoneInput,
	retentionMonths: z.number().int().min(1).max(120),
	retentionJustification: z.string().trim().min(10).max(2000),
});
export type DrivingLicenceSetupInput = z.infer<typeof drivingLicenceSetupInput>;

export const drivingLicenceSwitchInput = z.strictObject({
	enabled: z.boolean(),
	/** Only read when no usable policy exists yet; a saved policy is reused as it is. */
	setup: z.unknown().optional(),
});

export type DrivingLicenceFeatureState = {
	/** The policy's enabled value: the feature's single on/off. */
	enabled: boolean;
	/** True until a policy with a justified retention period exists. */
	setupRequired: boolean;
	/** Interval and fixed deadline timezone of an existing policy, for prefilling setup. */
	savedSetup: { intervalMonths: number; timezone: string } | null;
};

/** The Features card's view of driving licence control. */
export async function readDrivingLicenceFeatureState(
	organizationId: string,
): Promise<DrivingLicenceFeatureState> {
	const policy = await readDrivingLicencePolicy(organizationId);
	return {
		enabled: policy?.enabled ?? false,
		setupRequired: !policy || policy.retentionMonths === null,
		savedSetup: policy
			? { intervalMonths: policy.intervalMonths, timezone: policy.timezone }
			: null,
	};
}

export type DrivingLicenceSwitchResult = {
	enabled: boolean;
	/** True when this switch-on created the organization's usable policy. */
	firstActivation: boolean;
};

/**
 * The only activation of driving licence control (#1421), used by the Features switch.
 * Switching on creates the policy from `setup` the first time and reuses the saved
 * policy afterwards; switching off keeps every record and only stops reminders and tasks.
 */
export async function switchDrivingLicenceControl(
	actor: DrivingLicenceActor,
	raw: unknown,
): Promise<DrivingLicenceSwitchResult> {
	const input = drivingLicenceSwitchInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const [previous] = await tx
			.select()
			.from(drivingLicencePolicy)
			.where(eq(drivingLicencePolicy.organizationId, actor.organizationId));
		const now = systemClock.nowInstant();
		if (!input.enabled) {
			await deactivateDrivingLicenceControl(tx, actor, previous, now);
			return { enabled: false, firstActivation: false };
		}
		if (previous?.enabled) return { enabled: true, firstActivation: false };
		if (!previous || previous.retentionMonths === null) {
			await activateDrivingLicenceControlFirstTime(
				tx,
				actor,
				previous,
				input.setup,
				now,
			);
			return { enabled: true, firstActivation: true };
		}
		await reactivateDrivingLicenceControl(tx, actor, previous, now);
		return { enabled: true, firstActivation: false };
	});
}

async function activateDrivingLicenceControlFirstTime(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	previous: DrivingLicencePolicyRow | undefined,
	rawSetup: unknown,
	now: Instant,
) {
	if (rawSetup === undefined) throw new Error("setup_required");
	const parsed = drivingLicenceSetupInput.safeParse(rawSetup);
	if (!parsed.success) throw new Error("invalid_setup");
	const setup = parsed.data;
	// The deadline timezone is fixed from the first save, as before (#1311).
	if (previous && previous.timezone !== setup.timezone)
		throw new Error("timezone_fixed");
	// A saved policy without retention was never active (the activation check needs
	// retention, which can't be cleared afterwards), so no check or authorization
	// depends on its interval yet.
	await writeDrivingLicencePolicy(
		tx,
		actor,
		previous,
		{
			enabled: true,
			intervalMonths: setup.intervalMonths,
			timezone: setup.timezone,
			reminderLeadDays:
				previous?.reminderLeadDays ?? DRIVING_LICENCE_DEFAULT_REMINDER_LEAD_DAYS,
			retentionMonths: setup.retentionMonths,
			retentionJustification: setup.retentionJustification,
		},
		now,
	);
}

/** When the current off period began, or null when control is on or was never on. */
async function readSwitchedOffAt(
	database: DrivingLicenceDatabase,
	organizationId: string,
) {
	const periods = await readDrivingLicenceOffPeriods(database, organizationId);
	const last = periods.at(-1);
	return last && last.onAt === null ? last.offAt : null;
}

/**
 * Switching on again reuses the saved policy unchanged and settles what changed while
 * off (#1422), inside the same locked transaction: authorizations whose deadline or
 * expiry passed are suspended, and each gets exactly one suspension notice to the
 * employee and their responsible verifiers. Reminder occasions that fell while off are
 * skipped by the reminder job (`reminderOccasionFellWhileOff`), not caught up.
 */
async function reactivateDrivingLicenceControl(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	previous: DrivingLicencePolicyRow,
	now: Instant,
) {
	const offAt = await readSwitchedOffAt(tx, actor.organizationId);
	await materializeExpiredDrivingAuthorizations(tx, actor.organizationId, now);
	await writeDrivingLicencePolicy(
		tx,
		actor,
		previous,
		{ ...policyValues(previous), enabled: true },
		now,
	);
	const settled = await collectDrivingLicenceReactivationSuspensions(
		tx,
		actor.organizationId,
		offAt,
		now,
	);
	for (const occasion of settled) {
		// Ordered writes on the switch-on transaction connection.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		await deliverDrivingLicenceOccasion(tx, occasion, now);
	}
}

export type DrivingLicenceReactivationImpact = {
	/** Authorizations the switch-on suspends, each with one suspension notice. */
	suspendedAuthorizations: number;
};

/**
 * Read-only count for the switch-on confirmation (#1422): the same selection the
 * switch-on settles. Zero while control is on or before its first activation.
 */
export async function readDrivingLicenceReactivationImpact(
	organizationId: string,
): Promise<DrivingLicenceReactivationImpact> {
	const policy = await readDrivingLicencePolicy(organizationId);
	if (!policy || policy.enabled || policy.retentionMonths === null)
		return { suspendedAuthorizations: 0 };
	const settled = await collectDrivingLicenceReactivationSuspensions(
		db,
		organizationId,
		await readSwitchedOffAt(db, organizationId),
		systemClock.nowInstant(),
	);
	return { suspendedAuthorizations: settled.length };
}

/**
 * Switching off keeps intended drivers, verifier grants, records, authorizations and
 * the retention period; deadlines keep running and evidence cleanup continues. It
 * stops reminders and tasks: open tasks become obsolete and unsent reminder emails
 * are dropped, so nothing from before the switch-off is delivered later.
 */
async function deactivateDrivingLicenceControl(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
	previous: DrivingLicencePolicyRow | undefined,
	now: Instant,
) {
	if (!previous?.enabled) return;
	await materializeExpiredDrivingAuthorizations(tx, actor.organizationId, now);
	await writeDrivingLicencePolicy(
		tx,
		actor,
		previous,
		{ ...policyValues(previous), enabled: false },
		now,
	);
	await reconcileDrivingLicenceTasks(tx, actor.organizationId, now);
	await tx
		.update(drivingLicenceReminderDelivery)
		.set({ emailState: "obsolete" })
		.where(
			and(
				eq(drivingLicenceReminderDelivery.organizationId, actor.organizationId),
				eq(drivingLicenceReminderDelivery.emailState, "pending"),
			),
		);
}
