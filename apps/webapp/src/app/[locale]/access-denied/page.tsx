import type { Metadata } from "next";
import AccessDeniedPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Access denied | Z8",
	description: "Review access restrictions for your Z8 workspace.",
};

export default function AccessDeniedPage({
	searchParams,
}: {
	searchParams: Promise<{ app?: string }>;
}) {
	return <AccessDeniedPageClient searchParams={searchParams} />;
}
