import { BrowserWindow, WebContentsView, session } from "electron";
import { randomUUID } from "node:crypto";
import type { Tab } from "../shared/types";
export function normalizeUrl(input: string) {
  const text = input.trim();
  if (text === "about:blank") return text;
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(text) &&
    !/^https?:/i.test(text) &&
    !/^localhost:\d+/i.test(text)
  )
    throw new Error("只允许 HTTP / HTTPS 网页");
  let url: string;
  if (/^https?:\/\//i.test(text)) url = text;
  else if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(text))
    url = "http://" + text;
  else if (!/\s/.test(text) && text.includes(".")) url = "https://" + text;
  else url = "https://www.bing.com/search?q=" + encodeURIComponent(text);
  const parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("网址格式不受支持");
  return parsed.href;
}
type Entry = {
  view: WebContentsView;
  tab: Tab;
  epoch: number;
  scroll?: number;
};
export class BrowserManager {
  entries = new Map<string, Entry>();
  active = "";
  sidebar = 416;
  hidden = false;
  controlled = "";
  onInterrupt = () => {};
  constructor(
    public win: BrowserWindow,
    public changed: () => void,
  ) {
    win.on("resize", () => this.layout());
    win.on("closed", () => {
      for (const e of this.entries.values())
        if (!e.view.webContents.isDestroyed()) e.view.webContents.close();
    });
    const s = session.fromPartition("persist:browsing");
    s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.on("will-download", (_e, item) => {
      item.once("done", (_e, state) => {
        if (state !== "completed") console.warn("Download", state);
      });
    });
  }
  list() {
    return [...this.entries.values()].map((e) => e.tab);
  }
  get(id = this.active) {
    const e = this.entries.get(id);
    if (!e) throw new Error("目标标签已关闭");
    return e;
  }
  add(input = "https://www.bing.com/", zoom = 1) {
    const url = normalizeUrl(input),
      id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:browsing",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const e: Entry = {
      view,
      tab: { id, title: "新标签页", url, loading: false, zoom },
      epoch: 0,
    };
    this.entries.set(id, e);
    this.win.contentView.addChildView(view);
    view.setBackgroundColor("#ffffff");
    const wc = view.webContents;
    wc.setZoomFactor(zoom);
    wc.setWindowOpenHandler(({ url }) => {
      try {
        this.add(url);
      } catch {}
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (!/^https?:\/\//i.test(url) && url !== "about:blank")
        event.preventDefault();
    });
    wc.on("did-start-navigation", (_event, _url, _inPlace, main) => {
      if (main) e.epoch++;
    });
    const refresh = () => {
      if (wc.isDestroyed()) return;
      e.tab.url = wc.getURL() || url;
      e.tab.title = wc.getTitle() || "新标签页";
      e.tab.loading = wc.isLoading();
      e.tab.zoom = wc.getZoomFactor();
      this.changed();
    };
    wc.on("did-start-loading", refresh);
    wc.on("did-stop-loading", refresh);
    wc.on("did-navigate", refresh);
    wc.on("did-navigate-in-page", refresh);
    wc.on("page-title-updated", refresh);
    wc.on("did-fail-load", (_event, code, description, _url, main) => {
      if (main && code !== -3) {
        e.tab.error = description;
        this.changed();
      }
    });
    wc.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && this.controlled === id)
        this.onInterrupt();
      if (
        input.type === "keyDown" &&
        (input.control || input.meta) &&
        this.shortcut(input.key, input.shift)
      ) {
        event.preventDefault();
      }
    });
    wc.on("before-mouse-event", (_event, input) => {
      if (
        this.controlled === id &&
        ["mouseDown", "mouseWheel"].includes(input.type)
      )
        this.onInterrupt();
    });
    this.select(id);
    void wc.loadURL(url).catch(() => {});
    return id;
  }
  shortcut(key: string, shift = false) {
    const k = key.toLowerCase();
    if (k === "l") {
      this.win.webContents.focus();
      this.win.webContents.send("focus-address");
      return true;
    }
    if (k === "t") {
      this.add();
      return true;
    }
    if (k === "w") {
      this.close(this.active);
      return true;
    }
    if (k === "tab") {
      const ids = [...this.entries.keys()];
      this.select(
        ids[
          (ids.indexOf(this.active) + (shift ? ids.length - 1 : 1)) % ids.length
        ],
      );
      return true;
    }
    if (["+", "=", "-", "0"].includes(k)) {
      this.zoom(
        k === "0"
          ? 1
          : this.get().view.webContents.getZoomFactor() +
              (k === "-" ? -0.1 : 0.1),
      );
      return true;
    }
    return false;
  }
  select(id: string) {
    this.get(id);
    this.active = id;
    this.layout();
    this.changed();
  }
  close(id: string) {
    const e = this.get(id);
    if (this.controlled === id) this.onInterrupt();
    this.win.contentView.removeChildView(e.view);
    e.view.webContents.close();
    this.entries.delete(id);
    if (!this.entries.size) this.add();
    else if (this.active === id) this.select([...this.entries.keys()].at(-1)!);
    this.changed();
  }
  layout() {
    if (this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const side =
      this.sidebar === 0 ? 0 : Math.max(320, Math.min(this.sidebar, w - 360));
    if (side !== this.sidebar) {
      this.sidebar = side;
      this.changed();
    }
    for (const [id, e] of this.entries) {
      e.view.setVisible(
        id === this.active && !this.hidden && e.tab.url !== "about:blank",
      );
      e.view.setBounds({
        x: 0,
        y: 94,
        width: Math.max(1, w - side),
        height: Math.max(1, h - 94),
      });
    }
  }
  async navigate(id: string, url: string) {
    const e = this.get(id);
    e.tab.error = undefined;
    await e.view.webContents.loadURL(normalizeUrl(url));
    this.layout();
  }
  zoom(value: number) {
    const e = this.get();
    e.tab.zoom = Math.max(0.3, Math.min(3, value));
    e.view.webContents.setZoomFactor(e.tab.zoom);
    this.changed();
  }
  async observe(id: string) {
    const e = this.get(id);
    const snapshot = randomUUID();
    const result = await e.view.webContents.executeJavaScriptInIsolatedWorld(
      999,
      [{ code: `(${observeDOM.toString()})(${JSON.stringify(snapshot)})` }],
    );
    return {
      ...result,
      tab_id: id,
      document_epoch: e.epoch,
      snapshot_id: snapshot,
      observed_at: new Date().toISOString(),
    };
  }
  async act(id: string, name: string, args: any) {
    const e = this.get(id);
    if (name === "navigate") {
      await this.navigate(id, args.url);
      return this.observe(id);
    }
    if (name === "scroll") {
      await e.view.webContents.executeJavaScript(
        `window.scrollBy({top:${Number(args.pixels) || 600},behavior:'instant'})`,
      );
      return this.observe(id);
    }
    if (name === "wait_for") {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(5000, Math.max(100, Number(args.milliseconds) || 800)),
        ),
      );
      return this.observe(id);
    }
    if (args.document_epoch !== e.epoch)
      throw new Error("TARGET_STALE：页面已导航，请重新 observe_page");
    const result = await e.view.webContents.executeJavaScriptInIsolatedWorld(
      999,
      [
        {
          code: `(${actDOM.toString()})(${JSON.stringify(name)},${JSON.stringify(args)})`,
        },
      ],
      true,
    );
    if (result.error) throw new Error(result.error);
    await new Promise((r) => setTimeout(r, 180));
    return { action: result, observation: await this.observe(id) };
  }
}
function observeDOM(snapshot: string) {
  const w = window as any;
  const refs = new Map<string, Element>();
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      getComputedStyle(e).visibility !== "hidden"
    );
  };
  const elements: any[] = [];
  let index = 0;
  function scan(root: Document | ShadowRoot) {
    for (const e of root.querySelectorAll("*")) {
      if (e.shadowRoot) scan(e.shadowRoot);
      if (elements.length >= 160) break;
      if (
        !e.matches(
          'a,button,input,textarea,select,[role="button"],[contenteditable="true"],[role="textbox"]',
        ) ||
        !visible(e)
      )
        continue;
      const ref = String(++index);
      refs.set(ref, e);
      elements.push({
        ref,
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute("type"),
        label: (
          e.getAttribute("aria-label") ||
          e.getAttribute("placeholder") ||
          (e as HTMLElement).innerText ||
          e.getAttribute("title") ||
          ""
        ).slice(0, 200),
        value:
          (e as HTMLInputElement).type === "password"
            ? "[隐藏]"
            : String((e as HTMLInputElement).value || "").slice(0, 200),
      });
    }
  }
  scan(document);
  w.__lightboatSnapshot = { id: snapshot, refs };
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || "").slice(0, 14000),
    elements,
    scrollY,
    viewport: { width: innerWidth, height: innerHeight },
    iframes: document.querySelectorAll("iframe").length,
  };
}
function actDOM(name: string, args: any) {
  const snap = (window as any).__lightboatSnapshot;
  if (!snap || snap.id !== args.snapshot_id)
    return { error: "TARGET_STALE：快照已过期" };
  const el = snap.refs.get(String(args.element_ref)) as HTMLElement;
  if (!el || !el.isConnected)
    return { error: "ELEMENT_NOT_FOUND：请重新观察页面" };
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return { error: "TARGET_STALE：元素不可见" };
  if (name === "click") {
    el.click();
    return { status: "clicked" };
  }
  if (name === "fill") {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = args.text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: args.text,
        }),
      );
    } else {
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
        return { error: "该元素不支持输入" };
      if ((el as HTMLInputElement).type === "file")
        return { error: "文件上传需人工完成" };
      const proto =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : el.tagName === "SELECT"
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, args.text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { status: "filled" };
  }
  if (name === "press_key") {
    el.focus();
    if (args.key === "Enter" && (el as HTMLInputElement).form) {
      (el as HTMLInputElement).form!.requestSubmit();
      return { status: "submitted" };
    }
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: args.key, bubbles: true }),
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", { key: args.key, bubbles: true }),
    );
    return {
      status: "key_dispatched",
      note: "合成按键不保证网站响应，请观察核验",
    };
  }
  return { error: "未知操作" };
}
