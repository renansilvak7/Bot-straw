import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

export const championshipsTable = pgTable("championships", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slots: integer("slots").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const participantsTable = pgTable(
  "participants",
  {
    id: serial("id").primaryKey(),
    championshipId: integer("championship_id")
      .notNull()
      .references(() => championshipsTable.id, { onDelete: "cascade" }),
    discordId: text("discord_id").notNull(),
    name: text("name").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueParticipant: unique().on(table.championshipId, table.discordId),
  }),
);

export type Championship = typeof championshipsTable.$inferSelect;
export type Participant = typeof participantsTable.$inferSelect;
