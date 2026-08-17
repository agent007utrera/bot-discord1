require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ ERROR: Falta el TOKEN o el CLIENT_ID en las variables de entorno.');
    process.exit(1);
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

let db;

async function setupDatabase() {
    db = await open({
        filename: './inventario.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS inventario (
            user_id TEXT,
            item TEXT
        );
        CREATE TABLE IF NOT EXISTS suelo (
            channel_id TEXT,
            item TEXT
        );
    `);
}

const commands = [
    new SlashCommandBuilder().setName('inventario').setDescription('Muestra tu inventario personal'),
    new SlashCommandBuilder().setName('suelo').setDescription('Muestra los objetos en esta sala'),
    new SlashCommandBuilder()
        .setName('tirar')
        .setDescription('Tira un objeto al suelo de la sala')
        .addStringOption(opt => opt.setName('item').setDescription('Nombre del objeto').setRequired(true)),
    new SlashCommandBuilder()
        .setName('generar_item')
        .setDescription('Añade un objeto al suelo de esta sala')
        .addStringOption(opt => opt.setName('item').setDescription('Nombre del objeto').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    try {
        await setupDatabase();
        console.log('📦 Base de datos conectada.');

        const rest = new REST({ version: '10' }).setToken(TOKEN);
        console.log('🔄 Registrando comandos Slash...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log(`✅ Bot conectado correctamente como: ${client.user.tag}`);
    } catch (error) {
        console.error('❌ Error durante la inicialización:', error);
    }
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName, user, channelId, options } = interaction;

            if (commandName === 'inventario') {
                const items = await db.all('SELECT item FROM inventario WHERE user_id = ?', [user.id]);
                if (items.length === 0) {
                    return interaction.reply({ content: '🎒 Tu inventario está vacío.', ephemeral: true });
                }
                const lista = items.map((i, index) => `${index + 1}. ${i.item}`).join('\n');
                return interaction.reply({ content: `**🎒 Tu Inventario:**\n${lista}`, ephemeral: true });
            }

            if (commandName === 'suelo') {
                const items = await db.all('SELECT rowid, item FROM suelo WHERE channel_id = ?', [channelId]);
                if (items.length === 0) {
                    return interaction.reply({ content: '🔍 No hay nada en el suelo de esta sala.', ephemeral: false });
                }

                const row = new ActionRowBuilder();
                items.forEach(i => {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`recoger_${i.rowid}_${i.item}`)
                            .setLabel(`Recoger ${i.item}`)
                            .setStyle(ButtonStyle.Success)
                    );
                });

                return interaction.reply({ content: '**🔍 Objetos en el suelo:**', components: [row] });
            }

            if (commandName === 'tirar') {
                const item = options.getString('item');
                const existe = await db.get('SELECT rowid FROM inventario WHERE user_id = ? AND item = ?', [user.id, item]);

                if (!existe) {
                    return interaction.reply({ content: `No tienes "${item}" en tu inventario.`, ephemeral: true });
                }

                await db.run('DELETE FROM inventario WHERE rowid = ?', [existe.rowid]);
                await db.run('INSERT INTO suelo (channel_id, item) VALUES (?, ?)', [channelId, item]);

                return interaction.reply({ content: `📦 Has soltado **${item}** en el suelo.` });
            }

            if (commandName === 'generar_item') {
                const item = options.getString('item');
                await db.run('INSERT INTO suelo (channel_id, item) VALUES (?, ?)', [channelId, item]);
                return interaction.reply({ content: `✨ Se ha colocado **${item}** en esta sala.` });
            }
        }

        if (interaction.isButton()) {
            const [accion, rowid, item] = interaction.customId.split('_');

            if (accion === 'recoger') {
                const existe = await db.get('SELECT item FROM suelo WHERE rowid = ?', [rowid]);
                if (!existe) {
                    return interaction.reply({ content: '⚠️ Ese objeto ya no está aquí.', ephemeral: true });
                }

                await db.run('DELETE FROM suelo WHERE rowid = ?', [rowid]);
                await db.run('INSERT INTO inventario (user_id, item) VALUES (?, ?)', [interaction.user.id, item]);

                return interaction.reply({ content: `✋ ¡Has recogido **${item}**! Se ha añadido a tu inventario.` });
            }
        }
    } catch (err) {
        console.error('Error procesando interacción:', err);
    }
});

client.login(TOKEN).catch(err => {
    console.error('❌ Error de conexión:', err.message);
});