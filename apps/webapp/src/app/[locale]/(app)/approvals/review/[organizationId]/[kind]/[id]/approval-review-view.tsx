"use client";

import {
	IconBuildingSkyscraper,
	IconClipboardCheck,
	IconInbox,
	IconLock,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApprovalReviewArrival } from "@/lib/approvals/presentation/review-arrival";
import { Link, useRouter } from "@/navigation";
import { ApprovalDetailPanel } from "../../../../inbox/components/approval-detail-panel";

function ReviewCard({
	title,
	description,
	children,
}: {
	title: React.ReactNode;
	description: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<Card className="mx-auto w-full max-w-xl">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardFooter className="flex flex-wrap gap-2">{children}</CardFooter>
		</Card>
	);
}

/**
 * Renders an authorized arrival. A ready item opens in the inbox's own detail
 * panel, which reloads detail and decides through the inbox API so every
 * request is reauthorized. Other outcomes disclose no approval facts.
 */
export function ApprovalReviewOutcome({
	arrival,
	reviewPath,
}: {
	arrival: ApprovalReviewArrival;
	/** Locale-free path of this review, used as the post-switch destination. */
	reviewPath: string | null;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [open, setOpen] = useState(true);

	const inboxLink = (variant: "default" | "outline") => (
		<Button asChild variant={variant}>
			<Link href="/approvals/inbox">
				<IconInbox className="mr-2 size-4" aria-hidden="true" />
				{t("approvals:approvals.openInbox", "Open Inbox")}
			</Link>
		</Button>
	);

	let content: React.ReactNode;
	if (arrival.status === "ready") {
		content = (
			<>
				<ReviewCard
					title={t("approvals:approvals.review.title", "Approval review")}
					description={arrival.item.summary.detail}
				>
					<Button onClick={() => setOpen(true)}>
						<IconClipboardCheck className="mr-2 size-4" aria-hidden="true" />
						{t("approvals:approvals.review.showDetails", "Show details")}
					</Button>
					{inboxLink("outline")}
				</ReviewCard>
				<ApprovalDetailPanel
					approval={arrival.item}
					open={open}
					onOpenChange={setOpen}
					onActioned={() => router.push("/approvals/inbox")}
				/>
			</>
		);
	} else if (arrival.status === "switch_organization" && reviewPath) {
		const params = new URLSearchParams({
			organizationId: arrival.organizationId,
			callbackUrl: reviewPath,
		});
		const organization = { organization: arrival.organizationName };
		content = (
			<ReviewCard
				title={
					<>
						<IconBuildingSkyscraper className="size-5" aria-hidden="true" />
						{t(
							"approvals:approvals.review.switchOrganizationTitle",
							"Switch organization to review",
						)}
					</>
				}
				description={t(
					"approvals:approvals.review.switchOrganizationBody",
					"This approval belongs to {organization}. Switch to that organization to review it; your access is checked again after switching.",
					organization,
				)}
			>
				<Button asChild>
					<Link href={`/init?${params}`}>
						{t(
							"approvals:approvals.review.switchOrganizationAction",
							"Switch to {organization}",
							organization,
						)}
					</Link>
				</Button>
			</ReviewCard>
		);
	} else {
		content = (
			<ReviewCard
				title={
					<>
						<IconLock className="size-5" aria-hidden="true" />
						{t("approvals:approvals.review.unavailableTitle", "This approval is not available")}
					</>
				}
				description={t(
					"approvals:approvals.review.unavailableBody",
					"You cannot review this approval here. It may have been decided, reassigned, withdrawn or removed, or your access may have changed. A link alone never grants access. Your approval inbox shows everything currently waiting for you.",
				)}
			>
				{inboxLink("default")}
			</ReviewCard>
		);
	}

	return <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{content}</div>;
}
