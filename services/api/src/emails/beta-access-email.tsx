import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "react-email";
import { EmailFooter } from "./components/email-footer.js";
import { EmailHeader } from "./components/email-header.js";

type BetaAccessEmailProps = {
  name?: string;
  code?: string;
  signUpUrl?: string;
  activateUrl?: string;
  siteUrl?: string;
};

export function BetaAccessEmail({
  name = "there",
  code = "SIL-XXXX-XXXX-XXXX-XXXX",
  signUpUrl = "https://sillagehq.app/sign-up",
  activateUrl = "https://sillagehq.app/activate",
  siteUrl = "https://sillagehq.app",
}: BetaAccessEmailProps = {}) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Sillage private beta access</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader siteUrl={siteUrl} />
          <Section style={content}>
            <Text style={eyebrow}>Private beta · place 1–20</Text>
            <Heading style={heading}>Your place is ready.</Heading>
            <Text style={lead}>Hi {name}, you’re one of the first 20 people to join the Sillage beta.</Text>
            <Text style={copy}>Create your account, then activate it with this one-time code:</Text>
            <Section style={codeBox}><Text style={codeStyle}>{code}</Text></Section>
            <Button href={signUpUrl} style={button}>Create your Sillage account&nbsp;&nbsp;→</Button>
            <Text style={copy}>After signing up, enter the code on your account page or open the activation page directly:</Text>
            <Text style={linkText}><a href={activateUrl} style={link}>{activateUrl}</a></Text>
            <Text style={note}>Beta access is free. Sillage uses your own OpenRouter key for AI usage, and the desktop download will be available from your account once access is activated.</Text>
          </Section>
          <EmailFooter siteUrl={siteUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export default BetaAccessEmail;

const body = { backgroundColor: "#f5f4ef", color: "#11110f", fontFamily: "Arial, Helvetica, sans-serif", margin: "0", padding: "38px 16px" };
const container = { backgroundColor: "#ecebe5", border: "1px solid #cfcec7", margin: "0 auto", maxWidth: "600px" };
const content = { padding: "48px 32px 52px" };
const eyebrow = { color: "#2855d9", fontFamily: "'Courier New', Courier, monospace", fontSize: "10px", letterSpacing: "0.1em", lineHeight: "16px", margin: "0 0 22px", textTransform: "uppercase" as const };
const heading = { color: "#11110f", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "46px", fontWeight: "400", letterSpacing: "-0.04em", lineHeight: "48px", margin: "0 0 24px" };
const lead = { color: "#393934", fontSize: "16px", lineHeight: "26px", margin: "0 0 18px" };
const copy = { color: "#393934", fontSize: "15px", lineHeight: "24px", margin: "18px 0" };
const codeBox = { backgroundColor: "#11110f", margin: "28px 0", padding: "20px 16px", textAlign: "center" as const };
const codeStyle = { color: "#ffffff", fontFamily: "'Courier New', Courier, monospace", fontSize: "22px", fontWeight: "700", letterSpacing: "0.08em", margin: "0" };
const button = { backgroundColor: "#2855d9", boxSizing: "border-box" as const, color: "#ffffff", display: "inline-block", fontFamily: "'Courier New', Courier, monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "0.06em", lineHeight: "18px", padding: "16px 22px", textDecoration: "none", textTransform: "uppercase" as const };
const linkText = { fontSize: "13px", lineHeight: "20px", margin: "0" };
const link = { color: "#2855d9" };
const note = { borderLeft: "2px solid #2855d9", color: "#66665f", fontSize: "13px", lineHeight: "21px", margin: "30px 0 0", paddingLeft: "14px" };

BetaAccessEmail.PreviewProps = { name: "Jean-Benoît", code: "SIL-ABCD-EFGH-JKLM-NPQR", signUpUrl: "https://sillagehq.app/sign-up", activateUrl: "https://sillagehq.app/activate", siteUrl: "https://sillagehq.app" } satisfies BetaAccessEmailProps;
