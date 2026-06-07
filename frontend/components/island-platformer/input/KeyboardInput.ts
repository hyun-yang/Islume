// Keyboard input for the platformer.
// Hold-state booleans (left, right, jumpHeld) drive continuous behaviour.
// Edge events (jumpPressed, jumpReleased) are consumed once per frame so
// jump-buffer and jump-cut work without missing frames.

export class KeyboardInput {
  left = false;
  right = false;
  jumpHeld = false;

  private _jumpPressed = false;
  private _jumpReleased = false;
  private _enabled = true;
  private _detach: (() => void) | null = null;

  consumeJumpPressed(): boolean {
    if (this._jumpPressed) { this._jumpPressed = false; return true; }
    return false;
  }
  consumeJumpReleased(): boolean {
    if (this._jumpReleased) { this._jumpReleased = false; return true; }
    return false;
  }

  // External (e.g. touch) can set the move axis without a key event.
  setMoveAxis(dir: -1 | 0 | 1): void {
    this.left  = dir === -1;
    this.right = dir === 1;
  }
  triggerJumpPressed(): void {
    if (!this.jumpHeld) this._jumpPressed = true;
    this.jumpHeld = true;
  }
  triggerJumpReleased(): void {
    if (this.jumpHeld) this._jumpReleased = true;
    this.jumpHeld = false;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this.left = false; this.right = false;
      this.jumpHeld = false;
      this._jumpPressed = false;
      this._jumpReleased = false;
    }
  }

  attach(): void {
    if (this._detach) return;
    const isEditable = (e: Event): boolean => {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    };
    const onDown = (e: KeyboardEvent) => {
      if (!this._enabled || isEditable(e)) return;
      switch (e.code) {
        case "ArrowLeft": case "KeyA":
          this.left = true; break;
        case "ArrowRight": case "KeyD":
          this.right = true; break;
        case "Space": case "ArrowUp": case "KeyZ": case "KeyW":
          if (!this.jumpHeld) this._jumpPressed = true;
          this.jumpHeld = true;
          e.preventDefault();
          break;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (!this._enabled) return;
      switch (e.code) {
        case "ArrowLeft": case "KeyA":
          this.left = false; break;
        case "ArrowRight": case "KeyD":
          this.right = false; break;
        case "Space": case "ArrowUp": case "KeyZ": case "KeyW":
          if (this.jumpHeld) this._jumpReleased = true;
          this.jumpHeld = false;
          break;
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    this._detach = () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }

  detach(): void {
    this._detach?.();
    this._detach = null;
  }
}
