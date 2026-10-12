"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getOvertimePayoutExportReadinessAction } from "@/app/[locale]/(app)/payroll/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryKeys } from "@/lib/query/keys";

export interface OvertimePayoutReadinessRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
	formatId: string;
}

/**
 * Before exporting (#1001): a warning when the selected format has no wage type
 * mapped to "overtime" while the export's period holds uncancelled overtime
 * payouts. The export still runs; it leaves those payouts out and reports them.
 */
export function OvertimePayoutReadinessAlert({
	request,
}: {
	request: OvertimePayoutReadinessRequest;
}) {
	const { data } = useQuery({
		queryKey: queryKeys.payroll.overtimePayoutReadiness(request),
		queryFn: async () => {
			const result = await getOvertimePayoutExportReadinessAction(request);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: request.formatId !== "" && request.employeeIds?.length !== 0,
	});
	return <UnmappedOvertimePayoutsWarning count={data?.unmappedPayoutCount ?? 0} />;
}

export function UnmappedOvertimePayoutsWarning({ count }: { count: number }) {
	const { t } = useTranslate();
	if (count === 0) return null;

	return (
		<Alert className="border-amber-300 dark:border-amber-700">
			<IconAlertTriangle aria-hidden="true" className="text-amber-600" />
			<AlertTitle>
				{t(
					"payroll.overtimePayoutReadiness.title",
					"{count, plural, one {# overtime payout} other {# overtime payouts}} will not be exported",
					{ count },
				)}
			</AlertTitle>
			<AlertDescription>
				{t(
					"payroll.overtimePayoutReadiness.description",
					"No wage type is mapped to Overtime for this format, so the export leaves these payouts out. Ask an organization administrator to map one, or pay these hours out another way.",
				)}
			</AlertDescription>
		</Alert>
	);
}
