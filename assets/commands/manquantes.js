import { SlashCommandBuilder } from 'discord.js';
import { seriesChoices } from '../autocomplete.js';
import { getProfile, isVisible, privateMessage, playerChoices, profileFingerprint, resolveTarget, targetOptions } from '../comptes.js';
import { getFavoris } from '../favoris.js';
import {
  bar,
  byRarityThenRank,
  cardLine,
  filterCatalog,
  fmt,
  pct,
  profileUrl,
  RARITIES,
  RARITY_CHOICES,
  resolveSeries,
} from '../kyara.js';
import { baseEmbed, cardPages, characterControl, matchesCharacter, rarityControl, sendView, seriesControl } from '../pages.js';
import { expectedOwned, ownedCards, SCAN_MAX, seriesProgress } from '../scan.js';

export const data = targetOptions(
  new SlashCommandBuilder()
    .setName('manquantes')
    .setDescription('Affiche les cartes qui manquent à un joueur dans une œuvre (ou dans ses œuvres favorites)')
    .addStringOption((o) =>
      o.setName('oeuvre').setDescription('Œuvre à compléter (par défaut : tes favoris)').setAutocomplete(true),
    )
    .addStringOption((o) => o.setName('rarete').setDescription('Seulement cette rareté').addChoices(...RARITY_CHOICES)),
);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'oeuvre') return seriesChoices(focused.value);
  return playerChoices(focused.value, interaction);
}

export async function execute(interaction) {
  await interaction.deferReply();
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);

  let u = await getProfile(target.id, { fresh: true });
  if (!isVisible(u, 'collection')) return interaction.editReply(privateMessage(u, 'sa collection'));

  const seriesInput = interaction.options.getString('oeuvre');
  const series = seriesInput ? await resolveSeries(seriesInput) : null;
  if (seriesInput && !series) return interaction.editReply(`❌ Aucune œuvre trouvée pour « ${seriesInput} ».`);

  const make = (title) =>
    baseEmbed()
      .setAuthor({ name: u.pseudo, iconURL: u.avatar ?? undefined, url: profileUrl(u.id) })
      .setTitle(title)
      .setFooter({ text: 'kyara.games' });
  const message = (text) => [make('🧩 Manquantes').setDescription(text)];
  let perso = null; // personnage cherché (bouton « Rechercher un personnage »)
  const missing = (cards, owned) =>
    cards.filter((c) => !owned.has(c.id) && matchesCharacter(c, perso)).sort(byRarityThenRank);
  const line = (c) => cardLine(c);
  // Les œuvres favorites : celles du membre visé, sinon les tiennes.
  const favOwner = target.discordId ?? interaction.user.id;
  const favoris = await getFavoris(favOwner);

  const build = async ({ rarete: rarity, oeuvre, perso: query }) => {
    perso = query ?? null;
    u = await getProfile(target.id, { fresh: true }); // données à jour à chaque reconstruction (la collection change vite)
    // Une œuvre et/ou une rareté précise.
    if (oeuvre || rarity) {
      let seriesName = null;
      if (oeuvre) {
        // Les menus tronquent les noms à 100 caractères, et un favori peut être une série personnalisée.
        seriesName = (await resolveSeries(oeuvre))?.name;
        if (!seriesName) return message(`✨ **${oeuvre}** n’est pas encore sur Kyara (série personnalisée).`);
      }
      const cards = await filterCatalog({ rarity, series: seriesName });
      const expected = expectedOwned(u, { rarity, series: seriesName });
      // Pas de limite quand les compteurs du profil suffisent (rien ou tout possédé).
      if (cards.length > SCAN_MAX && expected !== 0 && expected !== cards.length) {
        return message(`❌ Trop de cartes à vérifier (${fmt(cards.length)}). Choisis une œuvre, ou une rareté plus rare.`);
      }
      const owned = await ownedCards(u, cards, expected);
      const list = missing(cards, owned);
      const filter = [rarity && `${RARITIES[rarity].emoji} ${RARITIES[rarity].label}`, seriesName].filter(Boolean).join(' · ');
      return cardPages(list, 20, () => make(`🧩 Manquantes — ${filter}`), {
        line,
        header:
          `${bar(owned.size, cards.length, 16)} **${fmt(owned.size)}** / ${fmt(cards.length)} (${pct(owned.size, cards.length)})` +
          `\n**${fmt(list.length)}** carte(s) manquante(s)`,
        empty: perso ? `Aucune carte manquante correspondant à « ${perso} ».` : '🎉 Rien ne manque : c’est complet !',
      });
    }

    // Sans filtre : les œuvres favorites.
    if (!favoris.length) {
      return message(
        favOwner === interaction.user.id
          ? '❌ Tu n’as aucune œuvre en favoris : ajoute-en avec `/favoris ajouter`, ou choisis une œuvre ci-dessous.'
          : `❌ <@${favOwner}> n’a aucune œuvre en favoris : choisis une œuvre ci-dessous.`,
      );
    }
    const progress = await seriesProgress(u, favoris);
    const overview = make('🧩 Manquantes — œuvres favorites').setDescription(
      progress
        .map((p) =>
          p.gone
            ? `✨ **${p.name}** — *série personnalisée (pas encore sur Kyara)*`
            : `${bar(p.owned.size, p.cards.length, 10)} **${p.name}** : ${p.owned.size}/${p.cards.length}` +
              (p.owned.size >= p.cards.length ? ' ✅' : ` — ${p.cards.length - p.owned.size} manquante(s)`),
        )
        .join('\n')
        .slice(0, 4096) + '\n\n-# Tourne les pages pour voir le détail de chaque œuvre.',
    );
    const pages = [overview];
    for (const p of progress) {
      if (p.gone || p.owned.size >= p.cards.length) continue;
      pages.push(
        ...cardPages(missing(p.cards, p.owned), 20, () => make(`🧩 ${p.name}`), {
          line,
          header: `${bar(p.owned.size, p.cards.length, 16)} **${p.owned.size}** / ${p.cards.length} (${pct(p.owned.size, p.cards.length)})`,
        }),
      );
    }
    return pages;
  };

  return sendView(interaction, {
    // Si le joueur a ouvert un booster, vendu ou acheté entre-temps, la réponse se met à jour au prochain clic.
    stale: async () => profileFingerprint(await getProfile(target.id, { fresh: true })) !== profileFingerprint(u),
    values: { rarete: interaction.options.getString('rarete'), oeuvre: series?.name ?? null },
    // Recalculé à chaque affichage : l'œuvre choisie (même via la recherche) apparaît toujours dans le menu.
    controls: async (values) => [
      rarityControl,
      await seriesControl(values.oeuvre, favoris, { allLabel: 'Mes œuvres favorites' }),
      characterControl,
    ],
    build,
  });
}
