// Raw device state. Nothing here knows what a key *means* -- the player
// controller maps this into the same Intent structure the AI produces.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this.mouse = { x: 0, y: 0 };      // screen space (CSS pixels)
    this.world = { x: 0, y: 0 };      // filled in by the camera each frame
    this.buttons = new Set();
    this.clicked = new Set();
    this.wheel = 0;
    this.enabled = true;

    const code = (e) => e.code;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Keep browser shortcuts working, but stop the page scrolling under us.
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(code(e));
      this.pressedThisFrame.add(code(e));
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(code(e));
      this.releasedThisFrame.add(code(e));
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });

    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.pressedThisFrame.has(code); }
  released(code) { return this.releasedThisFrame.has(code); }
  mouseDown(btn) { return this.buttons.has(btn); }
  mouseClicked(btn) { return this.clicked.has(btn); }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.clicked.clear();
    this.wheel = 0;
  }
}
