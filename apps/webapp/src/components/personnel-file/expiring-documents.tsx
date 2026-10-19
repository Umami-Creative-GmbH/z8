"use client";

import { IconCalendarExclamation, IconFileImport } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import type { ExpiryDescription } from "@/lib/expiry-reminders/expiry";
import { isDocumentRequestCategory } from "@/lib/personnel-file/document-request.types";
import type { ExpiringDocument } from "@/lib/personnel-file/expiry-store";
import { Link, useRouter } from "@/navigation";
import {
	CreateDocumentRequestDialog,
	type RenewedDocumentPrefill,
} from "./create-document-request-dialog";
import { usePersonnelFileLabels } from "./document-labels";

function ExpiryBadge({ expiry }: { expiry: ExpiryDescription }) {
	const { t } = useTranslate();
	if (expiry.status === "expired") {
		return (
			<Badge variant="destructive">
				{t(
					"settings.personnelFiles.expiring.expiredAgo",
					"Expired {days, plural, one {# day} other {# days}} ago",
					{ days: expiry.days },
				)}
			</Badge>
		);
	}
	if (expiry.status === "today") {
		return (
			<Badge variant="destructive">
				{t("settings.personnelFiles.expiring.today", "Expires today")}
			</Badge>
		);
	}
	return (
		<Badge variant="outline">
			{t(
				"settings.personnelFiles.expiring.inDays",
				"Expires in {days, plural, one {# day} other {# days}}",
				{ days: expiry.days },
			)}
		</Badge>
	);
}

function renewalOf(document: ExpiringDocument): RenewedDocumentPrefill | null {
	if (document.renewalRequested || !isDocumentRequestCategory(document.category)) return null;
	return {
		documentId: document.documentId,
		title: document.title,
		category: document.category,
		visibility: document.visibility,
	};
}

/**
 * Expiring documents (#869) in the Personnel files area: the documents the
 * viewer manages that expire within the organization's lead time or have
 * already expired, earliest first, each linking to the employee's file.
 * 'Request renewal' (#1404) asks the employee for its replacement with a
 * document request naming it; a document whose renewal is requested shows
 * that instead. The server re-checks coverage and the one active request per
 * document.
 */
export function ExpiringDocumentsCard({
	documents,
	leadDays,
	today,
}: {
	documents: readonly ExpiringDocument[];
	leadDays: number;
	/** The organization's today (`YYYY-MM-DD`): the earliest deadline. */
	today: string;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = usePersonnelFileLabels();
	const router = useRouter();
	const [renewing, setRenewing] = useState<{
		employeeId: string;
		renewal: RenewedDocumentPrefill;
	} | null>(null);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCalendarExclamation aria-hidden="true" className="size-5 text-muted-foreground" />
					{t("settings.personnelFiles.expiring.title", "Expiring documents")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.expiring.description",
						"Documents that expire within the next {days, plural, one {# day} other {# days}}, and documents that already expired.",
						{ days: leadDays },
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{documents.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("settings.personnelFiles.expiring.empty", "No documents are expiring.")}
					</p>
				) : (
					<ul className="divide-y rounded-md border">
						{documents.map((document) => {
							const renewal = renewalOf(document);
							return (
								<li
									key={document.documentId}
									className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap"
								>
									<Link
										href={`/personnel-files/${document.employeeId}`}
										className="min-w-0 flex-1 space-y-1 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="flex flex-wrap items-center gap-2">
											<span className="truncate font-medium">{document.title}</span>
											<Badge variant="secondary">{labels.categories[document.category]}</Badge>
										</span>
										<span className="block text-sm text-muted-foreground">
											{`${document.employeeName} · ${t(
												"settings.personnelFiles.list.expires",
												"Expires {date}",
												{ date: formatDateOnly(document.expiryDate, locale) },
											)}`}
										</span>
									</Link>
									<ExpiryBadge expiry={document.expiry} />
									{document.renewalRequested ? (
										<Badge variant="outline">
											{t("settings.personnelFiles.expiring.renewalRequested", "Renewal requested")}
										</Badge>
									) : renewal ? (
										<Button
											type="button"
											variant="outline"
											size="sm"
											aria-label={t(
												"settings.personnelFiles.expiring.requestRenewalFor",
												"Request a renewal of {title} ({employee})",
												{ title: document.title, employee: document.employeeName },
											)}
											onClick={() => setRenewing({ employeeId: document.employeeId, renewal })}
										>
											<IconFileImport aria-hidden="true" className="size-4" />
											{t("settings.personnelFiles.expiring.requestRenewal", "Request renewal")}
										</Button>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
			{renewing ? (
				<CreateDocumentRequestDialog
					key={renewing.renewal.documentId}
					open
					onOpenChange={(open) => {
						if (!open) setRenewing(null);
					}}
					employeeId={renewing.employeeId}
					categories={[renewing.renewal.category]}
					today={today}
					renewal={renewing.renewal}
					onCreated={() => router.refresh()}
				/>
			) : null}
		</Card>
	);
}
