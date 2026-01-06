"use client";

import { useTranslate } from "@tolgee/react";
import { ArrowLeft } from "lucide-react";
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
					<ArrowLeft className="h-4 w-4" />
					<span className="sr-only">{t("info.back-to-login", "Back to login")}</span>
				</Link>
			</Button>
			<div className="flex flex-1 flex-col items-center text-center">
				<h1 className="font-bold text-2xl">z8</h1>
				<p className="text-balance text-muted-foreground">{t(titleKey, titleDefault)}</p>
			</div>
			<div className="w-10" />
		</div>
	);
}
