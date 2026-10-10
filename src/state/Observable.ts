/** Minimal observerbar verdi. Brukes av både laptop-UI og (senere) VR-håndleddsmeny. */
export class Observable<T> {
  private listeners = new Set<(value: T, prev: T) => void>();
  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(next: T): void {
    if (Object.is(next, this.current)) return;
    const prev = this.current;
    this.current = next;
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(listener: (value: T, prev: T) => void, fireNow = false): () => void {
    this.listeners.add(listener);
    if (fireNow) listener(this.current, this.current);
    return () => this.listeners.delete(listener);
  }
}
