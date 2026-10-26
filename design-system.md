# Sillage Design System

Selected direction: **Vibe 5 — The Trail**  
Scale: **Refined**

## Anti-slop art direction override

This override takes precedence over incidental styling in the original generated section below.

- Art direction: restrained editorial modernism with an asymmetric, print-like composition.
- The memorable device is one continuous blue wake/trail crossing the page and connecting past notes to the present.
- Use warm near-black ink (`#0b0b0a`) and warm paper (`#efeee9`) as dominant fields. Blue (`#2855d9`) is a rare functional signal, never a glow wash.
- Typography must feel authored: a characterful serif display face paired with a neutral grotesk and small mono metadata. Avoid Inter, Roboto, Space Grotesk, giant generic sans headlines, and gradient text.
- Do not use centered SaaS heroes, pill-shaped CTA groups, bento grids, equal rounded feature cards, glassmorphism, neon glows, floating particles, fake terminal windows, decorative dashboards, stat counters, testimonials, or badge clutter.
- Prefer rules, columns, folio numbers, marginal notes, source paths, deliberate overlaps, hard edges, and generous negative space.
- Product demonstrations should look like fragments of real notes and cited sources, not generic UI skeletons.
- Corners are square or nearly square. Shadows are rare. Motion is slow, directional, and tied to the wake metaphor.
- Copy is sparse and confident. Each section should make one point.
- The logo is the split-plane mark: a warm-black left plane and cobalt right plane separated by an S-shaped negative-space wake. It represents Sillage layered above the vault. Never replace it with a document, sparkle, brain, generic diamond, or AI symbol.
- The page must remain highly legible, accessible, responsive, and respectful of reduced-motion preferences.

The following is the complete selected Gemini Design MCP section. It is the visual source of truth for subsequent frontend generation.

```tsx
// REQUIRED DEPENDENCIES:
// None (Self-contained React + TypeScript + CSS)

import React, { useState, useEffect, useMemo } from 'react';

const SillageHero = () => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Generate deterministic "fading notes" for the visualization
  const notes = useMemo(() => {
    return Array.from({ length: 18 }).map((_, i) => ({
      id: i,
      x: 15 + Math.random() * 70,
      y: 20 + Math.random() * 60,
      size: 40 + Math.random() * 60,
      delay: i * 0.15,
      rotation: (Math.random() - 0.5) * 20,
    }));
  }, []);

  return (
    <section className="sillage-hero">
      <style>{`
        :root {
          --sillage-bg: #09090b;
          --sillage-text: #fafafa;
          --sillage-accent: #3b82f6;
          --sillage-faded: #71717a;
          --sillage-border: rgba(255, 255, 255, 0.08);
          --sillage-glass: rgba(255, 255, 255, 0.03);
          --font-main: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --font-serif: "Ibarra Real Nova", serif;
        }

        .sillage-hero {
          position: relative;
          width: 100%;
          min-height: 90vh;
          background: var(--sillage-bg);
          color: var(--sillage-text);
          font-family: var(--font-main);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 2rem;
        }

        .sillage-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.03;
          pointer-events: none;
        }

        .trail-container {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
        }

        .note-fragment {
          position: absolute;
          background: var(--sillage-glass);
          border: 1px solid var(--sillage-border);
          backdrop-filter: blur(4px);
          border-radius: 4px;
          animation: floatIn 8s ease-in-out infinite alternate;
          opacity: 0;
        }

        @keyframes floatIn {
          0% { opacity: 0; transform: translateY(20px) rotate(var(--rot)); }
          20% { opacity: 0.15; }
          80% { opacity: 0.15; }
          100% { opacity: 0; transform: translateY(-40px) rotate(calc(var(--rot) + 10deg)); }
        }

        .nav-brand {
          position: absolute;
          top: 2rem;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 0.75rem;
          z-index: 10;
        }

        .logo-mark {
          width: 20px;
          height: 20px;
          border: 1.5px solid var(--sillage-accent);
          position: relative;
          transform: rotate(45deg);
        }

        .logo-mark::after {
          content: "";
          position: absolute;
          inset: -4px 0 0 -4px;
          border-left: 1.5px solid var(--sillage-accent);
          border-top: 1.5px solid var(--sillage-accent);
          opacity: 0.4;
        }

        .wordmark {
          font-weight: 500;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          font-size: 0.75rem;
          color: var(--sillage-text);
        }

        .content-wrap {
          position: relative;
          z-index: 10;
          text-align: center;
          max-width: 640px;
        }

        .kicker {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.3em;
          color: var(--sillage-accent);
          margin-bottom: 1.5rem;
          display: block;
        }

        .hero-title {
          font-size: clamp(2rem, 5vw, 3.25rem);
          font-weight: 600;
          line-height: 1.1;
          letter-spacing: -0.03em;
          margin-bottom: 1.5rem;
          background: linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.7) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .hero-title span {
          color: var(--sillage-accent);
          -webkit-text-fill-color: var(--sillage-accent);
          font-style: italic;
          font-family: serif;
        }

        .hero-description {
          font-size: 1rem;
          color: var(--sillage-faded);
          line-height: 1.6;
          margin-bottom: 2.5rem;
          max-width: 440px;
          margin-left: auto;
          margin-right: auto;
        }

        .cta-group {
          display: flex;
          gap: 1rem;
          justify-content: center;
          align-items: center;
        }

        .btn-primary {
          background: var(--sillage-text);
          color: var(--sillage-bg);
          padding: 0.75rem 1.5rem;
          border-radius: 100px;
          font-size: 0.875rem;
          font-weight: 500;
          text-decoration: none;
          transition: all 0.2s ease;
          border: 1px solid var(--sillage-text);
        }

        .btn-primary:hover {
          background: transparent;
          color: var(--sillage-text);
          transform: translateY(-2px);
        }

        .btn-secondary {
          background: transparent;
          color: var(--sillage-faded);
          padding: 0.75rem 1.5rem;
          border-radius: 100px;
          font-size: 0.875rem;
          font-weight: 500;
          text-decoration: none;
          transition: all 0.2s ease;
          border: 1px solid transparent;
        }

        .btn-secondary:hover {
          color: var(--sillage-text);
          border-color: var(--sillage-border);
        }

        .cursor-glow {
          position: absolute;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none;
          z-index: 2;
          transform: translate(-50%, -50%);
          transition: transform 0.1s ease-out;
        }

        @media (max-width: 768px) {
          .sillage-hero { padding: 1.5rem; }
          .hero-title { font-size: 2.25rem; }
        }
      `}</style>

      <div className="nav-brand">
        <div className="logo-mark" />
        <span className="wordmark">Sillage</span>
      </div>

      <div className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />

      <div className="trail-container">
        {notes.map((note) => (
          <div
            key={note.id}
            className="note-fragment"
            style={{
              left: `${note.x}%`,
              top: `${note.y}%`,
              width: `${note.size}px`,
              height: `${note.size * 1.2}px`,
              animationDelay: `${note.delay}s`,
              '--rot': `${note.rotation}deg`
            } as any}
          />
        ))}
      </div>

      <div className="content-wrap">
        <span className="kicker">Memory without effort</span>
        <h1 className="hero-title">
          Follow the <span>trail</span> of your own best thinking.
        </h1>
        <p className="hero-description">
          Sillage lives on your desktop, quietly surfaced relevant moments from your past notes exactly when you're working on them today.
        </p>

        <div className="cta-group">
          <a href="#download" className="btn-primary">Download for Desktop</a>
          <a href="#how" className="btn-secondary">See how it works</a>
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: '2rem',
        fontSize: '0.65rem',
        color: 'var(--sillage-faded)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        <span style={{
          width: '6px',
          height: '6px',
          background: '#22c55e',
          borderRadius: '50%',
          boxShadow: '0 0 8px #22c55e'
        }} />
        sillagehq.app • currently listening for context
      </div>
    </section>
  );
};

export default SillageHero;
```
