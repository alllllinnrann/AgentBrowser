import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Conversation, Settings, Schedule } from "../shared/types";
export const defaults: Settings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  contextLimit: 32000,
  outputLimit: 4096,
  maxSteps: 30,
  browserProxy: "",
  modelProxy: "",
  keySet: false,
};
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key=?")
      .get(key) as any;
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  conversations() {
    return this.get<Conversation[]>("conversations", []);
  }
  saveConversations(items: Conversation[]) {
    this.set("conversations", items);
  }
  newConversation(): Conversation {
    return {
      id: randomUUID(),
      title: "新的对话",
      messages: [],
      summary: "",
      summarizedThrough: 0,
      updated: Date.now(),
    };
  }
  schedules() {
    return this.get<Schedule[]>("schedules", []);
  }
  close() {
    this.db.close();
  }
}
