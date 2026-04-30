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
		<div className="flex max-h-[calc(100svh-12rem)] min-h-[min(42rem,calc(100svh-12rem))] flex-col overflow-hidden rounded-xl border border-border/70 bg-card/95 p-6 shadow-xl shadow-black/5 sm:p-8 dark:shadow-black/30">
			<InfoHeader locale={locale} titleDefault="Open Source Licenses" titleKey="info.licenses" />
			<div className="min-h-0 flex-1 pt-4">
				<LicenseTable licenses={licenses as LicenseReport} />
			</div>
		</div>
	);
}
