// Image de /classement : en-tête, podium pour les 3 premiers, puis les places 4 à 10 sur 2 colonnes.
// Rendue en double résolution (2400 px de large) et envoyée hors embed pour être nette et lisible.

import { createCanvas } from '@napi-rs/canvas';
import { avatar, BG, drawAvatar, fitText, ORANGE, plain, roundedRect } from './images.js';

const W = 1200;
const RES = 2;
const PAD = 36;
const MEDALS = ['#f5c518', '#c9ced6', '#cd7f32']; // or, argent, bronze
const TEXT = '#efebe4';
const MUTED = '#8d8899';
const DISPLAY = (size) => `${size}px Unbounded, Kyara`;
const MONO = (size) => `${size}px Mono, Kyara`;
const BODY = (size) => `${size}px Kyara`;

// title : grand titre ; subtitle : petite ligne (critère) ; rows : [{ pseudo, value, avatarUrl }] triés, 10 max.
export async function classementImage({ title, subtitle, rows }) {
  rows = rows.slice(0, 10);
  const rest = rows.slice(3);
  const HEADER_H = 150;
  const PODIUM_H = 400;
  const ROW_H = 64;
  const ROW_GAP = 12;
  const restRows = Math.ceil(rest.length / 2);
  const H = HEADER_H + PODIUM_H + (restRows ? 28 + restRows * (ROW_H + ROW_GAP) - ROW_GAP : 0) + PAD;

  const canvas = createCanvas(W * RES, H * RES);
  const ctx = canvas.getContext('2d');
  ctx.scale(RES, RES);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, HEADER_H + 120, 0, W / 2, HEADER_H + 120, 560);
  glow.addColorStop(0, 'rgba(245,197,24,0.10)');
  glow.addColorStop(1, 'rgba(245,197,24,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const imgs = await Promise.all(rows.map((r) => avatar(r.avatarUrl)));

  // --- En-tête ---
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = MONO(15);
  ctx.fillStyle = '#ff4d2e';
  ctx.fillText(plain(subtitle).toUpperCase(), PAD, 40);
  ctx.font = DISPLAY(34);
  ctx.fillStyle = TEXT;
  ctx.fillText(fitText(ctx, title, W - PAD * 2), PAD, 68);
  ctx.fillStyle = '#2a2733';
  ctx.fillRect(PAD, HEADER_H - 22, W - PAD * 2, 1.5);

  // --- Podium : 2e à gauche, 1er au centre, 3e à droite ---
  const baseY = HEADER_H + PODIUM_H;
  const spots = [
    { i: 1, cx: W / 2 - 340, block: 110, r: 62 },
    { i: 0, cx: W / 2, block: 150, r: 76 },
    { i: 2, cx: W / 2 + 340, block: 85, r: 56 },
  ];
  for (const s of spots) {
    const row = rows[s.i];
    if (!row) continue;
    const color = MEDALS[s.i];
    const bw = 290;
    const top = baseY - s.block;

    // Socle.
    const g = ctx.createLinearGradient(0, top, 0, baseY);
    g.addColorStop(0, '#2a2632');
    g.addColorStop(1, '#16141b');
    ctx.fillStyle = g;
    roundedRect(ctx, s.cx - bw / 2, top, bw, s.block, 16);
    ctx.fill();
    ctx.fillStyle = color;
    roundedRect(ctx, s.cx - bw / 2, top, bw, 7, 3.5);
    ctx.fill();
    ctx.font = DISPLAY(46);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`#${s.i + 1}`, s.cx, top + s.block / 2 + 4);

    // Valeur et pseudo au-dessus du socle, puis l'avatar.
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ORANGE;
    ctx.font = DISPLAY(20);
    ctx.fillText(fitText(ctx, row.value, bw), s.cx, top - 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = BODY(26);
    ctx.fillText(fitText(ctx, row.pseudo, bw + 30), s.cx, top - 48);
    const cy = top - 82 - s.r;
    if (s.i === 0) {
      // Halo doré derrière le 1er.
      const halo = ctx.createRadialGradient(s.cx, cy, s.r, s.cx, cy, s.r * 1.9);
      halo.addColorStop(0, 'rgba(245,197,24,0.35)');
      halo.addColorStop(1, 'rgba(245,197,24,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(s.cx - s.r * 2, cy - s.r * 2, s.r * 4, s.r * 4);
    }
    drawAvatar(ctx, imgs[s.i], s.cx, cy, s.r, color);
  }

  // --- Places 4 à 10, sur 2 colonnes (4 à 7 à gauche, 8 à 10 à droite) ---
  const colW = (W - PAD * 2 - 24) / 2;
  rest.forEach((row, k) => {
    const i = k + 3;
    const col = k < restRows ? 0 : 1;
    const x = PAD + col * (colW + 24);
    const y = baseY + 28 + (k % restRows) * (ROW_H + ROW_GAP);
    ctx.fillStyle = '#17151d';
    roundedRect(ctx, x, y, colW, ROW_H, 14);
    ctx.fill();
    const mid = y + ROW_H / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = DISPLAY(22);
    ctx.fillText(`#${i + 1}`, x + 20, mid + 1);
    drawAvatar(ctx, imgs[i], x + 108, mid, 22, null);
    ctx.textAlign = 'right';
    ctx.fillStyle = ORANGE;
    ctx.font = DISPLAY(18);
    const value = plain(row.value);
    ctx.fillText(value, x + colW - 20, mid + 1);
    const valueW = ctx.measureText(value).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = BODY(22);
    ctx.fillText(fitText(ctx, row.pseudo, colW - 142 - valueW - 30), x + 142, mid + 1);
  });

  return canvas.encode('jpeg', 92);
}
