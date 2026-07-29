import sharp from "sharp";
import { mkdir } from "node:fs/promises";
const bg = "#0A0A0B", gold = "#CBA45E";
const crown = (s) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">
  <path d="M120 350 L120 205 L192 268 L256 165 L320 268 L392 205 L392 350 Z" fill="${gold}"/>
  <rect x="120" y="350" width="272" height="40" rx="8" fill="${gold}"/>
  <circle cx="120" cy="205" r="14" fill="${gold}"/><circle cx="256" cy="165" r="16" fill="${gold}"/><circle cx="392" cy="205" r="14" fill="${gold}"/>
</g>`;
const svg = (s) => Buffer.from(`<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="${bg}"/><rect x="20" y="20" width="472" height="472" rx="96" fill="none" stroke="${gold}" stroke-width="5" opacity="0.4"/>${crown(s)}</svg>`);
await mkdir("public/icons", { recursive: true });
await sharp(svg(1)).resize(192,192).png().toFile("public/icons/icon-192.png");
await sharp(svg(1)).resize(512,512).png().toFile("public/icons/icon-512.png");
await sharp(svg(0.62)).resize(512,512).png().toFile("public/icons/maskable-512.png");
await sharp(svg(1)).resize(180,180).png().toFile("public/icons/apple-touch-icon.png");
console.log("icons generated");
