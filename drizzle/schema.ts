import { int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const waitlistEntries = mysqlTable("waitlist_entries", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const passReservations = mysqlTable(
  "pass_reservations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    guestEmail: varchar("guestEmail", { length: 320 }),
    status: mysqlEnum("status", ["reserved", "checked_in"]).default("reserved").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: uniqueIndex("pass_reservations_user_idx").on(table.userId),
    guestEmailIdx: uniqueIndex("pass_reservations_guest_email_idx").on(table.guestEmail),
  }),
);

export const tickets = mysqlTable(
  "tickets",
  {
    id: int("id").autoincrement().primaryKey(),
    reservationId: int("reservationId").notNull(),
    ticketId: varchar("ticketId", { length: 40 }).notNull().unique(),
    attendeeName: varchar("attendeeName", { length: 160 }).notNull(),
    attendeeEmail: varchar("attendeeEmail", { length: 320 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    reservationIdx: uniqueIndex("tickets_reservation_idx").on(table.reservationId),
  }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
export type PassReservation = typeof passReservations.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
