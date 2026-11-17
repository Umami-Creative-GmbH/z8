"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useOrganization } from "@/hooks/use-organization";
import { useSession } from "@/lib/auth-client";
import { sortActionItems } from "@/lib/manager-daily-briefing/logic";
import type {
	BriefingActionItem,
	BriefingSection,
	ManagerDailyBriefing,
} from "@/lib/manager-daily-briefing/types";
import { readTodayBriefing } from "./actions";
import { TodayBriefing } from "./today-briefing";
import { TodayPageLoading } from "./today-loading";
import type { TodayArrival, TodayScope } from "./today-types";

export function TodayWorkspace({
	scope,
	initial,
	initialEmployee,
}: {
	scope: TodayScope;
	initial: TodayArrival;
	initialEmployee: { id: string; role: string };
}) {
	const session = useSession();
	const organization = useOrganization();
	const identity = JSON.stringify([
		scope.userId,
		scope.organizationId,
		session.data?.session.id,
		organization.userId,
		organization.activeOrganizationId,
		organization.employeeId,
		organization.role,
	]);
	const [initialIdentity] = useState(identity);
	const [invalidated, setInvalidated] = useState(false);
	const status = todayViewStatus(scope, session, organization);
	// Published display identity retires evidence; the fresh server read still owns access.
	if (
		!invalidated &&
		(status !== "ready" ||
			identity !== initialIdentity ||
			organization.employeeId !== initialEmployee.id ||
			organization.role !== initialEmployee.role)
	)
		setInvalidated(true);
	if (status === "context-error") return <TodayContextError retry={organization.refetch} />;
	if (status !== "ready") return <TodayPageLoading />;
	return (
		<ScopedTodayWorkspace
			key={identity}
			scope={scope}
			initial={invalidated ? undefined : initial}
		/>
	);
}

function todayViewStatus(
	scope: TodayScope,
	session: ReturnType<typeof useSession>,
	organization: ReturnType<typeof useOrganization>,
) {
	if (
		session.isPending ||
		session.data?.user.id !== scope.userId ||
		session.data.session.activeOrganizationId !== scope.organizationId
	)
		return "loading";
	if (organization.error) return "context-error";
	if (
		organization.isLoading ||
		organization.userId !== scope.userId ||
		organization.activeOrganizationId !== scope.organizationId
	)
		return "loading";
	return "ready";
}

function TodayContextError({ retry }: { retry: () => Promise<void> }) {
	const { t } = useTranslate();
	const [pending, startRetry] = useTransition();
	return (
		<div className="space-y-4 p-4 md:p-6">
			<PageHeader title={t("today.briefing.title", "Manager Daily Briefing")} />
			<p role="alert">
				{t("today.briefing.contextFailed", "Could not check your current access. Try again.")}
			</p>
			<Button type="button" variant="outline" disabled={pending} onClick={() => startRetry(retry)}>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}

function ScopedTodayWorkspace({ scope, initial }: { scope: TodayScope; initial?: TodayArrival }) {
	const { t } = useTranslate();
	const { userId, organizationId } = scope;
	// Server props seed this arrival once. Combined refresh uses the registered reader;
	// a parallel RSC merge must not restart it or discard its retained evidence.
	const [hasInitial] = useState(initial !== undefined);
	const [arrival, setArrival] = useState<TodayArrival | undefined>(initial);
	const [refreshing, setRefreshing] = useState(false);
	const [readFailed, setReadFailed] = useState(false);
	const active = useRef(false);
	const generation = useRef(0);
	const firstActivation = useRef(true);
	const pending = useRef(false);
	const refresh = useCallback(async () => {
		if (!active.current || pending.current) return;
		pending.current = true;
		const request = ++generation.current;
		setRefreshing(true);
		try {
			const next = await readTodayBriefing({ userId, organizationId });
			if (!active.current || request !== generation.current) return;
			setReadFailed(next.status === "error");
			setArrival((previous) =>
				next.status === "error" && previous?.status === "ready"
					? previous
					: next.status === "ready" && previous?.status === "ready"
						? { status: "ready", briefing: retainFailedSections(previous.briefing, next.briefing) }
						: next,
			);
		} catch {
			if (!active.current || request !== generation.current) return;
			setReadFailed(true);
		}
		if (active.current && request === generation.current) {
			pending.current = false;
			setRefreshing(false);
		}
	}, [userId, organizationId]);
	useEffect(() => {
		active.current = true;
		if (!firstActivation.current || !hasInitial) {
			setArrival(undefined);
			void refresh();
		}
		firstActivation.current = false;
		return () => {
			active.current = false;
			generation.current++;
			pending.current = false;
		};
	}, [hasInitial, refresh]);
	useViewRefresh(refresh);
	if (!arrival && !readFailed) return <TodayPageLoading />;
	if (arrival?.status !== "ready")
		return (
			<div className="space-y-4 p-4 md:p-6">
				<PageHeader title={t("today.briefing.title", "Manager Daily Briefing")} />
				<p role="alert">
					{arrival?.status === "unavailable"
						? t(
								"today.briefing.accessUnavailable",
								"This briefing is unavailable for the current employee and organization.",
							)
						: t("today.briefing.loadFailed", "Could not load the briefing. Try again.")}
				</p>
				<Button
					type="button"
					variant="outline"
					disabled={refreshing}
					onClick={() => void refresh()}
				>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	return (
		<TodayBriefing
			briefing={arrival.briefing}
			isRefreshing={refreshing}
			onRetry={() => void refresh()}
			onDecision={() => void refresh()}
			readError={
				readFailed
					? t(
							"today.briefing.refreshFailed",
							"Could not refresh. Previous results are shown; try again before acting.",
						)
					: undefined
			}
		/>
	);
}

/** Retain only same-arrival evidence for failed readers; their error remains visible. */
function retainFailedSections(
	previous: ManagerDailyBriefing,
	next: ManagerDailyBriefing,
): ManagerDailyBriefing {
	const retain = <T extends BriefingActionItem>(
		before: BriefingSection<T>,
		after: BriefingSection<T>,
	): BriefingSection<T> => (after.error ? { ...after, items: before.items } : after);
	const sections = {
		approvals: retain(previous.sections.approvals, next.sections.approvals),
		attendance: retain(previous.sections.attendance, next.sections.attendance),
		absences: retain(previous.sections.absences, next.sections.absences),
		coverage: retain(previous.sections.coverage, next.sections.coverage),
		overtime: retain(previous.sections.overtime, next.sections.overtime),
		payroll: retain(previous.sections.payroll, next.sections.payroll),
	};
	const failedCategories = new Set(
		Object.values(next.sections)
			.filter((section) => section.error)
			.flatMap((section) =>
				previous.sections[section.id as keyof typeof sections].items.map((item) => item.category),
			),
	);
	if (next.needsActionError) failedCategories.add("driving");
	return {
		...next,
		sections,
		needsAction: sortActionItems([
			...next.needsAction,
			...previous.needsAction.filter((item) => failedCategories.has(item.category)),
		]),
	};
}
