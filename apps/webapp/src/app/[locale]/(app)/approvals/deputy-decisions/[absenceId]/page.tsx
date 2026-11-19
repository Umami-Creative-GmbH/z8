import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { loadDeputyDecisionsForAbsence } from "@/lib/approvals/deputy/cover-summary-store";
import { getAuthContext } from "@/lib/auth-helpers";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { getUserTimeFormat } from "@/lib/user-preferences/time-format-server";
import { isUuid } from "@/lib/validations/uuid";
import { getTranslate } from "@/tolgee/server";
import {
	DeputyDecisionsHeader,
	DeputyDecisionsView,
} from "./deputy-decisions-view";

interface DeputyDecisionsPageProps {
	params: Promise<{ locale: string; absenceId: string }>;
	searchParams: Promise<{ deputy?: string | string[] }>;
}
async function DeputyDecisionsContent({
	params,
	searchParams,
}: DeputyDecisionsPageProps) {
	const [{ locale, absenceId }, query, context, t] = await Promise.all([
		params,
		searchParams,
		getAuthContext(),
		getTranslate(),
	]);
	const deputy = isUuid(query.deputy) ? query.deputy : undefined;
	if (!isUuid(absenceId) || !context?.employee) notFound();

	const organizationId = context.employee.organizationId;
	const [result, timezone, timeFormat] = await Promise.all([
		loadDeputyDecisionsForAbsence(db, {
			organizationId,
			absenceId,
			viewerEmployeeId: context.employee.id,
			deputyEmployeeId: deputy,
		}),
		getEffectiveTimezone(context.user.id, organizationId),
		getUserTimeFormat(context.user.id),
	]);
	if (!result) notFound();

	return (
		<DeputyDecisionsView
			result={result}
			display={{ locale, timezone, timeFormat }}
			t={t}
		/>
	);
}
function DeputyDecisionsLoading({
	t,
}: {
	t: Awaited<ReturnType<typeof getTranslate>>;
}) {
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<DeputyDecisionsHeader t={t} />
			<div
				role="status"
				aria-busy="true"
				aria-label={t("common.loading", "Loading...")}
				className="space-y-3 rounded-lg border p-4"
			>
				<Skeleton aria-hidden="true" className="h-10 w-full" />
				<Skeleton aria-hidden="true" className="h-10 w-full" />
			</div>
		</div>
	);
}

export default async function DeputyDecisionsPage(
	props: DeputyDecisionsPageProps,
) {
	const t = await getTranslate();
	return (
		<Suspense fallback={<DeputyDecisionsLoading t={t} />}>
			<DeputyDecisionsContent {...props} />
		</Suspense>
	);
}
