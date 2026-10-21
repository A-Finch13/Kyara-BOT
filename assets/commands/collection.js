import { SlashCommandBuilder } from 'discord.js';
import { seriesChoices } from '../autocomplete.js';
import { getProfile, isVisible, privateMessage, playerChoices, profileFingerprint, resolveTarget, targetOptions } from '../comptes.js';
import { cardEmbed } from '../fiche.js';
import { byRarityThenRank, filterCatalog, profileUrl, RARITIES, RARITY_CHOICES, RARITY_ORDER, resolveSeries } from '../kyara.js';
import { baseEmbed, characterControl, matchesCharacter, rarityControl, sendView } from '../pages.js';
import { expectedOwned, nthOwned, ownedCards, ownedSeries } from '../scan.js';

export const data = targetOptions(
  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('Parcours la collection d’un joueur carte par carte, de la plus rare à la moins rare')
    .addStringOption((o) => o.setName('rarete').setDescription('Seulement cette rareté').addChoices(...RARITY_CHOICES))
    .addStringOption((o) => o.setName('oeuvre').setDescription('Seulement cette œuvre').setAutocomplete(true)),
);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'oeuvre') return seriesChoices(focused.value);
  return playerChoices(focused.value, interaction);
}

// Menu « Œuvre » : toutes les œuvres dont le joueur possède au moins une carte (ses 8 plus avancées
// d'abord, puis les autres par ordre alphabétique). La liste se complète pendant l'analyse de la collection.
async function ownedSeriesControl(u, current) {
  const { names, done, progress } = await ownedSeries(u);
  const top = (u.series ?? []).map((s) => s.name);
  const rest = names.filter((n) => !top.includes(n)).sort((a, b) => a.localeCompare(b, 'fr'));
  const list = [...top, ...rest];
  if (current && !list.some((n) => n.slice(0, 100) === current.slice(0, 100))) list.unshift(current);
  return {
    name: 'oeuvre',
    placeholder: 'Œuvre',
    searchable: true, // bouton 🔎 : recherche par titre parmi les œuvres possédées
    searchLabel: 'Rechercher une œuvre',
    options: [
      {
        label: 'Toutes les œuvres',
        value: null,
        emoji: '📚',
        description: done
          ? `${names.length} œuvres possédées`
          : `Analyse de la collection : ${Math.floor(progress * 100)} % · ${names.length} œuvres trouvées`,
      },
      ...list.map((n) => ({ label: n, value: n.slice(0, 100), emoji: top.includes(n) ? '⭐' : '📖' })),
    ],
  };
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

  const author = { name: `Collection de ${u.pseudo}`, iconURL: u.avatar ?? undefined, url: profileUrl(u.id) };
  const message = (text) => [baseEmbed().setAuthor(author).setDescription(text)];

  const build = async ({ rarete: rarity, oeuvre, perso }) => {
    u = await getProfile(target.id, { fresh: true }); // données à jour à chaque reconstruction (la collection change vite)
    // Les menus tronquent les noms à 100 caractères, et un favori peut être une série personnalisée.
    if (oeuvre) {
      const found = await resolveSeries(oeuvre);
      if (!found) return message(`✨ **${oeuvre}** n’est pas encore sur Kyara (série personnalisée).`);
      oeuvre = found.name;
    }
    const label = [rarity && RARITIES[rarity].label, oeuvre, perso && `« ${perso} »`].filter(Boolean).join(' · ');
    const empty = () => message(`📭 **${u.pseudo}** n’a aucune carte${label ? ` pour ce filtre (${label})` : ''}.`);

    // Avec une œuvre ou un personnage cherché : peu de cartes, on vérifie tout d'un coup.
    if (oeuvre || perso) {
      const cards = (await filterCatalog({ rarity, series: oeuvre ?? undefined })).filter((c) => matchesCharacter(c, perso));
      if (cards.length > 1500) return message(`🔎 Trop de personnages correspondent à « ${perso} » : précise le nom.`);
      const owned = await ownedCards(u, cards, perso ? null : expectedOwned(u, { rarity, series: oeuvre }));
      const list = cards.filter((c) => owned.has(c.id)).sort(byRarityThenRank);
      if (!list.length) return empty();
      return { count: list.length, get: (i) => cardEmbed(list[i], { author }) };
    }

    // Sinon, rareté par rareté (Mythique d'abord). Les compteurs du profil donnent le nombre de cartes
    // de chaque rareté ; chaque page ne vérifie que les cartes nécessaires pour la trouver.
    const buckets = [];
    let total = 0;
    for (const r of [...RARITY_ORDER].reverse()) {
      if (rarity && r !== rarity) continue;
      const count = u.byRarity?.[r] ?? 0;
      if (count) buckets.push({ rarity: r, start: total, count });
      total += count;
    }
    if (!total) return empty();
    return {
      count: total,
      get: async (i) => {
        const b = buckets.findLast((x) => x.start <= i);
        const card = await nthOwned(u, await filterCatalog({ rarity: b.rarity }), b.count, i - b.start);
        if (!card) return message('⚠️ La collection a changé entre-temps : relance la commande.')[0];
        return cardEmbed(card, { author });
      },
    };
  };

  return sendView(interaction, {
    // Si le joueur a ouvert un booster, vendu ou acheté entre-temps, la réponse se met à jour au prochain clic.
    stale: async () => profileFingerprint(await getProfile(target.id, { fresh: true })) !== profileFingerprint(u),
    values: { rarete: interaction.options.getString('rarete'), oeuvre: series?.name ?? null },
    controls: async (values) => [rarityControl, await ownedSeriesControl(u, values.oeuvre), characterControl], // recalculé à chaque affichage
    build,
  });
}
