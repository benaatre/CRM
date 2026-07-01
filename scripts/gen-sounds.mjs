// مولّد نغمات WAV قصيرة مدمجة (PCM 16-bit, mono, 44.1kHz) في public/sounds/.
// يُشغّل مرة واحدة لتوليد الملفات: node scripts/gen-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SR = 44100;
const OUT = path.join("public", "sounds");
mkdirSync(OUT, { recursive: true });

// يبني عيّنات من قائمة نغمات [{freq, dur, type}] متتابعة، مع غلاف بسيط (attack/decay).
function tones(segments) {
  const samples = [];
  for (const seg of segments) {
    const n = Math.floor(SR * seg.dur);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const p = i / n; // 0..1 داخل المقطع
      // غلاف: هجوم سريع ثم اضمحلال أسّي (إحساس نغمة لطيفة)
      const env = Math.min(1, p / 0.02) * Math.pow(1 - p, seg.decay ?? 2.2);
      let s;
      if (seg.type === "square") s = Math.sign(Math.sin(2 * Math.PI * seg.freq * t));
      else s = Math.sin(2 * Math.PI * seg.freq * t);
      samples.push(s * env * (seg.gain ?? 0.32));
    }
    // صمت قصير بين المقاطع
    if (seg.gap) for (let i = 0; i < Math.floor(SR * seg.gap); i++) samples.push(0);
  }
  return samples;
}

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);      // حجم fmt
  header.writeUInt16LE(1, 20);       // PCM
  header.writeUInt16LE(1, 22);       // mono
  header.writeUInt32LE(SR, 24);      // sample rate
  header.writeUInt32LE(SR * 2, 28);  // byte rate
  header.writeUInt16LE(2, 32);       // block align
  header.writeUInt16LE(16, 34);      // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const file = Buffer.concat([header, data]);
  const out = path.join(OUT, name);
  writeFileSync(out, file);
  console.log(`✓ ${name} (${(file.length / 1024).toFixed(1)} KB)`);
}

// النغمات الست
writeWav("soft.wav",    tones([{ freq: 660, dur: 0.28, decay: 2.4 }]));
writeWav("bell.wav",    tones([{ freq: 880, dur: 0.6, decay: 4 }]));
writeWav("success.wav", tones([{ freq: 523.25, dur: 0.14, decay: 1.6 }, { freq: 783.99, dur: 0.34, decay: 3 }]));
writeWav("urgent.wav",  tones([{ freq: 988, dur: 0.12, type: "square", gain: 0.26, decay: 1.2, gap: 0.06 }, { freq: 988, dur: 0.12, type: "square", gain: 0.26, decay: 1.2 }]));
writeWav("click.wav",   tones([{ freq: 1200, dur: 0.05, decay: 2 }]));
writeWav("ding.wav",    tones([{ freq: 1046.5, dur: 0.4, decay: 3.4 }]));

console.log("تمّ توليد النغمات ✅");
