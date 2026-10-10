"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getCustomFieldSection } from "@/app/[locale]/(app)/settings/custom-fields/value-actions";
import type { CustomFieldEntity } from "@/lib/organization/custom-fields/definition-rules";
import {
	type CustomFieldValuesInput,
	customFieldValuesOfDrafts,
} from "@/lib/organization/custom-fields/value-rules";
import { queryKeys } from "@/lib/query";

/**
 * The "Custom fields" section of a record's form (#818): the section as the
 * server decides it for the viewer, and the drafts of the fields edited in this
 * form. Drafts hold only edited fields, so untouched fields keep their value.
 */
export function useCustomFieldDrafts(input: {
	entity: CustomFieldEntity;
	/** null = a record being created. */
	recordId: string | null;
	enabled: boolean;
	/** The dialog's open change; closing drops unsaved drafts. */
	onOpenChange?: (open: boolean) => void;
	/** Called after a successful save, once drafts are dropped and sections refreshed. */
	onSaved?: () => void;
}) {
	const queryClient = useQueryClient();
	const { data: section = null } = useQuery({
		queryKey: queryKeys.customFields.section(input.entity, input.recordId),
		queryFn: async () => {
			const result = await getCustomFieldSection({
				entity: input.entity,
				recordId: input.recordId,
			});
			if (!result.success) throw new Error(result.error || "Failed to load custom fields");
			return result.data;
		},
		enabled: input.enabled,
	});
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const reset = () => setDrafts({});

	return {
		section,
		drafts,
		isDirty: Object.keys(drafts).length > 0,
		setDraft: (fieldId: string, draft: string) =>
			setDrafts((current) => ({ ...current, [fieldId]: draft })),
		reset,
		/**
		 * What the save sends. Undefined while the section isn't loaded: the save
		 * then neither writes values nor checks required fields it couldn't show.
		 */
		values: (): CustomFieldValuesInput | undefined =>
			section ? customFieldValuesOfDrafts(section.fields, drafts) : undefined,
		handleOpenChange: (open: boolean) => {
			if (!open) reset();
			input.onOpenChange?.(open);
		},
		handleSaved: () => {
			reset();
			void queryClient.invalidateQueries({ queryKey: queryKeys.customFields.all });
			input.onSaved?.();
		},
	};
}

export type CustomFieldDrafts = ReturnType<typeof useCustomFieldDrafts>;
