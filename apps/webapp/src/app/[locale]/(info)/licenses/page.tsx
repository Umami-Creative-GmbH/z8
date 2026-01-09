import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { InfoHeader } from "@/components/info-header";
import { LicenseTable } from "@/components/licenses/license-table";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import type { LicenseReport } from "@/types/license";

type Props = {
	params: Promise<{ locale: string }>;
};

async function getLicenseData(): Promise<LicenseReport | null> {
	"use cache";
	try {
		const filePath = join(process.cwd(), "public", "licenses.json");
		const content = await readFile(filePath, "utf-8");
		return JSON.parse(content) as LicenseReport;
	} catch {
		return null;
	}
}

export default async function LicensesPage({ params }: Props) {
	const { locale } = await params;

	if (!ALL_LANGUAGES.includes(locale)) {
		notFound();
	}

	const licenses = await getLicenseData();

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<InfoHeader
				locale={locale}
				titleDefault="Open Source Licenses"
				titleKey="info.licenses"
			/>
			<div className="min-h-0 flex-1 p-4">
				{licenses ? (
					<LicenseTable licenses={licenses} />
				) : (
					<div className="flex h-full items-center justify-center text-muted-foreground">
						<p>License information is currently unavailable.</p>
					</div>
				)}
			</div>
		</div>
	);
}
