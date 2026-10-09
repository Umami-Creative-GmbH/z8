"use client";

import { IconDownload, IconFileZip } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function personnelFileZipUrl(employeeId: string, options: { sharedOnly: boolean }): string {
	return `/api/personnel-files/employees/${employeeId}/zip?sharedOnly=${options.sharedOnly ? "1" : "0"}`;
}

/**
 * Downloads an employee's personnel file as one ZIP (#871), for example to
 * hand it over to a former employee. The server includes only the categories
 * the actor manages; "shared documents only" is on by default.
 */
export function DownloadPersonnelFile({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const checkboxId = useId();
	const [open, setOpen] = useState(false);
	const [sharedOnly, setSharedOnly] = useState(true);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button type="button" variant="outline">
					<IconFileZip aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.zip.action", "Download personnel file")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 space-y-4">
				<div className="flex items-start gap-3">
					<Checkbox
						id={checkboxId}
						checked={sharedOnly}
						onCheckedChange={(checked) => setSharedOnly(checked === true)}
					/>
					<div className="space-y-1">
						<Label htmlFor={checkboxId}>
							{t("settings.personnelFiles.zip.sharedOnly", "Shared documents only")}
						</Label>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.personnelFiles.zip.hint",
								"One ZIP with the documents of the categories you manage, sorted into a folder per category.",
							)}
						</p>
					</div>
				</div>
				<Button asChild className="w-full">
					<a href={personnelFileZipUrl(employeeId, { sharedOnly })} onClick={() => setOpen(false)}>
						<IconDownload aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.zip.download", "Download ZIP")}
					</a>
				</Button>
			</PopoverContent>
		</Popover>
	);
}
