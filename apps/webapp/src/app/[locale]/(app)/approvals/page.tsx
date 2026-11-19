import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { Suspense } from "react";
import { LegacyApprovalsWorkspace } from "@/components/approvals/legacy-approvals-workspace";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee } from "./actions";

async function ApprovalsContent() {
	const [currentEmployee, t] = await Promise.all([
		getCurrentEmployee(),
		getTranslate(),
	]);
	if (
		currentEmployee &&
		currentEmployee.role !== "manager" &&
		currentEmployee.role !== "admin"
	)
		return redirectWithLocale("/");
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("approvals:approvals.title", "Approvals")}
				description={t(
					"approvals:approvals.inboxDescription",
					"Review and approve pending requests from your team",
				)}
				actions={
					<Button asChild variant="outline">
						<Link href="/approvals/inbox">
							<IconInbox className="size-4" />
							{t("approvals:approvals.openInbox", "Open Inbox")}
						</Link>
					</Button>
				}
			/>
			{currentEmployee ? (
				<LegacyApprovalsWorkspace
					userId={currentEmployee.userId}
					organizationId={currentEmployee.organizationId}
				/>
			) : (
				<NoEmployeeError feature="approve requests" />
			)}
			<aside
				className="flex min-w-0 flex-wrap items-center justify-between gap-4 border-t pt-5"
				aria-label={t("approvals:approvals.unifiedInbox", "Unified Inbox")}
			>
				<div className="min-w-0 flex-[1_1_20rem] space-y-1">
					<h2 className="flex items-center gap-2 text-sm font-medium">
						<IconInbox className="size-4 shrink-0" />
						{t("approvals:approvals.unifiedInbox", "Unified Inbox")}
					</h2>
					<p className="max-w-3xl text-sm text-muted-foreground">
						{t(
							"approvals:approvals.unifiedInboxBannerDescription",
							"View all approval types in one place with filtering, bulk actions, and SLA tracking.",
						)}
					</p>
				</div>
				<Button asChild size="sm" variant="outline">
					<Link href="/approvals/inbox">
						{t("approvals:approvals.openInbox", "Open Inbox")}
						<IconArrowRight className="size-4" />
					</Link>
				</Button>
			</aside>
		</div>
	);
}
async function ApprovalsLoading() {
	const t = await getTranslate();
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader title={t("approvals:approvals.title", "Approvals")} />
			<div
				role="status"
				aria-label={t("common.loading", "Loading…")}
				className="space-y-4"
			>
				<Skeleton className="h-10 w-full max-w-sm" />
				<Skeleton className="h-48 w-full" />
			</div>
		</div>
	);
}
export default function ApprovalsPage() {
	return (
		<Suspense fallback={<ApprovalsLoading />}>
			<ApprovalsContent />
		</Suspense>
	);
}
