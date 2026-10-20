// Images de /profil, dans le style de la page profil du site : en-tête (avatar, pseudo, rang, bio, badges)
// avec un encadré de stats, puis la vitrine. Une seconde image détaille la collection par rareté.

import { createCanvas } from '@napi-rs/canvas';
import {
  avatar,
  BG,
  cardArt,
  drawAvatar,
  drawTile,
  fitText,
  hex,
  ORANGE,
  plain,
  roundedRect,
  TILE_H,
  TILE_W,
} from './images.js';
import { RARITIES, RARITY_ORDER } from './kyara.js';

const W = 1200;
// Rendu en double résolution (2400 px de large) : net même en plein écran sur Discord.
const RES = 2;
function hdCanvas(height) {
  const canvas = createCanvas(W * RES, Math.ceil(height * RES));
  const ctx = canvas.getContext('2d');
  ctx.scale(RES, RES); // on dessine toujours en coordonnées 1200 px
  return { canvas, ctx };
}
const RED = '#ff4d2e';
const GOLD = '#e9c496';
const MUTED = '#8d8899';
const TEXT = '#efebe4';
const BORDER = '#2a2733';
const DISPLAY = (size) => `${size}px Unbounded, Kyara`;
const MONO = (size) => `${size}px Mono, Kyara`;
const BODY = (size) => `${size}px Kyara`;
const fr = (n) => plain(Number(n ?? 0).toLocaleString('fr-FR'));

// Coupe un texte en lignes de largeur max (les retours à la ligne du texte sont gardés).
function wrap(ctx, text, maxWidth, maxLines) {
  const lines = [];
  for (const para of plain(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        if (line) lines.push(line);
        line = ctx.measureText(word).width <= maxWidth ? word : fitText(ctx, word, maxWidth);
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fitText(ctx, `${lines[maxLines - 1]}…`, maxWidth);
  }
  return lines;
}

// Pseudo en gros : réduit jusqu’à 32 px, puis coupé sur 2 lignes comme sur le site.
function pseudoLayout(ctx, pseudo, maxWidth) {
  for (let size = 64; size >= 32; size -= 4) {
    ctx.font = DISPLAY(size);
    if (ctx.measureText(pseudo).width <= maxWidth) return { size, lines: [pseudo] };
  }
  ctx.font = DISPLAY(40);
  const lines = [''];
  for (const ch of pseudo) {
    const cur = lines[lines.length - 1];
    if (ctx.measureText(cur + ch).width > maxWidth && lines.length < 2) lines.push(ch);
    else lines[lines.length - 1] = cur + ch;
  }
  lines[1] = fitText(ctx, lines[1] ?? '', maxWidth);
  return { size: 40, lines };
}

function chip(ctx, x, y, text, { fill = null, stroke = null, color = TEXT, font = BODY(14), h = 26 } = {}) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 22;
  roundedRect(ctx, x, y, w, h, h / 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 11, y + h / 2 + 1);
  return w;
}

function background(ctx, height) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, height);
  // Lueur rouge en haut à gauche, comme sur le site.
  const glow = ctx.createRadialGradient(120, 0, 0, 120, 0, 700);
  glow.addColorStop(0, 'rgba(255,77,46,0.16)');
  glow.addColorStop(1, 'rgba(255,77,46,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, height);
}

// Avatar dans un anneau rouge avec un losange au sommet.
function bigAvatar(ctx, img, cx, cy, r, initial) {
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, '#ff7a3d');
  g.addColorStop(1, '#c81e1e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BG;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fill();
  drawAvatar(ctx, img, cx, cy, r, null);
  if (!img) {
    ctx.fillStyle = MUTED;
    ctx.font = DISPLAY(Math.round(r * 0.8));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, cx, cy + 4);
  }
  ctx.fillStyle = '#ff6a3d';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r - 30);
  ctx.lineTo(cx + 12, cy - r - 16);
  ctx.lineTo(cx, cy - r - 2);
  ctx.lineTo(cx - 12, cy - r - 16);
  ctx.closePath();
  ctx.fill();
}

// Position de chaque stat : sur 2 colonnes, ou toute la largeur avec wide: true.
function statsLayout(stats) {
  let row = 0;
  let col = 0;
  const pos = stats.map((s) => {
    if (s.wide && col) {
      row++;
      col = 0;
    }
    const p = { row, col, wide: Boolean(s.wide) };
    if (s.wide || col === 1) {
      row++;
      col = 0;
    } else col = 1;
    return p;
  });
  return { pos, rows: row + (col ? 1 : 0) };
}

const statsBoxHeight = (stats, rank) => 28 + statsLayout(stats).rows * 78 + (rank ? 64 : 0) + 12;

// Encadré de stats : [{ value, total?, label, color?, wide? }], puis la barre de rang.
function statsBox(ctx, x, y, w, stats, rank) {
  const colW = (w - 48) / 2;
  const rowH = 78;
  const { pos, rows } = statsLayout(stats);
  const h = statsBoxHeight(stats, rank);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = BORDER;
  ctx.stroke();

  stats.forEach((s, i) => {
    const sx = x + 24 + pos[i].col * colW;
    const sy = y + 28 + pos[i].row * rowH;
    const maxW = pos[i].wide ? w - 48 : colW - 10;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = DISPLAY(30);
    ctx.fillStyle = s.color ?? TEXT;
    const value = fitText(ctx, s.value, maxW);
    ctx.fillText(value, sx, sy);
    if (s.total) {
      ctx.fillStyle = '#55505f';
      ctx.fillText(fitText(ctx, `/${s.total}`, maxW - ctx.measureText(value).width), sx + ctx.measureText(value).width, sy);
    }
    ctx.font = MONO(13);
    ctx.fillStyle = MUTED;
    ctx.fillText(s.label.toUpperCase(), sx, sy + 42);
  });

  if (rank) {
    const ry = y + 28 + rows * rowH + 6;
    ctx.font = MONO(13);
    ctx.fillStyle = MUTED;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(rank.next ? `VERS ${rank.next.label.toUpperCase()}` : 'RANG MAXIMAL', x + 24, ry);
    ctx.textAlign = 'right';
    ctx.fillText(rank.next ? `${fr(rank.points)} / ${fr(rank.next.min)} PTS` : `${fr(rank.points)} PTS`, x + w - 24, ry);
    const bw = w - 48;
    const ratio = rank.next ? Math.min(1, rank.points / rank.next.min) : 1;
    ctx.fillStyle = BORDER;
    roundedRect(ctx, x + 24, ry + 24, bw, 10, 5);
    ctx.fill();
    const g = ctx.createLinearGradient(x + 24, 0, x + 24 + bw, 0);
    g.addColorStop(0, '#ff7a3d');
    g.addColorStop(1, RED);
    ctx.fillStyle = g;
    roundedRect(ctx, x + 24, ry + 24, Math.max(10, bw * ratio), 10, 5);
    ctx.fill();
  }
  return h;
}

// p : { u, completedSeries, isSelf, showcase: [carte], hidden: { collection, doubles } }
export async function profileImage({ u, completedSeries, isSelf, showcase, hidden }) {
  const avatarUrl = u.avatar?.replace(/\.webp/, '.png').replace(/size=\d+/, 'size=512');
  const [img, arts] = await Promise.all([avatar(avatarUrl), Promise.all(showcase.map((c) => cardArt(c)))]);

  // Mise en page de l'en-tête sur un canevas de mesure.
  const measure = createCanvas(10, 10).getContext('2d');
  const MID_X = 300;
  const MID_W = 450;
  const pseudo = pseudoLayout(measure, plain(u.pseudo), MID_W);
  measure.font = BODY(18);
  const bio = u.bio ? wrap(measure, u.bio, MID_W, 3) : [];
  const badges = u.badges ?? [];

  // Hauteur de la colonne centrale.
  const lineH = pseudo.size * 1.05;
  let midH = 22 + 14 + pseudo.lines.length * lineH + 12 + 58 + 14 + bio.length * 26 + (bio.length ? 14 : 0) + 26;
  // Badges sur plusieurs lignes si besoin.
  const badgeRows = [];
  measure.font = BODY(14);
  let rowW = 0;
  for (const b of badges) {
    const w = measure.measureText(`${b.kanji ?? '•'}  ${b.label}`).width + 22 + 8;
    if (!badgeRows.length || rowW + w > MID_W) {
      badgeRows.push([]);
      rowW = 0;
    }
    badgeRows[badgeRows.length - 1].push(b);
    rowW += w;
  }
  midH += badgeRows.length ? 16 + badgeRows.length * 34 : 0;

  const stats = [
    hidden.collection
      ? { value: '—', label: 'Cartes uniques', wide: true }
      : { value: fr(u.owned), total: fr(u.catalogSize), label: 'Cartes uniques', wide: true },
    hidden.collection
      ? { value: '—', label: 'Complétion' }
      : {
          value: `${(Math.floor((u.owned / u.catalogSize) * 1000) / 10).toLocaleString('fr-FR')} %`,
          label: 'Complétion',
          color: RED,
        },
    { value: fr(u.boostersOpened), label: 'Boosters ouverts' },
    { value: completedSeries === null || completedSeries === undefined ? '—' : fr(completedSeries), label: 'Œuvres complètes' },
    { value: hidden.doubles ? '—' : fr(u.doublesCount), label: 'Doublons' },
  ];
  const BOX_X = 780;
  const BOX_W = W - BOX_X - 36;
  const boxH = statsBoxHeight(stats, u.rank);

  const headerH = Math.max(midH, boxH, 280) + 80;
  // Vitrine sur une seule ligne : l'image reste plus large que haute, et Discord l'affiche plus grande.
  const VGAP = 14;
  const SCALE = showcase.length ? Math.min(1.08, (W - 72 - (showcase.length - 1) * VGAP) / showcase.length / TILE_W) : 1;
  const tw = TILE_W * SCALE;
  const th = TILE_H * SCALE;
  const cols = showcase.length;
  const vitrineH = showcase.length ? 40 + th + 40 : 0;
  const H = headerH + vitrineH;

  const { canvas, ctx } = hdCanvas(H);
  background(ctx, H);

  // --- Colonne de gauche : avatar ---
  const headTop = 40;
  const cy = headTop + Math.max(midH, boxH, 280) / 2;
  bigAvatar(ctx, img, 160, cy, 100, (u.pseudo?.[0] ?? '?').toUpperCase());

  // --- Colonne centrale ---
  let y = headTop + 10;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = MONO(14);
  ctx.fillStyle = RED;
  ctx.fillText(fitText(ctx, (u.title ?? 'Joueur Kyara').toUpperCase(), MID_W), MID_X, y);
  y += 30;
  ctx.font = DISPLAY(pseudo.size);
  ctx.fillStyle = TEXT;
  for (const line of pseudo.lines) {
    ctx.fillText(line, MID_X, y);
    y += lineH;
  }
  y += 12;
  if (u.rank) {
    // Pastille du rang (kanji) et son nom en dessous.
    ctx.font = BODY(22);
    const kw = ctx.measureText(u.rank.kanji ?? '').width + 24;
    ctx.fillStyle = '#c81e3c';
    roundedRect(ctx, MID_X, y, kw, 36, 9);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f5a524';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(u.rank.kanji ?? '', MID_X + 12, y + 19);
    ctx.font = MONO(12);
    ctx.fillStyle = '#f5a524';
    ctx.textAlign = 'center';
    ctx.fillText(u.rank.label.toUpperCase(), MID_X + kw / 2, y + 48);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
  y += 72;
  ctx.font = BODY(18);
  ctx.fillStyle = '#cfcad6';
  for (const line of bio) {
    ctx.fillText(line, MID_X, y);
    y += 26;
  }
  if (bio.length) y += 14;
  ctx.font = BODY(15);
  ctx.fillStyle = MUTED;
  const since = `Membre depuis le ${new Date(u.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  ctx.fillText(since, MID_X, y + 3);
  if (isSelf) chip(ctx, MID_X + ctx.measureText(since).width + 12, y, 'c’est toi', { fill: RED, color: '#ffffff', font: MONO(12), h: 22 });
  y += 26;
  if (badgeRows.length) y += 16;
  const badgeColors = ['#3fbfa0', '#7b7bff', '#f5a524', '#ff6a8a'];
  let bi = 0;
  for (const row of badgeRows) {
    let x = MID_X;
    for (const b of row) {
      const color = badgeColors[bi++ % badgeColors.length];
      x += chip(ctx, x, y, `${b.kanji ?? '•'}  ${b.label}`, { stroke: color, color, fill: 'rgba(255,255,255,0.03)' }) + 8;
    }
    y += 34;
  }

  // --- Encadré des stats ---
  statsBox(ctx, BOX_X, headTop + (Math.max(midH, boxH, 280) - boxH) / 2, BOX_W, stats, u.rank);

  // --- Vitrine ---
  if (showcase.length) {
    let vy = headerH;
    ctx.fillStyle = BORDER;
    ctx.fillRect(36, vy - 20, W - 72, 1.5);
    ctx.font = MONO(14);
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('VITRINE', 36, vy);
    vy += 40;
    const gridW = cols * tw + (cols - 1) * VGAP;
    const x0 = (W - gridW) / 2;
    showcase.forEach((card, i) => {
      ctx.save();
      ctx.translate(x0 + i * (tw + VGAP), vy);
      ctx.scale(SCALE, SCALE);
      drawTile(ctx, 0, 0, card, arts[i], { name: false });
      ctx.restore();
    });
  }
  return canvas.encode('jpeg', 92);
}

// Collection par rareté : une barre par rareté, à la couleur de la rareté.
export async function rarityImage({ u, totals }) {
  const avatarUrl = u.avatar?.replace(/\.webp/, '.png').replace(/size=\d+/, 'size=256');
  const img = await avatar(avatarUrl);
  const ROW = 78;
  const H = 150 + RARITY_ORDER.length * ROW + 20;
  const { canvas, ctx } = hdCanvas(H);
  background(ctx, H);

  drawAvatar(ctx, img, 76, 74, 36, RED);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = MONO(14);
  ctx.fillStyle = RED;
  ctx.fillText('COLLECTION PAR RARETÉ', 132, 42);
  ctx.font = DISPLAY(34);
  ctx.fillStyle = TEXT;
  ctx.fillText(fitText(ctx, plain(u.pseudo), 600), 132, 66);
  ctx.font = DISPLAY(28);
  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT;
  const total = `${fr(u.owned)}`;
  ctx.fillText(total, W - 40 - ctx.measureText(`/${fr(u.catalogSize)}`).width, 70);
  ctx.fillStyle = '#55505f';
  ctx.fillText(`/${fr(u.catalogSize)}`, W - 40, 70);

  const LABEL_W = 250;
  const BAR_X = 40 + LABEL_W;
  const BAR_W = W - BAR_X - 220;
  [...RARITY_ORDER].reverse().forEach((r, i) => {
    const y = 150 + i * ROW;
    const n = u.byRarity?.[r] ?? 0;
    const t = totals[r] || 1;
    const color = hex(RARITIES[r].color);
    const mid = y + 26;
    // Pastille et nom.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(52, mid, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = BODY(22);
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(RARITIES[r].label, 76, mid + 1);
    // Barre.
    ctx.fillStyle = BORDER;
    roundedRect(ctx, BAR_X, mid - 9, BAR_W, 18, 9);
    ctx.fill();
    if (n > 0) {
      let fill = color;
      if (r === 'M') {
        fill = ctx.createLinearGradient(BAR_X, 0, BAR_X + BAR_W, 0);
        ['#ff4d2e', '#f5c518', '#3fbf7f', '#4d9bff', '#b072ff', '#ff4fa0'].forEach((c, k, a) => fill.addColorStop(k / (a.length - 1), c));
      }
      ctx.fillStyle = fill;
      roundedRect(ctx, BAR_X, mid - 9, Math.max(18, BAR_W * Math.min(1, n / t)), 18, 9);
      ctx.fill();
    }
    // Compteur.
    ctx.textAlign = 'right';
    ctx.font = DISPLAY(22);
    const totalTxt = `/${fr(t)}`;
    ctx.fillStyle = '#55505f';
    ctx.fillText(totalTxt, W - 40, mid + 1);
    ctx.fillStyle = n >= t ? color : TEXT;
    ctx.fillText(fr(n), W - 40 - ctx.measureText(totalTxt).width, mid + 1);
  });
  return canvas.encode('jpeg', 92);
}
