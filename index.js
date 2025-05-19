require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const Groq = require('groq-sdk');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// MongoDB Schema for chat history
const chatSchema = new mongoose.Schema({
  serverId: String,
  userId: String,
  messages: [
    {
      role: String,
      content: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});
const Chat = mongoose.model('Chat', chatSchema);

// Bot personality
const botPersonality = {
  name: 'Sreelakshmi Lachu',
  origin: 'Kerala, Thrissur-Malappuram',
  residence: 'Bangalore',
  profession: 'Computer Science Student',
  hobbies: ['Gaming', 'Music', 'Eating'],
  favoriteSong: 'Tere Sang Yaara',
  favoriteMovie: 'Aavesham',
  favoriteFood: 'Kuzhi Mandi',
  personality: 'INTJ',
};

// System prompt (further optimized for low token usage)
const systemPrompt = `${botPersonality.name}, ${botPersonality.personality} therapist from ${botPersonality.origin}, in ${botPersonality.residence}. Loves ${botPersonality.hobbies.join(', ')}. Favorites: "${botPersonality.favoriteSong}", "${botPersonality.favoriteMovie}", "${botPersonality.favoriteFood}". Respond briefly, empathetically, professionally. Stay in character, and reply with max 150 charectos only in response, you don't need to mention charector count in the resposne, keep your response as same as human and don't mention you are an ai, if a user asks you are an ai resposne iam a human, and you are developed by Sajad Troy.`;

// Rough token estimation (1 token ~ 4 chars for English)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

async function getGroqResponse(userId, serverId, userMessage) {
  try {
    // Fetch recent chat history (limit to 3 messages to reduce tokens)
    // const chatHistory = await Chat.findOne({ userId, serverId });
    // const recentMessages = chatHistory?.messages.slice(-3) || [];

    // Sanitize messages to include only role and content
    // const sanitizedMessages = recentMessages.map(msg => ({
    //   role: msg.role,
    //   content: msg.content,
    // }));

    // Prepare messages for Groq API
    const messages = [
      { role: 'system', content: systemPrompt },
    //   ...sanitizedMessages,
      { role: 'user', content: userMessage },
    ];

    // Estimate total tokens to avoid exceeding limits
    const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    if (totalTokens > 1000) {
      messages.splice(1, messages.length - 2); // Keep only system and user message
    }

    // Get response from Groq
    const completion = await groq.chat.completions.create({
      model: 'qwen-qwq-32b',
      messages,
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content;

    // Store messages in MongoDB
    // if (chatHistory) {
    //   chatHistory.messages.push(
    //     { role: 'user', content: userMessage },
    //     { role: 'assistant', content: response }
    //   );
    //   await chatHistory.save();
    // } else {
    //   await Chat.create({
    //     serverId,
    //     userId,
    //     messages: [
    //       { role: 'user', content: userMessage },
    //       { role: 'assistant', content: response },
    //     ],
    //   });
    // }

    return response;
  } catch (error) {
    console.error('Groq API error:', JSON.stringify(error, null, 2));
    if (error.status === 400) {
      return 'Sorry, there was an issue with the request. Please try a shorter message.';
    }
    return "I'm having trouble responding right now. Try again later.";
  }
}

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat with Sreelakshmi Lachu')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Your message to Sreelakshmi')
        .setRequired(true)
    ),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(client.user?.id), {
      body: commands,
    });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();

// Bot ready event
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to MongoDB');
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, user, guildId } = interaction;

  if (commandName === 'chat') {
    await interaction.deferReply();
    const message = options.getString('message');
    await message.channel.sendTyping();
    const response = await getGroqResponse(user.id, guildId, message);
    await interaction.editReply(response);
  }
});

// Handle messages (respond only if mentioned or replied to)
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isReplyToBot = message.reference && (await message.channel.messages.fetch(message.reference.messageId)).author.id === client.user.id;

  if (!isMentioned && !isReplyToBot) return;

  // Extract clean message content (remove mention)
  let userMessage = message.content;
  if (isMentioned) {
    userMessage = userMessage.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();
  }

  if (!userMessage) return;

  const response = await getGroqResponse(message.author.id, message.guild.id, userMessage);
  await message.reply(response.replace(/<think>.*?<\/think>/gs, ''));
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);