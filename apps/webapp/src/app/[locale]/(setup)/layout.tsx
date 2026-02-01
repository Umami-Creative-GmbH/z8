import type { ReactNode } from "react";
import { getTranslate } from "@/tolgee/server";

interface SetupLayoutProps {
	children: ReactNode;
}

export default async function SetupLayout({ children }: SetupLayoutProps) {
	const t = await getTranslate();

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
			<div className="mb-8 flex flex-col items-center gap-2">
				<div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-3xl font-bold text-primary-foreground">
					z8
				</div>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("setup.layout.title", "Initial Setup")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t("setup.layout.subtitle", "Configure your platform to get started")}
				</p>
			</div>
			{children}
		</div>
	);
}
