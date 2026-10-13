import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session,
  safeStorage,
  dialog,
  shell,
} from "electron";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, defaults } from "../storage/store";
import { BrowserManager, normalizeUrl } from "../browser/manager";
import { AgentRuntime } from "../agent/runtime";
import { completion } from "../models/client";
import { localDay, due } from "./scheduler";
import type { State, Settings, Conversation, Schedule } from "../shared/types";
if (process.env.LIGHTBOAT_DATA)
  app.setPath("userData", process.env.LIGHTBOAT_DATA);
let win: BrowserWindow,
  store: Store,
  browser: BrowserManager,
  agent: AgentRuntime;
let settings: Settings,
  conversations: Conversation[],
  schedules: Schedule[],
  activeConversation = "",
  encryptedKey = "",
  chatWindows = new Set<BrowserWindow>();
let emitTimer: ReturnType<typeof setTimeout> | undefined,
  saveTimer: ReturnType<typeof setTimeout> | undefined;
const getKey = () =>
  encryptedKey
    ? safeStorage.decryptString(Buffer.from(encryptedKey, "base64"))
    : "";
function persist() {
  store.saveConversations(conversations);
}
function state(): State {
  return {
    tabs: browser.list(),
    activeTab: browser.active,
    conversations,
    activeConversation,
    settings: { ...settings, keySet: !!encryptedKey },
    schedules,
    running: agent.running,
    targetTab: agent.target,
    runningConversation: agent.conversation,
    phase: agent.phase,
    draft: agent.draft,
    sidebar: browser.sidebar,
    dataPath: app.getPath("userData"),
  };
}
function broadcast() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = undefined;
    if (!win.isDestroyed()) {
      const s = state();
      win.webContents.send("state", s);
      for (const w of chatWindows)
        if (!w.isDestroyed()) w.webContents.send("state", s);
    }
  }, 70);
  if (!saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      if (browser)
        store.set(
          "tabs",
          browser.list().map((t) => ({ url: t.url, zoom: t.zoom })),
        );
    }, 1000);
}
function activeChat() {
  const c = conversations.find((c) => c.id === activeConversation);
  if (!c) throw new Error("对话不存在");
  return c;
}
function newChat() {
  const c = store.newConversation();
  conversations.unshift(c);
  activeConversation = c.id;
  persist();
  broadcast();
  return c;
}
async function proxy() {
  await session
    .fromPartition("persist:browsing")
    .setProxy(
      settings.browserProxy
        ? { mode: "fixed_servers", proxyRules: settings.browserProxy }
        : { mode: "system" },
    );
  await session
    .fromPartition("persist:model")
    .setProxy(
      settings.modelProxy
        ? { mode: "fixed_servers", proxyRules: settings.modelProxy }
        : { mode: "system" },
    );
}
const settingsSchema = z
  .object({
    baseUrl: z
      .url()
      .refine((u) => ["http:", "https:"].includes(new URL(u).protocol)),
    model: z.string().min(1).max(200),
    contextLimit: z.number().int().min(16000).max(2000000),
    outputLimit: z.number().int().min(512).max(64000),
    maxSteps: z.number().int().min(1).max(200),
    browserProxy: z.string().max(500),
    modelProxy: z.string().max(500),
    apiKey: z.string().max(4000).optional(),
    clearKey: z.boolean().optional(),
  })
  .refine(
    (s) => s.outputLimit < s.contextLimit / 2,
    "输出预算必须小于上下文上限的一半",
  );
app.whenReady().then(async () => {
  mkdirSync(app.getPath("userData"), { recursive: true });
  store = new Store(join(app.getPath("userData"), "lightboat.sqlite"));
  settings = { ...defaults, ...store.get("settings", {}) };
  encryptedKey = store.get("key", "");
  conversations = store.conversations();
  schedules = store.schedules();
  if (!conversations.length) conversations.push(store.newConversation());
  activeConversation = conversations[0].id;
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    title: "轻舟 · Agent Browser",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  browser = new BrowserManager(win, broadcast);
  agent = new AgentRuntime(browser, broadcast, persist, () => settings, getKey);
  browser.onInterrupt = () => agent.stop("你已手动操作网页，自动任务已停止");
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      (input.control || input.meta) &&
      browser.shortcut(input.key, input.shift)
    )
      event.preventDefault();
  });
  await proxy();
  const saved = store.get<{ url: string; zoom: number }[]>("tabs", []);
  for (const t of saved.slice(0, 15)) {
    try {
      browser.add(
        t.url === "about:blank" ? "https://www.bing.com/" : t.url,
        t.zoom,
      );
    } catch {}
  }
  if (!browser.entries.size) browser.add();
  browser.sidebar = store.get("sidebar", 416);
  browser.layout();
  ipcMain.handle("command", async (event, command, payload) => {
    const sender = event.sender;
    const trusted =
      sender === win.webContents ||
      [...chatWindows].some(
        (w) => !w.isDestroyed() && w.webContents === sender,
      );
    if (!trusted || event.senderFrame !== sender.mainFrame)
      throw new Error("拒绝网页访问桌面控制接口");
    switch (command) {
      case "state":
        return state();
      case "newTab":
        browser.add(typeof payload === "string" ? payload : undefined);
        break;
      case "selectTab":
        browser.select(z.string().parse(payload));
        break;
      case "closeTab":
        browser.close(z.string().parse(payload));
        break;
      case "navigate":
        agent.stop("你已手动导航，任务已停止");
        await browser.navigate(
          browser.active,
          z.string().max(4000).parse(payload),
        );
        break;
      case "back":
        agent.stop();
        if (browser.get().view.webContents.navigationHistory.canGoBack())
          browser.get().view.webContents.navigationHistory.goBack();
        break;
      case "forward":
        agent.stop();
        if (browser.get().view.webContents.navigationHistory.canGoForward())
          browser.get().view.webContents.navigationHistory.goForward();
        break;
      case "reload":
        agent.stop();
        browser.get().view.webContents.reload();
        break;
      case "zoom":
        browser.zoom(z.number().parse(payload));
        break;
      case "sidebar":
        browser.sidebar = z.number().min(0).max(1000).parse(payload);
        browser.layout();
        store.set("sidebar", browser.sidebar);
        break;
      case "overlay":
        browser.hidden = z.boolean().parse(payload);
        browser.layout();
        if (browser.hidden) win.webContents.focus();
        break;
      case "newChat":
        newChat();
        break;
      case "selectChat":
        if (!conversations.some((c) => c.id === payload))
          throw new Error("对话不存在");
        activeConversation = payload;
        break;
      case "deleteChat":
        if (agent.running && agent.conversation === payload)
          throw new Error("请先停止当前任务");
        conversations = conversations.filter((c) => c.id !== payload);
        if (!conversations.length) newChat();
        if (activeConversation === payload)
          activeConversation = conversations[0].id;
        persist();
        break;
      case "send": {
        const text = z.string().min(1).max(30000).parse(payload);
        if (agent.running) throw new Error("请先停止当前任务");
        void agent.run(activeChat(), text, browser.active).catch((e) => {
          agent.phase = e.message;
          broadcast();
        });
        break;
      }
      case "retry": {
        const prompt = [...activeChat().messages]
          .reverse()
          .find((m) => m.role === "user")?.content;
        if (!prompt) throw new Error("没有可重试的指令");
        if (agent.running) throw new Error("请先停止当前任务");
        void agent.run(activeChat(), prompt, browser.active).catch((e) => {
          agent.phase = e.message;
          broadcast();
        });
        break;
      }
      case "stop":
        agent.stop();
        break;
      case "settings": {
        if (agent.running) throw new Error("请先停止任务再更改模型设置");
        const parsed = settingsSchema.parse(payload);
        let key = encryptedKey;
        if (parsed.clearKey) key = "";
        else if (parsed.apiKey) {
          if (!safeStorage.isEncryptionAvailable())
            throw new Error("系统加密服务不可用，无法保存密钥");
          key = safeStorage.encryptString(parsed.apiKey).toString("base64");
        }
        const { apiKey, clearKey, ...rest } = parsed;
        settings = { ...rest, keySet: !!key };
        encryptedKey = key;
        store.set("settings", settings);
        store.set("key", key);
        await proxy();
        break;
      }
      case "testConnection": {
        const result = await completion(
          { ...settings, outputLimit: 64 },
          getKey(),
          [{ role: "user", content: "仅回复：连接成功" }],
          [],
          AbortSignal.timeout(30000),
          () => {},
          agent.fetcher(),
        );
        return result.content;
      }
      case "saveSchedule": {
        const p = z
          .object({
            id: z.string().optional(),
            title: z.string().min(1).max(100),
            time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            url: z.string().min(1).max(4000),
            prompt: z.string().min(1).max(20000),
            enabled: z.boolean(),
          })
          .parse(payload);
        const existing = schedules.find((s) => s.id === p.id);
        const item: Schedule = {
          ...p,
          id: existing?.id || randomUUID(),
          url: normalizeUrl(p.url),
          lastRun: existing?.lastRun || localDay(new Date()),
          status: existing?.status || "从下次每日时间开始",
        };
        schedules = existing
          ? schedules.map((s) => (s.id === item.id ? item : s))
          : [...schedules, item];
        store.set("schedules", schedules);
        break;
      }
      case "toggleSchedule": {
        const s = schedules.find((s) => s.id === payload);
        if (s) s.enabled = !s.enabled;
        store.set("schedules", schedules);
        break;
      }
      case "deleteSchedule":
        schedules = schedules.filter((s) => s.id !== payload);
        store.set("schedules", schedules);
        break;
      case "runSchedule": {
        const s = schedules.find((s) => s.id === payload);
        if (!s) throw new Error("任务不存在");
        if (agent.running) throw new Error("请先停止当前任务");
        void runSchedule(s);
        break;
      }
      case "export": {
        const save = await dialog.showSaveDialog(win, {
          defaultPath: "轻舟对话备份.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!save.canceled && save.filePath) {
          writeFileSync(
            save.filePath,
            JSON.stringify(
              {
                version: 1,
                conversations,
                schedules,
                settings: { ...settings, keySet: false },
              },
              null,
              2,
            ),
            "utf8",
          );
          return "备份已保存（不含密钥、站点登录信息）";
        }
        return "已取消";
      }
      case "dataFolder":
        await shell.openPath(app.getPath("userData"));
        break;
      case "chatWindow": {
        const w = new BrowserWindow({
          width: 520,
          height: 780,
          title: "轻舟 · 对话",
          webPreferences: {
            preload: join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        chatWindows.add(w);
        w.on("closed", () => chatWindows.delete(w));
        w.webContents.on("will-navigate", (e) => e.preventDefault());
        w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        await w.loadFile(join(__dirname, "index.html"), {
          query: { chat: "1" },
        });
        break;
      }
      default:
        throw new Error("未知操作");
    }
    broadcast();
    return state();
  });
  await win.loadFile(join(__dirname, "index.html"));
  broadcast();
  setInterval(() => {
    if (agent.running) return;
    const s = schedules.find((s) => due(s, new Date()));
    if (s) void runSchedule(s);
  }, 15000).unref();
});
async function runSchedule(s: Schedule) {
  s.lastRun = localDay(new Date());
  s.status = "执行中";
  store.set("schedules", schedules);
  broadcast();
  try {
    const c = newChat();
    c.title = "定时 · " + s.title;
    const tab = browser.add(s.url);
    await new Promise((r) => setTimeout(r, 800));
    await agent.run(c, s.prompt, tab);
    s.status = agent.phase;
  } catch (e) {
    s.status = "失败：" + (e as Error).message;
  }
  store.set("schedules", schedules);
  broadcast();
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  agent?.stop();
  if (store) {
    if (saveTimer) clearTimeout(saveTimer);
    if (emitTimer) clearTimeout(emitTimer);
    store.set(
      "tabs",
      browser.list().map((t) => ({ url: t.url, zoom: t.zoom })),
    );
    persist();
  }
});
