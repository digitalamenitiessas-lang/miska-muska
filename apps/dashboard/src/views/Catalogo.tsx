import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Product } from '../api';
import { CATEGORY_LABEL, claveCategoria, Empty, Pill, Switch, money } from '../ui';

/**
 * Las que trae el catálogo de fábrica, en el orden en que las piensa el local.
 *
 * No son las únicas: el local crea las que necesite al cargar un producto. Estas
 * están escritas para que aparezcan en la lista incluso el día que no haya
 * ningún producto cargado en ellas.
 */
const CATEGORIAS = [
  'cursos', 'cookies', 'muffins', 'mini-tortas', 'cuadrados', 'alfajores',
  'tabletas', 'saladito', 'tortas', 'desayunos', 'merch',
];

/** Valor del renglón "categoría nueva" del selector. No es una categoría. */
const NUEVA = '__nueva__';

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
  const [creando, setCreando] = useState(false);

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

  /*
    Las categorías que se pueden elegir al cargar algo: las de fábrica más las que
    el local haya creado. Salen del propio catálogo, así que una categoría nueva
    aparece en la lista sola en cuanto tiene un producto adentro, sin pedirle nada
    más al servidor.
  */
  const categorias = useMemo(() => {
    const porClave = new Map(CATEGORIAS.map((c) => [claveCategoria(c), c]));
    for (const p of products) {
      const clave = claveCategoria(p.category);
      if (!porClave.has(clave)) porClave.set(clave, p.category);
    }
    return [...porClave.values()];
  }, [products]);

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

  const crear = async (body: Partial<Product>) => {
    try {
      const nuevo = await api.createProduct(body);
      /*
        La categoría que devuelve el servidor es la definitiva: si lo que se
        escribió era una que ya existía con otra ortografía, vuelve la que existe.
        Por eso el aviso se decide con la respuesta y no con lo que se tipeó.
      */
      const esNueva = !categorias.some((c) => claveCategoria(c) === claveCategoria(nuevo.category));
      setProducts((prev) => [...prev, nuevo]);
      setCreando(false);
      toast(
        esNueva
          ? `${nuevo.name} cargado, y con él la categoría ${CATEGORY_LABEL[nuevo.category] ?? nuevo.category}. Ahora podés ponerle la foto.`
          : `${nuevo.name} cargado. Ahora podés ponerle la foto.`,
      );
      // Se abre la foto en el mismo movimiento: es el paso que sigue siempre.
      setEditandoFoto(nuevo.id);
    } catch (err) {
      toast(`No pude crear el producto: ${String(err)}`);
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

  /*
    Borrar es distinto de apagar, y la diferencia importa: apagado el bot no lo
    ofrece pero sigue en la carta para volver a prenderlo mañana; borrado no
    existe más. Por eso pregunta antes, y por eso el botón está en gris y al
    final de la fila, lejos del interruptor que se usa todos los días.

    Los pedidos viejos no se tocan: guardan el nombre y el precio adentro, así que
    una comanda de la semana pasada se sigue leyendo igual.
  */
  const borrar = async (product: Product) => {
    const ok = window.confirm(
      `¿Borrar "${product.name}" del catálogo?

Si es algo que hoy no hay, mejor apagalo ` +
        'con el interruptor: así vuelve mañana con un clic. Borrarlo no se puede deshacer.',
    );
    if (!ok) return;
    const antes = products;
    setProducts((prev) => prev.filter((x) => x.id !== product.id));
    try {
      await api.deleteProduct(product.id);
      toast(`${product.name}: borrado del catálogo`);
    } catch (err) {
      setProducts(antes);
      toast(`No pude borrarlo: ${String(err)}`);
    }
  };

  if (loading) return <Empty glyph="⏳">Cargando el catálogo…</Empty>;

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14, gap: 10 }}>
        <Pill tone="mint">{availableCount} disponibles hoy</Pill>
        <Pill tone="grey">{products.length - availableCount} agotados</Pill>
        <button className="btn btn-sm btn-primary" onClick={() => setCreando(true)}>
          Producto nuevo
        </button>
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
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Borrar del catálogo. Si hoy no hay, mejor apagalo."
                      onClick={() => void borrar(p)}
                    >
                      ✕
                    </button>
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
          toast={toast}
        />
      ) : null}

      {creando ? (
        <NuevoDialogo
          categorias={categorias}
          onCerrar={() => setCreando(false)}
          onCrear={(body) => void crear(body)}
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

/**
 * Carga de la foto de un producto: se elige un archivo, se sube, y queda
 * guardada la dirección que devuelve el servidor.
 *
 * El archivo NO se guarda en el disco del servidor: va a la base, que es lo que
 * mantiene la propiedad de que el proceso del bot es descartable. Lo que se
 * guarda en el producto es la dirección pública que sirve ese archivo, porque es
 * lo que entienden los dos canales: Telegram y WhatsApp descargan el link ellos
 * mismos.
 *
 * También se puede pegar una dirección a mano, para las fotos que ya están en la
 * tienda o en Instagram y no hace falta duplicar.
 */
function FotoDialogo({
  producto,
  onCerrar,
  onGuardar,
  toast,
}: {
  producto: Product;
  onCerrar: () => void;
  onGuardar: (url: string) => void;
  toast: (text: string) => void;
}) {
  const [url, setUrl] = useState(producto.imageUrl ?? '');
  const [subiendo, setSubiendo] = useState(false);
  const archivoRef = useRef<HTMLInputElement | null>(null);
  const limpia = url.trim();
  /*
    Una dirección relativa (/media/…) es la que devuelve el servidor cuando falta
    PUBLIC_URL: sirve para verla acá, pero no para que WhatsApp la descargue. Se
    acepta igual y el servidor avisa, en vez de bloquear una foto que en Telegram
    andaría.
  */
  const servible = limpia.startsWith('https://') || limpia.startsWith('/');

  const subir = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast('La foto pesa más de 5 MB, que es el máximo que acepta WhatsApp.');
      return;
    }
    setSubiendo(true);
    try {
      const r = await api.uploadMedia(file);
      setUrl(r.url);
      if (r.advertencia) toast(r.advertencia);
    } catch (err) {
      toast(`No pude subir la foto: ${String(err)}`);
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="foto-dialogo card" onClick={(e) => e.stopPropagation()}>
        <div className="card-pad">
          <h3 className="card-title">Foto de {producto.name}</h3>

          <input
            ref={archivoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void subir(file);
              // Se limpia para poder volver a elegir el mismo archivo.
              e.target.value = '';
            }}
          />
          <button
            className="btn btn-primary"
            disabled={subiendo}
            onClick={() => archivoRef.current?.click()}
          >
            {subiendo ? 'Subiendo…' : 'Elegir una foto'}
          </button>
          <p className="small muted">jpg, png o webp, hasta 5 MB.</p>

          <label className="label" style={{ marginTop: 10 }}>
            O pegar la dirección de una que ya esté online
          </label>
          <input
            type="url"
            placeholder="https://miskamuska.com.ar/…/torta.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: '100%' }}
          />

          <div className="foto-preview">
            {limpia && servible ? (
              <img src={limpia} alt="" />
            ) : (
              <span className="small muted">
                {limpia
                  ? 'La dirección tiene que empezar con https://'
                  : 'Elegí un archivo o pegá una dirección, y la ves acá'}
              </span>
            )}
          </div>
          <p className="small muted">
            Si acá no se ve, al cliente tampoco le llega: WhatsApp descarga la foto por su cuenta y
            necesita que la dirección sea pública.
          </p>

          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={subiendo || (Boolean(limpia) && !servible)}
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

/**
 * Alta de un producto.
 *
 * Faltaba del todo: el panel dejaba marcar disponibilidad y editar precios, pero
 * no había forma de cargar algo nuevo. Un curso presencial —que cambia cada
 * semana— no se podía dar de alta sin tocar la base a mano.
 *
 * Y las categorías se crean acá, en el mismo formulario, porque así es como
 * aparecen de verdad: el local no se sienta a diseñar categorías, se encuentra
 * con que lo que va a cargar no entra en ninguna. Antes la lista era fija y eso
 * significaba esperar un despliegue para vender un pan.
 */
function NuevoDialogo({
  categorias,
  onCerrar,
  onCrear,
}: {
  categorias: string[];
  onCerrar: () => void;
  onCrear: (body: Partial<Product>) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categorias[0] ?? 'cursos');
  /** Nombre de la categoría que se está creando, si se eligió crear una. */
  const [nueva, setNueva] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const precio = Number(price);

  const creandoCategoria = category === NUEVA;
  const categoriaFinal = creandoCategoria ? nueva.replace(/\s+/g, ' ').trim() : category;
  /*
    Si lo escrito es una categoría que ya existe con otra ortografía, el servidor
    lo va a mandar ahí adentro. Se avisa antes de guardar: la sorpresa sería
    apretar Crear y ver el producto aparecer en un grupo que no es el que se
    estaba creando.
  */
  const yaExiste = creandoCategoria
    ? categorias.find((c) => claveCategoria(c) === claveCategoria(categoriaFinal))
    : undefined;
  const listo =
    name.trim().length > 1 &&
    categoriaFinal.length > 1 &&
    Number.isFinite(precio) &&
    precio > 0;

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="foto-dialogo card" onClick={(e) => e.stopPropagation()}>
        <div className="card-pad">
          <h3 className="card-title">Producto nuevo</h3>

          <label className="label">Nombre</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Curso de macarons, jueves 4"
            style={{ width: '100%' }}
          />

          <div className="row" style={{ gap: 12, marginTop: 10 }}>
            <div className="grow">
              <label className="label">Categoría</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: '100%' }}
              >
                {categorias.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c] ?? c}
                  </option>
                ))}
                <option value={NUEVA}>+ Categoría nueva…</option>
              </select>
            </div>
            <div>
              <label className="label">Precio</label>
              <input
                type="number"
                min={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                style={{ width: 120 }}
              />
            </div>
          </div>

          {creandoCategoria ? (
            <div style={{ marginTop: 10 }}>
              <label className="label">Nombre de la categoría nueva</label>
              <input
                type="text"
                autoFocus
                maxLength={40}
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                placeholder="Panes"
                style={{ width: '100%' }}
              />
              <p className="small muted">
                {yaExiste
                  ? `Eso ya es «${CATEGORY_LABEL[yaExiste] ?? yaExiste}»: el producto va a entrar ahí.`
                  : 'Se escribe como querés verla en el panel. Se crea junto con este producto, y ' +
                    'el bot ya la usa para agrupar cuando le preguntan qué hay.'}
              </p>
            </div>
          ) : null}

          <label className="label" style={{ marginTop: 10 }}>
            Nota para el bot (opcional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Jueves 4 a las 18, quedan 3 lugares"
            style={{ width: '100%' }}
          />
          <p className="small muted">
            El bot la lee y la puede contar. Sirve para la fecha de un curso, o para lo que cambia
            seguido y no entra en el nombre.
          </p>

          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={!listo}
              onClick={() =>
                onCrear({
                  name: name.trim(),
                  category: categoriaFinal,
                  price: precio,
                  notes: notes.trim() || null,
                })
              }
            >
              Crear
            </button>
            <button className="btn btn-ghost" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
