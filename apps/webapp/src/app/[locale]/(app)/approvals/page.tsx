import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AbsenceApprovalsTable } from "@/components/approvals/absence-approvals-table";
import { TimeCorrectionApprovalsTable } from "@/components/approvals/time-correction-approvals-table";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee } from "./actions";

async function ApprovalsContent() {
	const [currentEmployee, t] = await Promise.all([getCurrentEmployee(), getTranslate()]);

	// Show error if no employee profile found
	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="approve requests" />
			</div>
		);
	}

	// Only managers and admins can access approvals
	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		redirect("/");
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("approvals:approvals.title", "Approvals")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"approvals:approvals.inboxDescription",
							"Review and approve pending requests from your team",
						)}
					</p>
				</div>
			</div>

			{/* Unified Inbox Banner */}
			<Alert>
				<IconInbox className="size-4" />
				<AlertTitle>
					{t("approvals:approvals.unifiedInboxBannerTitle", "Try the new Unified Inbox")}
				</AlertTitle>
				<AlertDescription className="flex items-center justify-between">
					<span>
						{t(
							"approvals:approvals.unifiedInboxBannerDescription",
							"View all approval types in one place with filtering, bulk actions, and SLA tracking.",
						)}
					</span>
					<Button asChild size="sm" variant="outline" className="ml-4">
						<Link href="/approvals/inbox">
							{t("approvals:approvals.openInbox", "Open Inbox")}
							<IconArrowRight className="ml-2 size-4" />
						</Link>
					</Button>
				</AlertDescription>
			</Alert>

			<Tabs defaultValue="absences" className="space-y-4">
				<TabsList>
					<TabsTrigger value="absences" className="relative">
						{t("approvals:approvals.absenceRequests", "Absence Requests")}
					</TabsTrigger>
					<TabsTrigger value="corrections" className="relative">
						{t("approvals:approvals.timeCorrections", "Time Corrections")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="absences" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>{t("approvals:approvals.absenceRequests", "Absence Requests")}</CardTitle>
							<CardDescription>
								{t(
									"approvals:approvals.absenceRequestsDescription",
									"Review and approve time-off requests from your team members",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<AbsenceApprovalsTable />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="corrections" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>{t("approvals:approvals.timeCorrections", "Time Corrections")}</CardTitle>
							<CardDescription>
								{t(
									"approvals:approvals.timeCorrectionsDescription",
									"Review and approve time entry correction requests from your team members",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<TimeCorrectionApprovalsTable />
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function ApprovalsLoading() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
			<div className="flex items-center justify-between">
				<div className="space-y-2">
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-4 w-96" />
				</div>
				<Skeleton className="h-6 w-24" />
			</div>
			<div className="space-y-4">
				<Skeleton className="h-10 w-full" />
				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-48" />
						<Skeleton className="h-4 w-96" />
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
						</div>
					</CardContent>
				</Card>
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
