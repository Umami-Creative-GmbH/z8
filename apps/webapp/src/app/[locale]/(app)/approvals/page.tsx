import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AbsenceApprovalsTable } from "@/components/approvals/absence-approvals-table";
import { TimeCorrectionApprovalsTable } from "@/components/approvals/time-correction-approvals-table";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentEmployee, getPendingApprovals } from "./actions";

async function ApprovalsContent() {
	const currentEmployee = await getCurrentEmployee();

	// Redirect if no employee profile found
	if (!currentEmployee) {
		redirect("/");
	}

	// Only managers and admins can access approvals
	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		redirect("/");
	}

	const { absenceApprovals, timeCorrectionApprovals } = await getPendingApprovals();

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
					<p className="text-sm text-muted-foreground">
						Review and approve pending requests from your team
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="secondary">
						{absenceApprovals.length + timeCorrectionApprovals.length} pending
					</Badge>
				</div>
			</div>

			<Tabs defaultValue="absences" className="space-y-4">
				<TabsList>
					<TabsTrigger value="absences" className="relative">
						Absence Requests
						{absenceApprovals.length > 0 && (
							<Badge variant="destructive" className="ml-2 size-5 rounded-full p-0 text-xs">
								{absenceApprovals.length}
							</Badge>
						)}
					</TabsTrigger>
					<TabsTrigger value="corrections" className="relative">
						Time Corrections
						{timeCorrectionApprovals.length > 0 && (
							<Badge variant="destructive" className="ml-2 size-5 rounded-full p-0 text-xs">
								{timeCorrectionApprovals.length}
							</Badge>
						)}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="absences" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Absence Requests</CardTitle>
							<CardDescription>
								Review and approve time-off requests from your team members
							</CardDescription>
						</CardHeader>
						<CardContent>
							<AbsenceApprovalsTable approvals={absenceApprovals} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="corrections" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Time Corrections</CardTitle>
							<CardDescription>
								Review and approve time entry correction requests from your team members
							</CardDescription>
						</CardHeader>
						<CardContent>
							<TimeCorrectionApprovalsTable approvals={timeCorrectionApprovals} />
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
		<SidebarProvider>
			<ServerAppSidebar />
			<SidebarInset>
				<SiteHeader />
				<Suspense fallback={<ApprovalsLoading />}>
					<ApprovalsContent />
				</Suspense>
			</SidebarInset>
		</SidebarProvider>
	);
}
