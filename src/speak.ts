import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

export type TtsProvider = "say" | "openai" | "silent";

export function ttsProvider(): TtsProvider {
  const provider = process.env.TTS_PROVIDER ?? "say";
  return provider === "openai" || provider === "silent" ? provider : "say";
}

/**
 * Speaks one line to the participant with synthesized speech (OR-2).
 * This is where the check-in generates audio (MR-1): the consent script, the
 * two questions, and any follow-up are all spoken, not shown.
 *
 * The default voice is the macOS `say` command: offline, free, and always
 * present on the demo laptop, so a dead network cannot kill the check-in.
 * OpenAI text-to-speech is an opt-in upgrade; `silent` prints only.
 */
export async function speakToParticipant(text: string): Promise<void> {
  console.log(`\n🔊 agent: ${text}`);
  const provider = ttsProvider();
  if (provider === "silent") return;
  if (provider === "openai") {
    await speakWithOpenAi(text);
    return;
  }
  spawnSync("say", ["-v", process.env.SAY_VOICE ?? "Samantha", text], { stdio: "ignore" });
}

async function speakWithOpenAi(text: string): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn("OPENAI_API_KEY is not set; falling back to the macOS voice");
    spawnSync("say", [text], { stdio: "ignore" });
    return;
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "mp3" }),
  });
  if (!response.ok) throw new Error(`OpenAI text-to-speech failed with HTTP ${response.status}`);
  mkdirSync("out", { recursive: true });
  const path = `out/tts-${Date.now()}.mp3`;
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  spawnSync("afplay", [path], { stdio: "ignore" });
}
