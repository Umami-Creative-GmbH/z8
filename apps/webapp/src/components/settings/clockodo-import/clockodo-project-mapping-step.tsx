"use client";

import { IconArrowLeft, IconArrowRight, IconBriefcase, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ProjectMappingEntry } from "@/lib/clockodo/types";
import type { ClockodoImportController } from "./clockodo-import-controller";

const UNMAPPED = "unmapped";

/**
 * Maps Clockodo projects to existing Z8 projects (#907). Imported entries carry
 * the mapped project and Clockodo's billable value; entries on unmapped
 * projects, or on Z8 projects without a customer, import as non-billable.
 */
export function ClockodoProjectMappingStep({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	const { t } = useTranslate();
	const mappedCount = controller.projectMappings.filter(
		(mapping) => mapping.projectId !== null,
	).length;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconBriefcase className="size-5" aria-hidden="true" />
					{t("settings.clockodoImport.projectMapping.title", "Map Projects")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.projectMapping.description",
						"Map Clockodo projects to existing Z8 projects. Imported time entries keep their project and Clockodo's billable value. Entries on unmapped projects, or on projects without a customer, are imported as non-billable. No projects are created.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{controller.z8Projects.length === 0 && (
					<p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
						{t(
							"settings.clockodoImport.projectMapping.noZ8Projects",
							"This organization has no projects yet. Create projects first to import Clockodo time with its project and billable value.",
						)}
					</p>
				)}
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left">
								<th className="pb-2 font-medium">
									{t("settings.clockodoImport.projectMapping.clockodoProject", "Clockodo Project")}
								</th>
								<th className="pb-2 font-medium">
									{t(
										"settings.clockodoImport.projectMapping.clockodoCustomer",
										"Clockodo Customer",
									)}
								</th>
								<th className="pb-2 font-medium">
									{t("settings.clockodoImport.projectMapping.z8Project", "Z8 Project")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{controller.projectMappings.map((mapping) => (
								<ClockodoProjectMappingRow
									key={mapping.clockodoProjectId}
									mapping={mapping}
									z8Projects={controller.z8Projects}
									onChange={(projectId) =>
										controller.updateProjectMapping(mapping.clockodoProjectId, projectId)
									}
								/>
							))}
						</tbody>
					</table>
				</div>
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.clockodoImport.projectMapping.mappedCount",
						"{mapped} of {total} projects mapped",
						{ mapped: mappedCount, total: controller.projectMappings.length },
					)}
				</p>
				<div className="flex justify-between pt-2">
					<Button variant="outline" onClick={() => controller.setStep("user-mapping")}>
						<IconArrowLeft className="mr-2 size-4" aria-hidden="true" />
						{t("common.back", "Back")}
					</Button>
					<Button
						onClick={() => controller.saveProjectMappingsMutation.mutate()}
						disabled={controller.saveProjectMappingsMutation.isPending}
					>
						{controller.saveProjectMappingsMutation.isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconArrowRight className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.clockodoImport.projectMapping.continue", "Continue")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ClockodoProjectMappingRow({
	mapping,
	z8Projects,
	onChange,
}: {
	mapping: ProjectMappingEntry;
	z8Projects: ClockodoImportController["z8Projects"];
	onChange: (projectId: string | null) => void;
}) {
	const { t } = useTranslate();
	const selected = z8Projects.find((entry) => entry.id === mapping.projectId);
	return (
		<tr>
			<td className="py-2 pr-3 font-medium">{mapping.clockodoProjectName}</td>
			<td className="py-2 pr-3 text-muted-foreground">{mapping.clockodoCustomerName ?? "-"}</td>
			<td className="py-2">
				<Select
					value={mapping.projectId ?? UNMAPPED}
					onValueChange={(value) => onChange(value === UNMAPPED ? null : value)}
				>
					<SelectTrigger
						size="sm"
						className="w-[240px]"
						aria-label={t(
							"settings.clockodoImport.projectMapping.z8ProjectFor",
							"Z8 project for {project}",
							{ project: mapping.clockodoProjectName },
						)}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={UNMAPPED}>
							{t("settings.clockodoImport.projectMapping.unmapped", "Not mapped (no project)")}
						</SelectItem>
						{z8Projects.map((entry) => (
							<SelectItem key={entry.id} value={entry.id}>
								{entry.customerName ? `${entry.name} · ${entry.customerName}` : entry.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{selected && selected.customerName === null && (
					<p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
						{t(
							"settings.clockodoImport.projectMapping.noCustomer",
							"This project has no customer, so its imported time is non-billable.",
						)}
					</p>
				)}
			</td>
		</tr>
	);
}
