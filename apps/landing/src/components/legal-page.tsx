import type { ReactNode } from "react";
import { Wordmark } from "./brand";

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  documentLabel: string;
  effectiveDate: string;
  introduction: ReactNode;
  sections: LegalSection[];
  title: string;
};

export function LegalPage({
  documentLabel,
  effectiveDate,
  introduction,
  sections,
  title,
}: LegalPageProps) {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <a href="/" aria-label="Sillage home"><Wordmark /></a>
        <nav aria-label="Legal documents">
          <a href="/privacy">Privacy</a>
          <a href="/tos">Terms</a>
        </nav>
      </header>

      <section className="legal-hero">
        <p className="section-index">{documentLabel}</p>
        <h1>{title}</h1>
        <div className="legal-effective">
          <span>Effective</span>
          <time dateTime="2026-07-27">{effectiveDate}</time>
        </div>
        <div className="legal-introduction">{introduction}</div>
      </section>

      <div className="legal-layout">
        <aside>
          <p className="section-index">CONTENTS</p>
          <ol>
            {sections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <article>
          {sections.map((section, index) => (
            <section id={section.id} key={section.id}>
              <div className="legal-section-heading">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{section.title}</h2>
              </div>
              <div className="legal-section-copy">{section.content}</div>
            </section>
          ))}
        </article>
      </div>

      <footer className="legal-footer">
        <a href="/"><Wordmark /></a>
        <p>SIA JB Holdings · Rīga, Latvia</p>
        <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a>
      </footer>
    </main>
  );
}
