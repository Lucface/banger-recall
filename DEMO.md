# Two minutes, timed

**0:00 – 0:20, the outcome first (no screen yet)**

"Business Bangerz can't prove a song worked. So the second banger is a matter of taste, and a premium price has nothing behind it. Banger Recall is a 45-second voice check-in, a week after the song ships. It asks two questions out loud, scores whether the message landed, and tells you exactly which message the next song has to fix. The report is a new line item. It costs about a cent per employee to run."

**0:20 – 1:15, live (audio through the TV)**

```bash
bun run recall --participant "Lucas"
```

Agent speaks the consent script. Say **"yes"**.
Question 1. Answer in your own words, get one detail wrong on purpose (say "sixty days").
Question 2, the $300 scenario. Answer it properly.
Score appears: M1 misrecalled with your quote, M2 and M3 landed. Say: "That's real. It heard me, transcribed locally, and scored the message, not the words. Misrecall is its own state because that's what the songwriter needs."

If the room is too loud: add `--typed`. Say so.

**1:15 – 1:45, cut to the pre-baked tray**

```bash
bun run report --fixtures-only
```

"Twelve employees, synthetic voices, scored by the same code before the demo." Point at the table: the message with the lowest landed rate, the misrecalls in their own words, the next-banger candidate line. "That line is the next sale."

The numbers as baked (2026-09-09): M1 landed 58%, M2 landed 75%, M3 landed 50% with five employees still on the old $500 threshold or buying first and asking later. Next banger candidate: M3. Cost of all twelve check-ins: about twenty cents.

**1:45 – 2:00, what is real and what is staged**

"Everything you saw runs. The twelve employees are synthetic. The company is fictional. The phone call is a laptop. Supabase is a documented path, not built. Done."

---

Before your slot: plug in, play `say test` and confirm it comes out of the TV. Run `bun run recall --replay elena` once so Whisper and the voice are warm.
