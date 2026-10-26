import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import styles from "../styles.css?url";
import { Analytics } from "../components/analytics";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sillage — Your notes. Now part of every conversation." },
      { name: "description", content: "Sillage is an AI workspace with a verifiable memory built from your Obsidian notes." },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "icon", href: "/favicon.svg" },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body><Outlet /><Analytics /><Scripts /></body>
    </html>
  );
}
