import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// one pool per process; survives Next dev hot reloads
const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
export const sqlClient = g.__pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") g.__pg = sqlClient;

export const db = drizzle(sqlClient, { schema });
export * from "./schema";
