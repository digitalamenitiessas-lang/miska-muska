-- Migración 6 de la base del bot de Miska Muska.
-- Generado con `npm run db:sql`. No editar a mano: editá migrations.ts.
--
-- Para correrla a mano en el editor SQL de Supabase: pegá todo, incluido el
-- INSERT del final, que es lo que le dice al servidor que ya está aplicada.

CREATE TABLE IF NOT EXISTS _migrations (
  id         integer PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ========================================================================
-- Migración 6: cursos-e-inscriptos
-- ========================================================================
-- Los cursos viven aparte del catálogo, y no como productos de categoría
-- "cursos", por dos cosas que un producto no sabe expresar: tienen TURNOS (el
-- mismo curso el viernes o el sábado) y cada turno tiene cupos. Un producto es
-- una cosa que se vende N veces; un curso es una fecha con doce lugares.
--
-- Y porque el local los mira aparte: la pantalla de cursos es la planilla de
-- inscriptos, no la carta.
CREATE TABLE courses (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  price       integer NOT NULL DEFAULT 0,
  -- Dónde y cómo: "Barrio Norte", "presencial" u "online".
  location    text,
  modality    text NOT NULL DEFAULT 'presencial'
                CHECK (modality IN ('presencial', 'online')),
  image_url   text,
  -- Apagado = el bot no lo ofrece. Es el interruptor de la carta, para cursos.
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_active ON courses (active, created_at DESC);

-- Un turno del curso. La fecha va como texto porque el equipo la escribe como la
-- dice ("viernes 11/9, 17 hs") y esa cadena es la que ve el cliente; el orden lo
-- da sort_order. Guardarla como timestamp obligaría a inventar zona horaria y
-- formato para algo que nadie va a consultar por rango.
CREATE TABLE course_sessions (
  id         text PRIMARY KEY,
  course_id  text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  label      text NOT NULL,
  capacity   integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_course_sessions ON course_sessions (course_id, sort_order);

-- La planilla de inscriptos: una fila por persona anotada. Es el "ticket" del
-- curso, y las columnas son las de la planilla que ya usa el local.
CREATE TABLE course_signups (
  id              text PRIMARY KEY,
  course_id       text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  session_id      text REFERENCES course_sessions(id) ON DELETE SET NULL,
  contact_id      text REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  full_name       text NOT NULL,
  -- Celular o Instagram, como en la planilla: el equipo escribe lo que tenga.
  contact_info    text,
  total           integer NOT NULL DEFAULT 0,
  paid            integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente', 'inscripto', 'cancelado')),
  notes           text,
  created_by      text NOT NULL DEFAULT 'bot',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_course_signups ON course_signups (course_id, created_at);
CREATE INDEX idx_course_signups_session ON course_signups (session_id);

INSERT INTO _migrations (id, name) VALUES (6, 'cursos-e-inscriptos')
  ON CONFLICT (id) DO NOTHING;
