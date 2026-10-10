"use client";

import { IconPaperclip } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";

export const SICK_NOTE_MARKER_LINK_CLASS =
	"inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline";

/** The marker's content: an icon and "Sick note attached (n)". */
export function SickNoteMarkerLabel({ count }: { count: number }) {
	const { t } = useTranslate();
	return (
		<>
			<IconPaperclip aria-hidden="true" className="size-3.5" />
			{t("absences.sickNotes.marker", "Sick note attached ({count})", { count })}
		</>
	);
}

/**
 * "Sick note attached (n)" on an absence (#982). It shows only that sick notes
 * exist (ADR 0002); with `onOpen` it opens them, which callers offer only to a
 * viewer who may open them through personnel file access.
 */
export function SickNoteMarker({ count, onOpen }: { count: number; onOpen?: () => void }) {
	if (count < 1) return null;
	if (onOpen) {
		return (
			<button type="button" onClick={onOpen} className={SICK_NOTE_MARKER_LINK_CLASS}>
				<SickNoteMarkerLabel count={count} />
			</button>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
			<SickNoteMarkerLabel count={count} />
		</span>
	);
}
