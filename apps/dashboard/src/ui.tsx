/** Primitivas visuales y helpers de formato. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
      <span className="switch-track" data-on={checked}>
        <span className="switch-knob" />
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      {label ? <span className="small">{label}</span> : null}
    </label>
  );
}

type PillTone = 'mint' | 'rose' | 'lav' | 'warn' | 'danger' | 'ok' | 'grey';

export function Pill({ tone = 'grey', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Card({
  title,
  actions,
  children,
  pad = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className="card">
      {title || actions ? (
        <header
          className="row"
          style={{ padding: '13px 16px 0', alignItems: 'baseline', gap: 10 }}
        >
          {title ? <h3 className="card-title" style={{ margin: 0 }}>{title}</h3> : null}
          <span className="grow" />
          {actions}
        </header>
      ) : null}
      <div className={pad ? 'card-pad' : undefined}>{children}</div>
    </section>
  );
}

export function Empty({ glyph = '🧁', children }: { glyph?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-glyph">{glyph}</span>
      {children}
    </div>
  );
}

/** Avisos breves, sin dependencias. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const node = message ? <div className="toast">{message}</div> : null;
  return { show, node };
}

// ------------------------------------------------------------------ formato

export const money = (value: number): string =>
  `$${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export const CHANNEL_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

/**
 * Con qué comparar dos categorías para saber si son la misma.
 *
 * Las que vienen de fábrica están escritas como slug ('mini-tortas') y las que
 * carga el local están escritas como se leen ("Mini tortas"). Sirve para no
 * ofrecerle crear una categoría que ya existe con otra ortografía: el servidor
 * las une igual, pero el panel tiene que poder decirlo ANTES de guardar.
 *
 * Es el gemelo de `claveDeCategoria` del servidor, y tiene que dar lo mismo.
 */
export const claveCategoria = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Cómo se muestra una categoría. Las que crea el local ya vienen legibles. */
export const CATEGORY_LABEL: Record<string, string> = {
  cookies: 'Cookies',
  muffins: 'Muffins',
  'mini-tortas': 'Mini tortas',
  cuadrados: 'Cuadrados de la felicidad',
  alfajores: 'Alfajores',
  tabletas: 'Tabletas rellenas',
  saladito: 'Lo saladito',
  tortas: 'Tortas y tartas',
  desayunos: 'Desayunos y boxes',
  cursos: 'Cursos',
  merch: 'Merchandising',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  confirmado: 'Confirmado',
  'en-preparacion': 'En preparación',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const ORDER_STATUS_TONE: Record<string, PillTone> = {
  borrador: 'warn',
  confirmado: 'mint',
  'en-preparacion': 'lav',
  listo: 'ok',
  entregado: 'grey',
  cancelado: 'danger',
};

export const DELIVERY_LABEL: Record<string, string> = {
  'retira-local': 'Retira en el local',
  'uber-cliente': 'Uber del cliente',
  'cadete-miska': 'Cadete de Miska',
};
