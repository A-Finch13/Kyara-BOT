// Fiche d'une carte, une par page (à la façon de Mudae) : nom, rareté, œuvre, prix et grande illustration.
import { largeArt, withLargeArt } from './images.js';
import { chakra, kyara, RARITIES, wikiUrl } from './kyara.js';
import { baseEmbed } from './pages.js';

// author : { name, iconURL, url } facultatif (le joueur dont on parcourt la collection).
// Renvoie une page dont l'illustration est jointe au message (affichage garanti sur Discord).
export async function cardEmbed(card, { author = null } = {}) {
  // Prix et illustration en parallèle (l'illustration est ensuite déjà en cache pour la page).
  const [details] = await Promise.all([kyara.character(card.id).catch(() => null), largeArt(card)]);
  const r = RARITIES[card.rarity];
  const p = details?.prices;
  const price = p?.median7d ?? p?.lastPrice ?? null;

  const embed = baseEmbed()
    .setColor(r?.color ?? null)
    .setTitle(card.name)
    .setURL(wikiUrl(card.id))
    .setDescription(
      [
        `*${card.series}*`,
        r ? `${r.emoji} **${r.label}**` : card.rarity,
        price !== null ? `💰 **${chakra(price)}**` : '💰 Pas encore vendue au marché',
      ].join('\n'),
    )
    .setFooter({ text: 'kyara.games' });
  if (author) embed.setAuthor(author);
  return withLargeArt(embed, card);
}
