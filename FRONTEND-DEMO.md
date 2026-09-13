# Remember Us — frontend-only demo

The default build is now static HTML, JavaScript, images and audio. It does not deploy a server, use Supabase, require an API key, or connect to OpenAI.

## Run and deploy

`npm run build` produces `dist`. `npm run preview` serves it at http://127.0.0.1:8080. Use `npm run dev` to build and serve. Set `PORT` to use a different port.

Cloudflare Workers Builds: build command `npm run build`; deploy command `npx wrangler deploy`. The root `wrangler.json` deploys only static assets. No environment variables are required. Previously configured runtime secrets are not used or included in the build.

Open **Start local demo** to create a Singapore sample and open family and elder views side by side. Or create a family through onboarding. Family codes only work in the same browser profile and origin. The two frames/tabs share localStorage; updates are serialized using Web Locks where available. Signing out clears the role selection but keeps the family. Clearing browser site data deletes the local demo data. Existing Supabase data is not migrated, modified or deleted.

## Simulation boundaries

- Chat uses exact matching against confirmed family records. Unknown questions appear in the local family view for confirmation. There is no AI model, live speech recognition, or continuous voice session. The microphone-shaped demo button plays a predefined sample question; replies can be read using browser speech synthesis.
- Maps, location, guidance and weather are simulated. They are not suitable for real navigation or safety monitoring. Use Settings → Demo control to simulate leaving and returning home.
- In-app calls use the existing recorded demonstration; they do not contact another device. Phone links, if configured by the user, still open the device dialer.
- Family editors retain manual entry and rule-based fallbacks. AI extraction and real voice input are unavailable.
- No cross-device sync, real authentication, push notifications, or cloud backup. Do not store real sensitive personal information in a shared demo browser.

The earlier `server`, `src`, Supabase files and historical tests remain in source history for reference, but are excluded from the static build and are not the active application runtime. `npm test` verifies the current static runtime; historical server tests do not represent this demo's features.
