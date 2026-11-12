"use client";

import { useTranslate } from "@tolgee/react";
import { ClockinImportWizard } from "@/components/settings/clockin-import/clockin-import-wizard";
import { ClockodoImportWizard } from "@/components/settings/clockodo-import/clockodo-import-wizard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CsvWorkUpload } from "./csv-work-upload";

export function ImportHub() {
	const { t } = useTranslate();
	return (
		<Tabs defaultValue="clockodo" className="space-y-6">
			<TabsList>
				<TabsTrigger value="clockodo">Clockodo</TabsTrigger>
				<TabsTrigger value="clockin">Clockin</TabsTrigger>
				<TabsTrigger value="csv">{t("settings.import.csv.tab", "CSV work")}</TabsTrigger>
			</TabsList>

			<TabsContent value="clockodo" className="space-y-4">
				<ClockodoImportWizard />
			</TabsContent>

			<TabsContent value="clockin" className="space-y-4">
				<ClockinImportWizard />
			</TabsContent>
			<TabsContent value="csv" className="space-y-4">
				<CsvWorkUpload />
			</TabsContent>
		</Tabs>
	);
}
