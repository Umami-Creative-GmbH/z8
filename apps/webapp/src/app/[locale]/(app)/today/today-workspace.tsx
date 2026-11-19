"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useOrganization } from "@/hooks/use-organization";
import { useSession } from "@/lib/auth-client";
import { readTodayBriefing } from "./actions";
import { TodayBriefing } from "./today-briefing";
import { TodayDecisionReservations } from "./today-decision-reservations";
import { TodayPageLoading } from "./today-loading";
import type { TodayArrival, TodayScope, TodayView } from "./today-types";

export function TodayWorkspace({ scope, initial }: { scope: TodayScope; initial: TodayArrival }) {
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
	const view = {
		...scope,
		employeeId: organization.employeeId,
		role: organization.role,
	};
	// Published display identity retires evidence; the fresh server read still owns access.
	if (
		!invalidated &&
		(status !== "ready" ||
			identity !== initialIdentity ||
			(initial.status === "ready" && !sameTodayView(initial.view, view)))
	)
		setInvalidated(true);
	if (status === "context-error") return <TodayContextError retry={organization.refetch} />;
	if (status !== "ready") return <TodayPageLoading />;
	return (
		<TodayDecisionReservations scope={scope}>
			<ScopedTodayWorkspace
				key={identity}
				scope={scope}
				initial={invalidated ? undefined : initial}
				view={view}
				recheckAccess={organization.refetch}
			/>
		</TodayDecisionReservations>
	);
}

type DisplayView = TodayScope & { employeeId: string | null; role: string | null };
function sameTodayView(producer: TodayView, display: DisplayView) {
	return (
		producer.userId === display.userId &&
		producer.organizationId === display.organizationId &&
		producer.employeeId === display.employeeId &&
		producer.role === display.role
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
		<div className="page-frame space-y-4">
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

function ScopedTodayWorkspace({
	scope,
	initial,
	view: { employeeId, role },
	recheckAccess,
}: {
	scope: TodayScope;
	initial?: TodayArrival;
	view: DisplayView;
	recheckAccess: () => Promise<void>;
}) {
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
			const result = await readTodayBriefing({ userId, organizationId });
			if (!active.current || request !== generation.current) return;
			const next: TodayArrival =
				result.status === "ready" &&
				!sameTodayView(result.view, { userId, organizationId, employeeId, role })
					? { status: "unavailable" }
					: result;
			setReadFailed(next.status === "error");
			setArrival((previous) =>
				next.status === "error" && previous?.status === "ready" ? previous : next,
			);
		} catch {
			if (!active.current || request !== generation.current) return;
			setReadFailed(true);
		}
		if (active.current && request === generation.current) {
			pending.current = false;
			setRefreshing(false);
		}
	}, [userId, organizationId, employeeId, role]);
	const retry = async () => {
		await recheckAccess();
		await refresh();
	};
	useEffect(() => {
		active.current = true;
		generation.current++;
		if (!firstActivation.current || !hasInitial) {
			setArrival(undefined);
			void refresh();
		}
		firstActivation.current = false;
		return () => {
			active.current = false;
			pending.current = false;
		};
	}, [hasInitial, refresh]);
	useViewRefresh(refresh);
	if (!arrival && !readFailed) return <TodayPageLoading />;
	if (arrival?.status !== "ready")
		return (
			<div className="page-frame space-y-4">
				<PageHeader title={t("today.briefing.title", "Manager Daily Briefing")} />
				<p role="alert">
					{arrival?.status === "unavailable"
						? t(
								"today.briefing.accessUnavailable",
								"This briefing is unavailable for the current employee and organization.",
							)
						: t("today.briefing.loadFailed", "Could not load the briefing. Try again.")}
				</p>
				<Button type="button" variant="outline" disabled={refreshing} onClick={() => void retry()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	return (
		<TodayBriefing
			briefing={arrival.briefing}
			isRefreshing={refreshing}
			onRetry={() => void retry()}
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
