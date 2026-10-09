import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MyDocumentsList } from "@/components/personnel-file/my-documents-list";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import { getMyDocumentsAction } from "../personnel-files/actions";

/**
 * My documents (#865): the signed-in employee's shared employee documents.
 * Unavailable (not found) while personnel files are off, and for anyone
 * without a current employee profile, former employees included.
 */
async function MyDocumentsContent() {
	const [t, result] = await Promise.all([getTranslate(), getMyDocumentsAction()]);
	if (!result.success) notFound();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.personnelFiles.myDocuments.title", "My Documents")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.personnelFiles.myDocuments.description",
						"Documents from your personnel file that your organization shared with you.",
					)}
				</p>
			</header>
			<MyDocumentsList documents={result.data} />
		</div>
	);
}

function MyDocumentsLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.myDocuments.loading",
				labelDefault: "Loading your documents",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
		</LoadingRegion>
	);
}

export default function MyDocumentsPage() {
	return (
		<Suspense fallback={<MyDocumentsLoading />}>
			<MyDocumentsContent />
		</Suspense>
	);
}
