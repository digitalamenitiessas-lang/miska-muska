import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Product } from '../api';
import { CATEGORY_LABEL, Empty, Pill, Switch, money } from '../ui';

/**
 * Esta pantalla es la más usada del día: a la mañana el local marca qué salió del
 * horno. Lo que está en `availableToday = false` el bot nunca lo ofrece.
 */
export function Catalogo({ toast }: { toast: (text: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  /** Producto cuya foto se está cargando, si hay alguno. */
  const [editandoFoto, setEditandoFoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProducts(await api.products());
    } catch (err) {
      toast(`No pude cargar el catálogo: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [products]);

  const availableCount = products.filter((p) => p.availableToday).length;

  const toggle = async (product: Product, available: boolean) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, availableToday: available } : p)),
    );
    try {
      await api.updateProduct(product.id, { availableToday: available });
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
      void load();
    }
  };

  const bulk = async (category: string, available: boolean) => {
    const ids = products.filter((p) => p.category === category).map((p) => p.id);
    setProducts((prev) =>
      prev.map((p) => (p.category === category ? { ...p, availableToday: available } : p)),
    );
    try {
      await api.bulkAvailability(ids, available);
      toast(`${CATEGORY_LABEL[category] ?? category}: ${available ? 'todo disponible' : 'todo agotado'}`);
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
      void load();
    }
  };

  const saveFoto = async (id: string, url: string) => {
    try {
      const next = await api.updateProduct(id, { imageUrl: url });
      setProducts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      setEditandoFoto(null);
      toast(url ? 'Foto guardada' : 'Foto quitada');
    } catch (err) {
      toast('No pude guardar la foto: ' + String(err));
    }
  };

  const savePrice = async (product: Product, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    try {
      const next = await api.updateProduct(product.id, { price });
      setProducts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      toast(`${product.name}: ${money(price)}`);
    } catch (err) {
      toast(`No pude guardar el precio: ${String(err)}`);
    } finally {
      setEditing(null);
    }
  };

  if (loading) return <Empty glyph="⏳">Cargando el catálogo…</Empty>;

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14, gap: 10 }}>
        <Pill tone="mint">{availableCount} disponibles hoy</Pill>
        <Pill tone="grey">{products.length - availableCount} agotados</Pill>
        <span className="grow" />
        <span className="small muted">
          Lo que apagues acá deja de existir para el bot: no lo ofrece ni lo cotiza.
        </span>
      </div>

      <div className="grid-2">
        {grouped.map(([category, items]) => {
          const on = items.filter((p) => p.availableToday).length;
          return (
            <section className="card" key={category}>
              {/* `wrap`: en un teléfono angosto los botones "todo"/"nada" no
                  entraban junto al título y se salían de la tarjeta. */}
              <header className="row wrap" style={{ padding: '12px 15px 6px', gap: 8 }}>
                <h3 className="card-title" style={{ margin: 0 }}>
                  {CATEGORY_LABEL[category] ?? category}
                </h3>
                <Pill tone={on === items.length ? 'mint' : on === 0 ? 'grey' : 'warn'}>
                  {on}/{items.length}
                </Pill>
                <span className="grow" />
                <button className="btn btn-sm btn-ghost" onClick={() => void bulk(category, true)}>
                  todo
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => void bulk(category, false)}>
                  nada
                </button>
              </header>
              <div style={{ padding: '0 6px 8px' }}>
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="row"
                    style={{
                      gap: 10,
                      padding: '7px 9px',
                      borderRadius: 9,
                      opacity: p.availableToday ? 1 : 0.55,
                    }}
                  >
                    <Switch checked={p.availableToday} onChange={(next) => void toggle(p, next)} />
                    {/* La miniatura es también el botón: si ya hay foto se ve, y si
                        no, queda el marco vacío invitando a cargarla. */}
                    <button
                      className="foto-mini"
                      title={p.imageUrl ? 'Cambiar la foto' : 'Cargar una foto'}
                      onClick={() => setEditandoFoto(p.id)}
                    >
                      {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span>+</span>}
                    </button>
                    <span className="grow truncate" title={p.notes ?? p.name}>
                      {p.name}
                      {p.limitedEdition ? ' ✨' : ''}
                      {p.pickupOnly ? ' 🚫🛵' : ''}
                    </span>
                    {editing === p.id ? (
                      <input
                        type="number"
                        defaultValue={p.price}
                        autoFocus
                        style={{ width: 92 }}
                        onBlur={(e) => void savePrice(p, Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void savePrice(p, Number(e.currentTarget.value));
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        className="btn btn-sm btn-ghost mono"
                        title="Click para editar el precio"
                        onClick={() => setEditing(p.id)}
                      >
                        {money(p.price)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {editandoFoto ? (
        <FotoDialogo
          producto={products.find((p) => p.id === editandoFoto)!}
          onCerrar={() => setEditandoFoto(null)}
          onGuardar={(url) => void saveFoto(editandoFoto, url)}
        />
      ) : null}

      <p className="small muted" style={{ marginTop: 14 }}>
        ✨ edición limitada (el bot invita a consultar los sabores del mes) · 🚫🛵 no se envía a
        domicilio (el bot ofrece retiro en el local o Uber del cliente)
      </p>
    </>
  );
}

/**
 * Carga de la foto de un producto: se pega una URL pública y se ve la vista
 * previa antes de guardar.
 *
 * Por qué una URL y no subir el archivo: los dos canales descargan el link
 * ellos mismos (Telegram con sendPhoto, WhatsApp Cloud API con `image.link`),
 * así que la misma URL sirve en los dos y no hay que resubir nada al migrar de
 * canal. Alojar los archivos nosotros significaría almacenamiento, limpieza y
 * un dominio público que hoy no hacen falta: la foto ya está en la tienda o en
 * Instagram del local.
 *
 * WhatsApp además EXIGE https y que sea alcanzable desde afuera, y falla en
 * silencio si no. Por eso la vista previa: si acá no se ve, al cliente tampoco
 * le va a llegar.
 */
function FotoDialogo({
  producto,
  onCerrar,
  onGuardar,
}: {
  producto: Product;
  onCerrar: () => void;
  onGuardar: (url: string) => void;
}) {
  const [url, setUrl] = useState(producto.imageUrl ?? '');
  const limpia = url.trim();
  const esHttps = limpia.startsWith('https://');

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="foto-dialogo card" onClick={(e) => e.stopPropagation()}>
        <div className="card-pad">
          <h3 className="card-title">Foto de {producto.name}</h3>
          <label className="label">Dirección de la imagen</label>
          <input
            type="url"
            autoFocus
            placeholder="https://miskamuska.com.ar/…/torta.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: '100%' }}
          />
          <p className="small muted">
            Tiene que empezar con <code>https://</code> y abrirse sin contraseña. Sirve la de la
            tienda online o la de Instagram. WhatsApp no acepta otra cosa, y no avisa cuando falla.
          </p>

          <div className="foto-preview">
            {limpia && esHttps ? (
              <img src={limpia} alt="" />
            ) : (
              <span className="small muted">
                {limpia ? 'La dirección tiene que empezar con https://' : 'Pegá la dirección y la ves acá'}
              </span>
            )}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={Boolean(limpia) && !esHttps}
              onClick={() => onGuardar(limpia)}
            >
              Guardar
            </button>
            {producto.imageUrl ? (
              <button className="btn btn-ghost" onClick={() => onGuardar('')}>
                Quitar la foto
              </button>
            ) : null}
            <button className="btn btn-ghost" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
