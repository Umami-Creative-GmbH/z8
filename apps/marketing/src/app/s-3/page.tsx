import Image from "next/image";
import Link from "next/link";

export default function DesignS3() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace",
				backgroundColor: "#06080c",
				color: "#8af0e4",
			}}
		>
			{/* Scanline overlay */}
			<div
				className="pointer-events-none fixed inset-0 z-[1]"
				style={{
					background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,220,0.015) 2px, rgba(0,255,220,0.015) 4px)",
				}}
			/>

			{/* Neon glow ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 40% 30% at 70% 20%, rgba(0,220,200,0.06) 0%, transparent 60%), radial-gradient(ellipse 30% 40% at 20% 80%, rgba(0,180,220,0.04) 0%, transparent 50%)",
				}}
			/>

			{/* Grid lines */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					backgroundImage:
						"linear-gradient(rgba(0,255,220,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,220,0.03) 1px, transparent 1px)",
					backgroundSize: "80px 80px",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-center gap-4">
					<span className="text-[20px] font-bold" style={{ color: "#00dcc8", textShadow: "0 0 20px rgba(0,220,200,0.4)" }}>
						Z8_
					</span>
					<span className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "#1a4a44" }}>
						sys::zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-8 text-[11px] uppercase tracking-[0.15em] md:flex" style={{ color: "#1a5a50" }}>
					<a href="#features" className="transition-colors hover:text-[#00dcc8]">[funktionen]</a>
					<a href="#specs" className="transition-colors hover:text-[#00dcc8]">[specs]</a>
					<a href="#contact" className="transition-colors hover:text-[#00dcc8]">[kontakt]</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2 text-[11px] uppercase tracking-[0.15em] transition-all hover:shadow-[0_0_20px_rgba(0,220,200,0.3)]"
					style={{
						border: "1px solid #00dcc8",
						color: "#00dcc8",
						textShadow: "0 0 10px rgba(0,220,200,0.3)",
					}}
				>
					&gt; init
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[88vh] flex-col justify-center px-8 lg:px-16">
				<div className="max-w-3xl">
					{/* Terminal prompt */}
					<div
						className="animate-fade-in mb-6 text-[12px]"
						style={{ color: "#1a5a50", animationDelay: "0s" }}
					>
						$ z8 --track --precision=ms
					</div>

					<h1
						className="animate-fade-up text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-[1.0] tracking-[-0.04em]"
						style={{
							color: "#00dcc8",
							textShadow: "0 0 60px rgba(0,220,200,0.15), 0 0 120px rgba(0,220,200,0.05)",
							animationDelay: "0.15s",
						}}
					>
						ZEIT
						<br />
						<span style={{ color: "#065a52" }}>IST</span>
						<br />
						CODE.
					</h1>

					<p
						className="animate-fade-up mt-8 max-w-md text-[14px] leading-[1.8]"
						style={{ color: "#2a6a60", animationDelay: "0.35s" }}
					>
						Jede Millisekunde erfasst. Jeder Prozess optimiert.
						Z8 ist das Betriebssystem für Ihre Arbeitszeit.
					</p>

					<div className="animate-fade-up mt-12 flex items-center gap-6" style={{ animationDelay: "0.5s" }}>
						<a
							href="#contact"
							className="px-8 py-3 text-[12px] uppercase tracking-[0.1em] transition-all hover:shadow-[0_0_30px_rgba(0,220,200,0.3)]"
							style={{
								backgroundColor: "#00dcc8",
								color: "#06080c",
								fontWeight: 700,
							}}
						>
							&gt; deploy
						</a>
						<a
							href="#features"
							className="text-[12px] uppercase tracking-[0.1em] transition-colors hover:text-[#00dcc8]"
							style={{ color: "#1a5a50" }}
						>
							cat README →
						</a>
					</div>
				</div>

				{/* Hero image — neon-treated */}
				<div
					className="animate-fade-in absolute right-[5%] top-[15%] hidden overflow-hidden lg:block"
					style={{
						animationDelay: "0.6s",
						width: 360,
						height: 420,
						border: "1px solid rgba(0,220,200,0.08)",
					}}
				>
					<Image
						src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=700&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.15) brightness(0.3) contrast(1.4) hue-rotate(140deg)" }}
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 40%, rgba(6,8,12,0.9)), linear-gradient(to right, rgba(0,220,200,0.05), transparent)" }} />
					{/* Overlay code snippet */}
					<div className="absolute bottom-6 left-6 right-6">
						<pre className="text-[10px] leading-[1.7]" style={{ color: "#1a6a5e" }}>
							{`$ z8 status --json`}
						</pre>
						<pre className="mt-1 text-[10px] leading-[1.7]" style={{ color: "#0a4a40" }}>
							{`{ "active": 12, "idle": 3 }`}
						</pre>
					</div>
				</div>
			</section>

			{/* Features — terminal cards */}
			<section id="features" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "#1a5a50" }}>
						// features.config
					</div>
					<h2
						className="mt-4 text-[clamp(1.8rem,3.5vw,3rem)] font-bold tracking-[-0.03em]"
						style={{ color: "#8af0e4" }}
					>
						System-Module
					</h2>

					<div className="mt-16 grid gap-4 md:grid-cols-2">
						{[
							{ cmd: "track", title: "Echtzeit-Tracking", desc: "Starten, stoppen, pausieren — alles in Echtzeit synchronisiert." },
							{ cmd: "report", title: "Auto-Reports", desc: "Berichte generieren sich selbst. Export als CSV, PDF oder JSON." },
							{ cmd: "sync", title: "API-First", desc: "REST-API für alle Endpunkte. Integriert sich in Ihren Stack." },
							{ cmd: "secure", title: "Verschlüsselt", desc: "Ende-zu-Ende-Verschlüsselung. Ihre Daten bleiben Ihre Daten." },
						].map((f) => (
							<div
								key={f.cmd}
								className="p-8 transition-all hover:border-[rgba(0,220,200,0.15)]"
								style={{
									border: "1px solid rgba(0,220,200,0.06)",
									backgroundColor: "rgba(0,220,200,0.02)",
								}}
							>
								<span className="text-[11px]" style={{ color: "#1a5a50" }}>
									$ z8 {f.cmd}
								</span>
								<h3 className="mt-3 text-[17px] font-bold" style={{ color: "#8af0e4" }}>
									{f.title}
								</h3>
								<p className="mt-2 text-[13px] leading-[1.7]" style={{ color: "#2a6a60" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-16 lg:mx-16">
				<div className="grid gap-4 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-48 overflow-hidden" style={{ border: "1px solid rgba(0,220,200,0.06)" }}>
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.1) brightness(0.4) contrast(1.3) hue-rotate(140deg)" }} />
							<div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 60%, rgba(6,8,12,0.8))" }} />
						</div>
					))}
				</div>
			</section>

			{/* Specs strip */}
			<section
				id="specs"
				className="relative z-10 px-8 py-16 lg:px-16"
				style={{ borderTop: "1px solid rgba(0,220,200,0.06)", borderBottom: "1px solid rgba(0,220,200,0.06)" }}
			>
				<div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8">
					{[
						{ val: "99.99%", label: "uptime" },
						{ val: "<50ms", label: "latency" },
						{ val: "256bit", label: "encryption" },
						{ val: "∞", label: "scalability" },
					].map((s) => (
						<div key={s.label} className="text-center">
							<div
								className="text-[clamp(1.5rem,3vw,2.5rem)] font-bold"
								style={{ color: "#00dcc8", textShadow: "0 0 20px rgba(0,220,200,0.2)" }}
							>
								{s.val}
							</div>
							<div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: "#1a5a50" }}>
								{s.label}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 flex flex-col items-center px-8 py-32 text-center lg:px-16">
				<h2
					className="text-[clamp(2rem,4vw,3.5rem)] font-bold leading-[1.1] tracking-[-0.03em]"
					style={{ color: "#8af0e4" }}
				>
					<span style={{ color: "#1a5a50" }}>&gt;</span> Ready to{" "}
					<span style={{ color: "#00dcc8", textShadow: "0 0 30px rgba(0,220,200,0.3)" }}>execute</span>?
				</h2>
				<a
					href="#"
					className="mt-10 px-10 py-4 text-[12px] font-bold uppercase tracking-[0.1em] transition-all hover:shadow-[0_0_40px_rgba(0,220,200,0.3)]"
					style={{ backgroundColor: "#00dcc8", color: "#06080c" }}
				>
					&gt; z8 --start
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(0,220,200,0.04)" }}>
				<div className="flex items-center justify-between">
					<span className="text-[11px]" style={{ color: "#0a3a34" }}>
						/* z8 v2.0 */
					</span>
					<Link href="/" className="text-[11px] transition-colors hover:text-[#00dcc8]" style={{ color: "#1a5a50" }}>
						cd ~/designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
