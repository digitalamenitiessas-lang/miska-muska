/**
 * Bus de eventos en proceso. El pipeline publica; la capa HTTP se suscribe y
 * los reenvía al panel por SSE. `core/` no conoce HTTP.
 */

import type { Conversation, Order, StoredMessage } from '../types/domain.js';

export type AppEvent =
  | { type: 'message'; conversationId: string; message: StoredMessage }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'order'; order: Order }
  | { type: 'typing'; conversationId: string; on: boolean }
  | { type: 'channel-status'; channel: string; ok: boolean; detail?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; data?: unknown };

type Listener = (event: AppEvent) => void;

class EventBus {
  #listeners = new Set<Listener>();
  /** Anillo de los últimos eventos, para que un panel recién abierto tenga contexto. */
  #recent: AppEvent[] = [];

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: AppEvent): void {
    this.#recent.push(event);
    if (this.#recent.length > 200) this.#recent.shift();
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Un panel desconectado no debe romper el pipeline.
      }
    }
  }

  recent(): AppEvent[] {
    return [...this.#recent];
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}

export const bus = new EventBus();

export function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line, data ?? '');
  else if (level === 'warn') console.warn(line, data ?? '');
  else console.log(line, data ?? '');
  bus.emit({ type: 'log', level, message, data });
}
