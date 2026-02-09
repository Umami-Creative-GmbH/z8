import Image from "next/image";
import Link from "next/link";

export default function DesignS5() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Space Grotesk', 'Outfit', 'Sora', sans-serif",
				backgroundColor: "#f0f2f8",
				color: "#2a2e3a",
			}}
		>
			{/* Frost ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 60% 50% at 50% 0%, rgba(180,200,240,0.25) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 80% 80%, rgba(200,210,240,0.15) 0%, transparent 50%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-3">
					<span className="text-[22px] font-bold tracking-[-0.03em]" style={{ color: "#4a5a8a" }}>
						Z8
					</span>
				</div>
				<nav className="hidden items-center gap-8 text-[13px] font-medium md:flex" style={{ color: "#7a84a0" }}>
					<a href="#features" className="transition-colors hover:text-[#4a5a8a]">Funktionen</a>
					<a href="#glass" className="transition-colors hover:text-[#4a5a8a]">Vorteile</a>
					<a href="#contact" className="transition-colors hover:text-[#4a5a8a]">Preise</a>
				</nav>
				<a
					href="#contact"
					className="rounded-2xl px-6 py-2.5 text-[13px] font-semibold transition-all hover:shadow-lg"
					style={{
						backgroundColor: "rgba(255,255,255,0.7)",
						backdropFilter: "blur(12px)",
						border: "1px solid rgba(255,255,255,0.8)",
						color: "#4a5a8a",
					}}
				>
					Starten
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[88vh] flex-col items-center justify-center px-8 text-center lg:px-16">
				{/* Frosted glass card */}
				<div
					className="animate-scale-in"
					style={{
						animationDelay: "0s",
						padding: "64px 48px",
						borderRadius: 32,
						backgroundColor: "rgba(255,255,255,0.45)",
						backdropFilter: "blur(40px)",
						border: "1px solid rgba(255,255,255,0.6)",
						boxShadow: "0 8px 60px rgba(100,120,180,0.08), inset 0 1px 0 rgba(255,255,255,0.6)",
						maxWidth: 720,
					}}
				>
					<p
						className="animate-fade-up text-[11px] font-semibold tracking-[0.25em] uppercase"
						style={{ color: "#7a84a0", animationDelay: "0.15s" }}
					>
						Kristallklare Zeiterfassung
					</p>

					<h1
						className="animate-fade-up mt-6 text-[clamp(2.5rem,5.5vw,4.5rem)] font-bold leading-[1.08] tracking-[-0.04em]"
						style={{ color: "#2a2e3a", animationDelay: "0.3s" }}
					>
						Durchsichtig.
						<br />
						<span style={{ color: "#8a94b8" }}>Durchdacht.</span>
					</h1>

					<p
						className="animate-fade-up mx-auto mt-8 max-w-md text-[15px] leading-[1.75]"
						style={{ color: "#5a6080", animationDelay: "0.45s" }}
					>
						Wie gefrostetes Glas — Z8 zeigt genau das, was Sie brauchen,
						und blendet alles andere aus. Reine Klarheit.
					</p>

					<div className="animate-fade-up mt-10 flex items-center justify-center gap-4" style={{ animationDelay: "0.6s" }}>
						<a
							href="#contact"
							className="rounded-2xl px-8 py-3.5 text-[13px] font-bold transition-all hover:shadow-lg"
							style={{ backgroundColor: "#4a5a8a", color: "#f0f2f8" }}
						>
							Kostenlos testen
						</a>
						<a
							href="#features"
							className="rounded-2xl px-8 py-3.5 text-[13px] font-semibold transition-all hover:bg-white/60"
							style={{
								backgroundColor: "rgba(255,255,255,0.5)",
								border: "1px solid rgba(255,255,255,0.7)",
								color: "#4a5a8a",
							}}
						>
							Erkunden
						</a>
					</div>
				</div>

				{/* Hero image — frosted row below glass card */}
				<div className="animate-fade-up mt-16 flex items-center justify-center gap-4" style={{ animationDelay: "0.75s" }}>
					{[
						"https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div
							key={i}
							className="relative h-40 w-64 overflow-hidden"
							style={{
								borderRadius: 20,
								border: "1px solid rgba(255,255,255,0.5)",
								boxShadow: "0 4px 30px rgba(100,120,180,0.06)",
							}}
						>
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.4) brightness(1.05)" }} />
						</div>
					))}
				</div>
			</section>

			{/* Features — glass cards */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<h2
						className="text-center text-[clamp(1.8rem,3.5vw,2.8rem)] font-bold tracking-[-0.03em]"
						style={{ color: "#2a2e3a" }}
					>
						Schicht für Schicht
					</h2>

					<div className="mt-16 grid gap-6 md:grid-cols-3">
						{[
							{ icon: "◯", title: "Ein-Klick Start", desc: "Stempeln ohne Nachdenken. Die Uhr läuft ab dem ersten Tippen." },
							{ icon: "△", title: "Glasklare Berichte", desc: "Daten, die sich von selbst erklären. Kein Rätselraten." },
							{ icon: "□", title: "Team-Transparenz", desc: "Jeder sieht, was er braucht. Nicht mehr, nicht weniger." },
						].map((f) => (
							<div
								key={f.title}
								className="p-8 transition-all hover:shadow-lg"
								style={{
									borderRadius: 24,
									backgroundColor: "rgba(255,255,255,0.5)",
									backdropFilter: "blur(20px)",
									border: "1px solid rgba(255,255,255,0.6)",
								}}
							>
								<div className="text-[28px] font-light" style={{ color: "#8a94b8" }}>
									{f.icon}
								</div>
								<h3 className="mt-4 text-[17px] font-bold" style={{ color: "#2a2e3a" }}>
									{f.title}
								</h3>
								<p className="mt-2 text-[14px] leading-[1.7]" style={{ color: "#6a7090" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Glass dashboard preview */}
			<section id="glass" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-4xl">
					<div
						className="p-8 lg:p-12"
						style={{
							borderRadius: 32,
							backgroundColor: "rgba(255,255,255,0.4)",
							backdropFilter: "blur(30px)",
							border: "1px solid rgba(255,255,255,0.5)",
							boxShadow: "0 8px 60px rgba(100,120,180,0.06)",
						}}
					>
						{/* Mock toolbar */}
						<div className="flex items-center justify-between mb-8">
							<div className="flex items-center gap-3">
								<div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#e0c8c8" }} />
								<div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#e0dcc8" }} />
								<div className="h-3 w-3 rounded-full" style={{ backgroundColor: "#c8e0cc" }} />
							</div>
							<div className="h-6 w-48 rounded-lg" style={{ backgroundColor: "rgba(74,90,138,0.08)" }} />
						</div>
						{/* Mock content rows */}
						<div className="space-y-3">
							{[
								{ name: "Max Mustermann", hours: "7:45", w: "77%" },
								{ name: "Anna Schmidt", hours: "8:12", w: "82%" },
								{ name: "Jan Weber", hours: "6:30", w: "65%" },
								{ name: "Lisa Meyer", hours: "8:00", w: "80%" },
							].map((r) => (
								<div
									key={r.name}
									className="flex items-center gap-4 rounded-xl p-4"
									style={{ backgroundColor: "rgba(255,255,255,0.5)" }}
								>
									<div className="h-8 w-8 rounded-full" style={{ backgroundColor: "rgba(74,90,138,0.12)" }} />
									<div className="flex-1">
										<div className="text-[13px] font-semibold" style={{ color: "#2a2e3a" }}>{r.name}</div>
										<div
											className="mt-1 h-2 rounded-full"
											style={{
												width: r.w,
												backgroundColor: "rgba(74,90,138,0.15)",
											}}
										/>
									</div>
									<div className="text-[14px] font-bold" style={{ color: "#4a5a8a" }}>{r.hours}</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 px-8 py-12 lg:px-16">
				<div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div
							key={i}
							className="relative h-56 overflow-hidden"
							style={{
								borderRadius: 24,
								border: "1px solid rgba(255,255,255,0.5)",
							}}
						>
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.5) brightness(1.05) contrast(0.95)" }} />
						</div>
					))}
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 flex flex-col items-center px-8 py-32 text-center lg:px-16">
				<h2
					className="text-[clamp(2rem,4vw,3.2rem)] font-bold leading-[1.1] tracking-[-0.03em]"
					style={{ color: "#2a2e3a" }}
				>
					Sehen Sie klar.
				</h2>
				<p className="mt-4 text-[15px]" style={{ color: "#7a84a0" }}>
					Starten Sie heute — kostenlos und unverbindlich.
				</p>
				<a
					href="#"
					className="mt-10 rounded-2xl px-10 py-4 text-[14px] font-bold transition-all hover:shadow-lg"
					style={{ backgroundColor: "#4a5a8a", color: "#f0f2f8" }}
				>
					Jetzt starten
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(74,90,138,0.1)" }}>
				<div className="flex items-center justify-between">
					<span className="text-[12px]" style={{ color: "#9a9eb8" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[12px] transition-colors hover:text-[#4a5a8a]" style={{ color: "#9a9eb8" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
