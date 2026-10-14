import type { MouseInputEvent } from "electron";

// Right-drag gestures. Small movements remain ordinary context-menu clicks.
export class MouseGesture {
  constructor(
    private feedback: (
      phase: string,
      x: number,
      y: number,
      path: string,
    ) => void = () => {},
  ) {}
  active = false;
  private x = 0;
  private y = 0;
  private path = "";
  cancel() {
    if (this.active) this.feedback("cancel", 0, 0, "");
    this.active = false;
    this.path = "";
  }
  handle(input: MouseInputEvent): { consume: boolean; action?: string } {
    if (input.type === "mouseDown") {
      this.cancel();
      if (input.button === "right") {
        this.active = true;
        this.x = input.x;
        this.y = input.y;
        this.feedback("start", input.x, input.y, "");
      }
    }
    if (!this.active) return { consume: false };
    if (input.type === "mouseLeave") {
      this.cancel();
      return { consume: false };
    }
    if (input.type === "mouseMove" || input.type === "mouseUp") {
      const dx = input.x - this.x,
        dy = input.y - this.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 28) {
        const direction =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "R"
              : "L"
            : dy > 0
              ? "D"
              : "U";
        if (!this.path.endsWith(direction)) this.path += direction;
        this.x = input.x;
        this.y = input.y;
      }
    }
    const consume = this.path.length > 0;
    if (input.type === "mouseUp" && input.button === "right") {
      const action = this.path;
      this.active = false;
      this.path = "";
      this.feedback("end", input.x, input.y, action);
      return { consume, action };
    }
    if (input.type === "mouseMove")
      this.feedback("move", input.x, input.y, this.path);
    return { consume };
  }
}

// Executed in the page's isolated world; no page scripts or Node access needed.
export function paintGesture(
  phase: string,
  x: number,
  y: number,
  label: string,
) {
  const w = window as any;
  let state = w.__agentBrowserGesture;
  if (phase === "cancel" || phase === "start") {
    if (state) {
      clearTimeout(state.timer);
      state.host.remove();
    }
    w.__agentBrowserGesture = undefined;
    if (phase === "cancel") return;
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
    host.setAttribute("aria-hidden", "true");
    const shadow = host.attachShadow({ mode: "closed" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.cssText =
      "position:absolute;width:100%;height:100%;overflow:hidden;pointer-events:none";
    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline",
    );
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#1683ff");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.append(line);
    const tip = document.createElement("div");
    tip.style.cssText =
      "position:absolute;left:50%;bottom:32px;transform:translateX(-50%);padding:10px 18px;border:1px solid #dbe3ec;border-radius:10px;background:rgba(248,250,253,.96);color:#26364a;font:500 14px/20px 'Segoe UI','Microsoft YaHei',sans-serif;box-shadow:0 4px 16px #172b4d18;white-space:nowrap;display:none;pointer-events:none";
    shadow.append(svg, tip);
    document.documentElement.append(host);
    state = w.__agentBrowserGesture = {
      host,
      line,
      tip,
      points: [`${x},${y}`],
      timer: undefined,
    };
    // Cleanup even if mouse release happens outside the native view.
    state.timer = setTimeout(() => host.remove(), 15000);
  }
  if (!state) return;
  if (phase === "move") {
    state.points.push(`${x},${y}`);
    if (state.points.length > 2000) state.points.splice(1, 1);
    state.line.setAttribute("points", state.points.join(" "));
    state.line.style.display = label ? "" : "none";
    state.tip.textContent = label;
    state.tip.style.display = label ? "block" : "none";
    clearTimeout(state.timer);
    state.timer = setTimeout(() => state.host.remove(), 15000);
  }
  if (phase === "end") {
    state.line.style.display = "none";
    state.tip.textContent = label;
    clearTimeout(state.timer);
    if (!label) state.host.remove();
    else state.timer = setTimeout(() => state.host.remove(), 700);
  }
}
