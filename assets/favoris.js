// Œuvres favorites de chaque membre Discord, stockées dans data/favoris.json.
import { normalize } from './kyara.js';
import { jsonStore } from './store.js';

const store = jsonStore('favoris'); // { [discordId]: [nom d'œuvre, …] }
export const MAX_FAVORIS = 15;

export async function getFavoris(discordId) {
  return (await store.load())[discordId] ?? [];
}

// Renvoie "ok", "deja" ou "plein".
export async function addFavori(discordId, series) {
  const all = await store.load();
  const list = all[discordId] ?? [];
  if (list.some((s) => normalize(s) === normalize(series))) return 'deja'; // sans tenir compte des majuscules ni des accents
  if (list.length >= MAX_FAVORIS) return 'plein';
  all[discordId] = [...list, series];
  await store.save();
  return 'ok';
}

export async function removeFavori(discordId, series) {
  const all = await store.load();
  const list = all[discordId] ?? [];
  if (!list.includes(series)) return false;
  all[discordId] = list.filter((s) => s !== series);
  if (!all[discordId].length) delete all[discordId];
  await store.save();
  return true;
}
