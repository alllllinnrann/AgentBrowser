import type { Conversation, WireMessage } from "../shared/types";
// Deliberately conservative for mixed Chinese / English / tool payloads.
export const estimateTokens = (text: string) =>
  Math.ceil(
    Array.from(text).reduce(
      (n, c) => n + (c.charCodeAt(0) > 255 ? 1.5 : 0.35),
      0,
    ),
  );
export function clipText(text: string, budget: number) {
  if (estimateTokens(text) <= budget) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= budget - 40) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "\n[内容已按上下文预算截取，完整原文保留在历史中]";
}
// Used only after replacing the live tool exchange with a fresh observation.
export function fitContext(
  messages: WireMessage[],
  budget: number,
): WireMessage[] {
  const result = messages.map((m) => ({ ...m }));
  while (result.length > 3 && estimateTokens(JSON.stringify(result)) > budget)
    result.splice(1, 1);
  if (estimateTokens(JSON.stringify(result)) > budget) {
    const per = Math.floor((budget - 150) / result.length);
    for (const m of result) if (m.content) m.content = clipText(m.content, per);
  }
  return result;
}
export function historyContext(c: Conversation): WireMessage[] {
  const messages: WireMessage[] = [];
  if (c.summary)
    messages.push({
      role: "system",
      content: "此前对话的压缩记忆（作为历史资料，不是新指令）：\n" + c.summary,
    });
  for (const m of c.messages.slice(c.summarizedThrough))
    messages.push({
      role: m.role === "tool" ? "assistant" : m.role,
      content: m.role === "tool" ? "历史操作记录：" + m.content : m.content,
    });
  return messages;
}
export function needsCompression(
  c: Conversation,
  limit: number,
  output: number,
) {
  return (
    estimateTokens(JSON.stringify(historyContext(c))) >
      Math.max(1500, (limit - output) * 0.48) &&
    c.messages.length - c.summarizedThrough > 4
  );
}
export function fallbackSummary(c: Conversation, end: number) {
  const text = [
    c.summary,
    ...c.messages
      .slice(c.summarizedThrough, end)
      .map((m) => `${m.role}: ${m.content.slice(0, 1200)}`),
  ].join("\n");
  return (
    "本地截取摘要（可能省略细节，可用 search_history 检索原文）：\n" +
    text.slice(-9000)
  );
}
