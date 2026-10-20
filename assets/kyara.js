// Client pour l'API publique de kyara.games (celle qu'utilise le site lui-même).
// Les réponses sont mises en cache et les requêtes limitées pour ne pas surcharger le site.

export const SITE = 'https://kyara.games';
const API = `${SITE}/api`;
const USER_AGENT = 'KyaraDiscordBot/2.0 (+https://discord.com)';

export const RARITIES = {
  C: { label: 'Commune', color: 0xb5b1bb, emoji: '⚪', square: '⬜' },
  U: { label: 'Peu commune', color: 0x3fbf7f, emoji: '🟢', square: '🟩' },
  R: { label: 'Rare', color: 0x4d9bff, emoji: '🔵', square: '🟦' },
  E: { label: 'Épique', color: 0xb072ff, emoji: '🟣', square: '🟪' },
  L: { label: 'Légendaire', color: 0xf5c518, emoji: '🟡', square: '🟨' },
  M: { label: 'Mythique', color: 0xff4d2e, emoji: '🔴', square: '🟥' },
};
export const RARITY_ORDER = ['C', 'U', 'R', 'E', 'L', 'M'];
export const RARITY_CHOICES = RARITY_ORDER.map((r) => ({ name: RARITIES[r].label, value: r }));
export const BRAND_COLOR = 0xff4d2e;

// Les classements du site (paramètre "by" de /leaderboard/ladder).
export const LADDERS = {
  collection: { label: 'Collection', field: 'owned', unit: 'cartes' },
  prestige: { label: 'Prestige', field: 'points', unit: 'pts' },
  mythics: { label: 'Mythiques', field: 'mythics', unit: 'mythiques' },
  series: { label: 'Œuvres complètes', field: 'series', unit: 'œuvres' },
  achievements: { label: 'Succès', field: 'achievements', unit: 'succès' },
};

export class KyaraError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// --- Limitation : 6 requêtes simultanées max, pause si le quota du site (2000 req/min) s'épuise ---

const MAX_CONCURRENT = 12; // largement sous le quota du site (2000 req/min), avec pause automatique s'il s'épuise
let active = 0;
let pauseUntil = 0;
const waiting = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r)); // le créneau est transmis par release()
  else active++;
  const wait = pauseUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

async function request(path, retry = true) {
  await acquire();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } finally {
    release();
  }
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset')) || 10;
  if (res.status === 429 || (Number.isFinite(remaining) && remaining < 100)) {
    pauseUntil = Math.max(pauseUntil, Date.now() + reset * 1000);
  }
  if (res.status === 429 && retry) return request(path, false);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message || body?.error) msg = body.message ?? body.error;
    } catch {}
    throw new KyaraError(msg, res.status);
  }
  return res.json();
}

// Fichier statique du site (illustration de carte…), soumis à la même limitation que l'API.
// Avec { head: true }, vérifie seulement que le fichier existe (renvoie true).
export async function fetchAsset(path, { head = false } = {}) {
  await acquire();
  try {
    const res = await fetch(`${SITE}${path}`, {
      method: head ? 'HEAD' : 'GET',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new KyaraError(`HTTP ${res.status}`, res.status);
    return head ? true : Buffer.from(await res.arrayBuffer());
  } finally {
    release();
  }
}

// --- Cache : les requêtes simultanées sur le même chemin partagent la même promesse ---

const cache = new Map(); // path -> { at, ttl, promise }

function purgeCache() {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= v.ttl) cache.delete(k);
}

// fresh: true → on redemande au site (sauf requête identique partie il y a moins de 2 s, partagée).
// Sert à lancer chaque commande avec les informations exactes du joueur.
async function get(path, ttlMs, { fresh = false } = {}) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < (fresh ? Math.min(hit.ttl, 2000) : hit.ttl)) return hit.promise;
  if (cache.size > 20_000) purgeCache();
  const promise = request(path);
  cache.set(path, { at: Date.now(), ttl: ttlMs, promise });
  try {
    return await promise;
  } catch (err) {
    // On garde l'ancienne valeur si le site est momentanément indisponible.
    if (hit && !(err instanceof KyaraError && err.status === 404)) {
      cache.set(path, hit);
      return hit.promise;
    }
    cache.delete(path);
    throw err;
  }
}

function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

const MIN = 60_000;

export const kyara = {
  catalog: () => get('/characters', 60 * MIN), // ~6 700 persos, ~1,7 Mo : une fois par heure
  character: (id, opts) => get(`/characters/${encodeURIComponent(id)}`, 5 * MIN, opts),
  catalogNews: () => get('/characters/news', 60 * MIN),
  packs: () => get('/packs', 30 * MIN),
  ladder: (by, q, opts) => get(`/leaderboard/ladder${qs({ by, q })}`, 1 * MIN, opts),
  user: (id, opts) => get(`/users/${encodeURIComponent(id)}`, 0.5 * MIN, opts), // la collection change vite : profil relu toutes les 30 s au plus
  // { card, owned: { qty, since } | null, hidden, owners }
  // Une annonce du marché, même terminée : { status: active | sold | expired | cancelled, finalPrice, … }
  listing: (id) => get(`/market/listings/${encodeURIComponent(id)}`, 1 * MIN),
  userCard: (userId, charId) => get(`/users/${encodeURIComponent(userId)}/cards/${encodeURIComponent(charId)}`, 5_000 /* 5 s : la mémoire des cartes (scan.js) fait le reste */),
};

// --- Catalogue ---

export const normalize = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const indexes = new WeakMap(); // catalogue -> { byId, series }

async function catalogIndex() {
  const catalog = await kyara.catalog();
  let idx = indexes.get(catalog);
  if (!idx) {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const series = new Map();
    for (const c of catalog) {
      if (!series.has(c.series)) series.set(c.series, { name: c.series, cards: [] });
      series.get(c.series).cards.push(c);
    }
    idx = { catalog, byId, series };
    indexes.set(catalog, idx);
  }
  return idx;
}

export async function getCharacter(id) {
  return (await catalogIndex()).byId.get(Number(id)) ?? null;
}

// Toutes les œuvres : [{ name, cards }], les plus grosses d'abord.
export async function listSeries() {
  return [...(await catalogIndex()).series.values()].sort((a, b) => b.cards.length - a.cards.length);
}

// Retrouve une œuvre à partir d'un nom (exact, puis début, puis contenu).
export async function resolveSeries(input) {
  const q = normalize(input);
  if (!q) return null;
  const all = await listSeries();
  return (
    all.find((s) => normalize(s.name) === q) ??
    all.find((s) => normalize(s.name).startsWith(q)) ??
    all.find((s) => normalize(s.name).includes(q)) ??
    null
  );
}

export async function filterCatalog({ rarity, series } = {}) {
  const { catalog } = await catalogIndex();
  return catalog.filter((c) => (!rarity || c.rarity === rarity) && (!series || c.series === series));
}

export async function searchCharacters(query, limit = 25) {
  const { catalog } = await catalogIndex();
  const q = normalize(query);
  if (!q) return catalog.slice(0, limit); // déjà trié par popularité
  const scored = [];
  for (const c of catalog) {
    const name = normalize(c.name);
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q) || (c.native && c.native.includes(query.trim()))) score = 3;
    else if (normalize(c.series).includes(q)) score = 4;
    if (score >= 0) scored.push([score, c.rank ?? 1e9, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((x) => x[2]);
}

// Résout l'option "nom" d'un perso : un ID (choisi via l'autocomplétion) ou un nom tapé à la main.
export async function resolveCharacter(input) {
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) {
    const found = await getCharacter(trimmed);
    if (found) return found;
  }
  const [best] = await searchCharacters(trimmed, 1);
  return best ?? null;
}

// Tri d'affichage : rareté décroissante, puis popularité.
export const byRarityThenRank = (a, b) =>
  RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || (a.rank ?? 1e9) - (b.rank ?? 1e9);

// --- Formatage ---

export const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR'));
export const chakra = (n) => (n === null || n === undefined ? '—' : `${fmt(n)} ◆`);
export const pct = (part, total) =>
  total ? `${(Math.floor((part / total) * 1000) / 10).toLocaleString('fr-FR')} %` : '—'; // arrondi vers le bas : 99,9 % ≠ 100 %
// Barre de progression en carrés emoji (10 max, pour tenir sur une ligne même sur mobile).
// Pleine seulement à 100 %, au moins un carré dès qu'il y a quelque chose.
export const bar = (part, total, width = 10, fill = '🟧') => {
  width = Math.min(width, 10);
  let filled = 0;
  if (total && part >= total) filled = width;
  else if (total && part > 0) filled = Math.min(width - 1, Math.max(1, Math.floor((part / total) * width)));
  return fill.repeat(filled) + '⬛'.repeat(width - filled);
};
export const rarityLabel = (r) => (RARITIES[r] ? `${RARITIES[r].emoji} ${RARITIES[r].label}` : r);
export const ts = (iso, style = 'R') => (iso ? `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>` : '—');
export const wikiUrl = (id) => `${SITE}/wiki/${id}`;
export const profileUrl = (id) => `${SITE}/profil/${id}`;
export const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const cardLine = (c, extra = '') =>
  `${RARITIES[c.rarity]?.emoji ?? ''} [${c.name}](${wikiUrl(c.id)}) — *${truncate(c.series, 40)}*${extra}`;

// Assemble des lignes sans dépasser `max` caractères (limite des champs Discord : 1024).
export function joinLines(lines, max = 1024) {
  const out = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const more = `… et ${lines.length - i} autre(s)`;
    if (len + lines[i].length + 1 + (i < lines.length - 1 ? more.length + 1 : 0) > max) {
      out.push(more);
      break;
    }
    out.push(lines[i]);
    len += lines[i].length + 1;
  }
  return out.join('\n') || '—';
}
