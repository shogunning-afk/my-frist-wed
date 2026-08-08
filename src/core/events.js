// Minimal pub/sub bus. Systems (physics, combat, audio, FX, AI) never call each
// other directly -- they publish facts and subscribe to the ones they care
// about. That is what lets an unexpected interaction (an AI boulder shattering
// another enemy's chassis) produce full damage, sound and debris for free.

export class Bus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    // Iterate a snapshot: handlers are allowed to unsubscribe during dispatch.
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}
