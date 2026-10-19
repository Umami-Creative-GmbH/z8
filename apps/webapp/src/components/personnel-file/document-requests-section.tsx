"use client";

import { IconFilePlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { listEmployeeDocumentRequestsAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	DOCUMENT_REQUEST_CATEGORIES,
	type DocumentRequestCategory,
} from "@/lib/personnel-file/document-request.types";
import type { PersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { queryKeys } from "@/lib/query/keys";
import { CreateDocumentRequestDialog } from "./create-document-request-dialog";
import { DocumentRequestList } from "./document-request-list";
import { DocumentRequestOfficerActions } from "./document-request-officer-actions";

/**
 * The requests section of one employee's personnel file (#1401), for whoever
 * covers the employee's certificates or other documents: their requests with
 * status and history, create, and edit and cancel (#1403,
 * `DocumentRequestOfficerActions`). Nothing for anyone else; the
 * server decides what is listed. A former employee's file offers no new
 * request (the server refuses one with `former_employee`).
 */
export function DocumentRequestsSection({
	capability,
	former = false,
}: {
	capability: PersonnelFilePanelCapability;
	/** The employee's employment has ended. */
	former?: boolean;
}) {
	const categories = DOCUMENT_REQUEST_CATEGORIES.filter((category) =>
		capability.categories.includes(category),
	);
	if (categories.length === 0) return null;
	return <DocumentRequestsCard capability={capability} categories={categories} former={former} />;
}

function DocumentRequestsCard({
	capability,
	categories,
	former,
}: {
	capability: PersonnelFilePanelCapability;
	categories: DocumentRequestCategory[];
	former: boolean;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const employeeId = capability.employeeId;

	const query = useQuery({
		queryKey: queryKeys.personnelFile.employeeDocumentRequests(employeeId),
		queryFn: async () => {
			const result = await listEmployeeDocumentRequestsAction({ employeeId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	function refresh() {
		void queryClient.invalidateQueries({ queryKey: queryKeys.personnelFile.documentRequestsAll() });
	}

	return (
		<Card>
			<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
				<div className="space-y-1.5">
					<CardTitle>{t("settings.personnelFiles.requests.title", "Document requests")}</CardTitle>
					<CardDescription>
						{t(
							"settings.personnelFiles.requests.description",
							"Certificates and other documents asked of this employee, with their deadline and history.",
						)}
					</CardDescription>
				</div>
				{former ? null : (
					<Button type="button" onClick={() => setCreating(true)}>
						<IconFilePlus aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.requests.create.open", "Request a document")}
					</Button>
				)}
			</CardHeader>
			<CardContent>
				{query.isPending ? (
					<div className="space-y-2" aria-busy="true">
						<Skeleton className="h-16 w-full" />
					</div>
				) : query.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.personnelFiles.requests.loadFailed",
							"The document requests could not be loaded.",
						)}
					</p>
				) : query.data.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("settings.personnelFiles.requests.empty", "No documents requested yet.")}
					</p>
				) : (
					<DocumentRequestList
						requests={query.data}
						timezone={capability.timezone}
						actions={(request) => (
							<DocumentRequestOfficerActions
								request={request}
								today={capability.today}
								onChanged={refresh}
							/>
						)}
					/>
				)}
			</CardContent>
			<CreateDocumentRequestDialog
				open={creating && !former}
				onOpenChange={setCreating}
				employeeId={employeeId}
				categories={categories}
				today={capability.today}
				onCreated={refresh}
			/>
		</Card>
	);
}
