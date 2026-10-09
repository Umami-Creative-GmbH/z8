"use client";

import { IconCalendarExclamation } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import type { ExpiryDescription } from "@/lib/personnel-file/expiry";
import type { ExpiringDocument } from "@/lib/personnel-file/expiry-store";
import { Link } from "@/navigation";
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

/**
 * Expiring documents (#869) in the Personnel files area: the documents the
 * viewer manages that expire within the organization's lead time or have
 * already expired, earliest first, each linking to the employee's file.
 */
export function ExpiringDocumentsCard({
	documents,
	leadDays,
}: {
	documents: readonly ExpiringDocument[];
	leadDays: number;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = usePersonnelFileLabels();

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
						{documents.map((document) => (
							<li key={document.documentId}>
								<Link
									href={`/personnel-files/${document.employeeId}`}
									className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:flex-nowrap"
								>
									<span className="min-w-0 flex-1 space-y-1">
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
									</span>
									<ExpiryBadge expiry={document.expiry} />
								</Link>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
