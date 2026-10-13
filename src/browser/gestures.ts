import type { MouseInputEvent } from "electron";

// Right-drag gestures. Small movements remain ordinary context-menu clicks.
export class MouseGesture {
  active = false;
  private x = 0;
  private y = 0;
  private path = "";
  cancel() {
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
      this.cancel();
      return { consume, action };
    }
    return { consume };
  }
}
