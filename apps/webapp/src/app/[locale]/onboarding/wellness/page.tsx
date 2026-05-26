import type { Metadata } from "next";
import WellnessPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Wellness setup | Z8",
	description: "Set wellness preferences for reminders and healthy work routines in Z8.",
};

export default function WellnessPage() {
	return <WellnessPageClient />;
}
