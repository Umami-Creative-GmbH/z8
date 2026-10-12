import type { Metadata } from "next";
import { KioskApp } from "@/components/kiosk/kiosk-app";

export const metadata: Metadata = {
	title: "Kiosk | Z8",
	description: "Clock in and out at a shared kiosk.",
	robots: { index: false, follow: false },
	referrer: "no-referrer",
};

export default function KioskPage() {
	return <KioskApp />;
}
