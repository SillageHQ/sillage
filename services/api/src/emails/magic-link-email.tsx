import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { EmailFooter } from "./components/email-footer.js";
import { EmailHeader } from "./components/email-header.js";

type MagicLinkEmailProps = {
  magicLinkUrl?: string;
  siteUrl?: string;
};

export function MagicLinkEmail({
  magicLinkUrl = "https://sillagehq.app/api/auth/magic-link/example",
  siteUrl = "https://sillagehq.app",
}: MagicLinkEmailProps = {}) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your secure link to sign in to Sillage</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader siteUrl={siteUrl} />
          <Section style={content}>
            <Text style={eyebrow}>Secure sign in · 10 minute link</Text>
            <Heading style={heading}>Return to your thoughts.</Heading>
            <Text style={lead}>
              Use the secure link below to sign in to Sillage. No password is required.
            </Text>
            <Button href={magicLinkUrl} style={button}>
              Sign in to Sillage&nbsp;&nbsp;→
            </Button>
            <Text style={securityNote}>
              This link expires in 10 minutes and can only be used once. If you did not
              request it, you can safely ignore this email.
            </Text>
            <Text style={fallback}>
              Button not working?{" "}
              <Link href={magicLinkUrl} style={fallbackLink}>
                Open the secure sign-in link
              </Link>
              .
            </Text>
          </Section>
          <EmailFooter siteUrl={siteUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export default MagicLinkEmail;

MagicLinkEmail.PreviewProps = {
  magicLinkUrl: "https://sillagehq.app/api/auth/magic-link/example",
  siteUrl: "https://sillagehq.app",
} satisfies MagicLinkEmailProps;

const body = {
  backgroundColor: "#f5f4ef",
  color: "#11110f",
  fontFamily: "Arial, Helvetica, sans-serif",
  margin: "0",
  padding: "38px 16px",
};

const container = {
  backgroundColor: "#ecebe5",
  border: "1px solid #cfcec7",
  margin: "0 auto",
  maxWidth: "600px",
};

const content = {
  padding: "48px 32px 52px",
};

const eyebrow = {
  color: "#2855d9",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: "10px",
  letterSpacing: "0.1em",
  lineHeight: "16px",
  margin: "0 0 22px",
  textTransform: "uppercase" as const,
};

const heading = {
  color: "#11110f",
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: "46px",
  fontWeight: "400",
  letterSpacing: "-0.04em",
  lineHeight: "48px",
  margin: "0 0 24px",
};

const lead = {
  color: "#393934",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "0 0 30px",
  maxWidth: "450px",
};

const button = {
  backgroundColor: "#2855d9",
  boxSizing: "border-box" as const,
  color: "#ffffff",
  display: "inline-block",
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.06em",
  lineHeight: "18px",
  padding: "16px 22px",
  textDecoration: "none",
  textTransform: "uppercase" as const,
};

const securityNote = {
  borderLeft: "2px solid #2855d9",
  color: "#5f5e58",
  fontSize: "12px",
  lineHeight: "19px",
  margin: "32px 0 0",
  paddingLeft: "14px",
};

const fallback = {
  color: "#77766f",
  fontSize: "11px",
  lineHeight: "18px",
  margin: "24px 0 0",
};

const fallbackLink = {
  color: "#11110f",
  textDecoration: "underline",
};
