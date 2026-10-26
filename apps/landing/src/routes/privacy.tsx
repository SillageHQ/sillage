import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, type LegalSection } from "../components/legal-page";

const sections: LegalSection[] = [
  {
    id: "controller",
    title: "Who controls your data",
    content: <>
      <p>Sillage is operated by SIA JB Holdings, a Latvian limited liability company registered under number 50203500001 and VAT number LV50203500001.</p>
      <dl className="legal-details">
        <div><dt>Controller</dt><dd>SIA JB Holdings</dd></div>
        <div><dt>Address</dt><dd>Krišjāņa Valdemāra iela 149–5, Rīga, LV-1013, Latvia</dd></div>
        <div><dt>Privacy contact</dt><dd><a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a></dd></div>
      </dl>
      <p>This policy applies to the Sillage website, account area, desktop application, APIs, waitlist, and related support communications.</p>
    </>,
  },
  {
    id: "collection",
    title: "Data we collect",
    content: <>
      <h3>Account and authentication data</h3>
      <p>We process your name, email address, profile image when provided by an identity provider, account verification status, beta access status, passkey public credentials, authentication sessions, connected desktop sessions, IP address, browser or device information, and security timestamps.</p>
      <h3>Your content</h3>
      <p>When you connect a vault or use Sillage, we process the notes and files you choose to index, file paths and metadata, conversations, prompts, generated responses, saved drafts, knowledge proposals, capture jobs, and the links between those records. Your notes may contain personal data about you or other people. You are responsible for ensuring that you have the right to provide that content.</p>
      <h3>Settings and integrations</h3>
      <p>We process workspace preferences, selected AI models, sync state, and integration configuration. If you connect OpenRouter, its API credential is encrypted before storage and is not returned in readable form through the Sillage API.</p>
      <h3>Waitlist and communications</h3>
      <p>If you join the waitlist, we collect your name, email address, beta tag, subscription status, and email delivery events such as opens, clicks, bounces, and unsubscribes. If you contact us, we process the contents of your message and the information needed to reply.</p>
      <h3>Technical data</h3>
      <p>We process request and security logs, error details, approximate timestamps, device and browser characteristics, and limited usage metadata necessary to operate, secure, diagnose, and improve the service. We do not use third-party advertising analytics.</p>
    </>,
  },
  {
    id: "purposes",
    title: "Why we use it",
    content: <>
      <div className="legal-purpose-grid">
        <div><h3>Provide the service</h3><p>To create your account, authenticate you, index the content you select, retrieve relevant context, generate responses, sync connected devices, and provide exports.</p><span>Contract · GDPR Art. 6(1)(b)</span></div>
        <div><h3>Protect Sillage</h3><p>To prevent abuse, investigate failures, secure accounts, enforce beta access, and maintain service reliability.</p><span>Legitimate interests · GDPR Art. 6(1)(f)</span></div>
        <div><h3>Communicate</h3><p>To deliver sign-in links, service notices, support replies, and beta updates you requested.</p><span>Contract or consent · GDPR Art. 6(1)(a–b)</span></div>
        <div><h3>Meet obligations</h3><p>To respond to lawful requests, protect legal rights, and comply with accounting, consumer, and data-protection duties.</p><span>Legal obligation · GDPR Art. 6(1)(c)</span></div>
      </div>
      <p>We do not sell personal data, use it for targeted advertising, or make decisions about you that produce legal or similarly significant effects solely through automated processing.</p>
    </>,
  },
  {
    id: "ai",
    title: "How AI processing works",
    content: <>
      <p>Sillage sends only the context needed for the feature you request to OpenRouter, using the OpenRouter account and model configuration you connect. OpenRouter routes the request to the model provider you select or that the routing configuration selects. This can include note excerpts, messages, instructions, and generated output.</p>
      <p>OpenRouter states that prompt and response content is not retained by OpenRouter by default unless logging or data-use settings are enabled. Individual model providers have their own locations, retention rules, and training policies. Before selecting a model, review its data-policy label and the relevant provider terms. Sillage cannot control a model provider’s independent practices.</p>
      <p>AI output can be inaccurate. Sillage is designed to help retrieve and work with your own material; it should not be treated as professional, legal, medical, financial, or factual advice without independent verification.</p>
    </>,
  },
  {
    id: "sharing",
    title: "Processors and recipients",
    content: <>
      <p>We disclose data only as needed to operate Sillage, follow your instructions, protect legal rights, or comply with law.</p>
      <dl className="legal-vendors">
        <div><dt>UpCloud</dt><dd>Primary application and database hosting in Warsaw, Poland.</dd></div>
        <div><dt>Cloudflare</dt><dd>Network security, Turnstile bot protection, transactional email delivery, DNS, and release-file delivery.</dd></div>
        <div><dt>OpenRouter and selected model providers</dt><dd>AI inference and related request metadata when you use AI-powered features.</dd></div>
        <div><dt>Lumail</dt><dd>Waitlist subscriber management, beta email workflows, delivery, and engagement tracking.</dd></div>
        <div><dt>Google Analytics</dt><dd>Consent-based website traffic and campaign attribution.</dd></div>
        <div><dt>PostHog</dt><dd>Consent-based anonymous product analytics and beta-funnel measurement.</dd></div>
        <div><dt>Google</dt><dd>Optional Google sign-in when you choose that authentication method.</dd></div>
      </dl>
      <p>We may disclose information to authorities where legally required, to professional advisers bound by confidentiality, or in connection with a merger, financing, acquisition, or sale of assets. Any successor must respect this policy for data received from us.</p>
    </>,
  },
  {
    id: "transfers",
    title: "Location and transfers",
    content: <>
      <p>Sillage’s primary infrastructure and database are hosted with UpCloud in Warsaw, Poland, within the European Economic Area. Some processors—including Cloudflare, Lumail, OpenRouter, Google, and model providers—may process data in the United States or other countries.</p>
      <p>Where personal data leaves the EEA, we rely on an applicable adequacy decision, contractual safeguards such as the European Commission’s Standard Contractual Clauses, or another lawful transfer mechanism. The exact destination of AI content can depend on the model provider you select.</p>
    </>,
  },
  {
    id: "retention",
    title: "Retention and deletion",
    content: <>
      <p>Account information, workspace settings, conversations, indexed content, and connected-device records are retained while your account is active. When you delete your Sillage account, Sillage removes the account and its active workspace data immediately from its systems. Sillage does not keep routine application backups after deletion.</p>
      <p>Waitlist information is retained until you unsubscribe or ask us to delete it. Lumail may retain suppression records needed to ensure that unsubscribed, bounced, or complained-about addresses are not emailed again. Support communications may be retained only while needed to resolve the request or meet a legal obligation.</p>
      <p>Third-party processors may retain limited security, billing, routing, or compliance records under their own policies. Content already sent for AI inference is subject to the selected provider’s retention rules. We may retain narrowly limited information where law requires it or where necessary to establish, exercise, or defend legal claims.</p>
    </>,
  },
  {
    id: "cookies",
    title: "Cookies and tracking",
    content: <>
      <p>Sillage uses essential cookies and equivalent local storage for authentication, session security, and requested product functionality. These technologies are necessary to provide the service and cannot be disabled through a consent banner.</p>
      <p>Cloudflare Turnstile processes browser and device signals to distinguish people from abusive automated traffic. If you consent, Google Analytics measures traffic sources and page visits, while PostHog measures anonymous product-funnel events. Lumail records email delivery and engagement events, including opens and link clicks, for beta communications. Sillage does not use advertising cookies, cross-site behavioural profiling, or third-party advertising networks.</p>
    </>,
  },
  {
    id: "rights",
    title: "Your privacy rights",
    content: <>
      <p>Subject to applicable law, you may ask us to provide access to your personal data, correct it, export it, delete it, restrict its processing, or object to processing based on legitimate interests. Where processing relies on consent, you may withdraw that consent at any time without affecting earlier lawful processing.</p>
      <p>Sillage provides an account export and account-deletion function. You can also exercise your rights by emailing <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a>. We may need to verify your identity before fulfilling a request. We normally respond within one month, subject to extensions permitted by law.</p>
      <p>If privacy law where you live grants additional rights—for example, rights to know, correct, delete, or receive a portable copy of data—you may exercise them through the same contact. We will not discriminate against you for making a privacy request. Sillage does not sell personal data or share it for cross-context behavioural advertising.</p>
      <p>You may lodge a complaint with the <a href="https://www.dvi.gov.lv/en/services/complaint-concerning-processing-personal-data">Latvian Data State Inspectorate</a> or with the supervisory authority where you live or work. You are not required to contact us first, although we welcome the opportunity to resolve your concern.</p>
    </>,
  },
  {
    id: "security",
    title: "Security and responsibility",
    content: <>
      <p>We use measures designed to protect personal data, including transport encryption, access controls, tenant separation, hashed authentication and beta tokens, encrypted integration credentials, and restricted administrative access. No online service can guarantee absolute security.</p>
      <p>Protect access to your email account, devices, passkeys, and third-party credentials. Tell us promptly at <a href="mailto:hello@sillagehq.app">hello@sillagehq.app</a> if you believe your Sillage account or personal data has been compromised.</p>
    </>,
  },
  {
    id: "children-changes",
    title: "Children and policy changes",
    content: <>
      <p>Sillage is not directed to children under 16, and we do not knowingly collect their personal data. If you believe a child has provided data to us, contact us so we can delete it.</p>
      <p>We may update this policy as Sillage evolves or legal requirements change. We will post the revised version here and change the effective date. If a change materially affects how registered users’ data is handled, we will provide reasonable advance notice through the service or by email.</p>
    </>,
  },
];

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Sillage" },
      { name: "description", content: "How Sillage collects, uses, protects, and deletes personal data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      documentLabel="LEGAL 01 — PRIVACY"
      effectiveDate="27 July 2026"
      title="Privacy Policy"
      introduction={<>
        <p>Your notes can be deeply personal. This policy explains, in plain language, what Sillage processes, why it is needed, where it goes, and the controls you have.</p>
        <p>Sillage is designed around a simple boundary: your content is used to provide the product you request, not to build an advertising profile about you.</p>
      </>}
      sections={sections}
    />
  );
}
