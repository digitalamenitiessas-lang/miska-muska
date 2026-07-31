import { useCallback, useEffect, useState } from 'react';
import { api, type Campaign, type CampaignSku } from '../api';
import { Empty, Pill, Switch, money } from '../ui';

/**
 * Replica el control que el local ya hacía en planilla para el Día de la Madre:
 * stock total por caja, cuántas se comprometieron, cuántas quedan. La diferencia
 * es que acá el bot lee el stock disponible antes de prometer algo.
 */
export function Campanas({ toast }: { toast: (text: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

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
            <header className="row wrap" style={{ padding: '14px 16px 8px', gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-brand)', letterSpacing: '0.04em' }}>
                  {campaign.name}
                </h3>
                <div className="small muted">
                  {campaign.startsOn} → {campaign.endsOn}
                </div>
              </div>
              <span className="grow" />
              <Pill tone={campaign.active ? 'mint' : 'grey'}>
                {campaign.active ? 'activa' : 'pausada'}
              </Pill>
              <Switch
                checked={campaign.active}
                onChange={(next) => void setActive(campaign, next)}
                label="el bot la ofrece"
              />
            </header>

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
                    </tr>
                  </thead>
                  <tbody>
                    {campaign.skus.map((sku) => {
                      const left = sku.stockTotal - sku.stockUsed;
                      const pct = sku.stockTotal ? Math.min(100, (sku.stockUsed / sku.stockTotal) * 100) : 0;
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
                                void saveSku(campaign.id, sku, { stockTotal: Number(e.target.value) })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              defaultValue={sku.stockUsed}
                              onBlur={(e) =>
                                void saveSku(campaign.id, sku, { stockUsed: Number(e.target.value) })
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {campaign.pitch ? (
                <div style={{ marginTop: 12 }}>
                  <span className="label">Cómo la presenta el bot</span>
                  <p className="small" style={{ margin: 0 }}>{campaign.pitch}</p>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
