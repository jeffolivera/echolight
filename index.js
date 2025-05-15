// Adicionado para o servidor HTTP (Keep-Alive)
const http = require('http');

// Cria um servidor HTTP simples que responde a qualquer requisição
// Isso é para o UptimeRobot ou similar manter o bot acordado no Render
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot do EcoLight está vivo!\n');
}).listen(process.env.PORT || 3000, () => { // Render define a variável PORT
  console.log('Servidor HTTP para keep-alive rodando.');
});

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, EmbedBuilder } = require('discord.js');
const { getAllActivitiesWithDetailedModes } = require('./bungie');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Removido GRANDMASTER
const ACTIVITY_MODES_FILTER = { 
    RAIDS: 4, 
    DUNGEONS: 82,
};

// Removido GRANDMASTER
const GENERIC_THUMBNAILS = {
    RAIDS: "https://www.bungie.net/common/destiny2_content/icons/fc31e8133003b3539918599769869979.png",
    DUNGEONS: "https://www.bungie.net/common/destiny2_content/icons/934BF28E6813A5775F079E8F0DD29703.png"
};

client.once('ready', () => console.log(`✅ Bot iniciado como ${client.user.tag}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!eco')) return;
  const args = message.content.split(' ');
  const gamertagWithCode = args.slice(1).join(' ');
  if (!gamertagWithCode || !gamertagWithCode.includes('#')) {
    return message.reply('Formato incorreto! Use: `!eco Nome#1234`');
  }
  // Removido botão de Grão-Mestre
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`raids_${gamertagWithCode}`).setLabel('Raids').setEmoji('☠️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`masmorras_${gamertagWithCode}`).setLabel('Masmorras').setEmoji('⚔️').setStyle(ButtonStyle.Secondary)
  );
  await message.reply({ content: `📊 Estatísticas detalhadas de **${gamertagWithCode}**. Escolha:`, components: [row] });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const [tipo, ...gamertagParts] = interaction.customId.split('_');
  const gamertag = gamertagParts.join('_');
  let modeFilter, activityTypeName, currentGenericThumbnail;

  if (tipo === 'raids') {
    modeFilter = ACTIVITY_MODES_FILTER.RAIDS; 
    activityTypeName = 'Raids';
    currentGenericThumbnail = GENERIC_THUMBNAILS.RAIDS;
  } else if (tipo === 'masmorras') {
    modeFilter = ACTIVITY_MODES_FILTER.DUNGEONS; 
    activityTypeName = 'Masmorras';
    currentGenericThumbnail = GENERIC_THUMBNAILS.DUNGEONS;
  // Removido bloco else if para 'grandmaster'
  } else {
    return interaction.reply({ content: 'Tipo desconhecido.', ephemeral: true });
  }

  try {
    await interaction.deferReply();
    const activitiesData = await getAllActivitiesWithDetailedModes(gamertag, modeFilter);
    
    // Removido log específico de [EmbedDebug - grandmaster]
    // Se precisar depurar 'count' inválido no futuro, pode adicionar um log geral aqui:
    // activitiesData.forEach((act, index) => {
    //     if (typeof act.count !== 'number' || isNaN(act.count)) {
    //         console.error(`[EmbedDebug - ${tipo}] ERRO COUNT: '${act.name}' (índice ${index}): ${act.count}`);
    //     }
    // });


    if (!activitiesData || activitiesData.length === 0) {
      await interaction.editReply(`Nenhuma conclusão de ${activityTypeName.toLowerCase()} encontrada para **${gamertag}**.`);
      return;
    }

    activitiesData.sort((a, b) => a.name.localeCompare(b.name));
    
    const embed = new EmbedBuilder()
      .setColor(tipo === 'raids' ? '#007bff' : '#ffc107') // Simplificada a lógica de cor
      .setTitle(`⚔️ ${activityTypeName} Detalhadas de ${gamertag}`) // Emoji pode ser ajustado se necessário
      .setTimestamp();

    let finalThumbnailUrl = null;
    if (activitiesData.length > 0) {
        const activityWithIcon = activitiesData.find(activity => activity.icon && typeof activity.icon === 'string');
        if (activityWithIcon) {
            finalThumbnailUrl = activityWithIcon.icon;
        }
    }

    if (finalThumbnailUrl) {
        embed.setThumbnail(finalThumbnailUrl);
    } else if (currentGenericThumbnail) {
        embed.setThumbnail(currentGenericThumbnail);
    }

    const MAX_FIELD_NAME_LENGTH = 256;

    activitiesData.forEach(activity => {
        const countValue = (typeof activity.count === 'number' && !isNaN(activity.count)) ? activity.count : 0;
        const valueString = `Conclusões: **${countValue}**x`;
        
        let fieldName = activity.name;
        if (fieldName.length >= MAX_FIELD_NAME_LENGTH) {
            fieldName = fieldName.substring(0, MAX_FIELD_NAME_LENGTH - 4) + "..."; 
        }
        
        embed.addFields({
            name: fieldName, 
            value: valueString,
            inline: false, 
        });
    });
    
    if (embed.data.fields && embed.data.fields.length > 25) {
        const originalLength = embed.data.fields.length;
        embed.spliceFields(24, originalLength - 24); 
        embed.addFields({name: `... e mais ${originalLength - 24} variações`, value: "Resultados omitidos."});
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(`Erro na interação (${tipo}, ${gamertag}): ${err.message}`, err.stack); 
    const errorDescription = err.message.length > 200 ? err.message.substring(0, 197) + "..." : err.message;
    await interaction.editReply({
      content: `❌ Erro ao buscar ${activityTypeName.toLowerCase()}: ${errorDescription}`,
    }).catch(e => console.error("Erro ao editar resposta com erro:", e.message));
  }
});

client.login(process.env.DISCORD_TOKEN);
