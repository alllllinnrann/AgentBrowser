import { app, nativeImage, session, shell } from "electron";
import type { DownloadItem } from "electron";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  constants,
} from "node:fs";
import { randomUUID } from "node:crypto";
export type ResourceFile = {
  id: string;
  task?: string;
  name: string;
  path: string;
  kind: "source" | "result" | "download";
  status: string;
  bytes: number;
  total?: number;
  url?: string;
  error?: string;
  time: number;
  width?: number;
  height?: number;
};
const MAX = 64 * 1024 * 1024;
export class TaskFiles {
  root = resolve(
    process.env.LIGHTBOAT_FILES ||
      join(
        app.isPackaged ? dirname(app.getPath("exe")) : app.getAppPath(),
        "Data",
      ),
  );
  records: ResourceFile[] = [];
  error = "";
  constructor(private changed: () => void) {
    try {
      this.directory("");
      const index = this.safe("files.json");
      if (existsSync(index))
        this.records = JSON.parse(readFileSync(index, "utf8"));
      for (const r of this.records)
        if (r.status === "downloading") {
          r.status = "interrupted";
          r.error = "上次下载未完成，请重试";
        }
      this.persist();
    } catch (e) {
      this.error =
        "软件目录不可写或文件记录不可读取，请使用可写的安装目录：" +
        (e as Error).message;
    }
  }
  safe(part: string) {
    const full = resolve(this.root, part);
    if (full !== this.root && !full.startsWith(this.root + sep))
      throw new Error("文件超出软件 Data 目录");
    // Refuse directory junctions/symlinks, including ancestors of the installation.
    let cursor = full;
    while (true) {
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
        throw new Error("不支持链接目录或链接文件");
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return full;
  }
  directory(part: string) {
    const p = this.safe(part);
    mkdirSync(p, { recursive: true });
    return p;
  }
  ready() {
    if (this.error) throw new Error(this.error);
  }
  taskDir(task: string) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(task)) throw new Error("任务编号无效");
    return join("Tasks", task);
  }
  persist() {
    const temp = this.safe("files.json.tmp");
    writeFileSync(temp, JSON.stringify(this.records, null, 2));
    renameSync(temp, this.safe("files.json"));
    this.changed();
  }
  list(task?: string) {
    return this.records
      .filter((r) => !task || r.task === task)
      .map(({ path, ...r }) => r);
  }
  make(
    task: string | undefined,
    name: string,
    kind: ResourceFile["kind"],
    url?: string,
  ) {
    this.ready();
    name =
      basename(name)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/[. ]+$/g, "")
        .slice(0, 140) || "resource";
    const id = randomUUID();
    const dir = task
      ? join(this.taskDir(task), kind === "result" ? "Results" : "Sources")
      : "Downloads";
    this.directory(dir);
    const record: ResourceFile = {
      id,
      task,
      name,
      path: join(dir, id + "-" + name),
      kind,
      status: "downloading",
      bytes: 0,
      url,
      time: Date.now(),
    };
    this.records.unshift(record);
    this.persist();
    return record;
  }
  get(id: string, task?: string) {
    this.ready();
    const r = this.records.find(
      (r) => r.id === id && (!task || r.task === task),
    );
    if (!r) throw new Error("文件不属于当前任务或不存在");
    return r;
  }
  inspect(r: ResourceFile) {
    const p = this.safe(r.path);
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) Object.assign(r, img.getSize());
  }
  async download(
    task: string,
    url: string,
    name: string | undefined,
    referer: string,
    signal: AbortSignal,
  ) {
    if (!/^https?:\/\//i.test(url)) throw new Error("只支持网页 HTTP(S) 资源");
    const parsed = new URL(url);
    if (parsed.username || parsed.password)
      throw new Error("不支持网址内嵌凭据");
    const r = this.make(
      task,
      name || decodeURIComponent(parsed.pathname.split("/").pop() || "image"),
      "source",
      url,
    );
    try {
      const response = await session
        .fromPartition("persist:browsing")
        .fetch(url, {
          headers: { Referer: referer },
          signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
        });
      if (!response.ok)
        throw new Error(
          "下载失败 HTTP " + response.status + "，可返回网页重新获取链接",
        );
      const type = response.headers.get("content-type") || "";
      if (type.includes("text/html")) {
        await response.body?.cancel();
        throw new Error("返回的是网页，可能需要登录或链接已过期");
      }
      r.total = Number(response.headers.get("content-length")) || undefined;
      if (r.total && r.total > MAX) {
        await response.body?.cancel();
        throw new Error("单个资源上限为 64 MB");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("下载内容为空");
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          r.bytes += value.length;
          if (r.bytes > MAX) throw new Error("单个资源上限为 64 MB");
          chunks.push(value);
          this.changed();
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = Buffer.concat(chunks);
      const img = nativeImage.createFromBuffer(bytes);
      if (img.isEmpty())
        throw new Error("资源不是可读取的图片；未保存为 JPG，请检查原图链接");
      if (!extname(r.name) || /\.(php|aspx?|jsp)$/i.test(r.name)) {
        r.name = r.name.replace(/\.[^.]+$/, "") + ".png";
        r.path = join(dirname(r.path), r.id + "-" + r.name);
        writeFileSync(this.safe(r.path), img.toPNG(), { flag: "wx" });
      } else writeFileSync(this.safe(r.path), bytes, { flag: "wx" });
      Object.assign(r, img.getSize());
      r.status = "completed";
      this.persist();
      return this.list(task).find((f) => f.id === r.id);
    } catch (e) {
      r.status = signal.aborted ? "cancelled" : "failed";
      r.error = (e as Error).message;
      this.persist();
      return { file_id: r.id, status: r.status, error: r.error };
    }
  }
  capture(item: DownloadItem, task?: string) {
    let r: ResourceFile;
    try {
      r = this.make(
        task,
        item.getFilename(),
        task ? "source" : "download",
        item.getURL(),
      );
      item.setSavePath(this.safe(r.path));
    } catch (e) {
      item.cancel();
      this.error = (e as Error).message;
      this.changed();
      return;
    }
    item.on("updated", () => {
      r.bytes = item.getReceivedBytes();
      r.total = item.getTotalBytes();
      this.changed();
    });
    item.once("done", (_e, state) => {
      r.status = state;
      r.bytes = item.getReceivedBytes();
      if (state === "completed") this.inspect(r);
      else r.error = "下载未完成";
      this.persist();
    });
  }
  readImage(
    task: string,
    id: string,
    crop?: { x: number; y: number; width: number; height: number },
  ) {
    const r = this.get(id, task);
    if (r.status !== "completed") throw new Error("文件尚未下载完成");
    let img = nativeImage.createFromPath(this.safe(r.path));
    if (img.isEmpty()) throw new Error("文件不是支持的图片");
    const original = img.getSize();
    if (crop) {
      if (
        crop.x + crop.width > original.width ||
        crop.y + crop.height > original.height
      )
        throw new Error("裁剪范围超出原图");
      img = img.crop(crop);
    }
    const size = img.getSize();
    const scale = Math.min(1, 2400 / Math.max(size.width, size.height));
    if (scale < 1)
      img = img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      });
    return {
      file_id: id,
      name: r.name,
      original_size: original,
      crop: crop || null,
      sent_size: img.getSize(),
      data_url: "data:image/png;base64," + img.toPNG().toString("base64"),
    };
  }
  saveResult(task: string, name: string, text: string) {
    if (!/\.(md|txt|json|csv)$/i.test(name))
      throw new Error("结果支持 md、txt、json、csv");
    const r = this.make(task, name, "result");
    writeFileSync(this.safe(r.path), text, { flag: "wx" });
    r.status = "completed";
    r.bytes = Buffer.byteLength(text);
    this.persist();
    return { file_id: r.id, name: r.name, status: r.status };
  }
  progress(task: string, text?: string) {
    const dir = this.taskDir(task);
    this.directory(dir);
    const p = this.safe(join(dir, "progress.json"));
    if (text !== undefined) {
      writeFileSync(
        p,
        JSON.stringify({ updated: Date.now(), notes: text }, null, 2),
      );
      return { saved: true };
    }
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { notes: "" };
  }
  readText(task: string, id: string, offset = 0) {
    const r = this.get(id, task);
    if (r.kind !== "result" || r.status !== "completed")
      throw new Error("只读取已保存的文本结果");
    const text = readFileSync(this.safe(r.path), "utf8");
    return {
      file_id: id,
      text: text.slice(offset, offset + 18000),
      next_offset: offset + 18000 < text.length ? offset + 18000 : null,
    };
  }
  import(task: string, source: string) {
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.size > MAX)
      throw new Error("请选择不超过 64 MB 的图片");
    const img = nativeImage.createFromPath(source);
    if (img.isEmpty()) throw new Error("不是支持的图片");
    const r = this.make(task, basename(source), "source");
    copyFileSync(source, this.safe(r.path), constants.COPYFILE_EXCL);
    r.status = "completed";
    r.bytes = stat.size;
    Object.assign(r, img.getSize());
    this.persist();
    return r.id;
  }
  async open(id: string, folder = false) {
    const r = this.get(id);
    const p = this.safe(r.path);
    if (folder) {
      shell.showItemInFolder(p);
      return;
    }
    if (r.status !== "completed") throw new Error("文件尚未完成");
    if (!/\.(png|jpe?g|webp|gif|bmp|txt|md|json|csv)$/i.test(r.name))
      throw new Error("请在所在目录中手动打开此类型文件");
    const error = await shell.openPath(p);
    if (error) throw new Error(error);
  }
  folder(task?: string) {
    this.ready();
    return shell.openPath(
      this.directory(task ? this.taskDir(task) : "Downloads"),
    );
  }
}
