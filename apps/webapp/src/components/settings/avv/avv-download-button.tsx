"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { exportAvvToPDF, generateAvvFilename } from "@/lib/avv/avv-pdf-generator";
import { Button } from "@/components/ui/button";

interface AvvDownloadButtonProps {
	organizationName: string;
}

export function AvvDownloadButton({ organizationName }: AvvDownloadButtonProps) {
	const [loading, setLoading] = useState(false);

	const handleDownload = async () => {
		setLoading(true);

		const downloadResult = await exportAvvToPDF(organizationName)
			.then((data) => ({
				ok: true as const,
				value: {
					data,
					filename: generateAvvFilename(organizationName),
				},
			}))
			.catch((error) => ({ ok: false as const, error }));

		if (!downloadResult.ok) {
			console.error("AVV download failed:", downloadResult.error);
			toast.error("Download fehlgeschlagen", {
				description:
					downloadResult.error instanceof Error
						? downloadResult.error.message
						: "Ein Fehler ist aufgetreten",
			});
			setLoading(false);
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

		toast.success("AVV erfolgreich heruntergeladen", {
			description: `Datei: ${filename}`,
		});
		setLoading(false);
	};

	return (
		<Button onClick={handleDownload} disabled={loading} size="lg">
			<FileText className="mr-2 h-4 w-4" aria-hidden="true" />
			{loading ? "Generiere PDF\u2026" : "AVV als PDF herunterladen"}
		</Button>
	);
}
