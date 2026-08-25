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
const cancelButtonId = "championship:cancel";
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

function registrationButtons(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buttonId)
      .setLabel(disabled ? "Vagas esgotadas" : "Inscrever-se")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(cancelButtonId)
      .setLabel("Cancelar inscrição")
      .setStyle(ButtonStyle.Danger),
  );
}

function championshipText(
  championship: Championship,
  showParticipants = false,
): string {
  const remaining = Math.max(championship.slots - championship.participants.length, 0);
  const names = championship.participants.length
    ? championship.participants
        .map((participant, index) => `${index + 1}. ${participant.name}`)
        .join("\n")
    : "Nenhum participante ainda.";

  const summary = [
    `# ${championship.name}`,
    "",
    `**Participantes:** ${championship.participants.length}/${championship.slots}`,
    `**Vagas restantes:** ${remaining}`,
  ];

  if (showParticipants) {
    summary.push("", "**Lista de participantes**", names);
  }

  return summary.join("\n");
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
    components: [registrationButtons()],
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
    components: [
      registrationButtons(championship.participants.length >= championship.slots),
    ],
  });
}

async function handleParticipantsCommand(
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
    content: championshipText(championship, true),
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
    components: [
      registrationButtons(championship.participants.length >= championship.slots),
    ],
  });
}

async function handleCancellation(interaction: ButtonInteraction): Promise<void> {
  const championship = await loadChampionship();
  if (!championship) {
    await interaction.reply({
      content: "Ainda não existe um campeonato aberto.",
      ephemeral: true,
    });
    return;
  }

  const participantIndex = championship.participants.findIndex(
    (participant) => participant.id === interaction.user.id,
  );
  if (participantIndex === -1) {
    await interaction.reply({
      content: "Você não está inscrito neste campeonato.",
      ephemeral: true,
    });
    return;
  }

  championship.participants.splice(participantIndex, 1);
  await saveChampionship(championship);
  await interaction.update({
    content: championshipText(championship),
    components: [
      registrationButtons(championship.participants.length >= championship.slots),
    ],
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
      .setDescription("Mostra o campeonato e as vagas, sem exibir nomes"),
    new SlashCommandBuilder()
      .setName("ver-participantes")
      .setDescription("Mostra a lista atual de participantes"),
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
      } else if (interaction.isButton() && interaction.customId === cancelButtonId) {
        await handleCancellation(interaction);
      } else if (interaction.isChatInputCommand() && interaction.commandName === "criar-campeonato") {
        await handleCreateCommand(interaction);
      } else if (interaction.isChatInputCommand() && interaction.commandName === "campeonato") {
        await handleStatusCommand(interaction);
      } else if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "ver-participantes"
      ) {
        await handleParticipantsCommand(interaction);
      }
    } catch (error) {
      logger.error({ err: error }, "Erro ao processar interação do Discord");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Não consegui concluir essa ação agora.", ephemeral: true });
      }
    }
  });
      let reconnectTimeout: NodeJS.Timeout | undefined;

  client.on("error", (error) => {
    logger.error({ err: error }, "Erro no cliente do Discord");
  });

  client.on("shardReconnecting", (shardId) => {
    logger.warn(
      { shardId },
      "Discord desconectou; tentando reconectar...",
    );
  });

  client.on("shardResume", (shardId, replayedEvents) => {
    logger.info(
      { shardId, replayedEvents },
      "Bot do Discord reconectado e sessão retomada",
    );

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = undefined;
    }
  });

  client.on("shardDisconnect", (event, shardId) => {
    logger.warn(
      { shardId, code: event.code, reason: event.reason },
      "Conexão com o Discord encerrada",
    );

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }

    reconnectTimeout = setTimeout(() => {
      if (client.ws.status !== 0) {
        logger.warn(
          "Bot ainda desconectado após 1 minuto; tentando recuperar a conexão...",
        );

        void client.login(token).catch((error) => {
          logger.error(
            { err: error },
            "Tentativa de reconexão após 1 minuto falhou",
          );
        });
      }
    }, 60_000);
  });

  await client.login(token);
}
