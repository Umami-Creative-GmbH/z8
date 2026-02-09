"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const DESIGNS = [
	"6", "7", "13", "20", "22", "24",
	"24-1", "24-2", "24-3", "24-4", "24-5",
	"m-1", "m-2", "m-3", "m-4", "m-5", "m-6",
	"p-1", "p-2", "p-3", "p-4", "p-5", "p-6",
	"s-1", "s-2", "s-3", "s-4", "s-5", "s-6", "s-7", "s-8", "s-9", "s-10",
];

export function FloatingNav() {
	const pathname = usePathname();
	const current = pathname.replace("/", "");

	// Hide on the index page
	if (pathname === "/") return null;

	return (
		<div className="fixed bottom-4 left-1/2 z-[999] -translate-x-1/2">
			<div
				className="flex items-center gap-1 rounded-full px-2 py-1.5 shadow-2xl"
				style={{
					backgroundColor: "rgba(0,0,0,0.85)",
					backdropFilter: "blur(12px)",
					border: "1px solid rgba(255,255,255,0.1)",
				}}
			>
				<Link
					href="/"
					className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white"
					title="Index"
				>
					&larr;
				</Link>
				<div className="mx-1 h-4 w-px bg-white/10" />
				{DESIGNS.map((n) => (
					<Link
						key={n}
						href={`/${n}`}
						className="flex h-7 min-w-[28px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium transition-colors"
						style={{
							backgroundColor: current === n ? "rgba(255,255,255,0.15)" : "transparent",
							color: current === n ? "#fff" : "rgba(255,255,255,0.35)",
						}}
						title={`Design ${n}`}
					>
						{n}
					</Link>
				))}
			</div>
		</div>
	);
}
