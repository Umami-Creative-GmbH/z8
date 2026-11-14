"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";

type InfoHeaderProps = {
	titleKey: string;
	titleDefault: string;
	backHref?: string;
	locale: string;
};

export function InfoHeader({
	titleKey,
	titleDefault,
	backHref = "/sign-in",
	locale,
}: InfoHeaderProps) {
	const { t } = useTranslate();

	return (
		<div className="sticky top-0 z-30 flex shrink-0 items-center gap-4 pb-6">
			<Button asChild size="icon" variant="ghost">
				<Link href={backHref} locale={locale}>
					<IconArrowLeft className="size-4" aria-hidden="true" />
					<span className="sr-only">
						{t("info.back-to-login", "Back to login")}
					</span>
				</Link>
			</Button>
			<div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center break-words">
				<p className="text-sm font-semibold text-muted-foreground">z8</p>
				<h1 className="text-balance text-2xl font-semibold tracking-tight">
					{t(titleKey, titleDefault)}
				</h1>
			</div>
			<div className="w-10" />
		</div>
	);
}
