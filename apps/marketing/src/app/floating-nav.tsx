"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TOTAL = 20;

export function FloatingNav() {
	const pathname = usePathname();
	const current = Number(pathname.replace("/", "")) || 0;

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
				{Array.from({ length: TOTAL }, (_, i) => i + 1).map((n) => (
					<Link
						key={n}
						href={`/${n}`}
						className="flex h-7 min-w-[28px] items-center justify-center rounded-full text-[11px] font-medium transition-colors"
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
