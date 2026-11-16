"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";

export function AllLocationsLink() {
	const { t } = useTranslate();
	return (
		<Link
			href="/team/presence"
			className="inline-flex min-h-9 items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
		>
			<IconArrowLeft className="size-4 shrink-0" aria-hidden="true" />
			{t("team.presence.allLocations", "All locations")}
		</Link>
	);
}
