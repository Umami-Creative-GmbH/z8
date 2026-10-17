"use client";

import { useTranslate } from "@tolgee/react";
import { ClockinImportWizard } from "@/components/settings/clockin-import/clockin-import-wizard";
import { ClockodoImportWizard } from "@/components/settings/clockodo-import/clockodo-import-wizard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CsvWorkUpload } from "./csv-work-upload";

interface ImportHubProps {
	organizationId: string;
}

export function ImportHub({ organizationId }: ImportHubProps) {
	const { t } = useTranslate();
	return (
		<Tabs defaultValue="clockodo" className="space-y-6">
			<TabsList>
				<TabsTrigger value="clockodo">Clockodo</TabsTrigger>
				<TabsTrigger value="clockin">Clockin</TabsTrigger>
				<TabsTrigger value="csv">
					{t("settings.import.csv.tab", "CSV work")}
				</TabsTrigger>
			</TabsList>

			<TabsContent value="clockodo" className="space-y-4">
				<ClockodoImportWizard organizationId={organizationId} />
			</TabsContent>

			<TabsContent value="clockin" className="space-y-4">
				<ClockinImportWizard organizationId={organizationId} />
			</TabsContent>
			<TabsContent value="csv" className="space-y-4">
				<CsvWorkUpload organizationId={organizationId} />
			</TabsContent>
		</Tabs>
	);
}
