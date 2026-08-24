# Remember Us — 3-Minute Hackathon Demo Script (v1)

Audience: hackathon judges. Format: PPT (2 slides) → live split-screen product demo. All copy below is grounded in the actual UI strings in `public/app/index.html` and the current `SEED.en` sample data — nothing here is invented.

Note on source material: `C:\Users\Yuxuan\Downloads\PPT.pptx` currently has only 2 slides (title + problem). This script assumes that's intentional — PPT sets up the problem, the live product carries the rest of the story. If a longer deck exists, tell me and I'll re-cut the timing.

---

## Before you go on stage (not part of the 3:00)

1. `npm run dev`, then open **two** browser windows side by side — left = **Family**, right = **Elder**.
2. Same local URL in both. Add `?localDemo=1` for reliable map rendering; add `&localElder=1` on the **elder** window only.
3. On the entry screen in each window, tap the **`EN`** chip (top bar) — the app defaults to Chinese.
4. If you rehearsed earlier, tap **`Reset demo`** in both windows first.
5. Know the sample identities cold: elder = **Mom**, you = **Yuki (Daughter)**.
6. Have slides 1–2 of the PPT ready to click through, then alt-tab to the browser.

**Failure mode to know about:** the call-extraction and Q&A steps make a real call to Gemini server-side (up to ~14s timeout). If it's slow, keep talking — don't stand in silence. If it fails outright, the app silently falls back to the same two demo items, so the flow doesn't break on stage.

---

## Script

### [0:00] PPT — Slide 1, Title
**SAY:**
> "Remember Us is an AI care companion for families living with Alzheimer's. It turns memories a family already trusts into help at the exact moment it's needed — recognizing a caller, finding the way home, staying connected."

*(~18s)*

### [0:18] PPT — Slide 2, Problem
**SAY:**
> "Three moments break that trust: a familiar caller suddenly feels like a stranger, the same question comes back with no reliable answer, and outside, one wrong turn becomes a safety risk before the family even finds out."

*(~17s)*

### [0:35] Cut to the browser
**DO:** switch to the two browser windows, side by side.
**SAY:**
> "Let's make that real — two phones, live, right now."

*(~5s)*

### [0:40] Onboarding — sample data
**DO (left / Family):** Enter as Family → Create family → elder-info screen → **Fill sample** → home-location screen (pin already dropped) → next → "About you" screen → **Fill sample** → Finish setup → 6-digit family code appears.
**DO (right / Elder):** Enter as Elder → type that code → paired.

**SAY:**
> "Onboarding is one family member, once — and I'll use sample data instead of typing live. Create the family, fill Mom's profile and home address, fill my own so she can recognize my calls. One code, typed once on her phone. Paired."

*(~24s — running total 1:04)*

### [1:04] Map — home & guided walk home
**DO (right / Elder):** open the settings / demo-tools panel → tap **"Simulate going out."**
**SAY:**
> "Family placed one pin — that's home, with a safe radius. Watch: I simulate her stepping outside it. Her screen never shows a map — it gives one instruction at a time, using landmarks, spoken aloud."

**DO (left / Family):** point at the home tab — status flips to **"Heading home · step 1"**, alert bar appears.
**SAY:**
> "And on the family side, that shows up instantly: 'Heading home, step one.'"

*(~28s — running total 1:32)*

### [1:32] Call — recognition + memory extraction
**DO (left / Family):** tap **"Call Mom."**
**DO (right / Elder):** incoming-call screen shows Yuki's photo and "Daughter" — tap **Answer**. Scripted call plays: Yuki mentions visiting Saturday afternoon, reminds Mom about her blood pressure pills.
**DO (left / Family):** tap **Hang up** → Gemini extracts two items → confirm both, one tap each.

**SAY:**
> "She doesn't have to guess who's calling — that card is built from what family already told the system. I hang up, and Gemini — live — turns the call into two things to confirm: a fact, and a reminder. One tap each, and they're real."

*(~27s — running total 1:59)*

### [1:59] Todos
**DO (right / Elder):** switch to elder home — the pill reminder is now under **"What's next."** Tap **"I've done it."**
**DO (left / Family):** reminders list flips to done.

**SAY:**
> "That reminder is already on her home screen. She marks it done, and family sees it — no separate app, no phone call needed."

*(~13s — running total 2:12)*

### [2:12] Chatbot Q&A
**DO (right / Elder):** tap **Talk** → tap **"When is Yuki coming?"**
**SAY:** "She can ask anything the family already confirmed."
**DO:** answer appears — *"Saturday afternoon"* — with a source tag.
**SAY:** "Sourced straight to the fact we just confirmed."

**DO:** tap **"Where are my blood pressure pills?"**
**SAY:** "But ask something nobody told it, and it won't guess."
**DO (left / Family):** switch to the pending list — the question is now sitting there.
**SAY:** "It goes straight to family instead, waiting for a real answer."

*(~28s — running total 2:40)*

### [2:40] Close
**SAY:**
> "One phone call — understood, remembered, and acted on, safely, across two real devices. That's Remember Us. Thank you."

*(~10s — lands at 2:50, ~10s buffer for judges)*

---

## Judges Q&A prep (bonus, per demo-day Step 4)

1. **"What's actually live Gemini vs. scripted?"** — The call *dialogue* is a scripted transcript for demo reliability. The *extraction* into facts/todos, and the elder's Q&A answers, both run through a real server-side Gemini call (`/api/ai`); a fixed fallback keeps the demo from breaking if the API is slow or down.
2. **"How do you stop it from hallucinating answers to the elder?"** — Retrieval is restricted to facts the family has explicitly confirmed. The model is instructed to pick only from that confirmed list or return "no match" — it never free-generates an answer.
3. **"How does the two-device sync work?"** — Supabase realtime keeps both sides in sync; the local demo mode uses a same-browser fallback so it works reliably without network dependencies on stage.
4. **"What decides a safety event, the model or a rule?"** — A fixed rule: three consecutive real GPS readings outside the configured radius, specifically to avoid false alarms from GPS drift. No model in that decision path.
5. **"What's the actual next milestone after this hackathon?"** — Real call-audio input (today's call is scripted, not live audio), account auth/permissions, and the full risk-rule set beyond "leaving radius." Tracked as P0 items in `todo.md`.

---

## Timing self-check

Spoken word count ≈ 320 words across ~2:40 of talking time (~2.0 words/sec, deliberately slower than a 2.2–2.5 wps norm to leave room for clicks and the live Gemini calls). Rehearse once with the actual dev build — if the network call runs long, trim the Q&A section first (it's the most skippable: cut the "unknown question" beat and go straight to Close).
