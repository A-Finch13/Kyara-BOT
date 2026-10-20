import { SlashCommandBuilder } from 'discord.js';
import { characterChoices, seriesChoices } from '../autocomplete.js';
import { findAccount, getProfile, isVisible, playerChoices, profileFingerprint, resolveTarget, targetOptions } from '../comptes.js';
import {
  byRarityThenRank,
  cardLine,
  filterCatalog,
  fmt,
  kyara,
  profileUrl,
  RARITIES,
  RARITY_CHOICES,
  resolveCharacter,
  resolveSeries,
  SITE,
  wikiUrl,
} from '../kyara.js';
import { getFavoris } from '../favoris.js';
import { cardEmbed } from '../fiche.js';
import { ficheImage } from '../ficheImage.js';
import {
  baseEmbed,
  cardPages,
  characterControl,
  matchesCharacter,
  rarityControl,
  sendPages,
  sendView,
  seriesControl,
  withGrid,
} from '../pages.js';

const rarityOption = (o) => o.setName('rarete').setDescription('Filtrer par rareté').addChoices(...RARITY_CHOICES);

const SORTERS = {
  rarete: byRarityThenRank,
  popularite: (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9),
  puissance: (a, b) => b.pow - a.pow || b.aura - a.aura,
  nom: (a, b) => a.name.localeCompare(b.name, 'fr'),
};
const sortControl = {
  name: 'tri',
  placeholder: 'Tri',
  options: [
    { label: 'Tri : rareté', value: null, emoji: '💎' },
    { label: 'Tri : popularité', value: 'popularite', emoji: '❤️' },
    { label: 'Tri : puissance', value: 'puissance', emoji: '⚔️' },
    { label: 'Tri : nom', value: 'nom', emoji: '🔤' },
  ],
};

export const data = new SlashCommandBuilder()
  .setName('persos')
  .setDescription('Les personnages de Kyara : fiches, catalogue, œuvres, envies et doublons des joueurs')
  .addSubcommand((s) =>
    s
      .setName('fiche')
      .setDescription('Fiche détaillée d’un personnage')
      .addStringOption((o) => o.setName('nom').setDescription('Nom du personnage').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('liste')
      .setDescription('Parcourir les personnages de Kyara carte par carte, du plus rare au moins rare')
      .addStringOption(rarityOption)
      .addStringOption((o) => o.setName('oeuvre').setDescription('Filtrer par œuvre').setAutocomplete(true))
      .addStringOption((o) =>
        o
          .setName('tri')
          .setDescription('Ordre d’affichage (rareté par défaut)')
          .addChoices(
            { name: 'Rareté', value: 'rarete' },
            { name: 'Popularité', value: 'popularite' },
            { name: 'Puissance', value: 'puissance' },
            { name: 'Nom', value: 'nom' },
          ),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('oeuvre')
      .setDescription('Parcourir les personnages d’une œuvre carte par carte, du plus rare au moins rare')
      .addStringOption((o) => o.setName('oeuvre').setDescription('L’œuvre').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    targetOptions(s.setName('envies').setDescription('Les cartes recherchées par un joueur (sa wishlist)')).addStringOption(
      rarityOption,
    ),
  )
  .addSubcommand((s) =>
    targetOptions(s.setName('doublons').setDescription('Les cartes en double d’un joueur (à échanger)')).addStringOption(
      rarityOption,
    ),
  )
  .addSubcommand((s) => s.setName('nouveautes').setDescription('Les derniers personnages ajoutés au catalogue'));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'nom') return characterChoices(focused.value);
  if (focused.name === 'oeuvre') return seriesChoices(focused.value);
  return playerChoices(focused.value, interaction);
}

export async function execute(interaction) {
  await interaction.deferReply();
  const sub = interaction.options.getSubcommand();
  return handlers[sub](interaction);
}

const handlers = {
  async fiche(interaction) {
    const input = interaction.options.getString('nom');
    const c = await resolveCharacter(input);
    if (!c) return interaction.editReply(`❌ Aucun personnage trouvé pour « ${input} ».`);
    // Données en direct : prix, chances par booster, et possession par l'auteur de la commande.
    const [d, packs, acc] = await Promise.all([
      kyara.character(c.id, { fresh: true }),
      kyara.packs(),
      findAccount(interaction.user, interaction.member, { deep: true }).catch(() => null), // recherche approfondie par ID Discord si besoin
    ]);
    // Possession : la carte elle-même (si le compte Kyara de l'auteur est connu), sinon le nombre de possesseurs
    // via n'importe quel joueur connu (la réponse du site donne toujours ce total).
    const own = await kyara.userCard(acc?.kyaraId ?? '00000000-0000-0000-0000-000000000000', d.id).catch(() => null);

    // Meilleur booster qu'on peut ouvrir soi-même (les boosters seulement offerts, comme le Sceau mythique, sont exclus).
    const openable = new Map(packs.filter((pk) => !pk.grantOnly).map((pk) => [pk.id, pk]));
    const [bestId, bestChance] =
      Object.entries(d.dropChance ?? {})
        .filter(([id, v]) => v > 0 && openable.has(id))
        .sort((a, b) => b[1] - a[1])[0] ?? [];
    const pk = bestId ? openable.get(bestId) : null;
    const priceLabel = !pk
      ? ''
      : pk.usesFreePacks
        ? `Gratuit avec tes boosters offerts, ou ${fmt(pk.chakraPrice)} ◆`
        : pk.limit?.perDay
          ? `Gratuit, ${pk.limit.perDay} par jour`
          : `${fmt(pk.chakraPrice || pk.price)} ◆ le booster`;
    const best = pk ? { name: pk.name, chance: Math.round(1 / bestChance), priceLabel } : null;

    // Fiche en image, envoyée seule (hors embed) pour être affichée en grand.
    const page = {
      embed: baseEmbed().setTitle(`${d.name} · fiche Kyara`).setURL(wikiUrl(d.id)),
      bare: true,
      image: () =>
        ficheImage({
          c: d,
          owned: acc && own ? own.owned : undefined, // undefined : compte Kyara de l'auteur inconnu
          owners: own?.owners ?? 0,
          best,
        }),
    };
    return sendPages(interaction, [page]);
  },

  async liste(interaction) {
    const seriesInput = interaction.options.getString('oeuvre');
    const series = seriesInput ? await resolveSeries(seriesInput) : null;
    if (seriesInput && !series) return interaction.editReply(`❌ Aucune œuvre trouvée pour « ${seriesInput} ».`);

    const favoris = await getFavoris(interaction.user.id);
    const build = async ({ rarete: rarity, oeuvre, tri, perso }) => {
      const seriesName = oeuvre ? (await resolveSeries(oeuvre))?.name : null; // noms tronqués à 100 caractères dans les menus
      if (oeuvre && !seriesName) return [baseEmbed().setDescription(`✨ **${oeuvre}** n’est pas encore sur Kyara.`)];
      const cards = (await filterCatalog({ rarity, series: seriesName }))
        .filter((c) => matchesCharacter(c, perso))
        .sort(SORTERS[tri ?? 'rarete']);
      if (!cards.length) return [baseEmbed().setDescription('❌ Aucun personnage ne correspond.')];
      return { count: cards.length, get: (i) => cardEmbed(cards[i]) };
    };
    return sendView(interaction, {
      values: { rarete: interaction.options.getString('rarete'), oeuvre: series?.name ?? null, tri: interaction.options.getString('tri') === 'rarete' ? null : interaction.options.getString('tri') },
      // Recalculé à chaque affichage : l'œuvre choisie (même via la recherche) apparaît toujours dans le menu.
      controls: async (values) => [rarityControl, await seriesControl(values.oeuvre, favoris), sortControl, characterControl],
      build,
    });
  },

  async oeuvre(interaction) {
    const input = interaction.options.getString('oeuvre');
    const series = await resolveSeries(input);
    if (!series) return interaction.editReply(`❌ Aucune œuvre trouvée pour « ${input} ».`);
    const build = ({ rarete: rarity, perso }) => {
      const cards = series.cards
        .filter((c) => (!rarity || c.rarity === rarity) && matchesCharacter(c, perso))
        .sort(byRarityThenRank);
      if (!cards.length) {
        const filtre = [rarity && RARITIES[rarity].label.toLowerCase(), perso && `correspondant à « ${perso} »`].filter(Boolean).join(' ');
        return [baseEmbed().setDescription(`❌ Aucun personnage ${filtre} dans **${series.name}**.`)];
      }
      return { count: cards.length, get: (i) => cardEmbed(cards[i]) };
    };
    return sendView(interaction, { values: { rarete: null }, controls: [rarityControl, characterControl], build });
  },

  envies: (interaction) => playerList(interaction, 'wishlist'),
  doublons: (interaction) => playerList(interaction, 'doubles'),

  async nouveautes(interaction) {
    const n = await kyara.catalogNews();
    const embed = baseEmbed()
      .setTitle('🆕 Dernière mise à jour du catalogue')
      .setURL(`${SITE}/nouveautes`)
      .setDescription(
        `**${fmt(n.before)}** → **${fmt(n.after)}** personnages · ${fmt(n.addedCount)} ajoutés, ${fmt(n.removed)} retirés` +
          (n.heritage ? ` (dont ${fmt(n.heritage)} conservés en héritage)` : ''),
      )
      .setFooter({ text: 'kyara.games' });
    if (n.series?.length) {
      embed.addFields({
        name: '📖 Œuvres enrichies',
        value: n.series.map((s) => `**${s.name}** : ${s.before} → ${s.after} (+${s.after - s.before})`).join('\n').slice(0, 1024),
      });
    }
    const samples = (n.samples ?? []).slice(0, 10);
    if (samples.length) {
      embed.addFields({ name: '✨ Quelques arrivées', value: samples.map((c) => cardLine(c)).join('\n').slice(0, 1024) });
    }
    return sendPages(interaction, [withGrid(embed, samples)]);
  },
};

// Envies ou doublons d'un joueur. Le profil public n'en montre qu'une partie (24 cartes).
async function playerList(interaction, kind) {
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);
  let u = await getProfile(target.id, { fresh: true });
  const isWish = kind === 'wishlist';
  const title = isWish ? '💖 Envies' : '♻️ Doublons';
  if (!isVisible(u, kind)) return interaction.editReply(`🔒 **${u.pseudo}** a masqué ses ${isWish ? 'envies' : 'doublons'}.`);

  const build = async ({ rarete: rarity, perso }) => {
    u = await getProfile(target.id, { fresh: true }); // données à jour à chaque reconstruction (la collection change vite)
    const total = isWish ? u.wishlistCount : u.doublesCount;
    const shownAll = (u[kind]?.length ?? 0) >= (total ?? 0);
    return cardPages(
      (u[kind] ?? []).filter((c) => (!rarity || c.rarity === rarity) && matchesCharacter(c, perso)).sort(byRarityThenRank),
      isWish ? 12 : 15, // envies : 12 par page, en grille 4 × 3
      () =>
        baseEmbed()
          .setAuthor({ name: u.pseudo, iconURL: u.avatar ?? undefined, url: profileUrl(u.id) })
          .setTitle(`${title}${rarity ? ` — ${RARITIES[rarity].emoji} ${RARITIES[rarity].label}` : ''}`)
          .setURL(profileUrl(u.id))
          .setFooter({ text: 'kyara.games' }),
      {
        line: (c) => cardLine(c, !isWish && c.spare > 1 ? ` ×${c.spare}` : ''),
        qty: (c) => (isWish ? 1 : (c.spare ?? 1)),
        cols: isWish ? 4 : 5,
        header:
          `**${fmt(total ?? 0)}** carte(s) au total` +
          (shownAll ? '' : `\n-# Kyara n’affiche publiquement que les ${u[kind]?.length ?? 0} premières : la liste complète est sur le profil.`),
        empty: perso
          ? `Aucune carte correspondant à « ${perso} » parmi celles affichées.`
          : rarity
            ? 'Aucune carte de cette rareté parmi celles affichées.'
            : 'Aucune carte.',
      },
    );
  };
  return sendView(interaction, {
    values: { rarete: interaction.options.getString('rarete') },
    controls: [rarityControl, characterControl],
    build,
    // Si le joueur a ouvert un booster, vendu ou acheté entre-temps, la réponse se met à jour au prochain clic.
    stale: async () => profileFingerprint(await getProfile(target.id, { fresh: true })) !== profileFingerprint(u),
  });
}
