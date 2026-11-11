import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { customAlphabet } from "nanoid";
import { InsertUser, passReservations, tickets, users, waitlistEntries } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
const makeTicketId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function addToWaitlist(name: string, email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(waitlistEntries).where(eq(waitlistEntries.email, normalizedEmail)).limit(1);
  if (existing[0]) return { entry: existing[0], alreadyJoined: true };
  try {
    const result = await db.insert(waitlistEntries).values({ name: name.trim(), email: normalizedEmail });
    const entry = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, result[0].insertId)).limit(1);
    return { entry: entry[0], alreadyJoined: false };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const duplicate = await db.select().from(waitlistEntries).where(eq(waitlistEntries.email, normalizedEmail)).limit(1);
    if (duplicate[0]) return { entry: duplicate[0], alreadyJoined: true };
    throw error;
  }
}

export async function getReservationForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({ reservation: passReservations, ticket: tickets })
    .from(passReservations)
    .leftJoin(tickets, eq(tickets.reservationId, passReservations.id))
    .where(eq(passReservations.userId, userId))
    .limit(1);
  if (!result[0]) return undefined;
  return { ...result[0].reservation, ticket: result[0].ticket };
}

export async function reservePassForUser(userId: number, name: string, email: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const existing = await getReservationForUser(userId);
  if (existing?.ticket) return existing;

  try {
    await db.transaction(async tx => {
      const current = await tx.select().from(passReservations).where(eq(passReservations.userId, userId)).limit(1);
      const reservationId = current[0]
        ? current[0].id
        : Number((await tx.insert(passReservations).values({ userId, status: "reserved" }))[0].insertId);
      const currentTicket = await tx.select().from(tickets).where(eq(tickets.reservationId, reservationId)).limit(1);
      if (currentTicket[0]) return;
      await tx.insert(tickets).values({
        reservationId,
        ticketId: `AKXMAS-${new Date().getFullYear()}-${makeTicketId()}`,
        attendeeName: name?.trim() || "Afro Kravings guest",
        attendeeEmail: email?.trim().toLowerCase() || null,
      });
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const concurrent = await getReservationForUser(userId);
    if (concurrent) return concurrent;
    throw error;
  }
  return getReservationForUser(userId);
}

export async function reservePassForGuest(name: string, email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db
    .select({ reservation: passReservations, ticket: tickets })
    .from(passReservations)
    .leftJoin(tickets, eq(tickets.reservationId, passReservations.id))
    .where(eq(passReservations.guestEmail, normalizedEmail))
    .limit(1);
  if (existing[0]?.ticket) return existing[0];

  try {
    await db.transaction(async tx => {
      const current = await tx.select().from(passReservations).where(eq(passReservations.guestEmail, normalizedEmail)).limit(1);
      const reservationId = current[0]
        ? current[0].id
        : Number((await tx.insert(passReservations).values({ guestEmail: normalizedEmail, status: "reserved" }))[0].insertId);
      const currentTicket = await tx.select().from(tickets).where(eq(tickets.reservationId, reservationId)).limit(1);
      if (currentTicket[0]) return;
      await tx.insert(tickets).values({
        reservationId,
        ticketId: `AKXMAS-${new Date().getFullYear()}-${makeTicketId()}`,
        attendeeName: name.trim(),
        attendeeEmail: normalizedEmail,
      });
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const concurrent = await db
      .select({ reservation: passReservations, ticket: tickets })
      .from(passReservations)
      .leftJoin(tickets, eq(tickets.reservationId, passReservations.id))
      .where(eq(passReservations.guestEmail, normalizedEmail))
      .limit(1);
    if (concurrent[0]) return concurrent[0];
    throw error;
  }
  const result = await db
    .select({ reservation: passReservations, ticket: tickets })
    .from(passReservations)
    .leftJoin(tickets, eq(tickets.reservationId, passReservations.id))
    .where(eq(passReservations.guestEmail, normalizedEmail))
    .limit(1);
  return result[0];
}

function isDuplicateKey(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
}
