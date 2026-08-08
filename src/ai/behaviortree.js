// A tiny behaviour tree. Nodes are plain objects with a tick(bb, dt) method
// returning one of three statuses. Trees are instantiated per agent so that
// stateful nodes (cooldowns, running sequences) never leak between enemies.

export const SUCCESS = 'success';
export const FAILURE = 'failure';
export const RUNNING = 'running';

/**
 * Reactive sequence: re-evaluates every child from the start on each tick, so
 * guard conditions keep being checked while a later child is still running.
 * This matters -- a "chase the player" action must stop the instant the
 * "player exists and is visible" condition in front of it stops holding.
 */
export function sequence(...children) {
  return {
    kind: 'sequence',
    tick(bb, dt) {
      for (let i = 0; i < children.length; i++) {
        const status = children[i].tick(bb, dt);
        if (status === RUNNING) return RUNNING;
        if (status === FAILURE) return FAILURE;
      }
      return SUCCESS;
    },
  };
}

/** Run children in order; stop at the first that succeeds or is running. */
export function selector(...children) {
  return {
    kind: 'selector',
    tick(bb, dt) {
      for (const child of children) {
        const status = child.tick(bb, dt);
        if (status !== FAILURE) return status;
      }
      return FAILURE;
    },
  };
}

/** Leaf that passes when the predicate is true. */
export function condition(name, fn) {
  return { kind: 'condition', name, tick: (bb) => (fn(bb) ? SUCCESS : FAILURE) };
}

/**
 * Leaf that does something. The function may return a status; returning
 * undefined is treated as RUNNING, which is the common case for steering.
 */
export function action(name, fn) {
  return {
    kind: 'action', name,
    tick(bb, dt) {
      bb.activeAction = name;
      const r = fn(bb, dt);
      return r === undefined ? RUNNING : r;
    },
  };
}

export function invert(child) {
  return {
    kind: 'invert',
    tick(bb, dt) {
      const s = child.tick(bb, dt);
      if (s === SUCCESS) return FAILURE;
      if (s === FAILURE) return SUCCESS;
      return RUNNING;
    },
  };
}

/** Gate a subtree behind a recharge timer. */
export function cooldown(seconds, child) {
  return {
    kind: 'cooldown',
    timer: Math.random() * seconds,
    tick(bb, dt) {
      this.timer -= dt;
      if (this.timer > 0) return FAILURE;
      const s = child.tick(bb, dt);
      if (s === SUCCESS || s === FAILURE) this.timer = seconds;
      return s;
    },
  };
}

/** Keep ticking a subtree for a fixed duration once entered. */
export function commit(seconds, child) {
  return {
    kind: 'commit',
    remaining: 0,
    active: false,
    tick(bb, dt) {
      if (!this.active) { this.active = true; this.remaining = seconds; }
      this.remaining -= dt;
      const s = child.tick(bb, dt);
      if (this.remaining <= 0 || s === FAILURE) {
        this.active = false;
        return s === FAILURE ? FAILURE : SUCCESS;
      }
      return RUNNING;
    },
  };
}

export function always(status, child) {
  return { kind: 'always', tick(bb, dt) { child.tick(bb, dt); return status; } };
}
