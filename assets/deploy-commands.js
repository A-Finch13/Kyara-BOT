// Enregistre les commandes slash auprès de Discord. À relancer après tout ajout/modif de commande.
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadCommands } from './commands.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN et CLIENT_ID doivent être définis dans .env');
  process.exit(1);
}

const commands = [...(await loadCommands()).values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);

const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) // instantané, un seul serveur
  : Routes.applicationCommands(CLIENT_ID); // global, peut prendre jusqu'à 1 h

const result = await rest.put(route, { body: commands });
console.log(`✅ ${result.length} commandes enregistrées ${GUILD_ID ? `sur le serveur ${GUILD_ID}` : 'globalement'} :`);
console.log(result.map((c) => `  /${c.name}`).join('\n'));
