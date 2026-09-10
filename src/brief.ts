import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * A song brief is the structured record of what a banger has to accomplish.
 * Banger Recall only needs the part that can be measured afterwards: the
 * required messages, each with the behavior it asks for and the wrong version
 * an employee is likely to remember instead (usually the old policy).
 */
export const RequiredMessageSchema = z.object({
  id: z.string(),
  message: z.string().describe("The message the song must make people remember"),
  behavior: z.string().describe("The behavior change the message asks for"),
  common_misrecall: z
    .string()
    .describe("The old policy or a likely wrong version, so misrecall can be scored as its own state"),
});

export const SongBriefSchema = z.object({
  song_title: z.string(),
  client: z.string(),
  audience: z.string(),
  objective: z.string(),
  released_on: z.string(),
  required_messages: z.array(RequiredMessageSchema).min(1),
  check_in_questions: z.array(z.string()).min(1),
});

export type SongBrief = z.infer<typeof SongBriefSchema>;
export type RequiredMessage = z.infer<typeof RequiredMessageSchema>;

/** Loads and validates the brief the check-in is scored against. */
export function loadSongBrief(path: string): SongBrief {
  return SongBriefSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
