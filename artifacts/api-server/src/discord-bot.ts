import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "./lib/logger";

type Participant = {
  id: string;
  name: string;
  joinedAt: string;
};

type Championship = {
  name: string;
  slots: number;
  participants: Participant[];
  createdAt: string;
};

const dataDir = path.resolve(process.cwd(), "data");
const dataFile = path.join(dataDir, "championship.json");
const buttonId = "championship:register";
const defaultSlots = Number(process.env.CHAMPIONSHIP_SLOTS ?? 16);

async function loadChampionship(): Promise<Championship | null> {
  try {
    const content = await readFile(dataFile, "utf8");
    return JSON.parse(content) as Championship;
  } catch {
    return null;
  }
}

async function saveChampionship(championship: Championship): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(championship, null, 2), "utf8");
}

function registrationButton(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buttonId)
      .setLabel(disabled ? "Vagas esgotadas" : "Inscrever-se")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

function championshipText(championship: Championship): string {
  const remaining = Math.max(championship.slots - championship.participants.length, 0);
  const names = championship.participants.length
    ? championship.participants
        .map((participant, index) => `${index + 1}. ${participant.name}`)
        .join("\n")
    : "Nenhum participante ainda.";

  return [
    `# ${championship.name}`,
    "",
    `**Participantes:** ${championship.participants.length}/${championship.slots}`,
    `**Vagas restantes:** ${remaining}`,
    "",
    "**Lista de participantes**",
    names,
  ].join("\n");
}

async function handleCreateCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("nome", true);
  const slots = interaction.options.getInteger("vagas", true);
  const championship: Championship = {
    name,
    slots,
    participants: [],
    createdAt: new Date().toISOString(),
  };

  await saveChampionship(championship);
  await interaction.reply({
    content: championshipText(championship),
    components: [registrationButton()],
  });
}

async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const championship = await loadChampionship();
  if (!championship) {
    await interaction.reply({
      content: "Ainda não existe um campeonato. Use `/criar-campeonato` primeiro.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: championshipText(championship),
    components: [registrationButton(championship.participants.length >= championship.slots)],
  });
}

async function handleRegistration(interaction: ButtonInteraction): Promise<void> {
  const championship = await loadChampionship();
  if (!championship) {
    await interaction.reply({
      content: "Ainda não existe um campeonato aberto.",
      ephemeral: true,
    });
    return;
  }

  if (championship.participants.some((participant) => participant.id === interaction.user.id)) {
    await interaction.reply({
      content: "Você já está inscrito neste campeonato.",
      ephemeral: true,
    });
    return;
  }

  if (championship.participants.length >= championship.slots) {
    await interaction.reply({
      content: "As vagas já acabaram.",
      ephemeral: true,
    });
    return;
  }

  championship.participants.push({
    id: interaction.user.id,
    name: interaction.member && "displayName" in interaction.member
      ? interaction.member.displayName
      : interaction.user.globalName ?? interaction.user.username,
    joinedAt: new Date().toISOString(),
  });
  await saveChampionship(championship);
  await interaction.update({
    content: championshipText(championship),
    components: [registrationButton(championship.participants.length >= championship.slots)],
  });
}

function commands() {
  return [
    new SlashCommandBuilder()
      .setName("criar-campeonato")
      .setDescription("Cria ou reinicia um campeonato")
      .addStringOption((option) =>
        option
          .setName("nome")
          .setDescription("Nome do campeonato")
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("vagas")
          .setDescription(`Quantidade de vagas (padrão sugerido: ${defaultSlots})`)
          .setMinValue(1)
          .setMaxValue(500)
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("campeonato")
      .setDescription("Mostra o campeonato e a lista atual de participantes"),
  ].map((command) => command.toJSON());
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN não configurado; bot do Discord não iniciado");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ user: readyClient.user.tag }, "Bot do Discord conectado");
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands() });
    logger.info("Comandos do campeonato publicados");
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === buttonId) {
        await handleRegistration(interaction);
      } else if (interaction.isChatInputCommand() && interaction.commandName === "criar-campeonato") {
        await handleCreateCommand(interaction);
      } else if (interaction.isChatInputCommand() && interaction.commandName === "campeonato") {
        await handleStatusCommand(interaction);
      }
    } catch (error) {
      logger.error({ err: error }, "Erro ao processar interação do Discord");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Não consegui concluir essa ação agora.", ephemeral: true });
      }
    }
  });
  client.on("error", (error) => logger.error({ err: error }, "Erro no cliente do Discord"));
  await client.login(token);
}