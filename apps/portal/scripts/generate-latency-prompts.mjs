#!/usr/bin/env node
/**
 * Generate WAV prompt files for SIPp rtp_stream playback.
 * Uses espeak-ng when available; falls back to a short tone via ffmpeg.
 *
 * Usage: node scripts/generate-latency-prompts.mjs --scenario=dental
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScenario } from "./latency-scenarios.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "sipp", "prompts");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const scenarioId = typeof args.scenario === "string" ? args.scenario : "dental";
const scenario = getScenario(scenarioId);

function has(cmd) {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function generateWav(text, outPath) {
  if (has("espeak-ng")) {
    execSync(
      `espeak-ng -v en-gb -s 150 -w "${outPath}" "${text.replace(/"/g, '\\"')}"`,
      { stdio: "inherit" },
    );
    return;
  }
  if (has("ffmpeg")) {
    const safe = text.replace(/'/g, "");
    execSync(
      `ffmpeg -y -f lavfi -i sine=frequency=440:duration=0.4 -ar 8000 -ac 1 "${outPath}"`,
      { stdio: "ignore" },
    );
    console.warn(`espeak-ng not found; generated placeholder tone for: ${safe.slice(0, 40)}`);
    return;
  }
  throw new Error("Install espeak-ng or ffmpeg to generate prompt audio.");
}

function main() {
  const dir = path.join(OUT_DIR, scenarioId);
  ensureDir(dir);
  const files = [];

  scenario.prompts.forEach((prompt, i) => {
    const filename = `prompt_${i + 1}.wav`;
    const outPath = path.join(dir, filename);
    console.log(`Generating ${filename}: "${prompt}"`);
    generateWav(prompt, outPath);
    files.push({ turn: i + 1, prompt, file: outPath, filename });
  });

  const manifest = {
    scenario: scenarioId,
    pauseAfterPromptMs: scenario.pauseAfterPromptSec * 1000,
    prompts: files,
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${files.length} prompt(s) to ${dir}`);
}

main();
