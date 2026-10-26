import { createFileRoute } from "@tanstack/react-router";
import App from "../App";
import { getReleaseCatalog } from "../lib/releases";

export const Route = createFileRoute("/")({
  loader: () => getReleaseCatalog(),
  component: IndexPage,
});

function IndexPage() {
  return <App releaseCatalog={Route.useLoaderData()} />;
}
