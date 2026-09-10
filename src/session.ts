import { z } from "zod";
import { RequiredMessageSchema } from "./brief";
import { RecallScoreSchema } from "./score-recall";

export const ConsentRecordSchema = z.object({
  participant: z.string(),
  consented: z.boolean(),
  asked_at: z.string(),
  script_version: z.string(),
  retention_days: z.number(),
  purpose: z.string(),
  withdrawal: z.string(),
  answer_transcript: z.string(),
});

export const AnswerRecordSchema = z.object({
  question: z.string(),
  transcript: z.string(),
  input_kind: z.enum(["spoken", "typed", "synthetic_voice"]),
  audio_path: z.string().nullable(),
  is_follow_up: z.boolean(),
});

/**
 * The structured, machine-readable artifact one check-in produces (MR-3). It is what
 * the recall report aggregates, and what a future brief reads back ("last time, M3
 * was the one they got wrong").
 */
export const RecallSessionSchema = z.object({
  session_id: z.string(),
  mode: z.enum(["live", "fixture"]),
  participant: z.string(),
  client: z.string(),
  song_title: z.string(),
  brief_messages: z.array(RequiredMessageSchema),
  started_at: z.string(),
  completed_at: z.string(),
  consent: ConsentRecordSchema,
  answers: z.array(AnswerRecordSchema),
  recall: RecallScoreSchema.nullable(),
  cost_usd: z.number(),
  tokens: z.object({ input: z.number(), output: z.number() }),
  scoring_model: z.string(),
});

export type RecallSession = z.infer<typeof RecallSessionSchema>;
export type AnswerRecord = z.infer<typeof AnswerRecordSchema>;
