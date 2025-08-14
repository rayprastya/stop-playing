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
    .setDescription('Set daily auto-disconnect time in your local timezone')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Time in HH:MM format (24-hour) in your local timezone')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('current_time')
        .setDescription('What time is it for you RIGHT NOW? (HH:MM format for timezone sync)')
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

  // Indonesian time: 1 AM = UTC 6 PM (18:00)
  cron.schedule('45 17 * * *', async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());
    if (channel) {
      targetUserId.forEach(id => {
        channel.send(`<@${id}> ⏳ 15 minutes left until auto-disconnect at 1 AM Indonesian time.`);
      });
    }
  });
  cron.schedule('0 18 * * *', async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    for (const id of targetUserId) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member?.voice?.channel) {
        await member.voice.disconnect();
        console.log(`🔥 Disconnected ${member.user.tag} at 1 AM Indonesian time`);
      }
    }
  });

  cron.schedule('* * * * *', async () => {
    const utcNow = new Date();
    const utcHour = utcNow.getUTCHours();
    const utcMinute = utcNow.getUTCMinutes();
    
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());

    for (const [userId, { utcHour: scheduleHour, utcMinute: scheduleMinute, userTargetTime }] of Object.entries(userSchedules)) {
      // Warn 15 min before
      let warnHour = scheduleHour;
      let warnMinute = scheduleMinute - 15;
      if (warnMinute < 0) {
        warnMinute += 60;
        warnHour = (warnHour - 1 + 24) % 24;
      }
      
      if (utcHour === warnHour && utcMinute === warnMinute && channel) {
        channel.send(`<@${userId}> ⏳ 15 minutes left until your auto-disconnect at ${userTargetTime} (your local time).`);
      }

      // Disconnect at exact time (in UTC)
      if (utcHour === scheduleHour && utcMinute === scheduleMinute) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member?.voice?.channel) {
          await member.voice.disconnect();
          console.log(`🔥 Disconnected ${member.user.tag} at ${userTargetTime} their local time`);
        }
        delete userSchedules[userId];
      }
    }
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'main') {
    const targetTimeStr = interaction.options.getString('time');
    const currentTimeStr = interaction.options.getString('current_time');
    
    // Parse user input times
    const [targetHour, targetMinute] = targetTimeStr.split(':').map(Number);
    const [currentHour, currentMinute] = currentTimeStr.split(':').map(Number);
    
    // Validate input
    if (isNaN(targetHour) || isNaN(targetMinute) || isNaN(currentHour) || isNaN(currentMinute)) {
      return await interaction.reply('❌ Invalid time format. Please use HH:MM format.');
    }
    
    if (targetHour < 0 || targetHour > 23 || targetMinute < 0 || targetMinute > 59 ||
        currentHour < 0 || currentHour > 23 || currentMinute < 0 || currentMinute > 59) {
      return await interaction.reply('❌ Invalid time. Hours: 0-23, Minutes: 0-59');
    }
    
    // Get current UTC time
    const utcNow = new Date();
    const utcHour = utcNow.getUTCHours();
    const utcMinute = utcNow.getUTCMinutes();
    
    // Calculate timezone offset (user local time - UTC time)
    const userTotalMinutes = (currentHour * 60) + currentMinute;
    const utcTotalMinutes = (utcHour * 60) + utcMinute;
    let timezoneOffset = userTotalMinutes - utcTotalMinutes;
    
    // Handle day boundary crossings
    if (timezoneOffset > 720) timezoneOffset -= 1440; // More than 12 hours ahead
    if (timezoneOffset < -720) timezoneOffset += 1440; // More than 12 hours behind
    
    // Convert target time to UTC
    const targetTotalMinutes = (targetHour * 60) + targetMinute;
    const utcTargetMinutes = targetTotalMinutes - timezoneOffset;
    
    const utcTargetHour = Math.floor(utcTargetMinutes / 60) % 24;
    const utcTargetMin = utcTargetMinutes % 60;
    
    // Store in UTC time for consistent scheduling
    userSchedules[interaction.user.id] = { 
      utcHour: utcTargetHour < 0 ? utcTargetHour + 24 : utcTargetHour,
      utcMinute: utcTargetMin < 0 ? utcTargetMin + 60 : utcTargetMin,
      timezoneOffset: timezoneOffset,
      userTargetTime: targetTimeStr
    };
    
    await interaction.reply(`✅ You will be disconnected daily at ${targetTimeStr} (your local time)\nTimezone offset detected: UTC${timezoneOffset >= 0 ? '+' : ''}${Math.floor(timezoneOffset/60)}:${Math.abs(timezoneOffset%60).toString().padStart(2, '0')}`);
  }

  if (interaction.commandName === 'timeleft') {
    const schedule = userSchedules[interaction.user.id];
    if (!schedule) {
      return await interaction.reply('❌ You have no auto-disconnect time set.');
    }

    const utcNow = new Date();
    const utcHour = utcNow.getUTCHours();
    const utcMinute = utcNow.getUTCMinutes();
    
    // Calculate time until next disconnect (in UTC)
    let utcTarget = new Date();
    utcTarget.setUTCHours(schedule.utcHour, schedule.utcMinute, 0, 0);
    
    // If target time has passed today, set for tomorrow
    const utcTargetMinutes = (schedule.utcHour * 60) + schedule.utcMinute;
    const utcCurrentMinutes = (utcHour * 60) + utcMinute;
    
    if (utcCurrentMinutes >= utcTargetMinutes) {
      utcTarget.setUTCDate(utcTarget.getUTCDate() + 1);
    }
    
    const diffMs = utcTarget.getTime() - utcNow.getTime();
    const diffMinutes = Math.ceil(diffMs / 60000);
    
    await interaction.reply(`🕒 ${diffMinutes} minutes left until your auto-disconnect at ${schedule.userTargetTime} (your local time)`);
  }
});

client.login(process.env.BOT_TOKEN);
