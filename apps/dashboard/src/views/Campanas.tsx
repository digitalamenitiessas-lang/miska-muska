import { useCallback, useEffect, useState } from 'react';
import { api, type Campaign, type CampaignSku } from '../api';
import { Empty, Pill, Switch, money } from '../ui';

/**
 * Replica el control que el local ya hacía en planilla para el Día de la Madre:
 * stock total por caja, cuántas se comprometieron, cuántas quedan. La diferencia
 * es que acá el bot lee el stock disponible antes de prometer algo.
 *
 * LO QUE FALTABA, y se descubrió el 2 de octubre: de la campaña solo se podían
 * tocar el interruptor y los números de cada caja. El nombre, las fechas y el
 * pitch quedaban clavados desde el día que se creó, y las cajas no se podían
 * agregar ni sacar. Agus estuvo un rato buscando dónde editar la campaña del
 * Día de la Madre; no la encontraba porque no existía.
 *
 * Era peor que una molestia. La campaña vieja ofrecía productos del año pasado
 * y lo único que funcionaba era el interruptor, así que la única manera de que
 * no dijera algo falso era no prenderla.
 */
export function Campanas({ toast }: { toast: (text: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  /** La campaña que se está editando, si hay alguna. */
  const [editando, setEditando] = useState<string | null>(null);
  /** La campaña a la que se le está agregando una caja. */
  const [agregando, setAgregando] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns(await api.campaigns());
    } catch (err) {
      toast(`No pude cargar las campañas: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (campaign: Campaign, active: boolean) => {
    setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? { ...c, active } : c)));
    try {
      await api.setCampaignActive(campaign.id, active);
      toast(
        active
          ? `${campaign.name} activa: el bot ya la ofrece`
          : `${campaign.name} pausada: el bot deja de ofrecerla`,
      );
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
      void load();
    }
  };

  const saveSku = async (campaignId: string, sku: CampaignSku, patch: Partial<CampaignSku>) => {
    try {
      const next = await api.upsertSku(campaignId, { ...sku, ...patch });
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, skus: c.skus.map((s) => (s.id === next.id ? next : s)) }
            : c,
        ),
      );
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
    }
  };

  const guardarCampania = async (
    campaign: Campaign,
    datos: Pick<Campaign, 'name' | 'startsOn' | 'endsOn' | 'pitch'>,
  ) => {
    try {
      const next = await api.updateCampaign(campaign.id, datos);
      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...next, skus: c.skus } : c)),
      );
      setEditando(null);
      toast(
        campaign.active
          ? `${next.name} guardada. El bot ya la cuenta así.`
          : `${next.name} guardada. Sigue pausada.`,
      );
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
    }
  };

  const agregarCaja = async (campaign: Campaign, datos: NuevaCaja) => {
    try {
      const next = await api.upsertSku(campaign.id, {
        name: datos.name,
        price: datos.price,
        stockTotal: datos.stockTotal,
        stockUsed: 0,
        sortOrder: campaign.skus.length + 1,
      });
      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...c, skus: [...c.skus, next] } : c)),
      );
      setAgregando(null);
      toast(`${next.name} agregada`);
    } catch (err) {
      toast(`No pude agregarla: ${String(err)}`);
    }
  };

  const borrarCaja = async (campaign: Campaign, sku: CampaignSku) => {
    /*
      Se pregunta, y se dice qué se pierde. Si hay vendidas, el número de
      "usadas" se va con ella y es un dato que llevan a mano: no lo recupera
      nadie.
    */
    const ok = window.confirm(
      sku.stockUsed > 0
        ? `Borrar "${sku.name}" de ${campaign.name}?\n\nTiene ${sku.stockUsed} comprometidas ` +
            'anotadas y ese número se pierde.'
        : `Borrar "${sku.name}" de ${campaign.name}?`,
    );
    if (!ok) return;
    try {
      await api.deleteSku(campaign.id, sku.id);
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaign.id ? { ...c, skus: c.skus.filter((s) => s.id !== sku.id) } : c,
        ),
      );
      toast(`${sku.name} borrada`);
    } catch (err) {
      toast(`No pude borrarla: ${String(err)}`);
    }
  };

  if (loading) return <Empty glyph="⏳">Cargando…</Empty>;
  if (!campaigns.length) {
    return (
      <Empty glyph="🎁">
        Todavía no hay campañas. Se usan para San Valentín, Pascuas, Día del Padre, Día del Niño,
        Día de la Madre y Navidad.
      </Empty>
    );
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      {campaigns.map((campaign) => {
        const totals = campaign.skus.reduce(
          (acc, s) => ({
            total: acc.total + s.stockTotal,
            used: acc.used + s.stockUsed,
            money: acc.money + s.stockUsed * s.price,
          }),
          { total: 0, used: 0, money: 0 },
        );
        return (
          <section className="card" key={campaign.id}>
            {editando === campaign.id ? (
              <FormularioDeCampania
                campaign={campaign}
                onCancel={() => setEditando(null)}
                onSave={(datos) => void guardarCampania(campaign, datos)}
              />
            ) : (
              <header className="row wrap" style={{ padding: '14px 16px 8px', gap: 10 }}>
                <div>
                  <h3
                    style={{ margin: 0, fontFamily: 'var(--font-brand)', letterSpacing: '0.04em' }}
                  >
                    {campaign.name}
                  </h3>
                  <div className="small muted">
                    {campaign.startsOn} → {campaign.endsOn}
                  </div>
                </div>
                <span className="grow" />
                <button className="btn btn-sm btn-ghost" onClick={() => setEditando(campaign.id)}>
                  Editar
                </button>
                <Pill tone={campaign.active ? 'mint' : 'grey'}>
                  {campaign.active ? 'activa' : 'pausada'}
                </Pill>
                <Switch
                  checked={campaign.active}
                  onChange={(next) => void setActive(campaign, next)}
                  label="el bot la ofrece"
                />
              </header>
            )}

            <div className="card-pad" style={{ paddingTop: 4 }}>
              <div className="tiles" style={{ marginBottom: 12 }}>
                <div className="tile">
                  <div className="tile-label">Cajas producidas</div>
                  <div className="tile-value">{totals.total}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Comprometidas</div>
                  <div className="tile-value">{totals.used}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Disponibles</div>
                  <div className="tile-value">{totals.total - totals.used}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Vendido</div>
                  <div className="tile-value">{money(totals.money)}</div>
                </div>
              </div>

              <div className="scroll-x">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Caja / box</th>
                      <th style={{ width: 110 }}>Precio</th>
                      <th style={{ width: 100 }}>Stock</th>
                      <th style={{ width: 100 }}>Usadas</th>
                      <th style={{ width: 90, textAlign: 'right' }}>Quedan</th>
                      <th style={{ minWidth: 130 }}>Avance</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {campaign.skus.map((sku) => {
                      const left = sku.stockTotal - sku.stockUsed;
                      const pct = sku.stockTotal
                        ? Math.min(100, (sku.stockUsed / sku.stockTotal) * 100)
                        : 0;
                      return (
                        <tr key={sku.id}>
                          <td>{sku.name}</td>
                          <td>
                            <input
                              type="number"
                              defaultValue={sku.price}
                              onBlur={(e) =>
                                void saveSku(campaign.id, sku, { price: Number(e.target.value) })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              defaultValue={sku.stockTotal}
                              onBlur={(e) =>
                                void saveSku(campaign.id, sku, {
                                  stockTotal: Number(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              defaultValue={sku.stockUsed}
                              onBlur={(e) =>
                                void saveSku(campaign.id, sku, {
                                  stockUsed: Number(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td
                            className="mono"
                            style={{
                              textAlign: 'right',
                              color: left <= 0 ? 'var(--danger)' : undefined,
                              fontWeight: 600,
                            }}
                          >
                            {left}
                          </td>
                          <td>
                            <div className="stock-bar">
                              <i style={{ width: `${pct}%` }} data-low={left <= 5} />
                            </div>
                            <div className="small muted">{Math.round(pct)}% comprometido</div>
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-ghost"
                              title={`Borrar ${sku.name}`}
                              onClick={() => void borrarCaja(campaign, sku)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {agregando === campaign.id ? (
                <FormularioDeCaja
                  onCancel={() => setAgregando(null)}
                  onSave={(datos) => void agregarCaja(campaign, datos)}
                />
              ) : (
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginTop: 10 }}
                  onClick={() => setAgregando(campaign.id)}
                >
                  + Agregar caja
                </button>
              )}

              <div style={{ marginTop: 12 }}>
                <span className="label">Cómo la presenta el bot</span>
                <p className="small" style={{ margin: 0 }}>
                  {campaign.pitch || <span className="muted">Sin texto. Editala para ponerle uno.</span>}
                </p>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** El formulario de la campaña, abierto en el lugar del encabezado. */
function FormularioDeCampania({
  campaign,
  onSave,
  onCancel,
}: {
  campaign: Campaign;
  onSave: (datos: Pick<Campaign, 'name' | 'startsOn' | 'endsOn' | 'pitch'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [startsOn, setStartsOn] = useState(campaign.startsOn.slice(0, 10));
  const [endsOn, setEndsOn] = useState(campaign.endsOn.slice(0, 10));
  const [pitch, setPitch] = useState(campaign.pitch ?? '');

  const malasFechas = Boolean(startsOn && endsOn && endsOn < startsOn);
  const puede = Boolean(name.trim()) && !malasFechas;

  return (
    <div className="card-pad col" style={{ gap: 10, paddingBottom: 0 }}>
      <div>
        <span className="label">Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <div>
          <span className="label">Desde</span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div>
          <span className="label">Hasta</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>
      {malasFechas ? (
        <p className="small" style={{ margin: 0, color: 'var(--danger)' }}>
          La fecha de fin es anterior a la de inicio.
        </p>
      ) : null}
      <div>
        <span className="label">Cómo la presenta el bot</span>
        <textarea
          value={pitch}
          rows={4}
          onChange={(e) => setPitch(e.target.value)}
          style={{ width: '100%' }}
          placeholder="Lo que el bot tiene que decir cuando ofrezca esta campaña."
        />
        {/*
          Se avisa que esto lo lee el bot y no el cliente. Es la diferencia
          entre escribir el mensaje y escribir la instrucción, y confundirlas
          hace que el bot copie y pegue un texto en vez de usarlo.
        */}
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Lo lee el bot para saber cómo contarla, no se lo manda tal cual al cliente.
        </p>
      </div>
      <div className="row" style={{ gap: 8, paddingBottom: 12 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={!puede}
          onClick={() => onSave({ name: name.trim(), startsOn, endsOn, pitch: pitch.trim() || null })}
        >
          Guardar
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

interface NuevaCaja {
  name: string;
  price: number;
  stockTotal: number;
}

/** El formulario de una caja nueva. Las usadas arrancan en cero siempre. */
function FormularioDeCaja({
  onSave,
  onCancel,
}: {
  onSave: (datos: NuevaCaja) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stockTotal, setStockTotal] = useState('');

  return (
    <div className="row wrap" style={{ gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
      <div>
        <span className="label">Caja / box</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Box ..." />
      </div>
      <div>
        <span className="label">Precio</span>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          style={{ width: 110 }}
        />
      </div>
      <div>
        <span className="label">Stock</span>
        <input
          type="number"
          value={stockTotal}
          onChange={(e) => setStockTotal(e.target.value)}
          style={{ width: 100 }}
        />
      </div>
      <button
        className="btn btn-sm btn-primary"
        disabled={!name.trim()}
        onClick={() =>
          onSave({ name: name.trim(), price: Number(price) || 0, stockTotal: Number(stockTotal) || 0 })
        }
      >
        Agregar
      </button>
      <button className="btn btn-sm btn-ghost" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}
