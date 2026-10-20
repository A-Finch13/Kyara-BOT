// Image de /persos fiche : la carte en grand, et à côté son nom, son univers, sa rareté, sa valeur
// (puissance, aura, popularité), son prix au marché, si on la possède, et le meilleur booster pour l'obtenir.
// Rendue en double résolution (2400 px de large) et envoyée hors embed pour être nette et lisible.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { BG, drawTile, fitText, hex, largeArt, plain, roundedRect, TILE_H, TILE_W } from './images.js';
import { RARITIES } from './kyara.js';

const W = 1200;
const RES = 2;
const PAD = 40;
const TEXT = '#efebe4';
const MUTED = '#8d8899';
const BORDER = '#2a2733';
const GREEN = '#3fbf7f';
const RED = '#ff4d2e';
const DISPLAY = (size) => `${size}px Unbounded, Kyara`;
const MONO = (size) => `${size}px Mono, Kyara`;
const BODY = (size) => `${size}px Kyara`;
const fr = (n) => plain(Number(n ?? 0).toLocaleString('fr-FR'));

function box(ctx, x, y, w, h, stroke = BORDER) {
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  roundedRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function label(ctx, text, x, y, color = MUTED) {
  ctx.font = MONO(13);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(plain(text).toUpperCase(), x, y);
}

// Pastille ronde avec ✓ ou ✗ dessinés (les polices n'ont pas ces symboles).
function checkIcon(ctx, cx, cy, ok) {
  ctx.fillStyle = ok ? GREEN : RED;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (ok) {
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx - 2, cy + 6);
    ctx.lineTo(cx + 8, cy - 6);
  } else {
    ctx.moveTo(cx - 6, cy - 6);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.moveTo(cx + 6, cy - 6);
    ctx.lineTo(cx - 6, cy + 6);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// Nom en grand : réduit jusqu'à 34 px, puis sur 2 lignes.
function nameLines(ctx, name, maxW) {
  for (let size = 56; size >= 34; size -= 4) {
    ctx.font = DISPLAY(size);
    if (ctx.measureText(name).width <= maxW) return { size, lines: [name] };
  }
  ctx.font = DISPLAY(34);
  const words = name.split(' ');
  let first = '';
  for (const w of words) {
    if (ctx.measureText(first ? `${first} ${w}` : w).width > maxW) break;
    first = first ? `${first} ${w}` : w;
  }
  if (!first) first = fitText(ctx, name, maxW);
  return { size: 34, lines: [first, fitText(ctx, name.slice(first.length).trim(), maxW)].filter(Boolean) };
}

// c : personnage (avec prices) ; owned : { qty, since } | null | undefined (compte inconnu) ;
// owners : nombre de joueurs qui l'ont ; best : { name, chance, priceLabel } | null.
export async function ficheImage({ c, owned, owners, best }) {
  const r = RARITIES[c.rarity];
  const color = hex(r?.color ?? 0x888888);
  const buf = await largeArt(c);
  const art = buf ? await loadImage(buf).catch(() => null) : null;

  const SCALE = 2.4; // carte : 331 × 497
  const cardW = TILE_W * SCALE;
  const cardH = TILE_H * SCALE;
  const H = PAD * 2 + cardH;
  const canvas = createCanvas(W * RES, H * RES);
  const ctx = canvas.getContext('2d');
  ctx.scale(RES, RES);

  // Fond, avec une lueur de la couleur de la rareté derrière la carte.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(PAD + cardW / 2, H / 2, 0, PAD + cardW / 2, H / 2, 520);
  glow.addColorStop(0, `${color}40`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // --- Carte ---
  ctx.save();
  ctx.translate(PAD, PAD);
  ctx.scale(SCALE, SCALE);
  drawTile(ctx, 0, 0, c, art, { name: false });
  ctx.restore();

  // --- Colonne d'infos ---
  const X = PAD + cardW + 44;
  const CW = W - X - PAD;
  let y = PAD + 4;

  // Rareté et numéro.
  ctx.font = BODY(16);
  const rl = r?.label ?? c.rarity;
  const chipW = ctx.measureText(rl).width + 28;
  ctx.fillStyle = color;
  roundedRect(ctx, X, y, chipW, 30, 15);
  ctx.fill();
  ctx.fillStyle = c.rarity === 'L' || c.rarity === 'C' ? '#14121a' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(rl, X + 14, y + 16);
  ctx.font = MONO(15);
  ctx.fillStyle = MUTED;
  ctx.fillText(plain(c.num ?? ''), X + chipW + 14, y + 16);
  y += 46;

  // Nom, nom japonais, univers.
  const nl = nameLines(ctx, plain(c.name), CW);
  ctx.font = DISPLAY(nl.size);
  ctx.fillStyle = TEXT;
  ctx.textBaseline = 'top';
  for (const line of nl.lines) {
    ctx.fillText(line, X, y);
    y += nl.size * 1.12;
  }
  if (c.native) {
    ctx.font = BODY(20);
    ctx.fillStyle = '#b9b4c2';
    ctx.fillText(fitText(ctx, c.native, CW), X, y + 2);
    y += 32;
  }
  ctx.font = BODY(19);
  ctx.fillStyle = RED;
  ctx.fillText(fitText(ctx, plain(c.series).toUpperCase(), CW), X, y + 4);
  y += 44;

  // Valeur : puissance, aura, popularité.
  const stats = [
    ['Puissance', fr(c.pow)],
    ['Aura', fr(c.aura)],
    ['Popularité', `#${fr((c.rank ?? 0) + 1)}`],
  ];
  const sw = (CW - 24) / 3;
  stats.forEach(([l, v], i) => {
    const sx = X + i * (sw + 12);
    box(ctx, sx, y, sw, 72);
    label(ctx, l, sx + 16, y + 12);
    ctx.font = DISPLAY(24);
    ctx.fillStyle = TEXT;
    ctx.fillText(v, sx + 16, y + 34);
  });
  y += 88;

  // Prix au marché et possession, côte à côte.
  const half = (CW - 12) / 2;
  const p = c.prices;
  const price = p?.median7d ?? p?.lastPrice ?? null;
  box(ctx, X, y, half, 104);
  label(ctx, 'Prix au marché', X + 16, y + 12);
  ctx.font = DISPLAY(30);
  ctx.fillStyle = '#5ec8ff';
  ctx.fillText(price !== null ? `${fr(price)} ◆` : '—', X + 16, y + 34);
  ctx.font = BODY(14);
  ctx.fillStyle = MUTED;
  ctx.fillText(
    fitText(ctx, price !== null ? `Médiane 7 j · ${fr(p.sales7d)} ventes en 7 j` : 'Aucune vente récente', half - 32),
    X + 16,
    y + 76,
  );

  const ox = X + half + 12;
  box(ctx, ox, y, half, 104, owned ? `${GREEN}99` : owned === null ? `${RED}66` : BORDER);
  label(ctx, 'Ta collection', ox + 16, y + 12);
  ctx.textBaseline = 'middle';
  if (owned === undefined) {
    ctx.font = BODY(18);
    ctx.fillStyle = MUTED;
    ctx.fillText(fitText(ctx, 'Compte Kyara non reconnu', half - 32), ox + 16, y + 52);
  } else {
    checkIcon(ctx, ox + 31, y + 52, Boolean(owned));
    ctx.font = BODY(20);
    ctx.fillStyle = owned ? GREEN : '#ff8a73';
    const txt = owned ? `Tu l’as${owned.qty > 1 ? ` (×${owned.qty})` : ''}` : 'Tu ne l’as pas encore';
    ctx.fillText(fitText(ctx, txt, half - 76), ox + 56, y + 53);
  }
  ctx.textBaseline = 'top';
  ctx.font = BODY(14);
  ctx.fillStyle = MUTED;
  ctx.fillText(fitText(ctx, `Possédée par ${fr(owners)} joueurs`, half - 32), ox + 16, y + 76);
  y += 120;

  // Meilleur booster pour l'obtenir.
  const bh = Math.max(84, H - PAD - y);
  box(ctx, X, y, CW, bh, '#f5c51866');
  label(ctx, 'Meilleur booster pour l’obtenir', X + 16, y + 12, '#e9c496');
  if (best) {
    ctx.font = DISPLAY(24);
    ctx.fillStyle = TEXT;
    const bn = fitText(ctx, plain(best.name), CW * 0.55);
    ctx.fillText(bn, X + 16, y + 36);
    ctx.font = BODY(16);
    ctx.fillStyle = MUTED;
    ctx.fillText(fitText(ctx, plain(best.priceLabel), CW * 0.55), X + 16, y + 68);
    ctx.textAlign = 'right';
    ctx.font = DISPLAY(22);
    ctx.fillStyle = '#f5c518';
    ctx.fillText(`1 chance sur ${fr(best.chance)}`, X + CW - 16, y + 40);
    ctx.textAlign = 'left';
  } else {
    ctx.font = BODY(18);
    ctx.fillStyle = MUTED;
    ctx.fillText('Disponible dans aucun booster en ce moment', X + 16, y + 40);
  }

  return canvas.encode('jpeg', 92);
}
