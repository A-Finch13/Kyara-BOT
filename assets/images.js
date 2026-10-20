// Images générées : grilles de cartes (illustration, bordure de rareté, nom) et outils de dessin partagés.
// Les illustrations sont téléchargées une seule fois puis gardées dans data/cache/cartes/.

import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchAsset, RARITIES, SITE } from './kyara.js';

const here = path.dirname(fileURLToPath(import.meta.url));
GlobalFonts.registerFromPath(path.join(here, 'fonts', 'ZenKakuGothicNew-Bold.ttf'), 'Kyara');
GlobalFonts.registerFromPath(path.join(here, 'fonts', 'Unbounded-Black.ttf'), 'Unbounded');
GlobalFonts.registerFromPath(path.join(here, 'fonts', 'JetBrainsMono-Medium.ttf'), 'Mono');
const cacheDir = path.join(here, '..', 'data', 'cache', 'cartes');

export const TILE_W = 138; // illustrations du site : 345×518, on garde le même ratio
export const TILE_H = 207;
const GAP = 10;
const PAD = 14;
const SECTION_TITLE = 30;
const SECTION_GAP = 18;
export const BG = '#0e0d12'; // fond du site
export const ORANGE = '#ff7a3d';
export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
// Les espaces insécables des nombres français n'existent pas dans la police : espaces normales.
export const plain = (s) => String(s).replace(/[  ]/g, ' ');

// --- Illustrations ---

const pending = new Map(); // id -> promesse de téléchargement
const cacheFile = (id) => path.join(cacheDir, `${id}.webp`);

async function download(card) {
  try {
    const buf = await fetchAsset(`/cards/sm/${card.id}.webp`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile(card.id), buf);
    return buf;
  } catch {
    // Pas d'illustration Kyara : image AniList du perso (non mise en cache, le site peut l'ajouter plus tard).
    if (!card.image) return null;
    const res = await fetch(card.image, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    return res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
}

export async function cardArt(card) {
  let buf = await readFile(cacheFile(card.id)).catch(() => null);
  if (!buf) {
    if (!pending.has(card.id)) pending.set(card.id, download(card).finally(() => pending.delete(card.id)));
    buf = await pending.get(card.id);
  }
  return buf ? loadImage(buf).catch(() => null) : null;
}

// Grande illustration d'une carte (690×1035) en fichier, pour la joindre au message : Discord n'arrive
// pas toujours à afficher les images de kyara.games par URL. Gardée dans data/cache/cartes-lg/.
// Renvoie un Buffer WebP, ou null si le site n'a pas d'illustration pour cette carte.
const largeDir = path.join(here, '..', 'data', 'cache', 'cartes-lg');
const largePending = new Map();
export async function largeArt(card) {
  const file = path.join(largeDir, `${card.id}.webp`);
  const cached = await readFile(file).catch(() => null);
  if (cached) return cached;
  if (!largePending.has(card.id)) {
    largePending.set(
      card.id,
      fetchAsset(`/cards/lg/${card.id}.webp`)
        .then(async (buf) => {
          await mkdir(largeDir, { recursive: true });
          await writeFile(file, buf);
          return buf;
        })
        .catch(() => null)
        .finally(() => largePending.delete(card.id)),
    );
  }
  return largePending.get(card.id);
}

// Page « une carte » : l'embed avec la grande illustration jointe au message (ou l'image AniList à défaut).
export function withLargeArt(embed, card) {
  return {
    embed,
    imageName: `carte-${card.id}.webp`,
    image: async () => {
      const buf = await largeArt(card);
      if (buf) return buf;
      if (card.image) embed.setImage(card.image);
      return null; // pas de fichier : la page garde l'image AniList
    },
  };
}

// URL de la grande illustration d'une carte (pour les fiches une par une), ou l'image AniList à défaut.
const artExists = new Map(); // id -> promesse<boolean>
export async function artUrl(card) {
  if (!artExists.has(card.id)) {
    artExists.set(
      card.id,
      access(cacheFile(card.id)).then(
        () => true,
        () => fetchAsset(`/cards/lg/${card.id}.webp`, { head: true }).catch(() => false),
      ),
    );
  }
  return (await artExists.get(card.id)) ? `${SITE}/cards/lg/${card.id}.webp` : card.image;
}

// --- Dessin ---

export function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fitText(ctx, text, maxWidth) {
  text = plain(text);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function borderStyle(ctx, rarity, x, y) {
  if (rarity === 'M') {
    // Mythique : bordure arc-en-ciel, comme sur le site.
    const g = ctx.createLinearGradient(x, y, x + TILE_W, y + TILE_H);
    ['#ff4d2e', '#f5c518', '#3fbf7f', '#4d9bff', '#b072ff', '#ff4fa0'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    return g;
  }
  return hex(RARITIES[rarity]?.color ?? 0x888888);
}

export function drawTile(ctx, x, y, card, art, { badge = null, name = true } = {}) {
  // Illustration (recadrée pour remplir la tuile).
  ctx.save();
  roundedRect(ctx, x, y, TILE_W, TILE_H, 10);
  ctx.clip();
  ctx.fillStyle = '#1c1a22';
  ctx.fillRect(x, y, TILE_W, TILE_H);
  if (art) {
    const scale = Math.max(TILE_W / art.width, TILE_H / art.height);
    const w = art.width * scale;
    const h = art.height * scale;
    ctx.drawImage(art, x + (TILE_W - w) / 2, y + (TILE_H - h) / 2, w, h);
  } else {
    ctx.fillStyle = '#4a4655';
    ctx.font = '48px Kyara';
    ctx.textAlign = 'center';
    ctx.fillText('?', x + TILE_W / 2, y + TILE_H / 2);
  }
  if (name) {
    // Dégradé sombre en bas pour lire le nom.
    const g = ctx.createLinearGradient(0, y + TILE_H - 64, 0, y + TILE_H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + TILE_H - 64, TILE_W, 64);
  }
  ctx.restore();

  if (name) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Kyara';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, card.name, TILE_W - 16), x + 8, y + TILE_H - 10);
  }

  // Bordure de rareté.
  ctx.lineWidth = 4;
  ctx.strokeStyle = borderStyle(ctx, card.rarity, x, y);
  roundedRect(ctx, x + 2, y + 2, TILE_W - 4, TILE_H - 4, 9);
  ctx.stroke();

  // Pastille en haut à droite (quantité, prix…).
  if (badge) {
    ctx.font = '13px Kyara';
    ctx.textAlign = 'left';
    const label = fitText(ctx, badge, TILE_W - 30);
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(14,13,18,0.85)';
    roundedRect(ctx, x + TILE_W - w - 7, y + 7, w, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + TILE_W - w - 1, y + 21);
  }
}

// Planche de cartes en sections : [{ title?, items: [{ card, qty?, badge? }] }] → image JPEG (Buffer).
export async function cardSheet(sections, { cols = 5, names = true } = {}) {
  sections = sections.filter((s) => s.items.length);
  cols = Math.max(1, Math.min(cols, Math.max(...sections.map((s) => s.items.length))));
  const width = PAD * 2 + cols * TILE_W + (cols - 1) * GAP;
  const blocks = sections.map((s) => {
    const rows = Math.ceil(s.items.length / cols);
    return { ...s, rows, height: (s.title ? SECTION_TITLE : 0) + rows * TILE_H + (rows - 1) * GAP };
  });
  const height = PAD * 2 + blocks.reduce((h, b) => h + b.height, 0) + (blocks.length - 1) * SECTION_GAP;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const arts = await Promise.all(blocks.map((b) => Promise.all(b.items.map((it) => cardArt(it.card)))));
  let y = PAD;
  blocks.forEach((b, bi) => {
    if (b.title) {
      ctx.fillStyle = '#e9c496';
      ctx.font = '18px Kyara';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(plain(b.title), PAD + 2, y + 20);
      y += SECTION_TITLE;
    }
    b.items.forEach((it, i) => {
      const x = PAD + (i % cols) * (TILE_W + GAP);
      const ty = y + Math.floor(i / cols) * (TILE_H + GAP);
      const badge = it.badge ?? (it.qty > 1 ? `×${it.qty}` : null);
      drawTile(ctx, x, ty, it.card, arts[bi][i], { badge, name: names });
    });
    y += b.height - (b.title ? SECTION_TITLE : 0) + SECTION_GAP;
  });
  return canvas.encode('jpeg', 88);
}

// Grille simple : [{ card, qty? }].
export const cardGrid = (items, opts) => cardSheet([{ items }], opts);

// --- Avatars ronds (classement, profil) ---

export async function avatar(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    return res.ok ? await loadImage(Buffer.from(await res.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

export function drawAvatar(ctx, img, cx, cy, r, ring) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#2a2733';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  if (ring) {
    ctx.lineWidth = Math.max(3, r / 9);
    ctx.strokeStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
