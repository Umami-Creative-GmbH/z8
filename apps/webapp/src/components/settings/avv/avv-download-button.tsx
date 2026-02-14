"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface AvvDownloadButtonProps {
	organizationName: string;
}

export function AvvDownloadButton({ organizationName }: AvvDownloadButtonProps) {
	const [loading, setLoading] = useState(false);

	const handleDownload = async () => {
		setLoading(true);

		try {
			const { exportAvvToPDF, generateAvvFilename } = await import(
				"@/lib/avv/avv-pdf-generator"
			);

			const data = await exportAvvToPDF(organizationName);
			const filename = generateAvvFilename(organizationName);

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
		} catch (error) {
			console.error("AVV download failed:", error);
			toast.error("Download fehlgeschlagen", {
				description:
					error instanceof Error ? error.message : "Ein Fehler ist aufgetreten",
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button onClick={handleDownload} disabled={loading} size="lg">
			<FileText className="mr-2 h-4 w-4" aria-hidden="true" />
			{loading ? "Generiere PDF\u2026" : "AVV als PDF herunterladen"}
		</Button>
	);
}
