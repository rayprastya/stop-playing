import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import cron from 'node-cron';
import dotenv from 'dotenv';
dotenv.config();

// fixed list for tgj, bob
let targetUserId = process.env.TARGET_USER_IDS ? JSON.parse(process.env.TARGET_USER_IDS) : [];

let userSchedules = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName('main')
    .setDescription('Set your daily auto-disconnect time')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Time in HH:MM format (24-hour)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('timeleft')
    .setDescription('See how many minutes until your next auto-disconnect')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('✅ Commands registered');
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerCommands();

  cron.schedule('45 0 * * *', async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());
    if (channel) {
      targetUserId.forEach(id => {
        channel.send(`<@${id}> ⏳ 15 minutes left until auto-disconnect at 1 AM.`);
      });
    }
  });
  cron.schedule('0 1 * * *', async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    for (const id of targetUserId) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member?.voice?.channel) {
        await member.voice.disconnect();
        console.log(`🔥 Disconnected ${member.user.tag} at 1 AM`);
      }
    }
  });

  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());

    for (const [userId, { hour, minute }] of Object.entries(userSchedules)) {
      // Warn 15 min before
      let warnHour = hour;
      let warnMinute = minute - 15;
      if (warnMinute < 0) {
        warnMinute += 60;
        warnHour = (warnHour - 1 + 24) % 24;
      }
      if (currentHour === warnHour && currentMinute === warnMinute && channel) {
        channel.send(`<@${userId}> ⏳ 15 minutes left until your auto-disconnect at ${hour}:${minute.toString().padStart(2, '0')}.`);
      }

      // Kick at exact time
      if (currentHour === hour && currentMinute === minute) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member?.voice?.channel) {
          await member.voice.disconnect();
          console.log(`🔥 Disconnected ${member.user.tag} at ${hour}:${minute}`);
        }
        delete userSchedules[userId];
      }
    }
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'main') {
    const timeStr = interaction.options.getString('time');
    const [hour, minute] = timeStr.split(':').map(Number);

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return interaction.reply('❌ Invalid time format. Please use HH:MM in 24-hour format.');
    }

    userSchedules[interaction.user.id] = { hour, minute };
    await interaction.reply(`✅ You will be disconnected daily at ${timeStr}`);
  }

  if (interaction.commandName === 'timeleft') {
    const schedule = userSchedules[interaction.user.id];
    if (!schedule) {
      return interaction.reply('❌ You have no auto-disconnect time set.');
    }

    const now = new Date();
    const target = new Date();
    target.setHours(schedule.hour, schedule.minute, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);

    const diffMinutes = Math.ceil((target - now) / 60000);
    await interaction.reply(`🕒 ${diffMinutes} minutes left until your auto-disconnect at ${schedule.hour}:${schedule.minute.toString().padStart(2, '0')}`);
  }
});

client.login(process.env.BOT_TOKEN);
