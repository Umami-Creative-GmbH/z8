"use client";

import { ClockinImportWizard } from "@/components/settings/clockin-import/clockin-import-wizard";
import { ClockodoImportWizard } from "@/components/settings/clockodo-import/clockodo-import-wizard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ImportHubProps {
	organizationId: string;
}

export function ImportHub({ organizationId }: ImportHubProps) {
	return (
		<Tabs defaultValue="clockodo" className="space-y-6">
			<TabsList>
				<TabsTrigger value="clockodo">Clockodo</TabsTrigger>
				<TabsTrigger value="clockin">Clockin</TabsTrigger>
			</TabsList>

			<TabsContent value="clockodo" className="space-y-4">
				<ClockodoImportWizard organizationId={organizationId} />
			</TabsContent>

			<TabsContent value="clockin" className="space-y-4">
				<ClockinImportWizard organizationId={organizationId} />
			</TabsContent>
		</Tabs>
	);
}
