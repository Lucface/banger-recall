# Banger Recall

## 1. What this is

**Banger Recall** is a 45-second voice check-in that calls an employee a week after a banger ships, asks two questions out loud, and scores whether the song's message actually landed. It gives Business Bangerz the one thing it cannot show a client today: proof the message stuck, and the exact message the next song has to fix.

## 2. The outcome it targets

**Outcome: revenue.** **Friction: F5, no proof of impact** (and it feeds F6, reusable memory, as a side effect).

Today a repeat purchase is a matter of taste and a premium price has nothing behind it. A recall report changes both: it is a billable line item after delivery ("Recall Check-in, 40 employees, $X"), it is the evidence that defends the price of the banger it measures, and it names the message employees still get wrong, which is the brief for banger number two. The check-in costs about two cents per employee to run (measured: $0.015 to $0.02 per scored session), so a 40-person check-in cycle is under a dollar and the margin on the report is the report.

## 3. What actually works

Real, runs end to end on a laptop:

- **Spoken consent** with retention window and withdrawal, recorded per participant (`src/consent.ts`).
- **Spoken questions** via synthesized speech, macOS voice by default, OpenAI voice optional (`src/speak.ts`).
- **Microphone capture** with start-on-speech and stop-on-silence, capped length, plus a typed fallback for loud rooms (`src/listen.ts`).
- **Transcription** with local Whisper (mlx_whisper), nothing leaves the laptop; OpenAI transcription optional (`src/transcribe.ts`).
- **Recall scoring** against the brief's required messages with Claude structured output: landed / partial / missed / **misrecalled**, evidence quotes, and one follow-up question when the answer is vague (`src/score-recall.ts`).
- **One spoken follow-up** and a re-score when the answer was vague (`src/recall-check.ts`).
- **Structured session record** per participant (`out/sessions/*.json`, schema in `src/session.ts`).
- **Measurement events** appended to `out/events.jsonl` on every step (`src/events.ts`).
- **Cost of a session** from token usage (`src/cost.ts`).
- **Aggregate recall report** across participants, with the next-banger candidate (`src/aggregate.ts`).
- **Offline replay** of pre-baked sessions with no API key (`bun run recall --replay <id>`).

Simulated, stubbed, or fictional, said plainly:

- **The twelve employees in `fixtures/` are synthetic.** Their answers were written for the demo, spoken by macOS system voices (no real person's voice), transcribed by local Whisper, and scored by the real scorer. Their consent is marked simulated in the record.
- **Cobalt Logistics and its expense policy are fictional.** No real client material.
- **There is no phone call.** The check-in runs on a laptop with a microphone. Telephony is the documented next step, not built.
- **No scheduling or outreach.** Who gets checked in, and when, is manual.
- **No barge-in.** The agent finishes speaking before it listens; a participant cannot interrupt mid-sentence. Silence, long pauses, and a noisy room are handled (auto-stop, cap, typed fallback).
- **Retention is recorded, not enforced.** The 30-day window is in every consent record; nothing deletes files yet.
- **No Supabase or Next.js integration.** The path is documented below, not built.

## 4. How it works

1. The **song brief** carries the required messages, the behavior each one asks for, and the wrong version an employee is likely to remember instead (usually the old policy). See `fixtures/brief.cobalt-expense-policy.json`.
2. The agent **asks for consent out loud**: what is recorded, what it is for, how long it is kept (30 days), how to withdraw. A "no" ends the check-in with nothing kept. Saying "stop" later does the same.
3. The agent **speaks two questions**: "In your own words, what did the song ask you to do differently?" and a scenario ("Say you bought a $300 part tomorrow. Walk me through exactly what you'd do."). The scenario is the point: recall is not recitation, and a scenario answer shows what the employee would actually do.
4. Each answer is **recorded from the microphone** and **transcribed locally**.
5. The transcript is **scored against every required message**. A paraphrase counts as landed. An employee who confidently states the old policy is scored **misrecalled**, a separate state from missed, because that is what the songwriter most needs to hear. If the answer is vague, the scorer returns one short follow-up question, the agent asks it out loud, and scores again.
6. The check-in writes a **structured session record** (consent, transcripts, per-message status with evidence quotes, cost) and appends **measurement events**.
7. `bun run report` **aggregates every session** into the recall report: landed rate per message, misrecalls in the employees' own words, and the **next banger candidate**, the message with the lowest landed rate.

## 5. Setup

Prerequisites (macOS, Apple silicon for local Whisper):

- Bun 1.3+ (`bun --version`)
- sox (`brew install sox`) for microphone capture
- mlx_whisper (`uv pip install mlx-whisper`) for local transcription; the default model is `mlx-community/whisper-large-v3-turbo` (downloaded on first use)
- `say` and `afplay` (ship with macOS)

```bash
bun install
cp .env.example .env   # add ANTHROPIC_API_KEY for live check-ins and for baking fixtures
```

Paid keys: `ANTHROPIC_API_KEY` is required for a live check-in and for `bun run bake`. It is **not** required for `bun run recall --replay <id>` or `bun run report`. `OPENAI_API_KEY` is only needed if you switch `TTS_PROVIDER` or `STT_PROVIDER` to `openai`.

## 6. The primary path

Live check-in, spoken end to end (the demo laptop's microphone and speakers):

```bash
bun run recall --participant "Lucas"
```

Same flow with typed answers, for a room too loud to record in:

```bash
bun run recall --participant "Lucas" --typed
```

The recall report over every saved session (12 pre-baked synthetic employees plus any live runs):

```bash
bun run report
```

Offline replay of one pre-baked check-in, no API key:

```bash
bun run recall --replay elena
```

Rebuild the pre-baked sessions through the real pipeline (synthetic voices, local Whisper, live scoring):

```bash
bun run bake --force
```

## 7. What we did not build, and why

Cut on purpose, in the first ten minutes:

- **Telephony.** A real check-in would be a phone call or a link in a text. The scoring and the report do not change when the transport does, so the transport was the thing to leave out.
- **A web UI.** The report is a Markdown page and a JSON file. Clear beat pretty.
- **Scheduling and outreach.** Which employees, which day after release, reminders. Real work, none of it about whether recall can be measured.
- **Barge-in and full-duplex conversation.** A realtime voice platform would give this for free; in 90 minutes the assembled pipeline (speak, listen, transcribe, score) was the honest choice, and the conversation design still handles silence, vagueness, and withdrawal.
- **Enforced retention and deletion.** Recorded in every consent record; a cron that deletes audio after 30 days is a two-line follow-up.
- **The next-brief loop.** The report names the next banger candidate; feeding it into a brief automatically (F6) is the obvious next hour.

With two more hours: a Twilio number so the check-in is an actual call, a Supabase table for sessions, and a one-page recall report the founder can send to the client with one click.

## 8. AI-use disclosure

- **Claude Code (Claude Fable 5.1)** wrote the scaffolding, the modules, the fixtures' synthetic answers, and this README from a spoken-out plan, inside the 90-minute window. The concept choice, the scenario question, the misrecall state, and the cut list were decided before any code.
- **Claude Opus 5** (`claude-opus-5`) is the scoring model at runtime, via the Anthropic TypeScript SDK with structured output.
- **Whisper large-v3-turbo** (mlx-community build) transcribes locally.
- **macOS `say` voices** read the synthetic employees' answers and speak the agent's lines.

## 9. Attribution

- `@anthropic-ai/sdk` (MIT), `zod` (MIT), Bun runtime.
- `mlx_whisper` (MIT) with the `mlx-community/whisper-large-v3-turbo` weights (Apache 2.0).
- sox (LGPL/GPL, used as a CLI) for microphone capture.
- All audio in this project is generated at runtime by macOS system voices. No copyrighted recordings, no real person's voice, no real client data.
- Commercial use: the Anthropic API and OpenAI API permit commercial use under their standard terms; the local Whisper weights are Apache 2.0.

---

## Voice, consent, and data

Voice is biometric data, so the check-in treats it that way:

- The consent script is spoken before anything is recorded and stored verbatim by version (`CONSENT_SCRIPT_VERSION`) with the participant's transcribed answer, so the company can show what each person was told.
- Purpose limitation is in the script: scoring only, never voice cloning.
- Retention (30 days) and withdrawal ("say stop", or ask the company to delete) are in the record. Saying "stop" mid-check-in ends it and marks the session declined.
- Transcription runs locally by default, so audio does not leave the laptop unless the operator opts into a cloud transcriber.

This is designed with BIPA, CUBI, and GDPR biometric provisions in mind (notice, purpose, retention, withdrawal); it is not legal advice.

## Measuring the outcome

`out/events.jsonl` is append-only and carries one row per step: session started, consent given or declined, question asked, answer captured, answer transcribed, follow-up asked, recall scored, session completed, each with participant, song, and cost. From those rows Business Bangerz can compute, per banger and over time: recall rate per message, check-in completion rate, consent decline rate, cost per employee, and, joined to sales, whether clients with a recall report buy a second banger more often than clients without one. That is the six-month proof.

## Path into the Next.js / Supabase surface

The song record that already exists in Supabase gains one JSON column, `required_messages`, in the shape of `fixtures/brief.*.json`. Two tables, `recall_sessions` and `recall_answers`, mirror `src/session.ts`. A Next.js route `/recall/[song]/[participant]` runs the check-in in the browser (MediaRecorder for capture, the same spoken script) and posts the audio to a Supabase Edge Function that calls `scoreRecallAgainstBrief`. The report page is `recall-report.md` rendered from the same aggregate. Rough adoption effort for a solo operator: about two days, most of it the browser capture and the report page; the scoring and aggregation code moves as is.
