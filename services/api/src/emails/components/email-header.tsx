import { Column, Img, Link, Row, Section } from "react-email";

type EmailHeaderProps = {
  siteUrl: string;
};

export function EmailHeader({ siteUrl }: EmailHeaderProps) {
  return (
    <Section style={header}>
      <Row>
        <Column style={markColumn}>
          <Link href={siteUrl} aria-label="Sillage">
            <Img
              src={`${siteUrl}/logo-mark.svg`}
              width="34"
              height="34"
              alt=""
              style={mark}
            />
          </Link>
        </Column>
        <Column>
          <Link href={siteUrl} style={wordmark}>
            Sillage
          </Link>
        </Column>
      </Row>
    </Section>
  );
}

const header = {
  borderBottom: "1px solid #cfcec7",
  padding: "24px 32px",
};

const markColumn = {
  width: "48px",
  verticalAlign: "middle",
};

const mark = {
  display: "block",
};

const wordmark = {
  color: "#11110f",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "13px",
  fontWeight: "700",
  letterSpacing: "0.19em",
  lineHeight: "34px",
  textDecoration: "none",
  textTransform: "uppercase" as const,
};
