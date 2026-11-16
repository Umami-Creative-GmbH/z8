"use client";

import { IconInbox, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { Link } from "@/navigation";
import { readPeriodSubmissionOverview } from "./actions";
import { PeriodSubmissionOverview } from "./period-submission-overview";
import type {
	PeriodSubmissionOverviewResult,
	PeriodSubmissionsAccess,
} from "./period-submissions-data";

export function PeriodSubmissionsLoading() {
	const { t } = useTranslate();
	return (
		<div className="space-y-4 p-4 md:p-6" aria-busy="true">
			<PageHeader title={t("team.periodSubmissions.title", "Period submissions")} />
			<p role="status" className="text-sm text-muted-foreground">
				{t("team.periodSubmissions.loading", "Loading period submissions")}
			</p>
		</div>
	);
}

/** Never admit retained session data while the session is still being reconciled. */
export function PeriodSubmissionsClient({
	access,
	requestedPeriod,
}: {
	access: PeriodSubmissionsAccess;
	requestedPeriod: string | null;
}) {
	const { data: session, isPending } = useSession();
	if (
		isPending ||
		session?.user.id !== access.userId ||
		session.session.activeOrganizationId !== access.organizationId
	)
		return <PeriodSubmissionsLoading />;
	return (
		<Workspace
			key={JSON.stringify([access.userId, access.organizationId, requestedPeriod])}
			access={access}
			requestedPeriod={requestedPeriod}
		/>
	);
}

function Workspace({
	access,
	requestedPeriod,
}: {
	access: PeriodSubmissionsAccess;
	requestedPeriod: string | null;
}) {
	const { t } = useTranslate();

	const [reader] = useState(() => createReader(access, requestedPeriod));
	const { result, failed, pending } = useSyncExternalStore(
		reader.subscribe,
		reader.snapshot,
		reader.initial,
	);
	useLayoutEffect(() => reader.activate(), [reader]);
	useViewRefresh(reader.read);
	const read = reader.read;
	const admitted = result?.status === "ok";
	return (
		<div
			className="@container/main flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6"
			aria-busy={pending}
		>
			<PageHeader
				title={t("team.periodSubmissions.title", "Period submissions")}
				scope={
					admitted
						? result.scope === "all"
							? t("team.periodSubmissions.scopeAll", "All covered employees")
							: t("team.periodSubmissions.scopeManaged", "Employees you manage")
						: undefined
				}
				description={t(
					"team.periodSubmissions.confirmationContext",
					"Submissions confirm records without freezing them. Changed records need resubmission. Review decisions in the approval inbox.",
				)}
				actions={
					admitted ? (
						<>
							<Button variant="outline" disabled={pending} onClick={() => void read()}>
								<IconRefresh aria-hidden="true" />
								{t("team.periodSubmissions.refresh", "Refresh submissions")}
							</Button>
							<Button asChild>
								<Link href="/approvals/inbox">
									<IconInbox aria-hidden="true" />
									{t("team.periodSubmissions.openInbox", "Open the approval inbox")}
								</Link>
							</Button>
						</>
					) : undefined
				}
			/>
			{failed ? (
				<Alert variant="destructive">
					<AlertDescription>
						<p>
							{t(
								"team.periodSubmissions.readFailed",
								"Could not load period submissions. Previously loaded records may be out of date.",
							)}
						</p>
						<Button variant="outline" disabled={pending} onClick={() => void read()}>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			) : null}
			{pending ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("team.periodSubmissions.loading", "Loading period submissions")}
				</p>
			) : null}
			{result?.status === "forbidden" ? (
				<p role="status">
					{t(
						"team.periodSubmissions.unavailable",
						"Period submissions are unavailable for your current access. Refresh to check access again.",
					)}
					<Button variant="outline" disabled={pending} onClick={() => void read()}>
						{t("common.retry", "Retry")}
					</Button>
				</p>
			) : null}
			{admitted ? (
				result.overview.kind === "off" ? (
					<section className="space-y-3 rounded-lg border bg-card p-6 text-sm">
						<p>
							{t(
								"team.periodSubmissions.off",
								"Your organization does not collect period submissions.",
							)}
						</p>
						{result.scope === "all" ? (
							<Link href="/settings/organization" className="underline underline-offset-4">
								{t(
									"team.periodSubmissions.chooseCadence",
									"Choose a submission cadence in the organization settings",
								)}
							</Link>
						) : null}
					</section>
				) : (
					<PeriodSubmissionOverview {...result.overview} />
				)
			) : null}
		</div>
	);
}

/** A route-local external read: Activity detachment invalidates every outstanding arrival. */
function createReader(access: PeriodSubmissionsAccess, requestedPeriod: string | null) {
	type Snapshot = {
		result: PeriodSubmissionOverviewResult | null;
		failed: boolean;
		pending: boolean;
	};
	const initial: Snapshot = { result: null, failed: false, pending: true };
	let state = initial;
	let lifetime: object | null = null;
	let operation: object | null = null;
	const listeners = new Set<() => void>();
	const publish = (next: Snapshot) => {
		state = next;
		for (const listener of listeners) listener();
	};
	const read = async () => {
		const arrival = lifetime;
		if (!arrival || operation) return;
		const token = {};
		operation = token;
		const current = () => lifetime === arrival && operation === token;
		publish({ ...state, pending: true });
		await runWithCleanup(
			async () => {
				try {
					const next = await readPeriodSubmissionOverview(requestedPeriod, {
						userId: access.userId,
						organizationId: access.organizationId,
					});
					if (!current()) return;
					publish(
						next.status === "unavailable"
							? { ...state, failed: true }
							: { ...state, result: next, failed: false },
					);
				} catch {
					if (current()) publish({ ...state, failed: true });
				}
			},
			() => {
				if (current()) {
					operation = null;
					publish({ ...state, pending: false });
				}
			},
		);
	};
	return {
		read,
		snapshot: () => state,
		initial: () => initial,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		activate: () => {
			lifetime = {};
			operation = null;
			publish(initial);
			void read();
			return () => {
				lifetime = null;
				operation = null;
			};
		},
	};
}
