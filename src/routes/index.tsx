import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Remember Us · Family Memory Companion" },
      {
        name: "description",
        content:
          "A two-sided memory companion for families living with Alzheimer's: recognition, trusted answers, and guidance for elders; shared context and alerts for caregivers.",
      },
      { property: "og:title", content: "Remember Us · Family Memory Companion" },
      {
        property: "og:description",
        content: "A warm two-phone prototype linked by a shared family code.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="h-screen w-screen overflow-hidden">
      <h1 className="sr-only">Remember Us · Family Memory Companion</h1>
      <iframe
        src="/app/index.html"
        title="Remember Us prototype"
        className="h-full w-full border-0"
      />
    </main>
  );
}
