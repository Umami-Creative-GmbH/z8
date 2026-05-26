import type { Metadata } from "next";
import WorkTemplatesPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Work templates setup | Z8",
	description: "Create work templates for consistent schedules and time tracking.",
};

export default function WorkTemplatesPage() {
	return <WorkTemplatesPageClient />;
}
