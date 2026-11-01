"use client";

import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	type GoLiveCheckResult,
	type GoLiveFailureGroup,
	type GoLiveMessage,
	goLiveMemberKey,
} from "@/lib/implementation-checklist/go-live/types";
import { Link } from "@/navigation";

const MEMBERS_PER_PAGE = 10;

type Translate = ReturnType<typeof useTranslate>["t"];

function message(t: Translate, text: GoLiveMessage) {
	return t(text.key, text.fallback, text.params);
}

/**
 * The generic view of one go-live check result: failure groups (reason, paged
 * members, fix link), advisory warnings and notes. Every check renders through
 * this; slice-specific views go in their own component.
 */
export function GoLiveCheckPanel({ result }: { result: GoLiveCheckResult }) {
	const { t } = useTranslate();

	if (result.outcome === "unavailable") {
		return (
			<p className="text-muted-foreground text-sm">
				{t(
					"settings.implementationChecklist.goLive.panel.unavailable",
					"This check could not be completed. Retry the checks to try again.",
				)}
			</p>
		);
	}

	if (!result.failures.length && !result.warnings.length && !result.notes.length) {
		return null;
	}

	return (
		<div className="space-y-3">
			{result.failures.map((group) => (
				<GoLiveFailureGroupView group={group} key={group.cause ?? group.reason.key} />
			))}
			{result.warnings.map((group) => (
				<GoLiveFailureGroupView advisory group={group} key={group.cause ?? group.reason.key} />
			))}
			{result.notes.length ? (
				<ul className="space-y-1 text-muted-foreground text-sm">
					{result.notes.map((note) => (
						<li key={note.key}>{message(t, note)}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

/** One cause: its reason, the affected members a page at a time, and the fix link. */
export function GoLiveFailureGroupView({
	group,
	advisory = false,
}: {
	group: GoLiveFailureGroup;
	advisory?: boolean;
}) {
	const { t } = useTranslate();
	const [page, setPage] = useState(0);
	const pageCount = Math.max(1, Math.ceil(group.members.length / MEMBERS_PER_PAGE));
	const currentPage = Math.min(page, pageCount - 1);
	const from = currentPage * MEMBERS_PER_PAGE;
	const visible = group.members.slice(from, from + MEMBERS_PER_PAGE);

	return (
		<section className="space-y-2 rounded-md border p-3">
			<div className="flex items-start gap-2">
				<IconAlertTriangle
					aria-hidden="true"
					className={
						advisory
							? "mt-0.5 size-4 shrink-0 text-muted-foreground"
							: "mt-0.5 size-4 shrink-0 text-destructive"
					}
				/>
				<p className="font-medium text-sm">{message(t, group.reason)}</p>
			</div>
			<ul className="space-y-1 pl-6 text-sm">
				{visible.map(({ member, detail }) => (
					<li className="flex flex-wrap items-center gap-2" key={goLiveMemberKey(member)}>
						<span>{member.displayName}</span>
						{member.kind === "invitee" ? (
							<Badge variant="outline">
								{t("settings.implementationChecklist.goLive.panel.invited", "Invited")}
							</Badge>
						) : null}
						{detail ? <span className="text-muted-foreground">{message(t, detail)}</span> : null}
					</li>
				))}
			</ul>
			<div className="flex flex-wrap items-center justify-between gap-2 pl-6">
				{pageCount > 1 ? (
					<div className="flex items-center gap-1">
						<Button
							aria-label={t(
								"settings.implementationChecklist.goLive.panel.previousPage",
								"Previous page",
							)}
							disabled={currentPage === 0}
							onClick={() => setPage(currentPage - 1)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<IconChevronLeft aria-hidden="true" className="size-4" />
						</Button>
						<span className="text-muted-foreground text-xs tabular-nums">
							{t(
								"settings.implementationChecklist.goLive.panel.pageRange",
								"{from}–{to} of {total}",
								{
									from: from + 1,
									to: from + visible.length,
									total: group.members.length,
								},
							)}
						</span>
						<Button
							aria-label={t("settings.implementationChecklist.goLive.panel.nextPage", "Next page")}
							disabled={currentPage >= pageCount - 1}
							onClick={() => setPage(currentPage + 1)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<IconChevronRight aria-hidden="true" className="size-4" />
						</Button>
					</div>
				) : (
					<span />
				)}
				{group.fix ? (
					<Button asChild size="sm" variant="outline">
						<Link href={group.fix.href}>{message(t, group.fix.label)}</Link>
					</Button>
				) : null}
			</div>
		</section>
	);
}
