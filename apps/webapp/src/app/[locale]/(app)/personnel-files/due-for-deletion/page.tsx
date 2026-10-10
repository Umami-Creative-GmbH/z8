import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DueForDeletionList } from "@/components/personnel-file/due-for-deletion-list";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/**
 * Due for deletion (#870): employee documents past their retention period in
 * the viewer's scope and categories, purged only after the officer confirms.
 * Not found without personnel file access and while personnel files are off.
 */
async function DueForDeletionContent() {
	const [t, current] = await Promise.all([getTranslate(), loadCurrentPersonnelFileAccess()]);
	if (current.status !== "resolved" || !managesAnyDocuments(current.access)) notFound();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Button asChild variant="ghost" size="sm" className="-ml-2">
					<Link href="/personnel-files">
						<IconArrowLeft aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.area.title", "Personnel Files")}
					</Link>
				</Button>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.personnelFiles.due.title", "Due for deletion")}
				</h1>
				<p className="max-w-prose text-muted-foreground">
					{t(
						"settings.personnelFiles.due.description",
						"Documents of former employees whose retention period has passed. They stay until you confirm their purge; leave a document here to keep it.",
					)}
				</p>
			</header>
			<DueForDeletionList />
		</div>
	);
}

function DueForDeletionLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.due.loading",
				labelDefault: "Loading documents due for deletion",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-32 w-full" />
		</LoadingRegion>
	);
}

export default function DueForDeletionPage() {
	return (
		<Suspense fallback={<DueForDeletionLoading />}>
			<DueForDeletionContent />
		</Suspense>
	);
}
