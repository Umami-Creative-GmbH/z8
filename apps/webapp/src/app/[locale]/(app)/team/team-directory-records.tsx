"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";
import type { ServerActionResult } from "@/lib/effect/result";
import { TeamDirectoryLoading, TeamDirectoryRetry } from "./team-directory-feedback";
import type { ManagedEmployee } from "./team-members-data";
import { TeamMembersList } from "./team-members-list";

type DirectoryResult = ServerActionResult<ManagedEmployee[]>;
type DirectorySnapshot = {
	result: DirectoryResult;
	showFormer: boolean;
	employees: ManagedEmployee[] | null;
};

function visibleSnapshot(
	result: DirectoryResult,
	showFormer: boolean,
	previous: DirectorySnapshot,
) {
	if (result.success) return result.data;
	if (result.code === "AuthorizationError" || result.code === "NotFoundError") return null;
	if (previous.showFormer !== showFormer) return null;
	return previous.employees;
}

function useDirectorySnapshot(result: DirectoryResult, showFormer: boolean) {
	const [snapshot, setSnapshot] = useState({
		result,
		showFormer,
		employees: result.success ? result.data : null,
	});
	// Retain a successful snapshot only for the same scope and former filter.
	// Authorization refusals invalidate it; transport/read failures may be retried.
	const employees = visibleSnapshot(result, showFormer, snapshot);
	if (snapshot.result !== result || snapshot.showFormer !== showFormer) {
		setSnapshot({ result, showFormer, employees });
	}
	return employees;
}

export function TeamDirectoryRecords({
	result,
	scope,
	showFormer,
}: {
	result: DirectoryResult;
	scope: { userId: string; organizationId: string; employeeId: string };
	showFormer: boolean;
}) {
	const { t } = useTranslate();
	const context = useOrganization();
	const session = useSession();
	const employees = useDirectorySnapshot(result, showFormer);
	if (context.isLoading || session.isPending) return <TeamDirectoryLoading />;
	if (
		session.data?.user.id !== scope.userId ||
		session.data?.session.activeOrganizationId !== scope.organizationId ||
		context.userId !== scope.userId ||
		context.activeOrganizationId !== scope.organizationId ||
		context.employeeId !== scope.employeeId ||
		(context.role !== "manager" && context.role !== "admin")
	) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-4 lg:p-6">
				<PageHeader title={t("team.title", "Your Team")} />
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"team.directory.scopeChanged",
						"Your organization or access changed. Refresh to load your team.",
					)}
				</p>
				<div>
					<TeamDirectoryRetry />
				</div>
			</div>
		);
	}
	return (
		<div className="@container/main flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-6">
			<PageHeader
				title={t("team.title", "Your Team")}
				description={t(
					"team.directory.scope",
					"You and the employees you directly supervise in the active organization.",
				)}
				scope={
					employees
						? t(
								"team.directory.count",
								"{count, plural, one {# member in this scope} other {# members in this scope}}",
								{ count: employees.length },
							)
						: undefined
				}
			/>
			{!result.success ? (
				<section className="space-y-3 rounded-lg border p-4" aria-labelledby="team-load-error">
					<h2 id="team-load-error" className="font-semibold">
						{t("team.error.title", "Something went wrong")}
					</h2>
					<p role="alert" className="text-sm text-muted-foreground">
						{t("team.error.description", "Unable to load your team members.")}
						{employees
							? ` ${t("team.directory.retained", "Showing the last loaded members. Retry to update them.")}`
							: null}
					</p>
					<TeamDirectoryRetry />
				</section>
			) : null}
			{employees ? <TeamMembersList employees={employees} showFormer={showFormer} /> : null}
		</div>
	);
}
