import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { deleteUserData, RETENTION_DAYS, userData } from '../donnees.js';
import { baseEmbed } from '../pages.js';

const PRIVACY_URL = 'https://github.com/A-Finch13/Kyara-BOT/blob/main/PRIVACY.md';

export const data = new SlashCommandBuilder()
  .setName('donnees')
  .setDescription('Tes données enregistrées par le bot : les voir ou les supprimer')
  .addSubcommand((s) => s.setName('voir').setDescription('Affiche ce que le bot a enregistré sur ton compte Discord'))
  .addSubcommand((s) => s.setName('supprimer').setDescription('Supprime tout ce que le bot a enregistré sur ton compte Discord'));

const when = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

async function voir(interaction) {
  const { account, favoris, lastActive } = await userData(interaction.user.id);
  const lines = [];
  if (account?.kyaraId) lines.push(`🔗 **Compte Kyara relié** : ${account.pseudo} (\`${account.kyaraId}\`), noté ${when(account.at)}`);
  else if (account?.optOut) lines.push(`🔒 **Suppression demandée** ${when(account.at)} : ton compte n’est plus relié automatiquement.`);
  else if (account?.none) lines.push(`🔍 **Aucun compte Kyara trouvé** (recherche ${when(account.at)})`);
  if (favoris.length) lines.push(`⭐ **Œuvres favorites** : ${favoris.join(', ')}`);
  if (lastActive) lines.push(`🕒 **Dernière commande** : ${when(lastActive)}`);
  const embed = baseEmbed()
    .setTitle('🗂️ Tes données')
    .setDescription(
      (lines.length ? lines.join('\n') : 'Le bot n’a rien enregistré sur ton compte Discord.') +
        `\n\n-# Ces données sont chiffrées et effacées après ${RETENTION_DAYS} jours sans activité. ` +
        `Supprime-les quand tu veux avec \`/donnees supprimer\`. [Politique de confidentialité](${PRIVACY_URL})`,
    );
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function supprimer(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('donnees:oui').setLabel('Tout supprimer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('donnees:non').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );
  const reply = await interaction.reply({
    content:
      '⚠️ Supprimer **tout** ce que le bot a enregistré sur ton compte Discord : le lien avec ton compte Kyara, tes favoris, ' +
      'ta date d’activité et ce qu’il avait noté de ta collection et de tes ventes Kyara.\n' +
      '-# Ton compte ne sera plus reconnu automatiquement (par exemple dans `/classement`). Tu pourras le relier à nouveau ' +
      'en utilisant `/profil` sur toi-même.',
    components: [row],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });
  const click = await reply.resource.message
    .awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 60_000 })
    .catch(() => null);
  if (!click || click.customId === 'donnees:non') {
    return interaction.editReply({ content: 'Suppression annulée : rien n’a été effacé.', components: [] });
  }
  await deleteUserData(interaction.user.id);
  return click.update({ content: '🗑️ Tes données ont été supprimées.', components: [] });
}

export async function execute(interaction) {
  return interaction.options.getSubcommand() === 'voir' ? voir(interaction) : supprimer(interaction);
}
