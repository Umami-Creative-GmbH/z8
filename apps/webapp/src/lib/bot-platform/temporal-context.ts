import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import { type Clock, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { DisplayContext } from "@/lib/datetime/temporal-format";
import { serializeInstant } from "@/lib/datetime/temporal-wire";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { resolveEffectiveTimezone } from "../timezone/effective-timezone";
import { normalizeTimeFormat, type TimeFormat } from "../user-preferences/time-format";

export interface BotTemporalContext extends DisplayContext {
	effectiveTimezone: string;
	organizationTimezone: string;
	now: Instant;
	clock: Clock;
}

export interface BotTemporalContextPayload {
	effectiveTimezone: string;
	organizationTimezone: string;
	locale: string;
	timeFormat: TimeFormat;
	now: string;
}

interface ResolveBotTemporalContextInput {
	userId: string;
	employeeId: string;
	organizationId: string;
	clock?: Clock;
}

/**
 * Resolves the temporal data for an authenticated bot member. The employee
 * lookup is intentionally organization-scoped before preferences are read.
 */
export async function resolveBotTemporalContext(
	input: ResolveBotTemporalContextInput,
): Promise<BotTemporalContext | null> {
	const member = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.employeeId),
			eq(employee.userId, input.userId),
			eq(employee.organizationId, input.organizationId),
		),
		columns: { id: true },
	});

	if (!member) return null;

	const [organizationData, settings] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.id, input.organizationId),
			columns: { timezone: true },
		}),
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, input.userId),
			columns: { timezone: true, locale: true, timeFormat: true },
		}),
	]);

	if (!organizationData) return null;

	const organizationTimezone = resolveEffectiveTimezone(undefined, organizationData.timezone);
	const effectiveTimezone = resolveEffectiveTimezone(settings?.timezone, organizationTimezone);
	const locale =
		settings?.locale && ALL_LANGUAGES.includes(settings.locale)
			? settings.locale
			: DEFAULT_LANGUAGE;
	const clock = input.clock ?? systemClock;

	return {
		effectiveTimezone,
		organizationTimezone,
		locale,
		timezone: effectiveTimezone,
		timeFormat: normalizeTimeFormat(settings?.timeFormat) as TimeFormat,
		now: clock.nowInstant(),
		clock,
	};
}

/** Converts the internal Temporal context into a JSON-safe external payload. */
export function serializeBotTemporalContext(
	context: BotTemporalContext,
): BotTemporalContextPayload {
	return {
		effectiveTimezone: context.effectiveTimezone,
		organizationTimezone: context.organizationTimezone,
		locale: context.locale,
		timeFormat: context.timeFormat,
		now: serializeInstant(context.now),
	};
}
