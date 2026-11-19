"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/use-organization";
import { useSession } from "@/lib/auth-client";
import type { TeamDrivingDetails } from "@/lib/time-tracking/vehicle-use/driving-details-team-store";
import { readTeamDrivingDetails } from "./actions";
import { DrivingDetailsList } from "./driving-details-list";

type Filters = TeamDrivingDetails["filters"];

export function DrivingDetailsController({ filters }: { filters: Filters }) {
	const { data: session } = useSession();
	const organization = useOrganization();
	const { t } = useTranslate();
	const userId = session?.user.id;
	const organizationId = session?.session.activeOrganizationId;
	if (organization.error)
		return (
			<div role="alert" className="space-y-3">
				<p>{t("team.driving.scopeFailed", "The current driving scope could not be loaded.")}</p>
				<Button variant="outline" onClick={() => void organization.refetch()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	// A retained session remains usable during a background session refresh.
	if (!userId || !organizationId || organization.isLoading) {
		return <p role="status">{t("team.driving.scopeLoading", "Loading current driving scope…")}</p>;
	}
	return (
		<DrivingDetailsArrival
			key={JSON.stringify([userId, organizationId, organization.employeeId, organization.role])}
			userId={userId}
			organizationId={organizationId}
			filters={filters}
		/>
	);
}

function DrivingDetailsArrival({
	userId,
	organizationId,
	filters,
}: {
	userId: string;
	organizationId: string;
	filters: Filters;
}) {
	const { t } = useTranslate();
	const arrival = useId();
	const client = useQueryClient();
	const hash = JSON.stringify(["team-driving", userId, organizationId, arrival, filters]);
	useLayoutEffect(
		() => () => {
			// Activity deactivation, actor changes and A→B→A arrivals retire old transports.
			const queryKey: readonly unknown[] = JSON.parse(hash);
			void client.cancelQueries({ queryKey, exact: true });
			client.removeQueries({ queryKey, exact: true });
		},
		[client, hash],
	);
	const query = useQuery({
		queryKey: JSON.parse(hash) as readonly unknown[],
		retry: false,
		gcTime: 0,
		queryFn: async ({ signal }) => {
			const result = await readTeamDrivingDetails({ userId, organizationId, filters });
			signal.throwIfAborted();
			if (result.status === "error") throw new Error("Driving details unavailable");
			return result;
		},
	});
	// A refusal supersedes retained data; transient transport failures keep it readable.
	if (query.data?.status === "forbidden")
		return (
			<p role="alert">
				{t("team.driving.restricted", "Driving details are not available in your current scope.")}
			</p>
		);
	return (
		<div className="space-y-4" aria-busy={query.isFetching}>
			{query.isError ? (
				<div role="alert" className="space-y-3 rounded-lg border border-destructive p-4">
					<p>
						{query.data
							? t(
									"team.driving.refreshFailed",
									"Driving details could not be refreshed. Previously loaded records are shown.",
								)
							: t("team.driving.loadFailed", "Driving details could not be loaded.")}
					</p>
					<Button
						variant="outline"
						disabled={query.isFetching}
						onClick={() => void query.refetch({ cancelRefetch: false })}
					>
						{t("common.retry", "Retry")}
					</Button>
				</div>
			) : null}
			{query.isFetching ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("team.driving.loading", "Loading driving details")}
				</p>
			) : null}
			{query.data?.status === "ok" ? <DrivingDetailsList {...query.data.details} /> : null}
		</div>
	);
}
