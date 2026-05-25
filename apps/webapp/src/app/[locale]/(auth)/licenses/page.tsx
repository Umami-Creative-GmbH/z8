import { notFound } from "next/navigation";
import { InfoHeader } from "@/components/info-header";
import { LicenseTable } from "@/components/licenses/license-table";
import licenses from "@/data/licenses.json";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import type { LicenseReport } from "@/types/license";

type Props = {
	params: Promise<{ locale: string }>;
};

export default async function LicensesPage({ params }: Props) {
	const { locale } = await params;

	if (!ALL_LANGUAGES.includes(locale)) {
		notFound();
	}

	return (
		<div className="flex h-[min(46rem,calc(100svh-9rem))] min-h-[min(34rem,calc(100svh-9rem))] w-full flex-col overflow-hidden rounded-xl border border-white/30 bg-white/20 p-5 shadow-xl shadow-black/5 backdrop-blur-md sm:p-8 dark:border-white/10 dark:bg-slate-950/45 dark:shadow-black/30">
			<InfoHeader locale={locale} titleDefault="Open Source Licenses" titleKey="info.licenses" />
			<div className="min-h-0 flex-1 pt-2">
				<LicenseTable licenses={licenses as LicenseReport} />
			</div>
		</div>
	);
}
