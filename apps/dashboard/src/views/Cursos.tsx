import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Course, type CourseSession, type CourseSignup, type CursoConTurnos } from '../api';
import { Empty, Pill, Switch, money } from '../ui';

/**
 * Cursos, aparte del catálogo.
 *
 * Es dos cosas en una pantalla, y por eso no entra en Catálogo: arriba se carga
 * el curso con sus turnos y sus cupos, y abajo está la planilla de inscriptos de
 * cada uno — la misma que el local llevaba en una hoja de cálculo, con las
 * mismas columnas.
 *
 * El bot anota a la gente como PENDIENTE. Marcarla como inscripta es una
 * decisión de una persona, que se toma cuando aparece la transferencia, y es el
 * momento en que se le avisa: ese botón manda el mensaje de confirmación.
 */
export function Cursos({ toast }: { toast: (text: string) => void }) {
  const [cursos, setCursos] = useState<CursoConTurnos[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [inscriptos, setInscriptos] = useState<CourseSignup[]>([]);
  const [editando, setEditando] = useState<Course | null>(null);
  const [creando, setCreando] = useState(false);

  const load = useCallback(async () => {
    try {
      setCursos(await api.courses());
    } catch (err) {
      toast(`No pude cargar los cursos: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const abrirPlanilla = useCallback(
    async (id: string) => {
      setAbierto(id);
      try {
        setInscriptos(await api.courseSignups(id));
      } catch (err) {
        toast(`No pude cargar los inscriptos: ${String(err)}`);
      }
    },
    [toast],
  );

  const guardarCurso = async (body: Partial<Course>, id?: string) => {
    try {
      if (id) await api.updateCourse(id, body);
      else await api.createCourse(body);
      setEditando(null);
      setCreando(false);
      await load();
      toast(id ? 'Curso actualizado' : 'Curso creado. Ahora cargale los turnos.');
    } catch (err) {
      toast(`No pude guardar: ${String(err)}`);
    }
  };

  const actualizarInscripto = async (id: string, patch: Partial<CourseSignup>) => {
    try {
      const next = await api.updateSignup(id, patch);
      setInscriptos((prev) => prev.map((i) => (i.id === next.id ? next : i)));
      // Los cupos libres cambian cuando alguien se cancela: hay que recargar.
      if (patch.status) await load();
      if (patch.status === 'inscripto') toast('Inscripto. Le avisamos por el chat.');
    } catch (err) {
      toast(`No pude actualizar: ${String(err)}`);
    }
  };

  if (loading) return <Empty glyph="⏳">Cargando los cursos…</Empty>;

  const curso = cursos.find((c) => c.course.id === abierto);

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14, gap: 10 }}>
        <Pill tone="mint">{cursos.filter((c) => c.course.active).length} abiertos</Pill>
        <Pill tone="grey">{cursos.filter((c) => !c.course.active).length} cerrados</Pill>
        <button className="btn btn-sm btn-primary" onClick={() => setCreando(true)}>
          Curso nuevo
        </button>
        <span className="grow" />
        <span className="small muted">
          El bot solo ofrece los cursos abiertos, y nunca anota a nadie en un turno completo.
        </span>
      </div>

      {cursos.length === 0 ? (
        <Empty glyph="🎓">
          Todavía no hay cursos. Cargá uno con el botón de arriba y el bot lo va a ofrecer.
        </Empty>
      ) : null}

      <div className="cursos-grid">
        {cursos.map(({ course, sessions }) => (
          <section key={course.id} className="card">
            <div className="card-pad">
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                {course.imageUrl ? (
                  <img className="curso-flyer" src={course.imageUrl} alt="" />
                ) : null}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong className="grow truncate">{course.name}</strong>
                    <Switch
                      checked={course.active}
                      onChange={(next) => void guardarCurso({ active: next }, course.id)}
                    />
                  </div>
                  <div className="small muted">
                    {money(course.price)} · {course.modality}
                    {course.location ? ` · ${course.location}` : ''}
                  </div>
                  {course.description ? (
                    <div className="small" style={{ marginTop: 4 }}>
                      {course.description}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {sessions.length === 0 ? (
                  <span className="small muted">Sin turnos cargados: el bot no puede anotar a nadie.</span>
                ) : (
                  sessions.map((t) => {
                    const libres = Math.max(0, t.capacity - (t.taken ?? 0));
                    return (
                      <Pill key={t.id} tone={libres === 0 ? 'danger' : libres <= 2 ? 'warn' : 'mint'}>
                        {t.label} · {libres === 0 ? 'completo' : `${libres} de ${t.capacity}`}
                      </Pill>
                    );
                  })
                )}
              </div>

              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn btn-sm btn-primary" onClick={() => void abrirPlanilla(course.id)}>
                  Inscriptos
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditando(course)}>
                  Editar
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      {curso ? (
        <Planilla
          curso={curso}
          inscriptos={inscriptos}
          onCerrar={() => setAbierto(null)}
          onActualizar={(id, patch) => void actualizarInscripto(id, patch)}
          onRecargar={() => void abrirPlanilla(curso.course.id)}
          toast={toast}
        />
      ) : null}

      {creando || editando ? (
        <CursoDialogo
          curso={editando}
          onCerrar={() => {
            setCreando(false);
            setEditando(null);
          }}
          onGuardar={(body) => void guardarCurso(body, editando?.id)}
          onTurnosCambiados={() => void load()}
          toast={toast}
        />
      ) : null}
    </>
  );
}

/**
 * La planilla de inscriptos, con las columnas de la hoja de cálculo que ya usaba
 * el local: nombre, contacto, si abonó, cuánto, y el saldo.
 */
function Planilla({
  curso,
  inscriptos,
  onCerrar,
  onActualizar,
  onRecargar,
  toast,
}: {
  curso: CursoConTurnos;
  inscriptos: CourseSignup[];
  onCerrar: () => void;
  onActualizar: (id: string, patch: Partial<CourseSignup>) => void;
  onRecargar: () => void;
  toast: (text: string) => void;
}) {
  const [agregando, setAgregando] = useState(false);
  const activos = inscriptos.filter((i) => i.status !== 'cancelado');
  const cobrado = activos.reduce((sum, i) => sum + i.paid, 0);
  const porCobrar = activos.reduce((sum, i) => sum + Math.max(0, i.total - i.paid), 0);
  const turno = (id: string | null) =>
    curso.sessions.find((t) => t.id === id)?.label ?? 'sin turno';

  const agregarAMano = async (body: Partial<CourseSignup>) => {
    try {
      await api.createSignup(curso.course.id, body);
      setAgregando(false);
      onRecargar();
      toast('Anotado en la planilla');
    } catch (err) {
      toast(`No pude anotarlo: ${String(err)}`);
    }
  };

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="planilla card" onClick={(e) => e.stopPropagation()}>
        <div className="card-pad">
          <div className="row" style={{ gap: 10 }}>
            <h3 className="card-title grow">Inscriptos · {curso.course.name}</h3>
            <button className="btn btn-sm btn-ghost" onClick={onCerrar}>
              Cerrar
            </button>
          </div>

          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <Pill tone="mint">{activos.filter((i) => i.status === 'inscripto').length} inscriptos</Pill>
            <Pill tone="warn">{activos.filter((i) => i.status === 'pendiente').length} pendientes</Pill>
            <Pill tone="grey">cobrado {money(cobrado)}</Pill>
            {porCobrar > 0 ? <Pill tone="danger">a cobrar {money(porCobrar)}</Pill> : null}
            <span className="grow" />
            <button className="btn btn-sm btn-primary" onClick={() => setAgregando(true)}>
              Anotar a mano
            </button>
          </div>

          {inscriptos.length === 0 ? (
            <Empty glyph="📋">
              Nadie anotado todavía. Los que anote el bot aparecen acá solos.
            </Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Nombre y apellido</th>
                    <th>Contacto</th>
                    <th>Turno</th>
                    <th style={{ textAlign: 'right' }}>Abonó</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inscriptos.map((i) => {
                    const saldo = Math.max(0, i.total - i.paid);
                    return (
                      <tr key={i.id} style={{ opacity: i.status === 'cancelado' ? 0.5 : 1 }}>
                        <td>{i.fullName}</td>
                        <td className="small">{i.contactInfo ?? '—'}</td>
                        <td className="small">{turno(i.sessionId)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            defaultValue={i.paid}
                            style={{ width: 96, textAlign: 'right' }}
                            onBlur={(e) => {
                              const paid = Number(e.target.value);
                              if (Number.isFinite(paid) && paid !== i.paid) {
                                onActualizar(i.id, { paid });
                              }
                            }}
                          />
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          {saldo > 0 ? (
                            <span style={{ color: 'var(--danger)' }}>{money(saldo)}</span>
                          ) : (
                            money(0)
                          )}
                        </td>
                        <td>
                          <Pill
                            tone={
                              i.status === 'inscripto'
                                ? 'ok'
                                : i.status === 'cancelado'
                                  ? 'grey'
                                  : 'warn'
                            }
                          >
                            {i.status}
                          </Pill>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4 }}>
                            {i.status !== 'inscripto' ? (
                              <button
                                className="btn btn-sm btn-primary"
                                title="Marca inscripto y le manda el mensaje de confirmación"
                                onClick={() =>
                                  onActualizar(i.id, { status: 'inscripto', paid: i.total })
                                }
                              >
                                Pagó, avisarle
                              </button>
                            ) : null}
                            {i.status !== 'cancelado' ? (
                              <button
                                className="btn btn-sm btn-ghost"
                                title="Libera el cupo"
                                onClick={() => onActualizar(i.id, { status: 'cancelado' })}
                              >
                                ✕
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {agregando ? (
            <AnotarAMano
              curso={curso}
              onCerrar={() => setAgregando(false)}
              onGuardar={(body) => void agregarAMano(body)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Alguien que se anotó por Instagram o en el mostrador, sin pasar por el chat. */
function AnotarAMano({
  curso,
  onCerrar,
  onGuardar,
}: {
  curso: CursoConTurnos;
  onCerrar: () => void;
  onGuardar: (body: Partial<CourseSignup>) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [sessionId, setSessionId] = useState(curso.sessions[0]?.id ?? '');

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-pad">
        <h3 className="card-title">Anotar a mano</h3>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="grow">
            <label className="label">Nombre y apellido</label>
            <input
              type="text"
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div className="grow">
            <label className="label">Contacto (cel o Instagram)</label>
            <input
              type="text"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="label">Turno</label>
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {curso.sessions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={fullName.trim().length < 3}
            onClick={() =>
              onGuardar({
                fullName: fullName.trim(),
                contactInfo: contactInfo.trim() || null,
                sessionId: sessionId || null,
                total: curso.course.price,
              })
            }
          >
            Anotar
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onCerrar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Alta y edición del curso, con sus turnos y el flyer. */
function CursoDialogo({
  curso,
  onCerrar,
  onGuardar,
  onTurnosCambiados,
  toast,
}: {
  curso: Course | null;
  onCerrar: () => void;
  onGuardar: (body: Partial<Course>) => void;
  onTurnosCambiados: () => void;
  toast: (text: string) => void;
}) {
  const [name, setName] = useState(curso?.name ?? '');
  const [description, setDescription] = useState(curso?.description ?? '');
  const [price, setPrice] = useState(String(curso?.price ?? ''));
  const [location, setLocation] = useState(curso?.location ?? '');
  const [modality, setModality] = useState<'presencial' | 'online'>(curso?.modality ?? 'presencial');
  const [imageUrl, setImageUrl] = useState(curso?.imageUrl ?? '');
  const [subiendo, setSubiendo] = useState(false);
  const archivoRef = useRef<HTMLInputElement | null>(null);

  const [turnos, setTurnos] = useState<CourseSession[]>([]);
  const [nuevoTurno, setNuevoTurno] = useState('');
  const [nuevoCupo, setNuevoCupo] = useState('12');

  useEffect(() => {
    if (!curso) return;
    void api.courses().then((todos) => {
      setTurnos(todos.find((c) => c.course.id === curso.id)?.sessions ?? []);
    });
  }, [curso]);

  const precio = Number(price);
  const listo = name.trim().length > 2 && Number.isFinite(precio) && precio > 0;

  const subir = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast('El flyer pesa más de 5 MB, que es el máximo que acepta WhatsApp.');
      return;
    }
    setSubiendo(true);
    try {
      const r = await api.uploadMedia(file);
      setImageUrl(r.url);
      if (r.advertencia) toast(r.advertencia);
    } catch (err) {
      toast(`No pude subir el flyer: ${String(err)}`);
    } finally {
      setSubiendo(false);
    }
  };

  const agregarTurno = async () => {
    if (!curso || !nuevoTurno.trim()) return;
    try {
      const t = await api.upsertSession(curso.id, {
        label: nuevoTurno.trim(),
        capacity: Number(nuevoCupo) || 0,
        sortOrder: turnos.length,
      });
      setTurnos((prev) => [...prev, t]);
      setNuevoTurno('');
      onTurnosCambiados();
    } catch (err) {
      toast(`No pude agregar el turno: ${String(err)}`);
    }
  };

  const borrarTurno = async (id: string) => {
    try {
      await api.deleteSession(id);
      setTurnos((prev) => prev.filter((t) => t.id !== id));
      onTurnosCambiados();
    } catch (err) {
      toast(`No pude borrar el turno: ${String(err)}`);
    }
  };

  return (
    <div className="foto-fondo" onClick={onCerrar}>
      <div className="planilla card" onClick={(e) => e.stopPropagation()}>
        <div className="card-pad">
          <h3 className="card-title">{curso ? 'Editar curso' : 'Curso nuevo'}</h3>

          <label className="label">Nombre</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Taller de budines y muffins"
            style={{ width: '100%' }}
          />

          <label className="label" style={{ marginTop: 10 }}>
            De qué se trata
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Distintas preparaciones de budines y muffins, técnicas de relleno, terminaciones…"
            style={{ width: '100%' }}
          />

          <div className="row wrap" style={{ gap: 12, marginTop: 10 }}>
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
            <div>
              <label className="label">Modalidad</label>
              <select
                value={modality}
                onChange={(e) => setModality(e.target.value as 'presencial' | 'online')}
              >
                <option value="presencial">presencial</option>
                <option value="online">online</option>
              </select>
            </div>
            <div className="grow">
              <label className="label">Dónde</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Barrio Norte"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <label className="label" style={{ marginTop: 10 }}>
            Flyer del curso
          </label>
          <div className="row" style={{ gap: 10 }}>
            <input
              ref={archivoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void subir(file);
                e.target.value = '';
              }}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={subiendo}
              onClick={() => archivoRef.current?.click()}
            >
              {subiendo ? 'Subiendo…' : 'Elegir el flyer'}
            </button>
            {imageUrl ? (
              <>
                <img className="curso-flyer" src={imageUrl} alt="" />
                <button className="btn btn-sm btn-ghost" onClick={() => setImageUrl('')}>
                  Quitar
                </button>
              </>
            ) : (
              <span className="small muted">
                El bot lo manda como imagen cuando preguntan por el curso.
              </span>
            )}
          </div>

          {curso ? (
            <>
              <label className="label" style={{ marginTop: 14 }}>
                Turnos y cupos
              </label>
              {turnos.length === 0 ? (
                <p className="small muted">
                  Sin turnos el bot no puede anotar a nadie. Cargá al menos uno.
                </p>
              ) : (
                <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                  {turnos.map((t) => (
                    <span key={t.id} className="chip">
                      {t.label} · {t.capacity} cupos
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Borrar el turno"
                        onClick={() => void borrarTurno(t.id)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="row wrap" style={{ gap: 8 }}>
                <input
                  className="grow"
                  type="text"
                  value={nuevoTurno}
                  onChange={(e) => setNuevoTurno(e.target.value)}
                  placeholder="viernes 11/9, 17 hs"
                />
                <input
                  type="number"
                  min={1}
                  value={nuevoCupo}
                  onChange={(e) => setNuevoCupo(e.target.value)}
                  style={{ width: 90 }}
                  title="Cupos de ese turno"
                />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!nuevoTurno.trim()}
                  onClick={() => void agregarTurno()}
                >
                  Agregar turno
                </button>
              </div>
            </>
          ) : (
            <p className="small muted" style={{ marginTop: 12 }}>
              Los turnos se cargan después de crear el curso.
            </p>
          )}

          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button
              className="btn btn-primary"
              disabled={!listo || subiendo}
              onClick={() =>
                onGuardar({
                  name: name.trim(),
                  description: description.trim() || null,
                  price: precio,
                  location: location.trim() || null,
                  modality,
                  imageUrl: imageUrl.trim(),
                })
              }
            >
              Guardar
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
