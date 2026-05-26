import type { Metadata } from "next";
import WorkSchedulePageClient from "./page-client";

export const metadata: Metadata = {
	title: "Work schedule setup | Z8",
	description: "Set weekly work schedule defaults for Z8 time tracking.",
};

export default function WorkSchedulePage() {
	return <WorkSchedulePageClient />;
}
