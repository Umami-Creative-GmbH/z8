import Image from "next/image";
import Link from "next/link";

export default function Design12() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Futura', 'Century Gothic', 'Avant Garde', sans-serif",
				backgroundColor: "#f5f0e8",
				color: "#1a1a1a",
			}}
		>
			{/* Header */}
			<header
				className="relative z-10 flex items-center justify-between px-8 py-5 lg:px-12"
				style={{ borderBottom: "3px solid #1a1a1a" }}
			>
				<div className="flex items-center gap-4">
					<div
						className="flex h-12 w-12 items-center justify-center text-sm font-black text-white"
						style={{ backgroundColor: "#d42b2b" }}
					>
						Z8
					</div>
					<span className="text-[11px] font-black uppercase tracking-[0.3em]">Zeiterfassung</span>
				</div>
				<nav className="hidden items-center gap-8 text-[11px] font-bold uppercase tracking-[0.15em] md:flex">
					<a href="#features" className="transition-colors hover:text-[#d42b2b]">Funktionen</a>
					<a href="#system" className="transition-colors hover:text-[#2356a8]">System</a>
					<a href="#contact" className="transition-colors hover:text-[#e8a820]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white"
					style={{ backgroundColor: "#2356a8" }}
				>
					Demo
				</a>
			</header>

			{/* Hero - Bauhaus composition */}
			<section className="relative z-10 overflow-hidden px-8 pb-20 pt-16 lg:px-12">
				<div className="grid gap-8 lg:grid-cols-12">
					<div className="lg:col-span-7">
						{/* Geometric decoration */}
						<div className="animate-fade-in mb-8 flex items-center gap-4" style={{ animationDelay: "0.1s" }}>
							<div className="h-6 w-6 rounded-full" style={{ backgroundColor: "#e8a820" }} />
							<div className="h-6 w-6" style={{ backgroundColor: "#d42b2b" }} />
							<div className="h-6 w-6" style={{ backgroundColor: "#2356a8", clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)" }} />
						</div>

						<h1
							className="animate-fade-up text-[clamp(3.5rem,10vw,9rem)] font-black uppercase leading-[0.85] tracking-[-0.04em]"
							style={{ animationDelay: "0.2s" }}
						>
							<span className="block">Zeit</span>
							<span className="block" style={{ color: "#d42b2b" }}>Ist</span>
							<span className="block">Form.</span>
						</h1>

						<p
							className="animate-fade-up mt-8 max-w-md text-[14px] font-medium leading-[1.8]"
							style={{ animationDelay: "0.4s", color: "#666" }}
						>
							Modulare Arbeitszeiterfassung mit dem Anspruch an Gestaltung, Funktion und
							Pr&auml;zision. GoBD-konform. Kompromisslos.
						</p>
					</div>

					{/* Bauhaus image composition */}
					<div className="animate-scale-in relative lg:col-span-5" style={{ animationDelay: "0.3s" }}>
						<div className="relative h-[50vh]">
							{/* Yellow block */}
							<div className="absolute left-0 top-0 h-1/2 w-3/5 overflow-hidden" style={{ backgroundColor: "#e8a820" }}>
								<Image
									src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80&auto=format&fit=crop"
									alt=""
									fill
									className="object-cover mix-blend-multiply opacity-60"
								/>
							</div>
							{/* Blue block */}
							<div className="absolute bottom-0 right-0 h-1/2 w-3/5 overflow-hidden" style={{ backgroundColor: "#2356a8" }}>
								<Image
									src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&q=80&auto=format&fit=crop"
									alt=""
									fill
									className="object-cover mix-blend-multiply opacity-50"
								/>
							</div>
							{/* Red circle */}
							<div
								className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
								style={{ backgroundColor: "#d42b2b" }}
							/>
							{/* Black text overlay */}
							<div className="absolute bottom-4 left-4 bg-[#1a1a1a] px-4 py-2">
								<span className="text-[10px] font-black uppercase tracking-[0.3em] text-white">
									Bauhaus &bull; 2025
								</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Color bar */}
			<section className="relative z-10 flex h-3">
				<div className="flex-1" style={{ backgroundColor: "#d42b2b" }} />
				<div className="flex-1" style={{ backgroundColor: "#2356a8" }} />
				<div className="flex-1" style={{ backgroundColor: "#e8a820" }} />
				<div className="flex-1" style={{ backgroundColor: "#1a1a1a" }} />
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-12" style={{ backgroundColor: "#1a1a1a", color: "#f5f0e8" }}>
				<div className="mb-16 flex items-center gap-6">
					<div className="h-8 w-8 rounded-full" style={{ backgroundColor: "#e8a820" }} />
					<h2 className="text-3xl font-black uppercase tracking-tight">Funktionen</h2>
				</div>

				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Ein Klick, sofort synchron.", bg: "#d42b2b" },
						{ title: "GoBD-Konform", desc: "Revisionssicher. Unver\u00e4nderbar. L\u00fcckenlos.", bg: "#2356a8" },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch.", bg: "#e8a820" },
						{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert. Sicher.", bg: "#e8a820" },
						{ title: "SSO & SCIM", desc: "SAML, OIDC. Enterprise-Authentifizierung.", bg: "#d42b2b" },
						{ title: "Dashboards", desc: "\u00dcberstunden, Trends, Auslastung. Echtzeit.", bg: "#2356a8" },
					].map((f, i) => (
						<div
							key={i}
							className="group relative overflow-hidden p-8 transition-colors hover:text-white"
							style={{ border: "2px solid #333" }}
						>
							<div
								className="absolute inset-0 origin-bottom scale-y-0 transition-transform duration-500 group-hover:scale-y-100"
								style={{ backgroundColor: f.bg }}
							/>
							<div className="relative z-10">
								<h3 className="mb-2 text-lg font-black uppercase tracking-tight">{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#888] transition-colors group-hover:text-white/80">
									{f.desc}
								</p>
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Bauhaus image section */}
			<section className="relative z-10">
				<div className="grid md:grid-cols-3">
					<div className="relative h-64 overflow-hidden" style={{ backgroundColor: "#d42b2b" }}>
						<Image
							src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=500&q=80&auto=format&fit=crop"
							alt="" fill className="object-cover mix-blend-multiply opacity-50"
						/>
					</div>
					<div className="flex items-center justify-center p-8" style={{ backgroundColor: "#e8a820" }}>
						<p className="text-center text-2xl font-black uppercase tracking-tight text-[#1a1a1a]">
							Form Follows Function.
						</p>
					</div>
					<div className="relative h-64 overflow-hidden" style={{ backgroundColor: "#2356a8" }}>
						<Image
							src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=500&q=80&auto=format&fit=crop"
							alt="" fill className="object-cover mix-blend-multiply opacity-50"
						/>
					</div>
				</div>
			</section>

			{/* System */}
			<section id="system" className="relative z-10 px-8 py-24 lg:px-12">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-6 flex items-center justify-center gap-3">
						<div className="h-4 w-4" style={{ backgroundColor: "#d42b2b" }} />
						<div className="h-4 w-4" style={{ backgroundColor: "#2356a8" }} />
						<div className="h-4 w-4" style={{ backgroundColor: "#e8a820" }} />
					</div>
					<h2 className="mb-6 text-4xl font-black uppercase tracking-tight">
						Weniger ist mehr.
					</h2>
					<p className="text-[15px] leading-[1.8] text-[#666]">
						Z8 wurde mit dem Anspruch entwickelt, dass gute Gestaltung immer auch gute Funktion
						bedeutet. Jedes Element dient einem Zweck.
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-20 lg:px-12" style={{ backgroundColor: "#2356a8", color: "#f5f0e8" }}>
				<div className="mx-auto max-w-xl text-center">
					<h2 className="mb-4 text-4xl font-black uppercase tracking-tight">Bereit?</h2>
					<p className="mb-8 text-[14px] leading-relaxed text-white/70">
						Erleben Sie Zeiterfassung, die gestaltet ist.
					</p>
					<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
						<a
							href="mailto:hello@z8.app"
							className="bg-white px-8 py-3.5 text-[11px] font-black uppercase tracking-[0.2em] text-[#2356a8]"
						>
							Demo anfragen
						</a>
						<a
							href="mailto:hello@z8.app"
							className="px-8 py-3.5 text-[11px] tracking-[0.2em] text-white/60 transition-colors hover:text-white"
						>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-6 lg:px-12" style={{ borderTop: "3px solid #1a1a1a" }}>
				<div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.3em] text-[#999]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#d42b2b]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
