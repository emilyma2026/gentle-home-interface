# Remember Us — local family data + real Live voice

Family data stays in this browser. Supabase is not used. A small server endpoint connects the elder's microphone to real OpenAI `gpt-live-1` through WebRTC; it does not store family data.

## Run and deploy

`npm run build` produces `dist`. `npm run preview` serves it at http://127.0.0.1:8080. Use `npm run dev` to build and serve. Set `PORT` to use a different port.

Cloudflare Workers Builds: build command `npm run build`; deploy command `npx wrangler deploy`. The root `wrangler.json` deploys static assets and the Live endpoint. Set `OPENAI_API_KEY` as a Worker runtime Secret; locally place it in `.env`. The key must have access to `gpt-live-1`. `LIVE_LOOKUP_MODEL` defaults to `gpt-4o-mini`. Neither key nor `.env` is copied into `dist`.

Open **Start local demo** to create a Singapore sample and open family and elder views side by side. Or create a family through onboarding. Family codes only work in the same browser profile and origin. The two frames/tabs share localStorage; updates are serialized using Web Locks where available. Signing out clears the role selection but keeps the family. Clearing browser site data deletes the local demo data. Existing Supabase data is not migrated, modified or deleted.

## Simulation boundaries

- **Live chat is real.** Starting it uses the microphone and sends audio to OpenAI. Personal questions send only confirmed text records and the conversation transcript through the Live lookup endpoint. Photos, phone numbers and unconfirmed drafts are excluded. Unknown questions are saved locally for family confirmation. Suggestions still support local record lookup and browser read-aloud without starting Live.
- Maps use `public/app/singapore-map-base.png` with interactive SVG overlays. Drag the elder pin outside the circle to trigger the elder warning and family alert; drag back inside to clear it. Resize the safe area with its circle handle or the radius slider. Settings → Demo control also offers Simulate going out / Back home. Map coordinates and distances are simulated.
- In-app calls use the existing recorded demonstration; they do not contact another device. Phone links, if configured by the user, still open the device dialer.
- Family editors retain manual entry and rule-based fallbacks. AI extraction and real voice input are unavailable.
- No cross-device sync, real authentication, push notifications, or cloud backup. Do not store real sensitive personal information in a shared demo browser.

`server/local-live-worker.mjs` is the deployed endpoint; it explicitly enables local family mode and never queries Supabase. This demonstration has no user authentication; the same-origin Live endpoint uses the operator's API account. Earlier React/Supabase files remain for reference but are not part of the active build. `npm test` covers local storage, packaged assets, Live sessions and microphone behavior.
