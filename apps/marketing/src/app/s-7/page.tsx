import Image from "next/image";
import Link from "next/link";

export default function DesignS7() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'IBM Plex Sans', 'DM Sans', 'Archivo', sans-serif",
				backgroundColor: "#0c0f0e",
				color: "#b8c4b8",
			}}
		>
			{/* Copper patina ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 50% 40% at 30% 20%, rgba(60,140,100,0.06) 0%, transparent 50%), radial-gradient(ellipse 60% 50% at 70% 80%, rgba(180,120,60,0.05) 0%, transparent 50%)",
				}}
			/>

			{/* Vertical copper strip */}
			<div
				className="pointer-events-none fixed right-[15%] top-0 z-0 h-full w-[2px]"
				style={{
					background: "linear-gradient(to bottom, transparent, rgba(180,120,60,0.15) 20%, rgba(60,140,100,0.1) 50%, rgba(180,120,60,0.15) 80%, transparent)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-5">
					<span
						className="text-[22px] font-bold tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #b87840, #4a9a6a)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<div className="h-4 w-px" style={{ backgroundColor: "rgba(180,120,60,0.2)" }} />
					<span className="text-[10px] font-medium tracking-[0.3em] uppercase" style={{ color: "#3a5a48" }}>
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] font-medium tracking-[0.15em] uppercase md:flex" style={{ color: "#3a5a48" }}>
					<a href="#features" className="transition-colors hover:text-[#b87840]">Funktionen</a>
					<a href="#craft" className="transition-colors hover:text-[#b87840]">Handwerk</a>
					<a href="#contact" className="transition-colors hover:text-[#b87840]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[11px] font-semibold tracking-[0.1em] uppercase transition-all hover:bg-[#b87840] hover:text-[#0c0f0e]"
					style={{ border: "1px solid #3a5a48", color: "#5a9a6a" }}
				>
					Starten
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[88vh] flex-col justify-center px-8 lg:px-16">
				<div className="max-w-3xl">
					{/* Patina badge */}
					<div
						className="animate-fade-up mb-8 inline-flex items-center gap-3 px-4 py-2"
						style={{
							backgroundColor: "rgba(60,140,100,0.08)",
							border: "1px solid rgba(60,140,100,0.12)",
							animationDelay: "0s",
						}}
					>
						<div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#4a9a6a" }} />
						<span className="text-[11px] font-medium tracking-[0.15em] uppercase" style={{ color: "#4a9a6a" }}>
							Oxidiert, nicht veraltet
						</span>
					</div>

					<h1
						className="animate-fade-up text-[clamp(2.5rem,6vw,5rem)] font-bold leading-[1.05] tracking-[-0.03em]"
						style={{ color: "#d4dcd4", animationDelay: "0.15s" }}
					>
						Beständig wie
						<br />
						<span
							style={{
								background: "linear-gradient(135deg, #b87840, #4a9a6a)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Kupfer
						</span>
						.
					</h1>

					<p
						className="animate-fade-up mt-8 max-w-md text-[15px] leading-[1.8]"
						style={{ color: "#5a7a68", animationDelay: "0.3s" }}
					>
						Kupfer wird mit der Zeit nicht schwächer — es entwickelt Charakter.
						Z8 ist die Zeiterfassung, die mit Ihrem Unternehmen reift.
					</p>

					<div className="animate-fade-up mt-12 flex items-center gap-6" style={{ animationDelay: "0.45s" }}>
						<a
							href="#contact"
							className="px-8 py-3.5 text-[12px] font-bold tracking-[0.1em] uppercase transition-all hover:shadow-[0_0_30px_rgba(184,120,64,0.2)]"
							style={{
								background: "linear-gradient(135deg, #b87840, #8a5a2a)",
								color: "#0c0f0e",
							}}
						>
							Kostenlos testen
						</a>
						<a
							href="#features"
							className="text-[12px] tracking-[0.1em] uppercase transition-colors hover:text-[#b87840]"
							style={{ color: "#3a5a48" }}
						>
							Erkunden →
						</a>
					</div>

					{/* Hero image strip */}
					<div className="animate-fade-up mt-16 grid grid-cols-2 gap-4" style={{ animationDelay: "0.6s" }}>
						<div className="relative h-48 overflow-hidden">
							<Image
								src="https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0.25) sepia(0.2) brightness(0.55) contrast(1.2)" }}
							/>
							<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(60,140,100,0.1), rgba(180,120,60,0.1))" }} />
						</div>
						<div className="relative h-48 overflow-hidden">
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0.25) sepia(0.2) brightness(0.55) contrast(1.2)" }}
							/>
							<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(180,120,60,0.1), rgba(60,140,100,0.1))" }} />
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="flex items-center gap-4 mb-4">
						<div className="h-px flex-1" style={{ backgroundColor: "rgba(180,120,60,0.12)" }} />
						<span className="text-[10px] font-medium tracking-[0.3em] uppercase" style={{ color: "#5a4a38" }}>
							Module
						</span>
						<div className="h-px flex-1" style={{ backgroundColor: "rgba(60,140,100,0.08)" }} />
					</div>

					<div className="mt-12 grid gap-px md:grid-cols-3" style={{ backgroundColor: "rgba(60,140,100,0.06)" }}>
						{[
							{ icon: "▣", title: "Stempeluhr", desc: "Präzise Zeiterfassung, ein Klick zum Start, ein Klick zum Ende." },
							{ icon: "▤", title: "Dashboard", desc: "Echtzeit-Übersicht über alle Mitarbeiter und laufende Projekte." },
							{ icon: "▥", title: "Berichte", desc: "Automatische Monats- und Projektberichte, exportbereit." },
						].map((f) => (
							<div key={f.title} className="p-10" style={{ backgroundColor: "#0c0f0e" }}>
								<div className="text-[24px]" style={{ color: "#4a9a6a" }}>{f.icon}</div>
								<h3 className="mt-4 text-[17px] font-semibold" style={{ color: "#b8c4b8" }}>
									{f.title}
								</h3>
								<p className="mt-2 text-[13px] leading-[1.7]" style={{ color: "#4a6a58" }}>
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
						"https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-56 overflow-hidden">
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.3) sepia(0.2) brightness(0.6) contrast(1.15)" }} />
							<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(60,140,100,0.1), rgba(180,120,60,0.08))" }} />
						</div>
					))}
				</div>
			</section>

			{/* Craft section */}
			<section id="craft" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-3xl">
					<div className="flex flex-col items-center text-center">
						{/* Copper/patina gradient bar */}
						<div
							className="mb-8 h-1 w-24"
							style={{ background: "linear-gradient(90deg, #b87840, #4a9a6a)" }}
						/>
						<h2
							className="text-[clamp(1.5rem,3vw,2.5rem)] font-light leading-[1.3] tracking-[-0.01em]"
							style={{ color: "#8aa898" }}
						>
							&ldquo;Software, die Patina ansetzt, statt zu veralten — das ist unser Versprechen.&rdquo;
						</h2>
					</div>
				</div>
			</section>

			{/* Stats */}
			<section className="relative z-10 px-8 py-16 lg:px-16" style={{ borderTop: "1px solid rgba(60,140,100,0.06)" }}>
				<div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-8">
					{[
						{ val: "5+", label: "Jahre am Markt" },
						{ val: "10k", label: "Nutzer" },
						{ val: "99.9%", label: "Uptime" },
						{ val: "DSGVO", label: "Konform" },
					].map((s) => (
						<div key={s.label} className="text-center">
							<div
								className="text-[clamp(1.5rem,3vw,2.5rem)] font-bold"
								style={{
									background: "linear-gradient(135deg, #b87840, #4a9a6a)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								{s.val}
							</div>
							<div className="mt-1 text-[10px] font-medium tracking-[0.2em] uppercase" style={{ color: "#3a5a48" }}>
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
					style={{ color: "#d4dcd4" }}
				>
					Bereit für
					<br />
					<span
						style={{
							background: "linear-gradient(135deg, #b87840, #4a9a6a)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Beständigkeit
					</span>
					?
				</h2>
				<a
					href="#"
					className="mt-10 px-10 py-4 text-[12px] font-bold tracking-[0.1em] uppercase transition-all hover:shadow-[0_0_30px_rgba(184,120,64,0.2)]"
					style={{ background: "linear-gradient(135deg, #b87840, #8a5a2a)", color: "#0c0f0e" }}
				>
					Jetzt starten
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(60,140,100,0.04)" }}>
				<div className="flex items-center justify-between">
					<span className="text-[11px]" style={{ color: "#2a3a30" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[11px] transition-colors hover:text-[#b87840]" style={{ color: "#3a5a48" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
