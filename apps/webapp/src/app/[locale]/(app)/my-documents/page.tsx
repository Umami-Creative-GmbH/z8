import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MyDocumentsList } from "@/components/personnel-file/my-documents-list";
import { MyDocumentsRetry } from "@/components/personnel-file/my-documents-retry";
import { MyDocumentsScope } from "@/components/personnel-file/my-documents-scope";
import { MyDocumentsUpload } from "@/components/personnel-file/my-documents-upload";
import { RequestedDocuments } from "@/components/personnel-file/requested-documents";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { loadOwnUploadCapability } from "@/lib/personnel-file/panel";
import { getTranslate } from "@/tolgee/server";
import { getMyDocumentsAction } from "../personnel-files/actions";
import { getMyDocumentRequestsAction } from "../personnel-files/document-request-actions";

/**
 * My documents (#865): the signed-in employee's shared employee documents.
 * Unavailable (not found) while personnel files are off, and for anyone
 * without a current employee profile, former employees included. Employees
 * upload certificates and other documents here (#867) and see what officers
 * requested from them (#1401).
 */
async function MyDocumentsContent() {
	const [t, result, uploadCapability, requests, current] = await Promise.all([
		getTranslate(),
		getMyDocumentsAction(),
		loadOwnUploadCapability(),
		getMyDocumentRequestsAction(),
		loadCurrentPersonnelFileAccess(),
	]);
	if (current.status !== "resolved" || !uploadCapability) notFound();

	return (
		<MyDocumentsScope
			key={`${current.access.userId}:${current.access.organizationId}:${uploadCapability.employeeId}`}
			userId={current.access.userId}
			organizationId={current.access.organizationId}
			employeeId={uploadCapability.employeeId}
		>
			<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-8">
				<PageHeader
					title={t("settings.personnelFiles.myDocuments.title", "My Documents")}
					description={t(
						"settings.personnelFiles.myDocuments.description",
						"Documents from your personnel file that your organization shared with you.",
					)}
				/>
				{requests.success ? (
					<RequestedDocuments requests={requests.data} capability={uploadCapability} />
				) : (
					<MyDocumentsRetry />
				)}
				{result.success ? (
					<MyDocumentsList
						documents={result.data}
						actions={<MyDocumentsUpload capability={uploadCapability} />}
					/>
				) : (
					<MyDocumentsRetry />
				)}
			</div>
		</MyDocumentsScope>
	);
}

function MyDocumentsLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.myDocuments.loading",
				labelDefault: "Loading your documents",
			}}
			className="@container/main page-frame flex flex-1 flex-col gap-6"
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
