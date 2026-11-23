"use server";

import { Effect } from "effect";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import {
	absenceDays,
	completedWorkPeriods,
	countClockedIn,
	countIncompleteSetup,
	countOpenViolations,
	countStaleLiveWork,
	countTeams,
	countUsersSignedIn,
	isEmptyScope,
	manualEntryShare,
	organizationWindows,
	rosterMovement,
	settle,
	statisticsScope,
	trackingCoverage,
	workedMinutes,
} from "./statistics-reads";
import type {
	AdoptionStatistics,
	AttentionStatistics,
	MonthStatistics,
	StatisticsScopeLabel,
	WorkforceStatistics,
} from "./statistics-types";

/**
 * Every statistics read is a scoped-manager read (#1938): an org admin and a
 * workforce admin read the whole organization, a manager the teams whose
 * settings they manage. Each group is its own action so it loads and fails on
 * its own, and each KPI inside settles on its own.
 */

/** Whom the figures cover, and when they were read. */
export const getStatisticsScope = organizationAction(
	{ name: "statistics.getScope", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* statisticsScope(actor, organizationId);
			const label: StatisticsScopeLabel = scope.organizationWide
				? { organizationWide: true }
				: { organizationWide: false, teamCount: scope.teamIds.length };
			return {
				scope: label,
				fetchedAt: instantToCanonicalString(systemClock.nowInstant()),
			};
		}),
);

export const getAttentionStatistics = organizationAction(
	{ name: "statistics.getAttention", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const now = systemClock.nowInstant();
			const scope = yield* statisticsScope(actor, organizationId);
			if (isEmptyScope(scope)) {
				return { staleLiveWork: zero(0), openViolations: zero(0) } satisfies AttentionStatistics;
			}
			const windows = yield* organizationWindows(organizationId, now);
			return {
				staleLiveWork: yield* settle(countStaleLiveWork(scope, now)),
				openViolations: yield* settle(countOpenViolations(scope, windows.current)),
			} satisfies AttentionStatistics;
		}),
);

export const getMonthStatistics = organizationAction(
	{ name: "statistics.getMonth", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const now = systemClock.nowInstant();
			const [scope, windows] = yield* Effect.all([
				statisticsScope(actor, organizationId),
				organizationWindows(organizationId, now),
			]);
			const comparison = {
				firstDay: windows.previous.firstDay.toString(),
				lastDay: windows.previous.lastDay.toString(),
			};
			if (isEmptyScope(scope)) {
				const none = zero({ current: 0, previous: 0 });
				return {
					comparison,
					workedMinutes: none,
					absenceDays: none,
					completedWorkPeriods: none,
				} satisfies MonthStatistics;
			}
			return {
				comparison,
				workedMinutes: yield* settle(workedMinutes(scope, windows)),
				absenceDays: yield* settle(absenceDays(scope, windows)),
				completedWorkPeriods: yield* settle(completedWorkPeriods(scope, windows)),
			} satisfies MonthStatistics;
		}),
);

export const getAdoptionStatistics = organizationAction(
	{ name: "statistics.getAdoption", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const now = systemClock.nowInstant();
			const scope = yield* statisticsScope(actor, organizationId);
			if (isEmptyScope(scope)) {
				return {
					coverage: zero({ tracked: 0, expected: 0 }),
					clockedIn: zero(0),
					manualEntryShare: zero({ manualMinutes: 0, totalMinutes: 0 }),
				} satisfies AdoptionStatistics;
			}
			const windows = yield* organizationWindows(organizationId, now);
			return {
				coverage: yield* settle(trackingCoverage(scope, windows.current)),
				clockedIn: yield* settle(countClockedIn(scope)),
				manualEntryShare: yield* settle(manualEntryShare(scope, windows.current)),
			} satisfies AdoptionStatistics;
		}),
);

export const getWorkforceStatistics = organizationAction(
	{ name: "statistics.getWorkforce", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const now = systemClock.nowInstant();
			const scope = yield* statisticsScope(actor, organizationId);
			// "Users signed in" is an org-admin figure; a workforce admin and a manager never get it.
			const usersSignedIn = meetsSettingsAccess(actor.settingsAccess, "orgAdmin")
				? { usersSignedIn: yield* settle(countUsersSignedIn(organizationId, now)) }
				: {};
			if (isEmptyScope(scope)) {
				return {
					roster: zero({ roster: 0, joined: 0, left: 0 }),
					teams: zero(0),
					incompleteSetup: zero(0),
					...usersSignedIn,
				} satisfies WorkforceStatistics;
			}
			const windows = yield* organizationWindows(organizationId, now);
			return {
				roster: yield* settle(rosterMovement(scope, windows.current)),
				teams: yield* settle(countTeams(scope)),
				incompleteSetup: yield* settle(countIncompleteSetup(scope, now)),
				...usersSignedIn,
			} satisfies WorkforceStatistics;
		}),
);

/** A known value for a scope that reaches nobody. */
function zero<T>(value: T) {
	return { status: "ok" as const, value };
}
