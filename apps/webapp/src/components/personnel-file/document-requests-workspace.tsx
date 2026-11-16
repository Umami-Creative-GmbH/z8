"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";
import type { DocumentRequestRecipientOptions } from "@/lib/personnel-file/document-request-overview";
import { Link, useRouter } from "@/navigation";
import { BulkDocumentRequestsButton } from "./bulk-document-requests-dialog";
import {
	DocumentRequestsOverview,
	type DocumentRequestsOverviewProps,
} from "./document-requests-overview";

export type DocumentRequestsSnapshot = DocumentRequestsOverviewProps & {
	recipientOptions: DocumentRequestRecipientOptions;
};

/** RSC owns reads; this boundary keeps drafts on refresh and rejects other account/org arrivals. */
export function DocumentRequestsWorkspace({
	userId,
	organizationId,
	employeeId,
	filterKey,
	snapshot,
}: {
	userId: string;
	organizationId: string;
	employeeId: string | null;
	filterKey: string;
	snapshot: DocumentRequestsSnapshot | null;
}) {
	const { t } = useTranslate();
	const { matches, settled } = useRequestScope(userId, organizationId, employeeId);
	const { refresh } = useRouter();
	const data = useRetainedRequestSnapshot(snapshot, filterKey);
	const current = useRequestArrival(snapshot, matches, settled, refresh);

	return (
		<div className="@container/main flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
			<Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
				<Link href="/personnel-files">
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.area.title", "Personnel Files")}
				</Link>
			</Button>
			<PageHeader
				title={t("settings.personnelFiles.requests.page.title", "Document requests")}
				description={t(
					"settings.personnelFiles.requests.page.description",
					"The documents asked of the employees whose certificates or other documents you manage. A request is overdue when it is still open after its deadline.",
				)}
				scope={
					current && data
						? t(
								"settings.personnelFiles.requests.page.calendarScope",
								"Deadlines follow your organization's calendar · {timezone}",
								{ timezone: data.timezone },
							)
						: undefined
				}
				actions={
					current && data ? (
						<BulkDocumentRequestsButton options={data.recipientOptions} today={data.today} />
					) : undefined
				}
			/>
			{!current ? (
				matches && snapshot === null ? (
					<DocumentRequestsReadFailure hasRetained={false} />
				) : (
					<DocumentRequestsChecking />
				)
			) : (
				<>
					{!snapshot ? <DocumentRequestsReadFailure hasRetained={Boolean(data)} /> : null}
					{data ? (
						<DocumentRequestsOverview {...data} decisionsAvailable={snapshot !== null} />
					) : null}
				</>
			)}
		</div>
	);
}

export function DocumentRequestsChecking() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.requests.page.checking",
				labelDefault: "Checking document request access",
			}}
			className="min-h-32"
		/>
	);
}

export function DocumentRequestsTitle() {
	const { t } = useTranslate();
	return <>{t("settings.personnelFiles.requests.page.title", "Document requests")}</>;
}

function useRequestArrival(
	snapshot: DocumentRequestsSnapshot | null,
	matches: boolean,
	settled: boolean,
	refresh: () => void,
) {
	const [retired, setRetired] = useState<{ snapshot: DocumentRequestsSnapshot | null } | null>(
		null,
	);
	const connected = useRef(false);
	const latest = useRef(snapshot);
	useLayoutEffect(() => {
		latest.current = snapshot;
	}, [snapshot]);
	useLayoutEffect(() => {
		if (connected.current) {
			// Activity reconnects must obtain fresh server authority before exposing cached targets.
			setRetired({ snapshot: latest.current });
			refresh();
		}
		connected.current = true;
	}, [refresh]);

	if (settled && !matches && retired?.snapshot !== snapshot) setRetired({ snapshot });
	return matches && retired?.snapshot !== snapshot;
}

function DocumentRequestsReadFailure({ hasRetained }: { hasRetained: boolean }) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Alert>
			<AlertDescription className="space-y-3">
				<p>
					{hasRetained
						? t(
								"settings.personnelFiles.requests.page.refreshFailed",
								"Requests could not be refreshed. Previously loaded records are shown; retry before making a decision.",
							)
						: t(
								"settings.personnelFiles.requests.page.loadFailed",
								"Document requests could not be loaded. Try again.",
							)}
				</p>
				<Button
					variant="outline"
					disabled={pending}
					aria-busy={pending}
					onClick={() => startTransition(() => refresh())}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

function useRequestScope(userId: string, organizationId: string, employeeId: string | null) {
	const context = useOrganization();
	const session = useSession();
	const settled = !session.isPending && !context.isLoading;
	return {
		settled,
		matches:
			settled &&
			session.data?.user.id === userId &&
			session.data.session.activeOrganizationId === organizationId &&
			context.userId === userId &&
			context.activeOrganizationId === organizationId &&
			context.employeeId === employeeId,
	};
}

function useRetainedRequestSnapshot(snapshot: DocumentRequestsSnapshot | null, filterKey: string) {
	const [retained, setRetained] = useState({ source: snapshot, filterKey, snapshot });
	if (retained.source !== snapshot || retained.filterKey !== filterKey) {
		setRetained({
			source: snapshot,
			filterKey,
			snapshot: snapshot ?? (retained.filterKey === filterKey ? retained.snapshot : null),
		});
	}
	const data = snapshot ?? (retained.filterKey === filterKey ? retained.snapshot : null);

	return data;
}
