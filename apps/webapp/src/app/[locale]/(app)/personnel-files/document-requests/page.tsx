import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import {
	type DocumentRequestsSnapshot,
	DocumentRequestsTitle,
	DocumentRequestsWorkspace,
} from "@/components/personnel-file/document-requests-workspace";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
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

type DocumentRequestsPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function DocumentRequestsContent({ searchParams }: DocumentRequestsPageProps) {
	const [current, params] = await Promise.all([loadCurrentPersonnelFileAccess(), searchParams]);
	if (current.status !== "resolved" || !managesDocumentRequests(current.access)) notFound();
	const { access } = current;
	const now = systemClock.nowInstant();
	const filters = parseDocumentRequestOverviewParams(params);
	let snapshot: DocumentRequestsSnapshot | null = null;
	try {
		const [result, { today, timezone }, recipientOptions] = await Promise.all([
			listManagedDocumentRequests(db, access, filters, now),
			loadOrganizationDay(db, { organizationId: access.organizationId, now }),
			listDocumentRequestRecipientOptions(db, access, now),
		]);
		if (result.kind !== "ok") notFound();
		snapshot = {
			filters: { ...filters, page: result.page },
			rows: result.rows,
			pageCount: result.pageCount,
			today: today.toString(),
			timezone,
			recipientOptions,
		};
	} catch (error) {
		unstable_rethrow(error);
		// A failed read is never an empty queue. The current scope may retry the RSC owner.
	}
	const grants = access.grants.map((grant) => [
		grant.source,
		[...grant.categories].sort(),
		grant.scope.kind === "all"
			? "all"
			: [[...grant.scope.employeeIds].sort(), [...grant.scope.teamIds].sort()],
	]);
	return (
		<DocumentRequestsWorkspace
			key={JSON.stringify([access.userId, access.organizationId, access.selfEmployeeId, grants])}
			userId={access.userId}
			organizationId={access.organizationId}
			employeeId={access.selfEmployeeId}
			filterKey={JSON.stringify(filters)}
			snapshot={snapshot}
		/>
	);
}

function DocumentRequestsLoading() {
	return (
		<div className="@container/main flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
			<PageHeader title={<DocumentRequestsTitle />} />
			<LoadingRegion
				label={{
					labelKey: "settings.personnelFiles.requests.page.loading",
					labelDefault: "Loading document requests",
				}}
			>
				<Skeleton aria-hidden="true" className="h-16 w-full" />
				<Skeleton aria-hidden="true" className="mt-4 h-64 w-full" />
			</LoadingRegion>
		</div>
	);
}

export default function DocumentRequestsPage(props: DocumentRequestsPageProps) {
	return (
		<Suspense fallback={<DocumentRequestsLoading />}>
			<DocumentRequestsContent {...props} />
		</Suspense>
	);
}
