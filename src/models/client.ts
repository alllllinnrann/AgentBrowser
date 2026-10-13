import type { WireMessage, Settings } from "../shared/types";
export async function completion(
  settings: Settings,
  key: string,
  messages: WireMessage[],
  tools: any[],
  signal: AbortSignal,
  onText: (s: string) => void,
  fetcher: typeof fetch = fetch,
) {
  const timeout = AbortSignal.timeout(180000);
  const combined = AbortSignal.any([signal, timeout]);
  const res = await fetcher(
    settings.baseUrl.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        max_tokens: settings.outputLimit,
        ...(tools.length
          ? { tools, tool_choice: "auto", parallel_tool_calls: false }
          : {}),
      }),
      signal: combined,
    },
  );
  if (!res.ok) {
    const body = (await res.text()).slice(0, 1200);
    throw new Error(`模型接口 ${res.status}：${body}`);
  }
  if (!res.body) throw new Error("模型接口没有返回正文");
  if (res.headers.get("content-type")?.includes("application/json")) {
    const data = (await res.json()) as any;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("接口返回格式不兼容 Chat Completions");
    onText(msg.content || "");
    return msg;
  }
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    content = "",
    finish = "";
  const calls: any[] = [];
  function line(s: string) {
    if (!s.startsWith("data:")) return;
    const raw = s.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    const data = JSON.parse(raw);
    if (data.error) throw new Error(data.error.message || "模型流出错");
    const choice = data.choices?.[0];
    if (!choice) return;
    finish = choice.finish_reason || finish;
    const d = choice.delta || {};
    if (typeof d.content === "string") {
      content += d.content;
      onText(content);
    }
    for (const t of d.tool_calls || []) {
      const i = t.index ?? 0;
      calls[i] ??= {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (t.id) calls[i].id = t.id;
      if (t.function?.name) calls[i].function.name += t.function.name;
      if (t.function?.arguments)
        calls[i].function.arguments += t.function.arguments;
    }
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let p;
      while ((p = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, p).trimEnd());
        buffer = buffer.slice(p + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trim());
  } finally {
    reader.releaseLock();
  }
  if (finish === "length" && calls.length)
    throw new Error("工具参数超过输出限制，请提高输出预算后重试");
  if (!content && !calls.length)
    throw new Error("模型返回空内容，请检查模型名和工具调用兼容性");
  return {
    role: "assistant",
    content: content || null,
    ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}),
  };
}
