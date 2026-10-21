import 'dotenv/config';
import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { loadCommands } from './commands.js';
import { detectChannel, findAccount } from './comptes.js';
import { startRetention, touch } from './donnees.js';
import { kyara, KyaraError } from './kyara.js';
import { handlePageButton, handlePageModal, handlePageSelect } from './pages.js';
import { dataKey, encryptPlainStores, flushStores } from './store.js';
import { startSalesTracker } from './ventes.js';

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN manquant : copie .env.example en .env et remplis-le.');
  process.exit(1);
}
if (!dataKey()) {
  console.error(
    '❌ DATA_KEY manquante ou invalide dans .env : c’est la clé qui chiffre le dossier data/ (64 caractères hexadécimaux).\n' +
      '   Pour en créer une : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      '   Garde-la précieusement : sans elle, les données enregistrées sont illisibles.',
  );
  process.exit(1);
}
await encryptPlainStores(); // anciens fichiers de data/ encore en clair

// GuildMembers (intent privilégié) sert à lister les membres pour /classement.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.commands = await loadCommands();

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Connecté en tant que ${c.user.tag} — ${client.commands.size} commandes chargées`);
  c.user.setActivity('kyara.games', { type: ActivityType.Watching });
  try {
    console.log(`📚 Catalogue Kyara chargé : ${(await kyara.catalog()).length} personnages`);
  } catch (err) {
    console.warn('⚠️ Impossible de charger le catalogue :', err.message);
  }
  // Les comptes Kyara des membres sont recherchés salon par salon, quand une commande y est utilisée.
  startSalesTracker(c); // suivi des ventes des membres connus, toutes les 5 min
  startRetention(); // efface les données liées aux comptes Discord après 30 jours sans activité
});

client.on(Events.GuildMemberAdd, (member) => {
  if (!member.user.bot) findAccount(member.user, member).catch(() => {});
});

function errorMessage(err) {
  if (err instanceof KyaraError) {
    if (err.status === 404) return '❌ Introuvable sur Kyara.';
    if (err.status === 429) return '⏳ Kyara reçoit trop de requêtes, réessaie dans un instant.';
    return `⚠️ Le site Kyara a répondu une erreur (${err.message}).`;
  }
  if (err?.name === 'TimeoutError') return '⏳ Le site Kyara met trop de temps à répondre.';
  return '⚠️ Une erreur est survenue.';
}

client.on(Events.InteractionCreate, async (interaction) => {
  // Boutons ◀ ▶ et menus d'options des réponses paginées.
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('page:')) {
    try {
      if (interaction.isButton()) await handlePageButton(interaction);
      else if (interaction.isStringSelectMenu()) await handlePageSelect(interaction);
      else await handlePageModal(interaction); // fenêtre « Rechercher »
    } catch (err) {
      console.error('[pages]', err);
      const content = errorMessage(err);
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  if (interaction.isAutocomplete()) {
    try {
      const choices = command.autocomplete ? await command.autocomplete(interaction) : [];
      await interaction.respond(choices.slice(0, 25));
    } catch (err) {
      console.error(`[autocomplétion /${interaction.commandName}]`, err.message);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  touch(interaction.user.id).catch(() => {}); // date de dernière activité (durée de conservation)
  // En arrière-plan : repère les comptes Kyara des membres du salon, pour que /classement soit prêt.
  if (interaction.inGuild() && interaction.channel) detectChannel(interaction.channel).catch(() => {});
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[/${interaction.commandName}]`, err);
    const content = errorMessage(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

// Arrêt propre (redémarrage du serveur, mise à jour, systemctl restart…) : on termine les écritures
// en cours dans data/ avant de quitter, pour ne rien perdre.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`🛑 Arrêt demandé (${signal}), sauvegarde des données…`);
  setTimeout(() => process.exit(1), 10_000).unref(); // filet de sécurité
  await flushStores().catch(() => {});
  await client.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Une erreur imprévue ne doit pas faire tomber le bot : on la note dans les journaux.
process.on('unhandledRejection', (err) => console.error('⚠️ Erreur non gérée :', err));

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  if (/disallowed intents/i.test(err.message)) {
    console.error(
      '❌ Active « Server Members Intent » : portail développeur Discord > ton application > Bot > Privileged Gateway Intents.',
    );
  } else {
    console.error('❌ Connexion à Discord impossible :', err.message);
  }
  process.exit(1);
});
