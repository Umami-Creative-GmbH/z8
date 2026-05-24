"use client";

import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";

export function InfoFooter({ buildHash }: { buildHash?: string }) {
	const { t } = useTranslate();

	return (
		<div className="space-y-1 text-balance text-center text-muted-foreground text-xs">
			<div className="*:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary">
				<Link href="/terms">{t("auth.terms.service", "Terms of Service")}</Link>
				{" · "}
				<Link href="/privacy">{t("auth.terms.privacy", "Privacy Policy")}</Link>
				{" · "}
				<Link href="/licenses">Open Source Licenses</Link>
			</div>
			{buildHash ? <div className="mt-2 text-[10px] opacity-40">Version {buildHash}</div> : null}
		</div>
	);
}
