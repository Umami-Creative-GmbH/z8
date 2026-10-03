import type { Metadata } from "next";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
import InitPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Initializing workspace | Z8",
	description:
		"Prepare your active Z8 organization before entering the workspace.",
};

export default function InitPage({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/init" params={params}>
			<InitPageClient />
		</RouteTranslationBoundary>
	);
}
