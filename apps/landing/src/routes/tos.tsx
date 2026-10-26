import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "../components/legal-page";

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement and provider",
    content: <>
      <p>These Terms of Service form a binding agreement between you and SIA JB Holdings, registration number 50203500001, of Krišjāņa Valdemāra iela 149–5, Rīga, LV-1013, Latvia (“Sillage”, “we”, “us”). They govern your use of the Sillage website, desktop application, APIs, beta programme, and related services.</p>
      <p>By creating an account, activating beta access, downloading or using the application, or otherwise using Sillage, you agree to these Terms and acknowledge the <a href="/privacy">Privacy Policy</a>. If you use Sillage for an organisation, you confirm that you can bind that organisation.</p>
      <p>You must be at least 16 years old and legally capable of entering into this agreement. If mandatory law in your country requires a higher age or parental consent, that requirement applies.</p>
    </>,
  },
  {
    id: "service",
    title: "What Sillage provides",
    content: <>
      <p>Sillage is a contextual memory layer for Obsidian. It can index content you select, retrieve relevant passages, support conversations grounded in your material, generate drafts and proposals, and resurface related notes. Features, limits, supported platforms, and model availability may change as the product develops.</p>
      <p>Sillage does not replace Obsidian or your original files. You are responsible for maintaining your own source files and appropriate backups. Sillage is not an archival, emergency, or guaranteed-availability service.</p>
    </>,
  },
  {
    id: "accounts",
    title: "Accounts and beta access",
    content: <>
      <p>You must provide accurate account information and keep your sign-in methods, email account, devices, passkeys, and access tokens secure. You are responsible for activity performed through your account unless it resulted from our breach of these Terms or applicable law.</p>
      <p>Account creation may be open while product access remains limited to approved beta testers. A beta code is personal, single-use, revocable, and may not be sold, published, shared, or used to bypass access limits. We may suspend or revoke beta access where necessary to protect the service or enforce these Terms.</p>
      <p>Contact <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a> promptly if you suspect unauthorised access.</p>
    </>,
  },
  {
    id: "beta-pricing",
    title: "Beta and future paid plans",
    content: <>
      <p>The private beta is provided without a Sillage subscription charge to invited beta testers. You remain responsible for third-party costs you choose to incur, including OpenRouter or model-provider usage.</p>
      <p>When Sillage reaches a stable commercial release, continued access may require a paid subscription. We will not charge you automatically merely because you participated in the free beta. Before any charge, we will present the price, billing interval, taxes, renewal terms, included usage, cancellation method, and applicable refund terms, and ask you to affirmatively purchase a plan.</p>
      <p>Any future paid terms will supplement these Terms. Mandatory consumer rights, including rights concerning digital services and withdrawal where applicable, remain unaffected.</p>
    </>,
  },
  {
    id: "content",
    title: "Your content",
    content: <>
      <p>You retain ownership of your notes, messages, files, prompts, and other material you provide to Sillage (“Your Content”). You grant us a limited, non-exclusive licence to host, copy, process, transmit, transform, and display Your Content only as needed to provide, secure, and support Sillage and to follow your instructions.</p>
      <p>You confirm that you have the rights and lawful basis needed to process Your Content through Sillage, including personal or confidential information about other people. Do not upload content whose use through an AI or cloud service would violate a duty, contract, law, or another person’s rights.</p>
      <p>You are responsible for reviewing generated output before relying on, publishing, or applying it. Sillage may produce incomplete, inaccurate, or unexpected results.</p>
    </>,
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    content: <>
      <p>You may not use Sillage to:</p>
      <ul>
        <li>break the law, infringe intellectual property, privacy, confidentiality, or other rights;</li>
        <li>create, distribute, or facilitate malware, phishing, spam, fraud, harassment, exploitation, or unlawful surveillance;</li>
        <li>access another person’s account, workspace, device, or data without authorisation;</li>
        <li>probe, bypass, disable, or interfere with security, beta restrictions, rate limits, authentication, or tenant isolation;</li>
        <li>scrape, overload, disrupt, reverse engineer, or extract non-public source code or model components except where applicable law expressly permits it;</li>
        <li>resell or provide Sillage as a service to third parties without our written agreement; or</li>
        <li>use output as the sole basis for decisions that create legal or similarly significant effects concerning another person.</li>
      </ul>
      <p>We may investigate suspected abuse and restrict access where reasonably necessary to protect users, third parties, or the service.</p>
    </>,
  },
  {
    id: "third-parties",
    title: "Third-party services",
    content: <>
      <p>Sillage interoperates with services such as Obsidian, OpenRouter, model providers, Google authentication, Cloudflare, and other integrations you choose. Those services are governed by their own terms, privacy notices, pricing, availability, and data practices.</p>
      <p>You are responsible for your third-party accounts, credentials, settings, and charges. We do not control and are not responsible for a third party’s service, model output, suspension, security incident, pricing change, or retention practice. Sillage may stop supporting an integration where continued support is impractical, insecure, or unlawful.</p>
    </>,
  },
  {
    id: "feedback-ip",
    title: "Feedback and Sillage IP",
    content: <>
      <p>We own Sillage, including its software, design, branding, documentation, and all related intellectual-property rights, except for Your Content, third-party components, and open-source software governed by their licences. These Terms give you only a limited, revocable, non-transferable right to use Sillage for its intended purpose.</p>
      <p>Beta testers may send suggestions, issue reports, or other feedback. You grant us a perpetual, worldwide, royalty-free right to use that feedback without restriction or compensation, provided it does not transfer ownership of Your Content to us.</p>
    </>,
  },
  {
    id: "availability",
    title: "Beta availability and changes",
    content: <>
      <p>Beta software is experimental. Features may be incomplete, unavailable, changed, or removed; data formats may evolve; and interruptions or defects may occur. We may impose usage limits, maintenance windows, or compatibility requirements.</p>
      <p>We aim to operate Sillage carefully, but we do not promise uninterrupted availability, permanent preservation of generated or indexed data, compatibility with every Obsidian setup, or that a particular AI model will remain available. Keep independent backups of your original notes and important exports.</p>
    </>,
  },
  {
    id: "termination",
    title: "Suspension, termination, and deletion",
    content: <>
      <p>You may stop using Sillage and delete your account at any time. Account deletion removes your active Sillage workspace data as described in the Privacy Policy. Uninstalling the desktop application alone does not delete your cloud account.</p>
      <p>We may suspend or terminate access if you materially breach these Terms, create security or legal risk, misuse beta access, fail to pay a future subscription, or if operating the service becomes unlawful or impracticable. Where reasonable, we will provide notice and an opportunity to export Your Content, unless urgent action is required or notice is legally prohibited.</p>
      <p>Terms that by their nature should survive termination—including ownership, disclaimers, liability limits, and dispute provisions—will continue to apply.</p>
    </>,
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    content: <>
      <p>To the fullest extent permitted by law, Sillage and the beta are provided “as is” and “as available”. We disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, availability, and uninterrupted or error-free operation.</p>
      <p>Sillage output is generated or assisted by automated systems and may be wrong. It is not professional advice. Nothing in these Terms excludes warranties or remedies that cannot lawfully be excluded, particularly mandatory rights available to consumers in the European Economic Area.</p>
    </>,
  },
  {
    id: "liability",
    title: "Limitation of liability",
    content: <>
      <p>To the fullest extent permitted by law, neither Sillage nor SIA JB Holdings will be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, goodwill, opportunities, or data, arising from Sillage or these Terms.</p>
      <p>Our total aggregate liability arising from Sillage or these Terms will not exceed the greater of EUR 100 or the amount you paid directly to SIA JB Holdings for Sillage during the twelve months before the event giving rise to the claim.</p>
      <p>These limits do not apply to fraud, wilful misconduct, death or personal injury caused by negligence, breach of obligations that cannot be limited under applicable data-protection law, or any liability that applicable law does not permit us to exclude or limit.</p>
    </>,
  },
  {
    id: "indemnity",
    title: "Responsibility for claims",
    content: <>
      <p>If you use Sillage on behalf of a business, you will indemnify SIA JB Holdings against third-party claims, losses, and reasonable costs arising from Your Content, your unlawful use of Sillage, or your material breach of these Terms, except to the extent caused by us.</p>
      <p>This business indemnity does not apply to consumers acting outside a trade or profession where it would conflict with mandatory consumer law.</p>
    </>,
  },
  {
    id: "law-disputes",
    title: "Governing law and disputes",
    content: <>
      <p>These Terms are governed by the laws of the Republic of Latvia, without regard to conflict-of-law principles. Before filing a claim, contact <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a> and allow 30 days for an informal resolution.</p>
      <p>Subject to mandatory law, the courts of Riga, Latvia have exclusive jurisdiction. If you are an EEA consumer, you retain the protection of mandatory laws in your country of residence and may bring proceedings in any court available to you under applicable consumer law.</p>
    </>,
  },
  {
    id: "changes-general",
    title: "Changes and general terms",
    content: <>
      <p>We may update these Terms as Sillage evolves. We will post the new version and effective date and provide reasonable advance notice of material changes to registered users. If you do not agree, you must stop using Sillage before the revised Terms take effect.</p>
      <p>These Terms and documents expressly incorporated into them are the entire agreement about Sillage. If one provision is unenforceable, the remainder stays effective. A delay in enforcement is not a waiver. You may not assign your rights without our consent; we may assign this agreement as part of a reorganisation, financing, merger, or sale, subject to applicable law.</p>
      <p>Questions about these Terms may be sent to <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a> or SIA JB Holdings, Krišjāņa Valdemāra iela 149–5, Rīga, LV-1013, Latvia.</p>
    </>,
  },
];

export const Route = createFileRoute("/tos")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Sillage" },
      { name: "description", content: "The terms governing use of Sillage and its private beta." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      documentLabel="LEGAL 02 — TERMS"
      effectiveDate="27 July 2026"
      title="Terms of Service"
      introduction={<>
        <p>These terms define the agreement between you and Sillage: what the product provides, what remains yours, and the boundaries that keep the service dependable.</p>
        <p>The private beta is free for invited testers. Moving to the stable paid product will always require clear pricing and your affirmative choice.</p>
      </>}
      sections={sections}
    />
  );
}
