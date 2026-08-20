import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "守护助手 · 阿尔茨海默双端伴侣" },
      {
        name: "description",
        content:
          "面向阿尔茨海默中度早期家庭的双端伴侣：老人端识人、问答与回家引导，家人端补充信息并处理提醒。",
      },
      { property: "og:title", content: "守护助手 · 阿尔茨海默双端伴侣" },
      {
        property: "og:description",
        content: "温暖的手机原型：老人端与家人端通过家庭码实时联动。",
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
      <h1 className="sr-only">守护助手 · 阿尔茨海默双端伴侣</h1>
      <iframe
        src="/app/index.html"
        title="守护助手原型"
        className="h-full w-full border-0"
      />
    </main>
  );
}
