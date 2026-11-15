import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InfoHeader } from "@/components/info-header";
import { LicenseTable } from "@/components/licenses/license-table";
import { LocalizedLoadingLabel } from "@/components/shells/localized-loading-label";
import { Skeleton } from "@/components/ui/skeleton";
import licenses from "@/data/licenses.json";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import type { LicenseReport } from "@/types/license";

type Props = {
	params: Promise<{ locale: string }>;
};

export default function LicensesPage(props: Props) {
	return (
		<Suspense fallback={<LicensesPageLoading />}>
			<LicensesPageContent {...props} />
		</Suspense>
	);
}

function LicensesPageLoading() {
	return (
		<div
			className="flex h-[min(50rem,calc(100svh-9rem))] min-h-[38rem] w-full flex-col gap-5 rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-8"
			aria-busy="true"
			role="status"
		>
			<LocalizedLoadingLabel
				translationKey="common:loading.licenses"
				fallback="Loading licenses"
			/>
			<Skeleton className="h-8 w-56" />
			<Skeleton className="h-5 w-80 max-w-full" />
			<Skeleton className="min-h-0 flex-1 w-full" />
		</div>
	);
}

async function LicensesPageContent({ params }: Props) {
	const { locale } = await params;

	if (!ALL_LANGUAGES.includes(locale)) {
		notFound();
	}

	return (
		<div className="flex h-[min(50rem,calc(100svh-9rem))] min-h-[38rem] w-full flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-8">
			<InfoHeader
				locale={locale}
				titleDefault="Open Source Licenses"
				titleKey="info.licenses"
			/>
			<div className="min-h-0 flex-1 pt-2">
				<LicenseTable licenses={licenses as LicenseReport} />
			</div>
		</div>
	);
}
