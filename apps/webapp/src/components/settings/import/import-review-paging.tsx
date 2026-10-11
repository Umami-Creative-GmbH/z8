"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";

/** Which page of the batch's staged rows the review shows (1-based). */
export interface ImportReviewPaging {
	page: number;
	pageCount: number;
}

interface ImportReviewPagingNavProps {
	batchId: string;
	paging: ImportReviewPaging | undefined;
	/** Names the navigation landmark, e.g. "Contact pages". */
	label: string;
}

/** Previous/next links between the review's pages; nothing when it has one page. */
export function ImportReviewPagingNav({ batchId, paging, label }: ImportReviewPagingNavProps) {
	const { t } = useTranslate();
	if (!paging || paging.pageCount <= 1) return null;

	return (
		<nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3">
			<span className="text-muted-foreground text-sm tabular-nums">
				{t("settings.import.review.paging.position", "Page {page} of {pageCount}", {
					page: paging.page,
					pageCount: paging.pageCount,
				})}
			</span>
			<div className="flex gap-2">
				{paging.page > 1 ? (
					<Button asChild variant="outline" size="sm">
						<Link href={`/settings/import/${batchId}?page=${paging.page - 1}`}>
							<IconChevronLeft aria-hidden="true" className="size-4" />
							{t("settings.import.review.paging.previous", "Previous page")}
						</Link>
					</Button>
				) : null}
				{paging.page < paging.pageCount ? (
					<Button asChild variant="outline" size="sm">
						<Link href={`/settings/import/${batchId}?page=${paging.page + 1}`}>
							{t("settings.import.review.paging.next", "Next page")}
							<IconChevronRight aria-hidden="true" className="size-4" />
						</Link>
					</Button>
				) : null}
			</div>
		</nav>
	);
}
