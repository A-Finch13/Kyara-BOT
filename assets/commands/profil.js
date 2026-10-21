import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { detectChannel, discordIdFromAvatar, getProfile, isLocked, isVisible, privateMessage, playerChoices, resolveTarget, targetOptions } from '../comptes.js';
import { kyara, profileUrl, RARITY_ORDER } from '../kyara.js';
import { baseEmbed, sendPages } from '../pages.js';
import { profileImage, rarityImage } from '../profilImage.js';

export const data = targetOptions(
  new SlashCommandBuilder().setName('profil').setDescription('Affiche le profil Kyara d’un joueur (toi par défaut)'),
);

export const autocomplete = (interaction) => playerChoices(interaction.options.getFocused(), interaction);

export async function execute(interaction) {
  await interaction.deferReply();
  // En arrière-plan : repère les comptes Kyara des membres qui ont accès au salon
  // (pour l'autocomplétion de « pseudo » et l'option « membre »).
  if (interaction.inGuild() && interaction.channel) detectChannel(interaction.channel).catch(() => {});

  // Sans option et compte encore inconnu : recherche du compte Kyara relié à l'ID Discord de l'utilisateur.
  // Compte Discord encore inconnu (le tien, un membre ou un ID Discord) : recherche à partir de l'ID Discord.
  const target = await resolveTarget(interaction, {
    onSearch: (user, self) =>
      interaction
        .editReply(
          self
            ? '🔎 Je ne connais pas encore ton compte Kyara : je le cherche à partir de ton ID Discord…'
            : `🔎 Je ne connais pas encore le compte Kyara de ${user} : je le cherche à partir de son ID Discord…`,
        )
        .catch(() => {}),
  });
  if (target.error) return interaction.editReply(target.error);

  let u = await getProfile(target.id, { fresh: true });
  // Le nombre d'œuvres complètes n'est donné que par le classement du site.
  const ladderRow = (await kyara.ladder('collection', u.pseudo, { fresh: true }).catch(() => null))?.found?.find((p) => p.id === u.id);
  // Profil verrouillé : le site renvoie des zéros aux visiteurs, mais le classement public garde
  // le nombre de cartes, de Mythiques et les points. On affiche ces valeurs-là, le reste est marqué privé.
  const locked = isLocked(u);
  if (locked && ladderRow) {
    u = { ...u, owned: ladderRow.owned, mythics: ladderRow.mythics, rank: u.rank && { ...u.rank, points: ladderRow.points ?? u.rank.points } };
  }

  const make = (title) =>
    baseEmbed()
      .setAuthor({ name: u.pseudo, iconURL: u.avatar ?? undefined, url: profileUrl(u.id) })
      .setTitle(title)
      .setURL(profileUrl(u.id))
      .setFooter({ text: 'kyara.games' });

  // Page 1 : le profil en image (en-tête, stats et vitrine).
  const page1 = {
    embed: make(`Profil de ${u.pseudo}`),
    bare: true, // image seule, affichée en grand
    caption: locked ? '-# 🔒 Profil privé : seules les données publiques du classement Kyara sont affichées.' : null,
    image: () =>
      profileImage({
        u,
        completedSeries: ladderRow?.series ?? null,
        isSelf: (target.discordId ?? discordIdFromAvatar(u.avatar)) === interaction.user.id,
        showcase: isVisible(u, 'showcase') ? (u.best ?? []) : [],
        hidden: {
          // Profil verrouillé : le nombre de cartes reste public via le classement.
          collection: locked ? !ladderRow : !isVisible(u, 'collection'),
          doubles: !isVisible(u, 'doubles'),
          boosters: !isVisible(u, 'stats'),
          private: locked,
        },
      }),
  };

  // Page 2 : la collection par rareté, en image aussi.
  let page2 = make('Collection par rareté').setDescription(privateMessage(u, 'le détail de sa collection'));
  if (isVisible(u, 'collection')) {
    const totals = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0]));
    for (const c of await kyara.catalog()) totals[c.rarity]++;
    page2 = { embed: make('Collection par rareté'), bare: true, image: () => rarityImage({ u, totals }) };
  }

  await sendPages(interaction, [page1, page2]);
  if (target.found) {
    await interaction
      .followUp({
        content:
          (target.discordId === interaction.user.id ? '✅ Compte Kyara trouvé et enregistré' : `✅ Compte Kyara de <@${target.discordId}> trouvé et enregistré`) +
          ` : **${u.pseudo}**. Les prochaines commandes le reconnaîtront directement.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}
