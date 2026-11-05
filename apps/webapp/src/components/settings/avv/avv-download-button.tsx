"use client";

import { IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { prepareAvvDownload } from "@/app/[locale]/(app)/settings/avv/actions";
import { Button } from "@/components/ui/button";
import {
	exportAvvToPDF,
	generateAvvFilename,
} from "@/lib/avv/avv-pdf-generator";
import type { AvvRequiredField } from "@/lib/avv/profile";
import { runWithCleanup } from "@/lib/run-with-cleanup";

interface AvvDownloadButtonProps {
	organizationId: string;
	missingFields: AvvRequiredField[];
}

export function AvvDownloadButton({
	organizationId,
	missingFields,
}: AvvDownloadButtonProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const [downloadMissingFields, setDownloadMissingFields] = useState<
		AvvRequiredField[]
	>([]);
	const [failed, setFailed] = useState(false);
	const visibleMissingFields = missingFields.length
		? missingFields
		: downloadMissingFields;
	const fieldLabels = {
		legalCompanyName: t(
			"settings.avv.profile.missing.legalCompanyName",
			"Legal company name",
		),
		addressLine1: t(
			"settings.avv.profile.missing.addressLine1",
			"Address line 1",
		),
		city: t("settings.avv.profile.missing.city", "City"),
		country: t("settings.avv.profile.missing.country", "Country"),
		postalCode: t("settings.avv.profile.missing.postalCode", "Postal code"),
	};

	const handleDownload = async () => {
		setLoading(true);
		setFailed(false);
		setDownloadMissingFields([]);
		await runWithCleanup(
			async () => {
				const prepared = await prepareAvvDownload(organizationId).catch(
					() => null,
				);
				if (!prepared?.success) {
					setFailed(true);
					return;
				}
				if (!prepared.data.ready) {
					setDownloadMissingFields(prepared.data.missingFields);
					return;
				}
				const profile = prepared.data.profile;
				const downloadResult = await exportAvvToPDF(profile)
					.then((data) => ({
						ok: true as const,
						value: {
							data,
							filename: generateAvvFilename(profile.legalCompanyName),
						},
					}))
					.catch((error) => ({ ok: false as const, error }));

				if (!downloadResult.ok) {
					console.error("AVV download failed:", downloadResult.error);
					toast.error(
						t("settings.avv.download.downloadFailed", "Download failed"),
						{
							description:
								downloadResult.error instanceof Error
									? downloadResult.error.message
									: t(
											"settings.avv.download.errorOccurred",
											"An error occurred",
										),
						},
					);
					return;
				}

				const { data, filename } = downloadResult.value;
				const blob = new Blob([data as BlobPart], { type: "application/pdf" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);

				toast.success(
					t(
						"settings.avv.download.downloaded",
						"Data processing agreement downloaded",
					),
					{
						description: t(
							"settings.avv.download.filename",
							"File: {filename}",
							{ filename },
						),
					},
				);
			},
			() => setLoading(false),
		);
	};

	return (
		<div className="space-y-3">
			{visibleMissingFields.length > 0 && (
				<div role="status" className="space-y-2 text-sm">
					<p>
						{t(
							"settings.avv.profile.incomplete",
							"Complete the organization profile before downloading the AVV. Missing required details:",
						)}
					</p>
					<ul className="list-disc pl-5">
						{visibleMissingFields.map((field) => (
							<li key={field}>{fieldLabels[field]}</li>
						))}
					</ul>
				</div>
			)}
			{failed && (
				<p role="alert" className="text-sm text-destructive">
					{t(
						"settings.avv.download.preparationFailed",
						"Unable to prepare the AVV. Check your access and try again.",
					)}
				</p>
			)}
			<Button
				onClick={handleDownload}
				disabled={loading || missingFields.length > 0}
				size="lg"
				className="h-auto max-w-full whitespace-normal py-3"
			>
				<IconFileText className="mr-2 size-4" aria-hidden="true" />
				{loading
					? t("settings.avv.download.generating", "Generating PDF…")
					: t(
							"settings.avv.download.button",
							"Download data processing agreement as PDF",
						)}
			</Button>
		</div>
	);
}
