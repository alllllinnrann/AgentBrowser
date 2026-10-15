import React from "react";
import type { Message } from "../shared/types";
import { Icon } from "./icons";

// Tool payloads stay in conversation storage; the chat only renders a presentation summary.
export function ToolActivity({
  messages,
  labels,
}: {
  messages: Message[];
  labels: Record<string, string>;
}) {
  const actions = new Map<
    string,
    { label: string; count: number; failed: number }
  >();
  let failures = 0;
  for (const message of messages) {
    const [name, ...body] = message.content.split("\n");
    let failed = false;
    try {
      failed = Boolean(JSON.parse(body.join("\n"))?.error);
    } catch {
      failed = /"error"\s*:/.test(body.join("\n"));
    }
    if (failed) failures++;
    const entry = actions.get(name) ?? {
      label: labels[name] || "网页操作",
      count: 0,
      failed: 0,
    };
    entry.count++;
    if (failed) entry.failed++;
    actions.set(name, entry);
  }
  return (
    <details className="activity-group">
      <summary>
        <Icon name={failures ? "alert" : "check"} size={14} />
        <span>
          {messages.length} 项操作
          {failures ? ` · ${failures} 项未成功` : "已完成"}
        </span>
        <Icon name="chevron" size={12} />
      </summary>
      <div className="activity-list">
        {[...actions.entries()].map(([name, action]) => (
          <div className="activity-row" key={name}>
            <Icon name={action.failed ? "alert" : "check"} size={12} />
            <span>{action.label}</span>
            <small>
              {action.failed ? `${action.failed} 次未成功 · ` : ""}
              {action.count} 次
            </small>
          </div>
        ))}
      </div>
    </details>
  );
}
