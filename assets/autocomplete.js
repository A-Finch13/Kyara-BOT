import { listSeries, normalize, RARITIES, searchCharacters, truncate } from './kyara.js';

// La valeur renvoyée est l'ID du perso, le libellé est lisible.
export async function characterChoices(query) {
  const results = await searchCharacters(query, 25);
  return results.map((c) => ({
    name: truncate(`${c.name} — ${c.series} (${RARITIES[c.rarity]?.label ?? c.rarity})`, 100),
    value: String(c.id),
  }));
}

export async function seriesChoices(query, only = null) {
  const q = normalize(query);
  let series = await listSeries();
  if (only) series = series.filter((s) => only.includes(s.name));
  return series
    .filter((s) => normalize(s.name).includes(q))
    .slice(0, 25)
    .map((s) => ({ name: truncate(`${s.name} (${s.cards.length} cartes)`, 100), value: s.name.slice(0, 100) })); // tronqué sans « … » : resolveSeries() le retrouve par le début
}
