import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BulkDocumentRequestsButton } from "@/components/personnel-file/bulk-document-requests-dialog";
import { DocumentRequestsOverview } from "@/components/personnel-file/document-requests-overview";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { managesDocumentRequests } from "@/lib/personnel-file/access";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { parseDocumentRequestOverviewParams } from "@/lib/personnel-file/document-request-overview";
import {
	listDocumentRequestRecipientOptions,
	listManagedDocumentRequests,
} from "@/lib/personnel-file/document-request-store";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

type DocumentRequestsPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Document requests (#1403): every request the viewer covers as an officer,
 * across employees (owners and admins: all, except on their own file), with
 * status and overdue filters; overdue is read in the organization's calendar.
 * Not found without coverage of certificates or other documents and while
 * personnel files are off. The header's bulk create (#1407) asks several
 * employees and teams for the same document at once.
 */
async function DocumentRequestsContent({ searchParams }: DocumentRequestsPageProps) {
	const [t, current, params] = await Promise.all([
		getTranslate(),
		loadCurrentPersonnelFileAccess(),
		searchParams,
	]);
	if (current.status !== "resolved" || !managesDocumentRequests(current.access)) notFound();
	const { access } = current;
	const now = systemClock.nowInstant();
	const filters = parseDocumentRequestOverviewParams(params);
	const [result, { today, timezone }, recipientOptions] = await Promise.all([
		listManagedDocumentRequests(db, access, filters, now),
		loadOrganizationDay(db, { organizationId: access.organizationId, now }),
		listDocumentRequestRecipientOptions(db, access, now),
	]);
	if (result.kind !== "ok") notFound();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Button asChild variant="ghost" size="sm" className="-ml-2">
					<Link href="/personnel-files">
						<IconArrowLeft aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.area.title", "Personnel Files")}
					</Link>
				</Button>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.personnelFiles.requests.page.title", "Document requests")}
					</h1>
					<BulkDocumentRequestsButton options={recipientOptions} today={today.toString()} />
				</div>
				<p className="max-w-prose text-muted-foreground">
					{t(
						"settings.personnelFiles.requests.page.description",
						"The documents asked of the employees whose certificates or other documents you manage. A request is overdue when it is still open after its deadline.",
					)}
				</p>
			</header>
			<DocumentRequestsOverview
				filters={{ ...filters, page: result.page }}
				rows={result.rows}
				pageCount={result.pageCount}
				today={today.toString()}
				timezone={timezone}
			/>
		</div>
	);
}

function DocumentRequestsLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.requests.page.loading",
				labelDefault: "Loading document requests",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function DocumentRequestsPage(props: DocumentRequestsPageProps) {
	return (
		<Suspense fallback={<DocumentRequestsLoading />}>
			<DocumentRequestsContent {...props} />
		</Suspense>
	);
}
