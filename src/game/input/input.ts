// One action model for keyboard, touch and gamepad.
//
// Keyboard uses relative steering (left/right turn the car or the walker).
// Touch and gamepad sticks are analog: the stick gives an absolute direction.

export interface InputFrame {
  /** Relative controls, -1..1 / 0..1 */
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  /** Analog stick (screen space, y down). Null when no stick is in use. */
  stick: { x: number; y: number } | null;
  fire: boolean;
  /** Edge-triggered this frame */
  action: boolean;
  map: boolean;
  pause: boolean;
}

export const emptyFrame = (): InputFrame => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  stick: null,
  fire: false,
  action: false,
  map: false,
  pause: false,
});

const KEYS: Record<string, string> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'action',
  KeyE: 'action',
  KeyF: 'action',
  Space: 'fire',
  ControlLeft: 'fire',
  ShiftLeft: 'handbrake',
  ShiftRight: 'handbrake',
  KeyM: 'map',
  Escape: 'pause',
  KeyP: 'pause',
};

export const keyAction = (code: string): string | undefined => KEYS[code];

/** Touch state written by the on-screen controls. */
export interface TouchState {
  stick: { x: number; y: number } | null;
  gas: boolean;
  brake: boolean;
  fire: boolean;
  action: boolean;
}

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  readonly touch: TouchState = { stick: null, gas: false, brake: false, fire: false, action: false };
  private touchActionLatch = false;
  private padButtons: boolean[] = [];
  enabled = true;

  keyDown(code: string): boolean {
    const a = keyAction(code);
    if (!a) return false;
    if (!this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
    return true;
  }

  keyUp(code: string): boolean {
    const a = keyAction(code);
    if (!a) return false;
    this.held.delete(a);
    return true;
  }

  releaseAll() {
    this.held.clear();
    this.pressed.clear();
    this.touch.stick = null;
    this.touch.gas = this.touch.brake = this.touch.fire = this.touch.action = false;
  }

  /** Builds this tick's frame and clears edge-triggered presses. */
  read(pad: Gamepad | null = null): InputFrame {
    const f = emptyFrame();
    const h = this.held;
    f.steer = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
    f.throttle = h.has('up') ? 1 : 0;
    f.brake = h.has('down') ? 1 : 0;
    f.handbrake = h.has('handbrake');
    f.fire = h.has('fire');
    f.action = this.pressed.has('action');
    f.map = this.pressed.has('map');
    f.pause = this.pressed.has('pause');
    this.pressed.clear();

    const t = this.touch;
    if (t.stick && Math.hypot(t.stick.x, t.stick.y) > 0.2) f.stick = { ...t.stick };
    if (t.gas) f.throttle = 1;
    if (t.brake) f.brake = 1;
    if (t.fire) f.fire = true;
    if (t.action && !this.touchActionLatch) f.action = true;
    this.touchActionLatch = t.action;

    if (pad) this.readPad(pad, f);
    if (!this.enabled) return emptyFrame();
    return f;
  }

  private readPad(pad: Gamepad, f: InputFrame) {
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (Math.hypot(ax, ay) > 0.25) f.stick = { x: ax, y: ay };
    const b = (i: number) => pad.buttons[i]?.pressed ?? false;
    const v = (i: number) => pad.buttons[i]?.value ?? 0;
    // standard mapping: 0 A, 1 B, 2 X, 3 Y, 6 LT, 7 RT, 8 Back, 9 Start, 12–15 d-pad
    f.throttle = Math.max(f.throttle, v(7), b(0) ? 1 : 0);
    f.brake = Math.max(f.brake, v(6));
    if (b(2) || b(5)) f.fire = true;
    if (b(14)) f.steer = -1;
    if (b(15)) f.steer = 1;
    if (b(12)) f.throttle = 1;
    if (b(13)) f.brake = 1;
    const edge = (i: number) => b(i) && !this.padButtons[i];
    if (edge(3) || edge(1)) f.action = true;
    if (edge(8)) f.map = true;
    if (edge(9)) f.pause = true;
    this.padButtons = pad.buttons.map((x) => x.pressed);
  }
}
