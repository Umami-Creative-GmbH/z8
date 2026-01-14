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
		<div className="flex h-full flex-col overflow-hidden">
			<InfoHeader locale={locale} titleDefault="Open Source Licenses" titleKey="info.licenses" />
			<div className="min-h-0 flex-1 p-4">
				<LicenseTable licenses={licenses as LicenseReport} />
			</div>
		</div>
	);
}
