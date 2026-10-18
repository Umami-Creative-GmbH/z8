"use client";

import { IconAlertTriangle, IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant, localeDefaultTimeFormat } from "@/lib/datetime/temporal-format";
import type {
	DocumentRequestEventView,
	DocumentRequestView,
} from "@/lib/personnel-file/document-request.types";
import { personnelDocumentUrl, usePersonnelFileLabels } from "./document-labels";
import { useDocumentRequestLabels } from "./document-request-labels";

type Labels = ReturnType<typeof useDocumentRequestLabels>;

function statusVariant(request: DocumentRequestView) {
	if (request.overdue) return "destructive" as const;
	if (request.status === "open" || request.status === "submitted") return "default" as const;
	return "secondary" as const;
}

function HistoryEntry({
	event,
	labels,
	timezone,
}: {
	event: DocumentRequestEventView;
	labels: Labels;
	timezone: string;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const at = formatInstant(
		parseInstant(event.occurredAt),
		{ locale, timezone, timeFormat: localeDefaultTimeFormat(locale) },
		"dateTimeMedium",
	);
	const reason = event.reasonCode ? labels.reasonCodes[event.reasonCode] : event.reason;
	return (
		<li className="space-y-0.5">
			<p>
				<span className="font-medium">{labels.events[event.kind]}</span>
				<span className="text-muted-foreground">
					{" · "}
					{at}
					{event.actorName ? ` · ${event.actorName}` : null}
				</span>
			</p>
			{event.changes?.deadline ? (
				<p className="text-muted-foreground">
					{t("settings.personnelFiles.requests.history.deadlineChanged", "Deadline {from} → {to}", {
						from: formatDateOnly(event.changes.deadline.from, locale),
						to: formatDateOnly(event.changes.deadline.to, locale),
					})}
				</p>
			) : null}
			{event.changes?.noteChanged ? (
				<p className="text-muted-foreground">
					{t("settings.personnelFiles.requests.history.noteChanged", "Note changed")}
				</p>
			) : null}
			{reason ? <p className="whitespace-pre-line text-muted-foreground">{reason}</p> : null}
		</li>
	);
}

/**
 * Document requests with their status, deadline, note, submissions and
 * history (#1307), for the employee's Requested documents and an employee's
 * file in the officer area. The server decided what is listed and which
 * documents the viewer may see.
 */
export function DocumentRequestList({
	requests,
	timezone,
	actions,
	subject,
}: {
	requests: readonly DocumentRequestView[];
	/** The organization's timezone: history times are shown in it. */
	timezone: string;
	actions?: (request: DocumentRequestView) => ReactNode;
	/** Whose request it is, above its title (the officer page across employees, #1403). */
	subject?: (request: DocumentRequestView) => ReactNode;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const fileLabels = usePersonnelFileLabels();
	const labels = useDocumentRequestLabels();

	return (
		<ul className="divide-y rounded-md border">
			{requests.map((request) => (
				<li key={request.id} className="space-y-2 p-3">
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="min-w-0 space-y-1">
							{subject ? subject(request) : null}
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{request.title}</span>
								<Badge variant="secondary">{fileLabels.categories[request.category]}</Badge>
								<Badge variant={statusVariant(request)}>
									{request.overdue ? (
										<>
											<IconAlertTriangle aria-hidden="true" />
											{labels.overdue}
										</>
									) : (
										labels.statuses[request.status]
									)}
								</Badge>
							</div>
							<p className="text-sm text-muted-foreground">
								{t("settings.personnelFiles.requests.deadline", "Due {date}", {
									date: formatDateOnly(request.deadline, locale),
								})}
							</p>
							{request.renewedDocument ? (
								<p className="flex items-center gap-1 text-sm text-muted-foreground">
									<IconRefresh aria-hidden="true" className="size-3.5" />
									{t("settings.personnelFiles.requests.renews", "Renews {title}", {
										title: request.renewedDocument.title,
									})}
								</p>
							) : null}
						</div>
						{actions ? <div className="flex items-center gap-1">{actions(request)}</div> : null}
					</div>
					{request.note ? <p className="whitespace-pre-line text-sm">{request.note}</p> : null}
					{request.submissions.length > 0 ? (
						<div className="space-y-1">
							{request.submissions.map((submission) => (
								<div key={submission.id} className="rounded-md bg-muted/50 p-2 text-sm">
									<p className="font-medium">
										{t("settings.personnelFiles.requests.submission", "Submitted {date}", {
											date: formatInstant(
												parseInstant(submission.submittedAt),
												{ locale, timezone, timeFormat: localeDefaultTimeFormat(locale) },
												"dateMedium",
											),
										})}
									</p>
									{submission.note ? (
										<p className="whitespace-pre-line text-muted-foreground">{submission.note}</p>
									) : null}
									<ul className="mt-1 space-y-0.5">
										{submission.documents.map((document) => (
											<li key={document.id}>
												<a
													href={personnelDocumentUrl(document.id)}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
												>
													<IconExternalLink aria-hidden="true" className="size-3.5" />
													{document.title}
												</a>
											</li>
										))}
									</ul>
								</div>
							))}
						</div>
					) : null}
					<details className="text-sm">
						<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
							{t("settings.personnelFiles.requests.history.title", "History")}
						</summary>
						<ol className="mt-2 space-y-2 border-l pl-3">
							{request.history.map((event) => (
								<HistoryEntry key={event.id} event={event} labels={labels} timezone={timezone} />
							))}
						</ol>
					</details>
				</li>
			))}
		</ul>
	);
}
