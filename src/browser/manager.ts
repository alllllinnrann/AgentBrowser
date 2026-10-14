import { BrowserWindow, WebContentsView, session, Menu } from "electron";
import { MouseGesture, paintGesture } from "./gestures";
import { randomUUID } from "node:crypto";
import type { WebFrameMain, NativeImage } from "electron";
import type { Tab } from "../shared/types";
import type { TaskFiles } from "../files/tasks";
async function readWithTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("框架读取超时")), 2500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
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
  snapshots?: Map<string, { frame: WebFrameMain; snapshot: string }>;
  screenshot?: {
    id: string;
    epoch: number;
    time: number;
    image: NativeImage;
    width: number;
    height: number;
    zoom: number;
  };
  injectedClick?: { x: number; y: number; events: Set<string> };
};
export class BrowserManager {
  entries = new Map<string, Entry>();
  active = "";
  sidebar = 416;
  hidden = false;
  controlled = "";
  onInterrupt = () => {};
  files?: TaskFiles;
  private downloadOwners = new Map<number, string>();
  downloadTask = (_webContentsId: number) => undefined as string | undefined;
  constructor(
    public win: BrowserWindow,
    public changed: () => void,
  ) {
    win.on("resize", () => this.layout());
    // Native child views and the chrome renderer have separate keyboard focus.
    win.webContents.on("before-mouse-event", (_event, input) => {
      if (input.type === "mouseDown") win.webContents.focus();
    });
    win.on("closed", () => {
      for (const e of this.entries.values())
        if (!e.view.webContents.isDestroyed()) e.view.webContents.close();
    });
    const s = session.fromPartition("persist:browsing");
    s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.on("will-download", (_e, item, contents) => {
      if (this.files)
        this.files.capture(
          item,
          this.downloadTask(contents?.id) ||
            this.downloadOwners.get(contents?.id),
        );
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
    wc.on("zoom-changed", (_event, direction) => {
      if (id !== this.active || this.hidden) return;
      this.zoom(wc.getZoomFactor() + (direction === "in" ? 0.1 : -0.1));
    });
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const owner =
          this.downloadTask(wc.id) || this.downloadOwners.get(wc.id);
        const child = this.add(url);
        if (owner)
          this.downloadOwners.set(this.get(child).view.webContents.id, owner);
      } catch {}
      return { action: "deny" };
    });
    wc.once("destroyed", () => this.downloadOwners.delete(wc.id));
    wc.on("will-navigate", (event, url) => {
      if (!/^https?:\/\//i.test(url) && url !== "about:blank")
        event.preventDefault();
    });
    wc.on("did-start-navigation", (_event, _url, _inPlace, main) => {
      // Child-frame navigation invalidates element references too.
      e.epoch++;
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
    const gesture = new MouseGesture((phase, x, y, path) => {
      if (wc.isDestroyed()) return;
      const labels: Record<string, string> = {
        L: "后退",
        R: "前进",
        U: "向上滚动",
        D: "向下滚动",
        UD: "刷新",
        DR: "关闭标签页",
      };
      let label = path ? labels[path] || "无效手势" : "";
      if (path === "L" && !wc.navigationHistory.canGoBack()) label = "无法后退";
      if (path === "R" && !wc.navigationHistory.canGoForward())
        label = "无法前进";
      const zoom = wc.getZoomFactor();
      void wc
        .executeJavaScriptInIsolatedWorld(999, [
          {
            code: `(${paintGesture.toString()})(${JSON.stringify(phase)},${x / zoom},${y / zoom},${JSON.stringify(label)})`,
          },
        ])
        .catch(() => {});
    });
    let suppressMenuUntil = 0;
    wc.on("blur", () => gesture.cancel());
    wc.on("did-start-navigation", () => gesture.cancel());
    wc.on("before-mouse-event", (event, input) => {
      const injected = e.injectedClick;
      if (
        injected &&
        input.button === "left" &&
        input.x === injected.x &&
        input.y === injected.y &&
        injected.events.delete(input.type)
      ) {
        if (!injected.events.size) e.injectedClick = undefined;
        return;
      }
      if (["mouseDown", "mouseWheel"].includes(input.type))
        e.screenshot = undefined;
      if (input.type === "mouseDown" && id === this.active && !this.hidden)
        wc.focus();
      if (
        this.controlled === id &&
        ["mouseDown", "mouseWheel"].includes(input.type)
      )
        this.onInterrupt();
      const result = gesture.handle(input);
      if (result.consume) {
        event.preventDefault();
        suppressMenuUntil = Date.now() + 500;
      }
      if (result.action) {
        this.onInterrupt();
        // Finish dispatching the mouse event before closing/navigating a view.
        setImmediate(() => {
          if (wc.isDestroyed() || this.active !== id || this.hidden) return;
          const history = wc.navigationHistory;
          switch (result.action) {
            case "L":
              if (history.canGoBack()) history.goBack();
              break;
            case "R":
              if (history.canGoForward()) history.goForward();
              break;
            case "UD":
              wc.reload();
              break;
            case "U":
            case "D":
              void wc
                .executeJavaScript(
                  `window.scrollBy({top: ${result.action === "U" ? "-" : ""}Math.round(innerHeight * .8), behavior: 'smooth'})`,
                )
                .catch(() => {});
              break;
            case "DR":
              this.close(id);
              break;
          }
        });
      }
    });
    wc.on("context-menu", (_event, params) => {
      if (gesture.active || Date.now() < suppressMenuUntil) return;
      Menu.buildFromTemplate(
        params.isEditable
          ? [
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ]
          : params.selectionText
            ? [{ role: "copy" }]
            : [
                {
                  label: "后退",
                  enabled: wc.navigationHistory.canGoBack(),
                  click: () => {
                    this.onInterrupt();
                    wc.navigationHistory.goBack();
                  },
                },
                {
                  label: "前进",
                  enabled: wc.navigationHistory.canGoForward(),
                  click: () => {
                    this.onInterrupt();
                    wc.navigationHistory.goForward();
                  },
                },
                {
                  label: "刷新",
                  click: () => {
                    this.onInterrupt();
                    wc.reload();
                  },
                },
              ],
      ).popup({ window: this.win });
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
      const visible =
        id === this.active && !this.hidden && e.tab.url !== "about:blank";
      if (e.view.getVisible() !== visible) e.view.setVisible(visible);
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
    if (this.controlled === this.active) this.onInterrupt();
    e.screenshot = undefined;
    e.tab.zoom = Math.max(0.3, Math.min(3, Math.round(value * 100) / 100));
    e.view.webContents.setZoomFactor(e.tab.zoom);
    for (const entry of this.entries.values()) {
      entry.tab.zoom = entry.view.webContents.getZoomFactor();
    }
    this.changed();
  }
  async observe(
    id: string,
    options: { frame_id?: string; offset?: number; query?: string } = {},
  ) {
    const e = this.get(id);
    const wc = e.view.webContents;
    const snapshot = randomUUID();
    const epoch = e.epoch;
    const allFrames = wc.mainFrame.framesInSubtree;
    const frames = options.frame_id
      ? allFrames.filter((f) => String(f.frameTreeNodeId) === options.frame_id)
      : allFrames.slice(0, 24);
    if (!frames.length) throw new Error("目标 iframe 已关闭或导航，请重新观察");
    const results: any[] = [];
    const snapshots = new Map<
      string,
      { frame: WebFrameMain; snapshot: string }
    >();
    e.snapshots = snapshots;
    await Promise.all(
      frames.map(async (frame, index) => {
        const frameId = String(frame.frameTreeNodeId);
        try {
          const code = `(${observeDOM.toString()})(${JSON.stringify(snapshot)},${JSON.stringify(options)})`;
          const result: any = await readWithTimeout(
            frame === wc.mainFrame
              ? wc.executeJavaScriptInIsolatedWorld(999, [{ code }])
              : frame.executeJavaScript(code),
          );
          snapshots.set(frameId, { frame, snapshot });
          results[index] = {
            ...result,
            frame_id: frameId,
            elements: result.elements.map((el: any) => ({
              ...el,
              ref: `${frameId}:${el.ref}`,
            })),
          };
        } catch {
          results[index] = {
            frame_id: frameId,
            error: "该框架暂时无法读取（可能正在导航或读取超时）",
            text: "",
            elements: [],
          };
        }
      }),
    );
    if (epoch !== e.epoch) throw new Error("页面正在导航，请稍后重新观察");
    const limit = options.frame_id
      ? 14000
      : Math.max(1200, Math.floor(24000 / frames.length));
    const text = results
      .map((r) => `[frame ${r.frame_id}]\n${r.text.slice(0, limit)}`)
      .join("\n\n");
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      text,
      elements: results.flatMap((r) => r.elements).slice(0, 240),
      frames: results.map(({ text, elements, ...r }) => ({
        ...r,
        returned_characters: Math.min(text.length, limit),
        next_offset:
          r.next_offset != null || text.length > limit
            ? (r.offset || 0) + Math.min(text.length, limit)
            : null,
      })),
      frames_truncated: !options.frame_id && allFrames.length > frames.length,
      found:
        options.query === undefined ? undefined : results.some((r) => r.found),
      incomplete:
        results.some((r) => r.error) ||
        (!options.frame_id && allFrames.length > frames.length),
      tab_id: id,
      document_epoch: e.epoch,
      snapshot_id: snapshot,
      observed_at: new Date().toISOString(),
    };
  }
  async resources(id: string, offset = 0) {
    const frames = this.get(
      id,
    ).view.webContents.mainFrame.framesInSubtree.slice(0, 24);
    const resources: any[] = [],
      errors: any[] = [];
    for (const frame of frames) {
      try {
        const items: any = await readWithTimeout(
          frame.executeJavaScript(`(${collectResources.toString()})()`),
        );
        resources.push(
          ...items.map((r: any) => ({
            ...r,
            frame_id: String(frame.frameTreeNodeId),
          })),
        );
      } catch {
        errors.push({
          frame_id: String(frame.frameTreeNodeId),
          error: "框架暂不可读取",
        });
      }
    }
    return {
      resources: resources.slice(offset, offset + 80),
      total: resources.length,
      next_offset: offset + 80 < resources.length ? offset + 80 : null,
      errors,
      scope: "当前已加载 DOM；候选链接不保证是原图",
    };
  }
  async screenshot(id: string) {
    const e = this.get(id),
      wc = e.view.webContents;
    const epoch = e.epoch,
      url = wc.getURL();
    let image = await wc.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    if (image.isEmpty())
      throw new Error("网页尚未绘制，暂时无法截图，请稍后重试");
    if (e.epoch !== epoch) throw new Error("截图时页面发生导航，请重新截图");
    const size = image.getSize();
    const scale = Math.min(1, 1800 / Math.max(size.width, size.height));
    if (scale < 1)
      image = image.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      });
    const bounds = e.view.getBounds();
    const screenshotId = randomUUID();
    e.screenshot = {
      id: screenshotId,
      epoch,
      time: Date.now(),
      image,
      width: bounds.width,
      height: bounds.height,
      zoom: wc.getZoomFactor(),
    };
    return {
      screenshot_id: screenshotId,
      tab_id: id,
      url,
      document_epoch: epoch,
      ...image.getSize(),
      scope: "当前网页可视区域",
      captured_at: new Date().toISOString(),
      data_url: "data:image/jpeg;base64," + image.toJPEG(85).toString("base64"),
    };
  }
  async act(id: string, name: string, args: any, signal?: AbortSignal) {
    const e = this.get(id);
    if (name === "click_coordinates") {
      const shot = e.screenshot,
        wc = e.view.webContents,
        bounds = e.view.getBounds();
      if (
        !shot ||
        shot.id !== args.screenshot_id ||
        shot.epoch !== e.epoch ||
        Date.now() - shot.time > 60000 ||
        shot.width !== bounds.width ||
        shot.height !== bounds.height ||
        shot.zoom !== wc.getZoomFactor()
      )
        throw new Error("SCREENSHOT_STALE：请重新截图后点击");
      const size = shot.image.getSize();
      if (
        !Number.isFinite(args.x) ||
        !Number.isFinite(args.y) ||
        args.x < 0 ||
        args.y < 0 ||
        args.x >= size.width ||
        args.y >= size.height
      )
        throw new Error("坐标超出截图范围");
      // Check the target neighborhood, so unrelated animation elsewhere does not block a click.
      const current = (
        await wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
      ).resize(size);
      signal?.throwIfAborted();
      const rect = {
        x: Math.max(0, Math.floor(args.x) - 24),
        y: Math.max(0, Math.floor(args.y) - 24),
        width: 1,
        height: 1,
      };
      rect.width = Math.min(48, size.width - rect.x);
      rect.height = Math.min(48, size.height - rect.y);
      if (
        e.screenshot !== shot ||
        e.epoch !== shot.epoch ||
        e.view.getBounds().width !== shot.width ||
        e.view.getBounds().height !== shot.height ||
        wc.getZoomFactor() !== shot.zoom ||
        !current.crop(rect).toPNG().equals(shot.image.crop(rect).toPNG())
      )
        throw new Error("SCREENSHOT_STALE：点击位置的画面已变化，请重新截图");
      const x = Math.min(
        bounds.width - 1,
        Math.floor((args.x * bounds.width) / size.width),
      );
      const y = Math.min(
        bounds.height - 1,
        Math.floor((args.y * bounds.height) / size.height),
      );
      e.screenshot = undefined;
      const injected = { x, y, events: new Set(["mouseDown", "mouseUp"]) };
      e.injectedClick = injected;
      try {
        wc.sendInputEvent({
          type: "mouseDown",
          button: "left",
          x,
          y,
          clickCount: 1,
        });
        wc.sendInputEvent({
          type: "mouseUp",
          button: "left",
          x,
          y,
          clickCount: 1,
        });
        await new Promise((r) => setTimeout(r, 180));
      } finally {
        if (e.injectedClick === injected) e.injectedClick = undefined;
      }
      return {
        action: { status: "click_dispatched", x: args.x, y: args.y },
        observation: await this.observe(id),
      };
    }
    if (name === "navigate") {
      await this.navigate(id, args.url);
      return this.observe(id);
    }
    if (name === "scroll") {
      const frame = args.frame_id
        ? e.view.webContents.mainFrame.framesInSubtree.find(
            (f) => String(f.frameTreeNodeId) === args.frame_id,
          )
        : e.view.webContents.mainFrame;
      if (!frame) throw new Error("目标框架已关闭，请重新观察");
      await frame.executeJavaScript(
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
    const [frameId, elementRef] = String(args.element_ref).split(":");
    const target = e.snapshots?.get(frameId);
    if (
      !target ||
      target.snapshot !== args.snapshot_id ||
      target.frame.isDestroyed() ||
      target.frame.detached
    )
      throw new Error("TARGET_STALE：元素所属框架已变化，请重新观察");
    const code = `(${actDOM.toString()})(${JSON.stringify(name)},${JSON.stringify({ ...args, element_ref: elementRef })})`;
    const result: any =
      target.frame === e.view.webContents.mainFrame
        ? await e.view.webContents.executeJavaScriptInIsolatedWorld(
            999,
            [{ code }],
            true,
          )
        : await target.frame.executeJavaScript(code, true);
    if (result.error) throw new Error(result.error);
    await new Promise((r) => setTimeout(r, 180));
    return { action: result, observation: await this.observe(id) };
  }
}
function observeDOM(
  snapshot: string,
  options: { offset?: number; query?: string } = {},
) {
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
  const fullText = document.body?.innerText || "";
  const match =
    options.query === undefined
      ? -1
      : fullText.toLowerCase().indexOf(options.query.toLowerCase());
  const offset =
    options.query === undefined
      ? Math.min(options.offset || 0, fullText.length)
      : Math.max(0, match - 500);
  const text =
    options.query !== undefined && match < 0
      ? ""
      : fullText.slice(offset, offset + 14000);
  return {
    url: location.href,
    title: document.title,
    text,
    offset,
    total_characters: fullText.length,
    next_offset:
      offset + text.length < fullText.length ? offset + text.length : null,
    found: options.query === undefined ? undefined : match >= 0,
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

function collectResources() {
  const result: any[] = [],
    seen = new Set<string>();
  const add = (url: string, data: any) => {
    try {
      const u = new URL(url, document.baseURI);
      if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) return;
      seen.add(u.href);
      result.push({ url: u.href, ...data });
    } catch {}
  };
  const scan = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) scan(el.shadowRoot);
      if (el instanceof HTMLImageElement) {
        const label = el.alt || el.title || el.getAttribute("aria-label") || "";
        add(el.currentSrc || el.src, {
          kind: "image",
          label,
          width: el.naturalWidth,
          height: el.naturalHeight,
        });
        for (const attr of [
          "data-src",
          "data-original",
          "data-full",
          "data-large",
        ]) {
          const u = el.getAttribute(attr);
          if (u) add(u, { kind: "candidate_image", label });
        }
        if (el.srcset)
          for (const entry of el.srcset.split(",")) {
            const u = entry.trim().split(/\s+/)[0];
            if (u) add(u, { kind: "candidate_image", label });
          }
        const link = el.closest("a");
        if (link?.href)
          add(link.href, {
            kind: "candidate_link",
            label: label || link.textContent?.trim(),
          });
      } else if (el instanceof HTMLAnchorElement && el.href) {
        const label = (el.textContent || el.title || "").trim().slice(0, 200);
        add(el.href, {
          kind: el.hasAttribute("download") ? "attachment" : "link",
          label,
          filename: el.getAttribute("download") || undefined,
        });
      }
    }
  };
  scan(document);
  return result;
}
