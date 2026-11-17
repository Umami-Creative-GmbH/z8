import { Suspense } from "react";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { PeriodSubmissionsClient, PeriodSubmissionsLoading } from "./period-submissions-client";
import { getPeriodSubmissionsAccess } from "./period-submissions-data";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function Content({ searchParams }: Props) {
	const [access, params] = await Promise.all([getPeriodSubmissionsAccess(), searchParams]);
	if (!access) return redirectWithLocale("/");
	return (
		<PeriodSubmissionsClient
			access={access}
			requestedPeriod={typeof params.period === "string" ? params.period : null}
		/>
	);
}

export default function PeriodSubmissionsPage(props: Props) {
	return (
		<Suspense fallback={<PeriodSubmissionsLoading />}>
			<Content {...props} />
		</Suspense>
	);
}
