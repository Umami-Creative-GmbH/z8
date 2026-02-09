import Image from "next/image";
import Link from "next/link";

export default function DesignS10() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'Instrument Sans', 'Geist', 'Inter Tight', sans-serif",
				backgroundColor: "#0e1118",
				color: "#b0b8cc",
			}}
		>
			{/* Slate blue ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 50% 40% at 50% 0%, rgba(60,80,130,0.08) 0%, transparent 60%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-center gap-6">
					<span className="text-[20px] font-bold tracking-[-0.04em]" style={{ color: "#e0e4f0" }}>
						Z8
					</span>
					<nav className="hidden items-center gap-6 text-[13px] font-medium md:flex" style={{ color: "#4a5470" }}>
						<a href="#features" className="transition-colors hover:text-[#e0e4f0]">Produkt</a>
						<a href="#precision" className="transition-colors hover:text-[#e0e4f0]">Preise</a>
						<a href="#contact" className="transition-colors hover:text-[#e0e4f0]">Kontakt</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[13px] font-medium transition-colors hover:text-[#e0e4f0]" style={{ color: "#4a5470" }}>
						Anmelden
					</a>
					<a
						href="#contact"
						className="rounded-lg px-5 py-2 text-[13px] font-semibold transition-all hover:bg-[#3a5aa0]"
						style={{ backgroundColor: "#2a4080", color: "#e0e4f0" }}
					>
						Starten
					</a>
				</div>
			</header>

			{/* Hero — asymmetric geometric */}
			<section className="relative z-10 flex min-h-[88vh] flex-col justify-center px-8 lg:px-16">
				<div className="grid items-center gap-16 lg:grid-cols-[1fr_1fr]">
					{/* Left text */}
					<div className="max-w-xl">
						<div
							className="animate-fade-up mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5"
							style={{
								backgroundColor: "rgba(42,64,128,0.15)",
								border: "1px solid rgba(42,64,128,0.2)",
								animationDelay: "0s",
							}}
						>
							<div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#4a80d0" }} />
							<span className="text-[11px] font-semibold" style={{ color: "#6a8ac0" }}>
								Neu: Team-Kalender
							</span>
						</div>

						<h1
							className="animate-fade-up text-[clamp(2.5rem,5.5vw,4.5rem)] font-bold leading-[1.06] tracking-[-0.04em]"
							style={{ color: "#e0e4f0", animationDelay: "0.15s" }}
						>
							Präzision
							<br />
							in jeder
							<br />
							<span style={{ color: "#4a80d0" }}>Sekunde.</span>
						</h1>

						<p
							className="animate-fade-up mt-8 max-w-md text-[15px] leading-[1.75]"
							style={{ color: "#5a6480", animationDelay: "0.3s" }}
						>
							Wie Schweizer Uhrmacherei — Z8 verbindet Präzision mit Einfachheit.
							Keine überflüssigen Teile, jedes Zahnrad hat seinen Platz.
						</p>

						<div className="animate-fade-up mt-10 flex items-center gap-4" style={{ animationDelay: "0.45s" }}>
							<a
								href="#contact"
								className="rounded-lg px-8 py-3.5 text-[13px] font-bold transition-all hover:bg-[#3a5aa0]"
								style={{ backgroundColor: "#2a4080", color: "#e0e4f0" }}
							>
								Kostenlos testen
							</a>
							<a
								href="#features"
								className="rounded-lg px-8 py-3.5 text-[13px] font-semibold transition-all hover:bg-white/5"
								style={{ border: "1px solid rgba(74,128,208,0.2)", color: "#6a8ac0" }}
							>
								Erkunden
							</a>
						</div>
					</div>

					{/* Right — geometric slate dashboard */}
					<div className="animate-scale-in hidden lg:block" style={{ animationDelay: "0.5s" }}>
						<div
							className="rounded-2xl p-8"
							style={{
								backgroundColor: "rgba(20,24,38,0.8)",
								border: "1px solid rgba(74,128,208,0.08)",
								boxShadow: "0 20px 80px rgba(0,0,0,0.3)",
							}}
						>
							{/* Mock header bar */}
							<div className="flex items-center justify-between mb-6">
								<div className="flex items-center gap-2">
									<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "rgba(74,128,208,0.3)" }} />
									<div className="h-3 w-24 rounded" style={{ backgroundColor: "rgba(74,128,208,0.08)" }} />
								</div>
								<div className="h-3 w-16 rounded" style={{ backgroundColor: "rgba(74,128,208,0.06)" }} />
							</div>

							{/* Grid of data blocks */}
							<div className="grid grid-cols-3 gap-3 mb-6">
								{[
									{ label: "Heute", val: "7:42" },
									{ label: "Woche", val: "38:15" },
									{ label: "Monat", val: "162h" },
								].map((d) => (
									<div
										key={d.label}
										className="rounded-lg p-4"
										style={{ backgroundColor: "rgba(74,128,208,0.05)" }}
									>
										<div className="text-[10px] font-medium" style={{ color: "#4a5470" }}>{d.label}</div>
										<div className="mt-1 text-[18px] font-bold" style={{ color: "#e0e4f0" }}>{d.val}</div>
									</div>
								))}
							</div>

							{/* Bar chart */}
							<div className="flex items-end gap-2 h-24">
								{[40, 65, 80, 55, 70, 45, 20].map((h, i) => (
									<div
										key={i}
										className="flex-1 rounded-t"
										style={{
											height: `${h}%`,
											backgroundColor: i === 2 ? "#2a4080" : "rgba(74,128,208,0.1)",
										}}
									/>
								))}
							</div>
							<div className="flex justify-between mt-2">
								{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
									<span key={d} className="flex-1 text-center text-[9px]" style={{ color: "#3a4460" }}>
										{d}
									</span>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Features — clean grid */}
			<section id="features" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<h2
						className="text-[clamp(1.8rem,3.5vw,2.8rem)] font-bold tracking-[-0.03em]"
						style={{ color: "#e0e4f0" }}
					>
						Gebaut für Genauigkeit
					</h2>
					<p className="mt-3 text-[15px]" style={{ color: "#4a5470" }}>
						Jede Funktion an ihrem exakten Platz.
					</p>

					<div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
						{[
							{ num: "01", title: "Stempeln", desc: "Ein Klick, sofort erfasst." },
							{ num: "02", title: "Berichte", desc: "Auto-generiert, exportbereit." },
							{ num: "03", title: "Projekte", desc: "Zeit nach Projekt zuordnen." },
							{ num: "04", title: "API", desc: "REST-Endpunkte für alles." },
						].map((f) => (
							<div
								key={f.num}
								className="rounded-xl p-6"
								style={{
									backgroundColor: "rgba(42,64,128,0.06)",
									border: "1px solid rgba(42,64,128,0.08)",
								}}
							>
								<span className="text-[11px] font-bold" style={{ color: "#4a80d0" }}>
									{f.num}
								</span>
								<h3 className="mt-3 text-[16px] font-bold" style={{ color: "#c0c8e0" }}>
									{f.title}
								</h3>
								<p className="mt-2 text-[13px] leading-[1.6]" style={{ color: "#4a5470" }}>
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
						"https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-48 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(42,64,128,0.08)" }}>
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.2) brightness(0.5) contrast(1.2)" }} />
							<div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 50%, rgba(14,17,24,0.7))" }} />
						</div>
					))}
				</div>
			</section>

			{/* Precision section */}
			<section id="precision" className="relative z-10 px-8 py-16 lg:px-16" style={{ borderTop: "1px solid rgba(42,64,128,0.08)" }}>
				<div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8">
					{[
						{ val: "0.1s", label: "Reaktionszeit" },
						{ val: "99.99%", label: "Verfügbarkeit" },
						{ val: "AES-256", label: "Verschlüsselung" },
						{ val: "DSGVO", label: "Zertifiziert" },
					].map((s) => (
						<div key={s.label} className="text-center">
							<div className="text-[clamp(1.5rem,3vw,2.5rem)] font-bold" style={{ color: "#4a80d0" }}>
								{s.val}
							</div>
							<div className="mt-1 text-[11px] font-medium tracking-[0.1em] uppercase" style={{ color: "#3a4460" }}>
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
					style={{ color: "#e0e4f0" }}
				>
					Präzision beginnt <span style={{ color: "#4a80d0" }}>jetzt</span>.
				</h2>
				<a
					href="#"
					className="mt-10 rounded-lg px-10 py-4 text-[14px] font-bold transition-all hover:bg-[#3a5aa0]"
					style={{ backgroundColor: "#2a4080", color: "#e0e4f0" }}
				>
					Kostenlos starten
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(42,64,128,0.06)" }}>
				<div className="flex items-center justify-between">
					<span className="text-[11px]" style={{ color: "#2a3050" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[11px] transition-colors hover:text-[#4a80d0]" style={{ color: "#3a4460" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
