"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { EmployeeDocumentView } from "@/app/[locale]/(app)/personnel-files/actions";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/personnel-file/document.types";
import { usePersonnelFileLabels } from "./document-labels";
import { DocumentList } from "./document-list";

const ALL_CATEGORIES = "all";

/** The employee's shared documents, filterable by category, with open and download links. */
export function MyDocumentsList({ documents }: { documents: readonly EmployeeDocumentView[] }) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const [category, setCategory] = useState<DocumentCategory | null>(null);
	const present = DOCUMENT_CATEGORIES.filter((option) =>
		documents.some((document) => document.category === option),
	);
	const shown = category
		? documents.filter((document) => document.category === category)
		: documents;

	if (documents.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.personnelFiles.myDocuments.empty",
					"No documents have been shared with you yet.",
				)}
			</p>
		);
	}

	return (
		<div className="space-y-3">
			{present.length > 1 ? (
				<Select
					value={category ?? ALL_CATEGORIES}
					onValueChange={(value) =>
						setCategory(value === ALL_CATEGORIES ? null : (value as DocumentCategory))
					}
				>
					<SelectTrigger
						className="w-44"
						aria-label={t("settings.personnelFiles.panel.filter", "Filter by category")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_CATEGORIES}>
							{t("settings.personnelFiles.panel.allCategories", "All categories")}
						</SelectItem>
						{present.map((option) => (
							<SelectItem key={option} value={option}>
								{labels.categories[option]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			<DocumentList documents={shown} showVisibility={false} />
		</div>
	);
}
