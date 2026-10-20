// L'API publique ne donne pas la liste complète des cartes d'un joueur, seulement ses compteurs
// et une route « ce joueur possède-t-il cette carte ? ». On vérifie donc carte par carte,
// en s'arrêtant dès que les compteurs du profil permettent de déduire le reste.
//
// Tout ce qui a été vérifié est mémorisé (data/collections/<id joueur>.json) : une carte connue
// n'est plus jamais redemandée au site tant que le compteur de sa rareté n'a pas bougé.

import { kyara, listSeries, normalize, RARITY_ORDER } from './kyara.js';
import { jsonStore } from './store.js';

export const SCAN_MAX = 6800; // au-delà, on demande un filtre plus précis
const MAX_AGE = 60 * 60_000; // filet de sécurité : un échange 1 contre 1 de même rareté ne change aucun compteur
const MAX_PLAYERS_IN_MEMORY = 200;

// Nombre de cartes possédées connu d'avance pour un filtre, d'après le profil (null si inconnu).
export function expectedOwned(profile, { rarity, series }) {
  if (rarity && !series) return profile.byRarity?.[rarity] ?? null;
  if (series && !rarity) return profile.series?.find((s) => s.name === series)?.owned ?? null;
  if (!rarity && !series) return profile.owned ?? null;
  return null;
}

// --- Mémoire des cartes déjà vérifiées ---

const stores = new Map(); // kyaraId -> jsonStore, du moins au plus récemment utilisé

function playerStore(kyaraId) {
  let store = stores.get(kyaraId);
  if (store) stores.delete(kyaraId);
  else {
    if (stores.size >= MAX_PLAYERS_IN_MEMORY) stores.delete(stores.keys().next().value);
    store = jsonStore(`collections/${kyaraId}`);
  }
  stores.set(kyaraId, store);
  return store;
}

// Connaissances sur un joueur, par rareté :
//   { [rareté]: { count, at, cards: { [idCarte]: 0 | 1 | [qty, since] } } }
//   0 = absente, 1 = possédée (déduite des compteurs), [qty, since] = possédée (vérifiée).
// Une rareté est oubliée dès que son compteur change sur le profil (booster, vente, échange…), ou après 12 h.
async function knowledge(profile) {
  const store = playerStore(profile.id);
  const data = await store.load();
  let changed = false;
  for (const r of RARITY_ORDER) {
    const count = profile.byRarity?.[r] ?? 0;
    const k = data[r];
    if (k && k.count === count && Date.now() - k.at < MAX_AGE) continue;
    if (k) changed = true;
    data[r] = { count, at: Date.now(), cards: {} };
  }
  return { store, data, changed };
}

// La n-ième carte possédée (à partir de 0) parmi `cards`, dans leur ordre, sachant que le joueur
// en possède `expected`. Ne vérifie que ce qu'il faut : on part du début ou de la fin selon ce qui
// est le plus proche, par paquets de 30. Les pages suivantes réutilisent ce qui est déjà connu.
// Renvoie la carte, ou null si les compteurs du profil ne correspondent plus.
export async function nthOwned(profile, cards, expected, n) {
  if (n < 0 || n >= expected) return null;
  const { store, data, changed } = await knowledge(profile);
  let dirty = changed;
  const fromEnd = n >= expected / 2;
  const list = fromEnd ? [...cards].reverse() : cards;
  const target = fromEnd ? expected - 1 - n : n;
  let found = -1;
  try {
    for (let i = 0; i < list.length; i += 30) {
      const chunk = list.slice(i, i + 30);
      const unknown = chunk.filter((c) => data[c.rarity] && data[c.rarity].cards[c.id] === undefined);
      const results = await Promise.all(unknown.map((c) => kyara.userCard(profile.id, c.id)));
      unknown.forEach((c, j) => {
        const o = results[j].owned;
        data[c.rarity].cards[c.id] = o ? [o.qty, o.since] : 0;
        dirty = true;
      });
      for (const c of chunk) {
        if (data[c.rarity]?.cards[c.id] && ++found === target) return c;
      }
    }
    return null;
  } finally {
    if (dirty) await store.save();
  }
}

// Renvoie Map<idCarte, { qty, since } | true> des cartes possédées parmi `cards`
// (true = possédée, déduite des compteurs sans vérification individuelle).
export async function ownedCards(profile, cards, expected = null) {
  const { store, data, changed } = await knowledge(profile);
  let dirty = changed;
  const owned = new Map();
  const unknown = [];
  for (const c of cards) {
    const v = data[c.rarity]?.cards[c.id];
    if (v === undefined) unknown.push(c);
    else if (v) owned.set(c.id, v === 1 ? true : { qty: v[0], since: v[1] });
  }

  const record = (c, v) => {
    if (!data[c.rarity]) return; // rareté inconnue du bot : on ne mémorise pas
    data[c.rarity].cards[c.id] = v;
    dirty = true;
  };
  // Si les compteurs permettent de conclure pour les cartes restantes, on les déduit sans requête.
  const settle = (rest) => {
    if (expected === null) return false;
    if (owned.size >= expected) {
      for (const c of rest) record(c, 0); // tout le reste manque
      return true;
    }
    if (owned.size + rest.length <= expected) {
      for (const c of rest) {
        owned.set(c.id, true); // tout le reste est possédé
        record(c, 1);
      }
      return true;
    }
    return false;
  };

  for (let i = 0; i < unknown.length && !settle(unknown.slice(i)); i += 60) {
    const batch = unknown.slice(i, i + 60);
    const results = await Promise.all(batch.map((c) => kyara.userCard(profile.id, c.id)));
    batch.forEach((c, j) => {
      const o = results[j].owned;
      if (o) owned.set(c.id, o);
      record(c, o ? [o.qty, o.since] : 0);
    });
  }

  if (dirty) await store.save();
  return owned;
}

// Progression d'un joueur sur plusieurs œuvres : [{ name, cards, owned: Map }].
export async function seriesProgress(profile, names) {
  // Correspondance sans majuscules ni accents : une série personnalisée est rattachée
  // automatiquement à l'œuvre quand elle arrive sur Kyara.
  const all = new Map((await listSeries()).map((s) => [normalize(s.name), s]));
  const out = [];
  for (const name of names) {
    const s = all.get(normalize(name));
    if (!s) {
      out.push({ name, cards: [], owned: new Map(), gone: true }); // pas (ou plus) sur Kyara : série personnalisée
      continue;
    }
    const owned = await ownedCards(profile, s.cards, expectedOwned(profile, { series: s.name }));
    out.push({ name: s.name, cards: s.cards, owned });
  }
  return out;
}

// --- Œuvres possédées par un joueur (menu « Œuvre » de /collection) ---
//
// Le profil public ne donne que ses 8 œuvres les plus avancées. Pour les autres, on analyse la collection
// en arrière-plan : pour chaque œuvre, on vérifie ses cartes jusqu'à trouver la première possédée.
// L’analyse est limitée (24 requêtes/s au plus, un joueur à la fois) pour ne pas gêner
// les commandes ; son résultat est gardé 24 h (data/collections/<id>.json, clé « _series »).

const SERIES_TTL = 6 * 60 * 60_000; // nouvelle analyse complète toutes les 6 h ; entre-temps, les œuvres des cartes vérifiées s’ajoutent au fur et à mesure
const seriesJobs = new Map(); // kyaraId -> { progress }
let seriesQueue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Valeur connue d'une carte, ou déduite des compteurs (aucune carte / toutes les cartes de sa rareté).
function cardState(data, totals, c) {
  const k = data[c.rarity];
  if (!k) return 0;
  const v = k.cards[c.id];
  if (v !== undefined) return v;
  if (k.count === 0) return 0;
  if (k.count >= totals[c.rarity]) return 1;
  return undefined;
}

async function scanSeries(profile, job) {
  const { store, data } = await knowledge(profile);
  const all = await listSeries();
  const totals = {};
  for (const s of all) for (const c of s.cards) totals[c.rarity] = (totals[c.rarity] ?? 0) + 1;
  const found = [];
  for (let i = 0; i < all.length; i++) {
    job.progress = i / all.length;
    const cards = [...all[i].cards].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
    let owned = false;
    for (let k = 0; k < cards.length && !owned; k += 6) {
      const chunk = cards.slice(k, k + 6);
      const unknown = chunk.filter((c) => cardState(data, totals, c) === undefined);
      if (unknown.length) {
        const results = await Promise.all(unknown.map((c) => kyara.userCard(profile.id, c.id).catch(() => null)));
        unknown.forEach((c, j) => {
          const o = results[j]?.owned;
          if (results[j] && data[c.rarity]) data[c.rarity].cards[c.id] = o ? [o.qty, o.since] : 0;
        });
        await sleep(unknown.length * 42); // ≤ 24 requêtes/s (le site en autorise 2000/min ; pause automatique si le quota s’épuise)
      }
      owned = chunk.some((c) => cardState(data, totals, c));
    }
    if (owned) found.push(all[i].name);
    if (i % 25 === 24) await store.save(); // on garde ce qui est déjà vérifié : une analyse interrompue reprend là où elle s’était arrêtée
  }
  data._series = { names: found, at: Date.now() };
  await store.save();
}

function startSeriesScan(profile) {
  if (seriesJobs.has(profile.id)) return;
  const job = { progress: 0 };
  seriesJobs.set(profile.id, job);
  seriesQueue = seriesQueue
    .then(() => scanSeries(profile, job))
    .catch((err) => console.warn(`⚠️ Analyse des œuvres de ${profile.pseudo} interrompue :`, err.message))
    .finally(() => seriesJobs.delete(profile.id));
}

// Œuvres où le joueur possède au moins une carte, avec ce qui est connu tout de suite :
// { names: [...], done, progress }. Lance l'analyse en arrière-plan si elle manque ou a plus de 24 h.
export async function ownedSeries(profile) {
  const { data } = await knowledge(profile);
  const names = new Set((profile.series ?? []).map((s) => s.name));
  for (const n of data._series?.names ?? []) names.add(n);
  // Œuvres des cartes déjà vérifiées comme possédées (pendant l'analyse ou en parcourant la collection).
  const catalog = await kyara.catalog();
  for (const c of catalog) {
    const v = data[c.rarity]?.cards[c.id];
    if (v) names.add(c.series);
  }
  const done = Boolean(data._series && Date.now() - data._series.at < SERIES_TTL);
  if (!done) startSeriesScan(profile);
  return { names: [...names], done, progress: seriesJobs.get(profile.id)?.progress ?? (done ? 1 : 0) };
}
