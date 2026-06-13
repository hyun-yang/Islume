import { Container, Sprite } from "pixi.js";

export class SpritePool {
  private container: Container;
  private pool: Sprite[] = [];
  private active = 0;

  constructor(container: Container) {
    this.container = container;
  }

  acquire(): Sprite {
    if (this.active < this.pool.length) {
      const s = this.pool[this.active];
      s.visible = true;
      this.active++;
      return s;
    }
    const s = new Sprite();
    this.pool.push(s);
    this.container.addChild(s);
    this.active++;
    return s;
  }

  releaseAll(): void {
    for (let i = 0; i < this.active; i++) {
      this.pool[i].visible = false;
    }
    this.active = 0;
  }

  destroy(): void {
    for (const s of this.pool) s.destroy();
    this.pool = [];
    this.active = 0;
  }
}
