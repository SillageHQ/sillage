import { Hr, Link, Section } from "react-email";

type EmailFooterProps = {
  siteUrl: string;
};

export function EmailFooter({ siteUrl }: EmailFooterProps) {
  return (
    <>
      <Hr style={rule} />
      <Section style={footer}>
        <Link href={siteUrl} style={siteLink}>
          sillagehq.app
        </Link>
      </Section>
    </>
  );
}

const rule = {
  borderColor: "#cfcec7",
  borderTop: "1px solid #cfcec7",
  margin: "0",
};

const footer = {
  padding: "24px 32px 30px",
};

const siteLink = {
  color: "#2855d9",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "12px",
  fontWeight: "600",
  letterSpacing: "0.04em",
  textDecoration: "none",
};
