import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => {
    const compare = search.compare === "1" || search.compare === 1 || search.compare === true;
    const code =
      typeof search.code === "string" || typeof search.code === "number"
        ? String(search.code)
        : "";
    const localDemo =
      search.localDemo === "1" || search.localDemo === 1 || search.localDemo === true;

    return {
      ...(compare && /^\d{6}$/.test(code) ? { compare: true, code } : {}),
      ...(localDemo ? { localDemo: true } : {}),
    };
  },
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
  const { compare, code, localDemo } = Route.useSearch();

  if (compare && code && /^\d{6}$/.test(code)) {
    const shared = new URLSearchParams({ embedded: "1", code });
    if (localDemo) shared.set("localDemo", "1");
    const frameSrc = (role: "family" | "elder") => {
      const frame = new URLSearchParams(shared);
      frame.set("dualRole", role);
      if (role === "elder" && localDemo) frame.set("localElder", "1");
      return `/app/index.html?${frame.toString()}`;
    };

    return (
      <main className="flex h-screen min-w-[880px] flex-col overflow-hidden bg-[#f3eee8] text-[#34271f]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#d8cec4] bg-[#fffaf5] px-5">
          <div className="flex min-w-0 items-baseline gap-3">
            <strong className="text-base tracking-[-0.01em]">Remember Us</strong>
            <span className="truncate text-sm text-[#786b61]">
              Live dual-side comparison · Family {code}
            </span>
          </div>
          <a
            href="/"
            className="rounded-full bg-[#e9efe1] px-4 py-2 text-sm font-semibold text-[#60723f] transition hover:bg-[#dfe8d3] focus:outline-none focus:ring-2 focus:ring-[#8a9a4e]"
          >
            Exit comparison
          </a>
        </header>
        <section className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-[#d8cec4]">
          <div className="relative min-w-0 bg-[#f8f4ef]">
            <span className="absolute left-5 top-4 z-10 rounded-full bg-[#edf1e6] px-3 py-1 text-xs font-bold text-[#687748]">
              Family side
            </span>
            <iframe
              src={frameSrc("family")}
              title="Remember Us family side"
              allow="microphone; geolocation"
              className="h-full w-full border-0"
            />
          </div>
          <div className="relative min-w-0 bg-[#fff8f1]">
            <span className="absolute left-5 top-4 z-10 rounded-full bg-[#f7e7d9] px-3 py-1 text-xs font-bold text-[#aa683c]">
              Elder side
            </span>
            <iframe
              src={frameSrc("elder")}
              title="Remember Us elder side"
              allow="microphone; geolocation"
              className="h-full w-full border-0"
            />
          </div>
        </section>
      </main>
    );
  }

  const appSearch = new URLSearchParams();
  if (localDemo) appSearch.set("localDemo", "1");
  const appQuery = appSearch.size ? `?${appSearch.toString()}` : "";

  return (
    <main className="h-screen w-screen overflow-hidden">
      <h1 className="sr-only">Remember Us · Family Memory Companion</h1>
      <iframe
        src={`/app/index.html${appQuery}`}
        title="Remember Us prototype"
        allow="microphone; geolocation"
        className="h-full w-full border-0"
      />
    </main>
  );
}
