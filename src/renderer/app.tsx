import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { State, Settings, Schedule } from "../shared/types";
import { Icon, IconButton } from "./icons";
import "./style.css";
const detached = new URLSearchParams(location.search).has("chat");
const toolLabels: Record<string, string> = {
  observe_page: "读取网页",
  list_tabs: "查看标签",
  open_tab: "打开网页",
  navigate: "导航",
  click: "点击",
  fill: "输入",
  press_key: "按键",
  scroll: "滚动",
  wait_for: "等待",
  find_in_page: "查找",
  search_history: "检索历史",
};
function App() {
  const [s, setS] = useState<State | null>(null),
    [url, setUrl] = useState(""),
    [input, setInput] = useState(""),
    [modal, setModal] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const address = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null);
  const call = async (command: string, payload?: any) => {
    try {
      return await window.host.invoke(command, payload);
    } catch (e) {
      setNotice(
        String((e as Error).message).replace(
          /^Error invoking remote method 'command': Error: /,
          "",
        ),
      );
      return null;
    }
  };
  useEffect(() => {
    window.host.invoke("state").then(setS);
    const off = window.host.onState(setS),
      focus = window.host.onFocusAddress(() => {
        address.current?.focus();
        address.current?.select();
      });
    return () => {
      off();
      focus();
    };
  }, []);
  const tab = s?.tabs.find((t) => t.id === s.activeTab),
    chat = s?.conversations.find((c) => c.id === s.activeConversation);
  useEffect(() => {
    setUrl(tab?.url === "about:blank" ? "" : tab?.url || "");
  }, [tab?.url, tab?.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, s?.draft]);
  useEffect(() => {
    if (!detached) void call("overlay", !!modal);
  }, [modal]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!s)
    return (
      <div className="loading">
        <span className="spinner" />
      </div>
    );
  const target = s.tabs.find((t) => t.id === s.targetTab),
    ownRunning = s.running && s.runningConversation === chat?.id;
  const phaseText =
    toolLabels[s.phase.replace("正在操作 · ", "")] ||
    s.phase
      .replace("正在压缩旧上下文，原始记录仍保留", "压缩上下文")
      .replace("已停止，网页交还给你", "已停止")
      .replace("准备就绪", "就绪");
  const send = async () => {
    if (!input.trim() || s.running) return;
    const text = input;
    if (await call("send", text)) setInput("");
  };
  const drag = (e: React.PointerEvent) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      void call(
        "sidebar",
        Math.min(720, Math.max(320, window.innerWidth - ev.clientX)),
      );
    const up = () => {
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move as EventListener);
    el.addEventListener("pointerup", up);
  };
  return (
    <div
      className={detached ? "app detached" : "app"}
      style={{ "--side": s.sidebar + "px" } as React.CSSProperties}
    >
      {!detached && (
        <header>
          <div className="tabbar">
            <div className="app-mark" title="轻舟">
              <Icon name="agent" size={19} />
            </div>
            <div className="tabs">
              {s.tabs.map((t) => (
                <div
                  key={t.id}
                  className={"tab " + (t.id === s.activeTab ? "selected" : "")}
                >
                  <button title={t.url} onClick={() => call("selectTab", t.id)}>
                    {t.loading ? (
                      <span className="spinner" />
                    ) : (
                      <Icon name="globe" size={14} />
                    )}
                    <span>{t.title}</span>
                  </button>
                  <IconButton
                    className="close-tab"
                    icon="close"
                    label="关闭标签"
                    onClick={() => call("closeTab", t.id)}
                  />
                </div>
              ))}
            </div>
            <IconButton
              icon="plus"
              label="新标签 (Ctrl+T)"
              onClick={() => call("newTab")}
            />
          </div>
          <div className="toolbar">
            <IconButton icon="back" label="后退" onClick={() => call("back")} />
            <IconButton
              icon="forward"
              label="前进"
              onClick={() => call("forward")}
            />
            <IconButton
              icon="reload"
              label="刷新"
              onClick={() => call("reload")}
            />
            <form
              className="address"
              onSubmit={(e) => {
                e.preventDefault();
                call("navigate", url);
              }}
            >
              <Icon
                name={tab?.url.startsWith("https:") ? "lock" : "search"}
                size={14}
              />
              <input
                ref={address}
                aria-label="地址或搜索"
                placeholder="搜索必应或输入网址"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </form>
            {tab?.zoom !== 1 && (
              <button
                className="zoom"
                title="重置缩放"
                onClick={() => call("zoom", 1)}
              >
                {Math.round((tab?.zoom || 1) * 100)}%
              </button>
            )}
            <IconButton
              icon="panel"
              label={s.sidebar ? "收起 Agent" : "显示 Agent"}
              aria-pressed={!!s.sidebar}
              onClick={() => call("sidebar", s.sidebar ? 0 : 416)}
            />
          </div>
        </header>
      )}
      {!detached && (
        <main className="browser-placeholder">
          {tab?.error && (
            <div className="page-error">
              <Icon name="alert" />
              <span>{tab.error}</span>
              <IconButton
                icon="reload"
                label="重试加载"
                onClick={() => call("reload")}
              />
            </div>
          )}
        </main>
      )}
      {(s.sidebar > 0 || detached) && (
        <aside>
          {!detached && (
            <div
              className="resize-handle"
              onPointerDown={drag}
              title="调整宽度"
            />
          )}
          <div className="agent-head">
            <strong>Agent</strong>
            <div className="head-actions">
              <IconButton
                icon="history"
                label="历史对话"
                onClick={() => setModal("history")}
              />
              <IconButton
                icon="clock"
                label="定时任务"
                onClick={() => setModal("schedules")}
              />
              <IconButton
                icon="settings"
                label="设置"
                onClick={() => setModal("settings")}
              />
              <span className="divider" />
              <IconButton
                icon="external"
                label="独立窗口"
                onClick={() => call("chatWindow")}
              />
              <IconButton
                icon="plus"
                label="新建对话"
                onClick={() => call("newChat")}
              />
            </div>
          </div>
          <div className="conversation-row">
            <select
              aria-label="选择对话"
              value={s.activeConversation}
              onChange={(e) => call("selectChat", e.target.value)}
            >
              {s.conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div
            className={"target " + (s.running ? "active" : "")}
            title={
              s.running
                ? "任务绑定网页：" + target?.url
                : "当前网页：" + tab?.url
            }
          >
            <Icon name={s.running ? "link" : "globe"} size={14} />
            <span>{s.running ? target?.title || "已关闭" : tab?.title}</span>
            {s.running && (
              <IconButton
                icon="hand"
                label="人工接管"
                onClick={() => call("stop")}
              />
            )}
          </div>
          <div className="messages">
            {!chat?.messages.length && (
              <div className="empty-chat">
                <Icon name="agent" size={28} />
                <div className="quick-actions">
                  <button onClick={() => setInput("总结当前页面的主要内容")}>
                    <Icon name="document" size={16} />
                    总结网页
                  </button>
                  <button
                    onClick={() => setInput("帮我草拟一条合适的回复，不要发布")}
                  >
                    <Icon name="message" size={16} />
                    草拟回复
                  </button>
                </div>
              </div>
            )}
            {chat?.messages.map((m) =>
              m.role === "tool" ? (
                <details
                  className={
                    "tool-message " +
                    (m.content.includes('"error"') ? "failed" : "")
                  }
                  key={m.id}
                >
                  <summary>
                    <Icon
                      name={m.content.includes('"error"') ? "alert" : "check"}
                      size={14}
                    />
                    <span>
                      {toolLabels[m.content.split("\n")[0]] ||
                        m.content.split("\n")[0]}
                    </span>
                    <Icon name="chevron" size={13} />
                  </summary>
                  <pre>{m.content.split("\n").slice(1).join("\n")}</pre>
                </details>
              ) : (
                <div className={"message " + m.role} key={m.id}>
                  <div className="message-label">
                    <Icon
                      name={m.role === "user" ? "user" : "agent"}
                      size={14}
                    />
                    <time>
                      {new Date(m.time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="message-body">{m.content}</div>
                </div>
              ),
            )}
            {ownRunning && s.draft && (
              <div className="message assistant">
                <div className="message-label">
                  <Icon name="agent" size={14} />
                </div>
                <div className="message-body">
                  {s.draft}
                  <span className="caret" />
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="composer-wrap">
            {(s.running || !!chat?.messages.length) && (
              <div className="phase">
                <span className={s.running ? "spinner" : "status-light"} />
                <span>{phaseText}</span>
                {!s.running && (
                  <IconButton
                    icon="reload"
                    label="重试上条指令"
                    onClick={() => call("retry")}
                  />
                )}
              </div>
            )}
            <div className="composer">
              <textarea
                aria-label="给 Agent 的指令"
                title="Enter 发送 · Shift+Enter 换行"
                placeholder="输入指令…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="composer-bottom">
                <button
                  className="model-badge"
                  title="模型设置"
                  onClick={() => setModal("settings")}
                >
                  {s.settings.model}
                  <Icon name="down" size={12} />
                </button>
                <div className="composer-actions">
                  <button
                    className={
                      "memory-button " + (chat?.summary ? "compressed" : "")
                    }
                    title={
                      chat?.summary
                        ? "查看压缩记忆"
                        : "上下文上限 " +
                          Math.round(s.settings.contextLimit / 1000) +
                          "k"
                    }
                    aria-label="上下文与记忆"
                    onClick={() => setModal("memory")}
                  >
                    <Icon name="memory" size={15} />
                    <span>{Math.round(s.settings.contextLimit / 1000)}k</span>
                  </button>
                  {s.running ? (
                    <IconButton
                      icon="stop"
                      label="停止"
                      className="send-button"
                      onClick={() => call("stop")}
                    />
                  ) : (
                    <IconButton
                      icon="send"
                      label="发送"
                      className="send-button"
                      disabled={!input.trim()}
                      onClick={send}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}
      {modal && (
        <div className="modal-shade">
          <section className={"modal " + (modal === "schedules" ? "wide" : "")}>
            <div className="modal-head">
              <h2>
                {
                  {
                    settings: "设置",
                    schedules: "定时任务",
                    history: "历史对话",
                    memory: "记忆",
                  }[modal]
                }
              </h2>
              <IconButton
                icon="close"
                label="关闭弹窗"
                onClick={() => setModal("")}
              />
            </div>
            {modal === "settings" && (
              <SettingsForm
                settings={s.settings}
                busy={busy}
                save={async (value) => {
                  setBusy(true);
                  const r = await call("settings", value);
                  if (r) setNotice("已保存");
                  setBusy(false);
                  return !!r;
                }}
                test={async () => {
                  setBusy(true);
                  const r = await call("testConnection");
                  if (r) setNotice("连接成功");
                  setBusy(false);
                }}
              />
            )}
            {modal === "schedules" && (
              <Schedules items={s.schedules} call={call} notify={setNotice} />
            )}
            {modal === "memory" && (
              <div className="memory-detail">
                <div className="memory-stat">
                  <Icon name="memory" />
                  <span>自动压缩</span>
                  <span className="badge">已开启</span>
                  <span>{Math.round(s.settings.contextLimit / 1000)}k</span>
                </div>
                {chat?.summary ? (
                  <pre>{chat.summary}</pre>
                ) : (
                  <div className="empty-small">暂无摘要</div>
                )}
              </div>
            )}
            {modal === "history" && (
              <div className="history">
                {s.conversations.map((c) => (
                  <div className="history-item" key={c.id}>
                    <button
                      onClick={() => {
                        call("selectChat", c.id);
                        setModal("");
                      }}
                    >
                      <strong>{c.title}</strong>
                      <small>{new Date(c.updated).toLocaleString()}</small>
                    </button>
                    <IconButton
                      icon="trash"
                      label="删除对话"
                      className="danger-text"
                      onClick={() => {
                        if (confirm("删除这个对话及其历史？"))
                          call("deleteChat", c.id);
                      }}
                    />
                  </div>
                ))}
                <div className="footer-actions">
                  <button
                    onClick={async () => {
                      const r = await call("export");
                      if (r) setNotice(r);
                    }}
                  >
                    <Icon name="download" size={16} />
                    导出
                  </button>
                  <IconButton
                    icon="folder"
                    label="打开数据文件夹"
                    onClick={() => call("dataFolder")}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {notice && (
        <div role="status" className="toast" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
    </div>
  );
}
function SettingsForm({
  settings,
  busy,
  save,
  test,
}: {
  settings: Settings;
  busy: boolean;
  save: (v: any) => Promise<boolean>;
  test: () => void;
}) {
  const [v, setV] = useState({ ...settings, apiKey: "", clearKey: false });
  const set = (k: string, value: any) => setV({ ...v, [k]: value });
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save(v))
          setV({
            ...v,
            apiKey: "",
            keySet: !v.clearKey && (!!v.apiKey || v.keySet),
            clearKey: false,
          });
      }}
    >
      <div className="settings-caption">
        OpenAI Compatible{" "}
        <span title="支持 Chat Completions；API 地址通常以 /v1 结尾。">
          <Icon name="info" size={14} />
        </span>
      </div>
      <label>
        API 地址
        <input
          required
          value={v.baseUrl}
          onChange={(e) => set("baseUrl", e.target.value)}
          placeholder="https://api.example.com/v1"
        />
      </label>
      <div className="form-grid">
        <label>
          模型名称
          <input
            required
            value={v.model}
            onChange={(e) => set("model", e.target.value)}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            placeholder={v.keySet ? "已保存 · 留空保持不变" : "API Key"}
            value={v.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
          />
        </label>
      </div>
      {v.keySet && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={v.clearKey}
            onChange={(e) => set("clearKey", e.target.checked)}
          />
          清除密钥
        </label>
      )}
      <div className="form-grid">
        <label>
          上下文上限
          <input
            type="number"
            min="16000"
            max="2000000"
            required
            value={v.contextLimit}
            onChange={(e) => set("contextLimit", +e.target.value)}
          />
        </label>
        <label>
          输出上限
          <input
            type="number"
            min="512"
            required
            value={v.outputLimit}
            onChange={(e) => set("outputLimit", +e.target.value)}
          />
        </label>
      </div>
      <label>
        最大步数
        <input
          type="number"
          min="1"
          max="200"
          value={v.maxSteps}
          onChange={(e) => set("maxSteps", +e.target.value)}
        />
      </label>
      <details>
        <summary>代理设置</summary>
        <div className="form-grid">
          <label>
            网页代理
            <input
              placeholder="留空使用系统代理"
              value={v.browserProxy}
              onChange={(e) => set("browserProxy", e.target.value)}
            />
          </label>
          <label>
            模型 API 代理
            <input
              placeholder="例如 http://127.0.0.1:7890"
              value={v.modelProxy}
              onChange={(e) => set("modelProxy", e.target.value)}
            />
          </label>
        </div>
      </details>
      <div className="footer-actions">
        <button type="button" disabled={busy} onClick={test}>
          测试连接
        </button>
        <button disabled={busy} className="primary">
          {busy ? "处理中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
function Schedules({
  items,
  call,
  notify,
}: {
  items: Schedule[];
  call: (c: string, p?: any) => Promise<any>;
  notify: (s: string) => void;
}) {
  const blank = {
    title: "",
    time: "10:00",
    url: "https://www.xiaoheihe.cn",
    prompt: "",
    enabled: true,
  };
  const [v, setV] = useState<any>(blank);
  return (
    <div className="schedules">
      <div className="schedule-note">
        <Icon name="clock" size={15} />
        <span>每日 · 本地时间</span>
        <span title="需要保持软件运行。新任务从明天开始；当天错过的任务在下次运行时补执行一次。">
          <Icon name="info" size={15} />
        </span>
      </div>
      <div className="schedule-layout">
        <div className="schedule-list">
          {!items.length && (
            <div className="empty-small">
              <Icon name="clock" size={28} />
              <span>暂无任务</span>
            </div>
          )}
          {items.map((s) => (
            <article className="schedule-card" key={s.id}>
              <div>
                <strong>{s.title}</strong>
                <span className="schedule-time">{s.time}</span>
              </div>
              <p>{s.prompt}</p>
              <small>{s.status}</small>
              <div className="schedule-actions">
                <button
                  className={"toggle " + (s.enabled ? "on" : "")}
                  role="switch"
                  aria-checked={s.enabled}
                  title={s.enabled ? "暂停任务" : "启用任务"}
                  aria-label={s.enabled ? "暂停任务" : "启用任务"}
                  onClick={() => call("toggleSchedule", s.id)}
                >
                  <span />
                </button>
                <IconButton
                  icon="play"
                  label="立即运行"
                  onClick={() => call("runSchedule", s.id)}
                />
                <IconButton
                  icon="edit"
                  label="编辑任务"
                  onClick={() => setV(s)}
                />
                <button
                  aria-label="删除任务"
                  title="删除任务"
                  className="icon-button danger-text"
                  onClick={() => {
                    if (confirm("删除此定时任务？"))
                      call("deleteSchedule", s.id);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </article>
          ))}
        </div>
        <form
          className="schedule-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("saveSchedule", v)) {
              setV(blank);
              notify("定时任务已保存");
            }
          }}
        >
          <h3>{v.id ? "编辑任务" : "新建任务"}</h3>
          <label>
            任务名称
            <input
              required
              placeholder="每日浏览社区"
              value={v.title}
              onChange={(e) => setV({ ...v, title: e.target.value })}
            />
          </label>
          <label>
            时间
            <input
              type="time"
              required
              value={v.time}
              onChange={(e) => setV({ ...v, time: e.target.value })}
            />
          </label>
          <label>
            开始网页
            <input
              required
              value={v.url}
              onChange={(e) => setV({ ...v, url: e.target.value })}
            />
          </label>
          <label>
            指令
            <textarea
              required
              rows={5}
              placeholder="输入任务指令…"
              value={v.prompt}
              onChange={(e) => setV({ ...v, prompt: e.target.value })}
            />
          </label>
          <p className="muted compact-note">
            <Icon name="info" size={14} />
            指令包含发布要求时，将实际提交。
          </p>
          <div className="footer-actions">
            {v.id && (
              <button type="button" onClick={() => setV(blank)}>
                取消编辑
              </button>
            )}
            <button className="primary">保存任务</button>
          </div>
        </form>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
