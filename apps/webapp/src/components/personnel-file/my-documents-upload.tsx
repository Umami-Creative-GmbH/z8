"use client";

import { IconUpload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { DocumentDialog } from "./document-dialog";

/**
 * Lets the employee add a certificate or another document to their own
 * personnel file from My documents (#867). The document is always shared and
 * appears in their list right away.
 */
export function MyDocumentsUpload({ capability }: { capability: PersonnelFilePanelCapability }) {
	const { t } = useTranslate();
	const router = useRouter();
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button type="button" onClick={() => setOpen(true)}>
				<IconUpload aria-hidden="true" className="size-4" />
				{t("settings.personnelFiles.myDocuments.upload.button", "Upload document")}
			</Button>
			<DocumentDialog
				mode="upload"
				uploadAs="employee"
				open={open}
				onOpenChange={setOpen}
				employeeId={capability.employeeId}
				categories={capability.categories}
				today={capability.today}
				onSaved={() => router.refresh()}
			/>
		</>
	);
}
