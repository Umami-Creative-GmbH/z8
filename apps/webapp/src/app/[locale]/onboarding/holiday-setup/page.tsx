import type { Metadata } from "next";
import HolidaySetupPageClient from "./page-client";

export const metadata: Metadata = {
	title: "Holiday setup | Z8",
	description: "Configure holidays for accurate workforce scheduling and absence planning.",
};

export default function HolidaySetupPage() {
	return <HolidaySetupPageClient />;
}
