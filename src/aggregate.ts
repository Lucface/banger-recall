import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { RecallSessionSchema, type RecallSession } from "./session";

export type RecallStatus = "landed" | "partial" | "missed" | "misrecalled";

export interface MessageRollup {
  message_id: string;
  message: string;
  counts: Record<RecallStatus, number>;
  landed_pct: number;
  misrecall_quotes: string[];
}

export interface RecallReport {
  song_title: string;
  client: string;
  generated_at: string;
  participants: number;
  consented: number;
  declined: number;
  average_score: number;
  per_message: MessageRollup[];
  next_banger_candidate: { message_id: string; message: string; reason: string } | null;
  total_cost_usd: number;
  sources: string[];
}

export const REPORT_JSON_PATH = "out/recall-report.json";
export const REPORT_MD_PATH = "out/recall-report.md";

/**
 * Aggregates every participant's recall record into one recall report (OR-9).
 *
 * This is the proof of impact the company does not have today (F5): for each required
 * message, the share of employees for whom it landed, was partial, missed, or
 * misrecalled, with the quotes behind each misrecall. The message with the lowest
 * landed rate is named as the next banger candidate, which is how a recall report
 * turns into the next sale instead of a scorecard.
 */
export function aggregateRecallReport(sessions: RecallSession[], sources: string[]): RecallReport {
  const completed = sessions.filter((s) => s.consent.consented && s.recall !== null);
  const declined = sessions.filter((s) => !s.consent.consented).length;
  const first = sessions[0];
  const messageIndex = new Map<string, string>();
  for (const s of completed) {
    for (const m of s.brief_messages) messageIndex.set(m.id, m.message);
  }

  const perMessage: MessageRollup[] = [...messageIndex.entries()].map(([id, message]) => {
    const counts: Record<RecallStatus, number> = { landed: 0, partial: 0, missed: 0, misrecalled: 0 };
    const misrecallQuotes: string[] = [];
    for (const s of completed) {
      const hit = s.recall?.per_message.find((m) => m.message_id === id);
      if (!hit) continue;
      counts[hit.status] += 1;
      if (hit.status === "misrecalled" && hit.evidence_quote) {
        misrecallQuotes.push(`${s.participant}: "${hit.evidence_quote}"`);
      }
    }
    const landedPct = completed.length ? Math.round((counts.landed / completed.length) * 100) : 0;
    return { message_id: id, message, counts, landed_pct: landedPct, misrecall_quotes: misrecallQuotes };
  });

  const weakest = [...perMessage].sort((a, b) => a.landed_pct - b.landed_pct)[0];
  const averageScore = completed.length
    ? Math.round(completed.reduce((sum, s) => sum + (s.recall?.overall_score ?? 0), 0) / completed.length)
    : 0;

  return {
    song_title: first?.song_title ?? "",
    client: first?.client ?? "",
    generated_at: new Date().toISOString(),
    participants: sessions.length,
    consented: completed.length,
    declined,
    average_score: averageScore,
    per_message: perMessage,
    next_banger_candidate: weakest
      ? {
          message_id: weakest.message_id,
          message: weakest.message,
          reason: `landed with ${weakest.landed_pct}% of employees; ${weakest.counts.misrecalled} still recall the old version`,
        }
      : null,
    total_cost_usd: Number(sessions.reduce((sum, s) => sum + s.cost_usd, 0).toFixed(4)),
    sources,
  };
}

/** Renders the recall report as the one page the founder would send the client. */
export function renderRecallReportMarkdown(report: RecallReport): string {
  const lines: string[] = [];
  lines.push(`# Recall report: "${report.song_title}"`);
  lines.push("");
  lines.push(`Client: ${report.client}  ·  Generated: ${report.generated_at}`);
  lines.push(
    `Participants: ${report.participants} (${report.consented} consented, ${report.declined} declined)  ·  Average recall score: ${report.average_score}/100  ·  Cost to run: $${report.total_cost_usd}`,
  );
  lines.push("");
  lines.push("| Message | Landed | Partial | Missed | Misrecalled |");
  lines.push("|---|---|---|---|---|");
  for (const m of report.per_message) {
    lines.push(
      `| ${m.message_id}: ${m.message} | **${m.landed_pct}%** (${m.counts.landed}) | ${m.counts.partial} | ${m.counts.missed} | ${m.counts.misrecalled} |`,
    );
  }
  lines.push("");
  for (const m of report.per_message) {
    if (!m.misrecall_quotes.length) continue;
    lines.push(`Misrecalled ${m.message_id}, in their words:`);
    for (const q of m.misrecall_quotes) lines.push(`- ${q}`);
    lines.push("");
  }
  if (report.next_banger_candidate) {
    lines.push(
      `**Next banger candidate:** ${report.next_banger_candidate.message_id}, "${report.next_banger_candidate.message}" (${report.next_banger_candidate.reason}).`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Reads every saved session (live runs in out/sessions, pre-baked runs in fixtures/sessions). */
export function loadSessions(dirs: string[]): { sessions: RecallSession[]; sources: string[] } {
  const sessions: RecallSession[] = [];
  const sources: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const path = join(dir, name);
      const parsed = RecallSessionSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed.success) {
        console.warn(`skipping ${path}: ${parsed.error.issues[0]?.message ?? "invalid session"}`);
        continue;
      }
      sessions.push(parsed.data);
      sources.push(path);
    }
  }
  return { sessions, sources };
}

const ArgsSchema = z.object({ fixturesOnly: z.boolean() });

function parseArgs(argv: string[]): z.infer<typeof ArgsSchema> {
  return ArgsSchema.parse({ fixturesOnly: argv.includes("--fixtures-only") });
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const dirs = args.fixturesOnly ? ["fixtures/sessions"] : ["fixtures/sessions", "out/sessions"];
  const { sessions, sources } = loadSessions(dirs);
  if (!sessions.length) {
    console.error("no sessions found; run `bun run bake` or `bun run recall` first");
    process.exit(1);
  }
  const report = aggregateRecallReport(sessions, sources);
  mkdirSync("out", { recursive: true });
  writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = renderRecallReportMarkdown(report);
  writeFileSync(REPORT_MD_PATH, markdown);
  console.log(markdown);
  console.log(`saved ${REPORT_JSON_PATH} and ${REPORT_MD_PATH}`);
}
