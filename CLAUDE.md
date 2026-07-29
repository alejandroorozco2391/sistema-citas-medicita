# MediCita — Sistema de Agendamiento de Citas Médicas

Aplicación web para clínicas medianas en México que permite a los pacientes consultar especialidades disponibles y solicitar citas médicas en línea.

## Stack tecnológico

- **Frontend:** HTML5, CSS3, JavaScript puro (sin frameworks, sin build step)
- **Fuentes:** Inter (Google Fonts)
- **Backend:** Supabase (Postgres + Auth + RLS) — **un proyecto por clínica**
- **Serverless:** funciones de Vercel (`api/chat.js` para el proxy de Anthropic)
- **Persistencia:** doble modo — `localStorage` sin sesión (demo pública), Supabase con sesión. Ver *Fase B1* abajo.
- **IA:** API de Anthropic (Claude) con tool use, llamada directamente desde el navegador
- **Email:** EmailJS v4 (CDN) — envío de emails HTML desde el frontend sin backend
- **Gráficas:** Chart.js vía CDN (se agrega en Módulo 3 — MediAnalytics)

## Estructura del proyecto

```
sistema-citas-medicas/
├── index.html          # Página principal (formulario de citas para pacientes)
├── admin.html          # Panel de administración (tabla, filtros, cambio de estado)
├── chat.html           # Chat con agente de IA (MediBot)
├── conversaciones.html # [NUEVO F0] MediInbox — inbox unificado multicanal
├── medipost.html       # [NUEVO M1] Generador de contenido para redes sociales
├── encuesta.html       # [NUEVO M2] Encuesta de satisfacción post-consulta
├── medidocs.html       # [NUEVO M4] Generador de documentos clínicos
├── terminos.html       # Términos y Condiciones de Uso
├── privacidad.html     # Política de Privacidad
├── CLAUDE.md           # Este archivo
├── css/
│   ├── styles.css      # Estilos de index.html
│   ├── admin.css       # Estilos del panel de administración
│   ├── chat.css        # Estilos del chat (tema oscuro WhatsApp-like)
│   ├── conversaciones.css # [NUEVO F0] Estilos de MediInbox (2 paneles, burbujas)
│   ├── medipost.css    # [NUEVO M1] Estilos del generador de posts
│   ├── encuesta.css    # [NUEVO M2] Estilos de la encuesta NPS (mobile-first)
│   └── medidocs.css    # [NUEVO M4] Estilos del generador de documentos + @media print
├── js/
│   ├── data.js         # Datos estáticos (especialidades, doctores, horarios)
│   ├── app.js          # Lógica de index.html + guardarCitaEnStorage()
│   ├── admin.js        # Lógica del panel de administración
│   ├── chat.js         # Lógica del chat: loop agéntico, tools, EmailJS
│   ├── puente-api.js  # [B2] Publica window.API para los scripts clásicos
│   ├── puente-sesion.js # [B2] Publica window.Sesion para el inbox
│   ├── conversaciones-store.js    # [F0/B2] Capa del inbox; delega en api.mjs
│   ├── conversaciones-adapters.js # [NUEVO F0] Normalizadores por canal (puros, testeables)
│   ├── conversaciones-envio.js    # [NUEVO F0] Dispatcher de salida por canal
│   ├── conversaciones-demo.js     # [NUEVO F0] Payloads crudos de muestra de los 4 canales
│   ├── conversaciones.js          # [NUEVO F0] Lógica de la vista del inbox
│   ├── horarios.js     # [NUEVO E] Panel del horario de atención
│   ├── escalaciones.js # [NUEVO E] Panel de escalaciones + sondeo y aviso sonoro
│   ├── medipost.js     # [NUEVO M1] Lógica del generador de posts
│   ├── analytics.js    # [NUEVO M3] Cálculo de métricas + integración Chart.js
│   ├── medidocs.js     # [NUEVO M4] Lógica del generador de documentos
│   └── encuesta.js     # [NUEVO M2] Lógica de la encuesta NPS
├── tests/              # [NUEVO F0] Pruebas con el runner nativo de node (sin dependencias)
│   ├── stub-localstorage.js
│   ├── adapters.test.js
│   ├── store.test.js
│   └── integracion.test.js
└── assets/             # Reservado para imágenes y recursos estáticos
```

## Cómo levantar el sitio

```bash
npm run dev       # http://localhost:5173
```

**Hace falta un servidor de verdad desde la Fase B1.** Los archivos `.mjs` son módulos ES y el navegador los rechaza bajo `file://` (origen opaco). Abrir `login.html` con doble clic hace que el `<script type="module">` nunca corra: el formulario se envía de forma nativa, la página se recarga y parece que el botón "no hace nada".

`scripts/servidor.mjs` es el `http` de node sirviendo archivos tal cual. No es un build step ni una dependencia — la restricción de "sin frameworks, sin build" sigue intacta.

Con una excepción deliberada: **también responde `/api/chat`**. En producción eso es una función serverless de Vercel (`api/chat.js`) que hace de proxy hacia Anthropic para que la API key no viaje al navegador. Sin ella en local, MediPost, MediDocs y los insights de Analytics daban 404 — tres módulos que no se podían probar sin desplegar. La llave sale de `ANTHROPIC_API_KEY` en `.env.local` (ignorado por git), y el arranque dice si la encontró:

```
/api/chat: activo (MediPost, MediDocs e insights de Analytics)
```

**Para probar la demo pura en local, apaga el backend.** Mientras exista `js/config-local.mjs`, la landing y la encuesta hablan con el Supabase real aunque no haya sesión — que es el diseño correcto, pero no es la demo. Renombra el archivo mientras pruebas ese modo:

```bash
mv js/config-local.mjs js/config-local.mjs.off   # demo pura
mv js/config-local.mjs.off js/config-local.mjs   # clínica real
```

## Verificación

No hay linter ni build step. La verificación corre con el runner nativo de node:

```bash
npm test           # 65 pruebas del frontend, cero dependencias
npm run test:db    # 131 pruebas contra un Postgres real (pglite, WebAssembly)
npm run test:all   # las 206
npm run db:verificar  # contra el proyecto de Supabase real, ya desplegado
```

`test:all` verifica que el esquema **está bien diseñado**; `db:verificar` que **está bien aplicado** — se conecta al proyecto de verdad con la llave pública e intenta leer las 11 tablas protegidas. Si alguna devolviera renglones, RLS no estaría funcionando y esa clínica no sale a producción.

Dos trampas conocidas:

- `node --test tests/` **falla en Windows** (interpreta el directorio como archivo). Hay que pasar el glob entrecomillado, como hacen los scripts de `package.json`.
- Las pruebas de base de datos corren con `--test-concurrency=1`. Cada archivo levanta su propio Postgres en WebAssembly, y en paralelo se estorban.

Las pruebas de base de datos no necesitan Docker ni la CLI de Supabase: `tests/db-harness.mjs` levanta Postgres en WebAssembly y le simula encima el entorno de Supabase (esquema `auth`, `auth.uid()`, roles `anon`/`authenticated` y los permisos por omisión sobre `public`). Eso último importa: en Supabase toda tabla nueva nace con permisos para `anon`, y lo único que impide que un anónimo lea la base entera es RLS. El arnés reproduce esa concesión para que las pruebas midan la seguridad real.

## Claves de localStorage

> **Desde B2, ningún módulo las lee ni las escribe directamente.** Todas viven detrás de `js/api.mjs`, y solo `js/api-local.mjs` las toca. La tabla queda como referencia del modelo de datos en modo local, no como una lista de cosas que haya que ir a leer.
>
> Las dos excepciones son estado de interfaz de este navegador, no datos de la clínica, y **siguen en `localStorage` en ambos modos**: `medicita_demo_seeded` (si ya se sembró la demo) y `medicita_tab_activa` (qué pestaña del panel estaba abierta). Sincronizarlas con el servidor no tendría sentido: la pestaña abierta en la computadora de recepción no es asunto del consultorio.

| Clave | Módulo | Contenido |
|---|---|---|
| `medicita_citas` | Core | Array de citas (folio, paciente, médico, fecha, hora, tipo, estado, notas, creadaEn) |
| `medicita_posts` | M1 MediPost | Array de posts generados (id, tipo, especialidad, red, caption, hashtags, creadoEn, borrador) |
| `medicita_nps` | M2 MediFollow | Array de respuestas NPS (folio, puntuacion, comentario, fechaRespuesta) |
| `medicita_followup_pendientes` | M2 MediFollow | Array de folios con seguimiento diferido pendiente (folio, fechaAtendida, emailEnviado_3d, emailEnviado_30d) |
| `medicita_docs` | M4 MediDocs | Array de metadatos de documentos (id, folio, tipodoc, inputs, creadoEn) — solo metadatos, el HTML se regenera |
| `medicita_pacientes` | M5 MediPacientes | Array de perfiles de paciente (ver estructura abajo) |
| `medicita_conversaciones` | F0 MediInbox | Array de conversaciones (id, claveExterna, pacienteId, telefono, nombreContacto, canal, canalMeta, estado, asunto, ultimoMensaje, noLeidos, creadaEn, actualizadaEn, cerradaEn) |
| `medicita_mensajes` | F0 MediInbox | Array de mensajes (id, conversacionId, remitente, autorNombre, tipo, contenido, audioUrl, duracionSeg, estadoEnvio, metadata, fecha) |
| `medicita_sesion` | F0 MediInbox | Objeto único con el rol activo (rol, nombre, iniciadaEn) — **solo en la demo sin backend**; con backend la sesión es de Supabase Auth y esta clave no se usa |
| `medicita_horarios` | Fase E MediHorario | Objeto único con `base` (bloques recurrentes por día) y `excepciones` (cambios por fecha) |
| `medicita_escalaciones` | Fase E | Array de escalaciones a humano (id, motivo, urgencia, resumen, destinoRol, estado, nivel, venceEn, acuse y cierre) |
| `medicita_config_clinica` | Global | Objeto único con configuración de la clínica: nombreClinica, nombreMedico, especialidadPrincipal, ciudad, telefono, email, logoUrl, cedulaProfesional, horarioAtencion, direccionConsultorio, fraseHero, fotoHero, fotoMedico, bioMedico, formacionMedico, totalPacientes, anosExperiencia, calificacionPromedio, serviciosClinica, whatsapp, facebook, instagram, **colorPrimario, colorAcento, tipografia** |

### Estructura de `medicita_pacientes`

```json
{
  "id": "PAC-YYYYMMDD-XXXX",
  "nombre": "", "apellidos": "", "telefono": "", "email": "",
  "fechaNacimiento": "", "sexo": "", "estatura": "", "peso": "",
  "tipoSangre": "", "alergias": "", "enfermedadesCronicas": "", "medicamentosActuales": "",
  "tieneSeguro": false, "nombreSeguro": "", "numeroPoliza": "",
  "ciudad": "", "comoNosEncontro": "", "ocupacion": "",
  "calificacion": 1,
  "notas": "",
  "foliosCitas": [],
  "foliosDocs": [],
  "respuestasNPS": [],
  "creadoEn": "", "actualizadoEn": ""
}
```

## Convenciones del proyecto

- Todo el texto visible al usuario va en **español mexicano**
- Colores principales definidos como variables en `:root` — no usar valores hexadecimales directos en otros lugares
- El objeto `estado` en `app.js` es la única fuente de verdad del estado de la UI; no usar variables globales sueltas
- El array `conversacion` en `chat.js` es el historial de mensajes para la API; no se persiste entre sesiones
- Las credenciales (API Key de Anthropic, claves de EmailJS) viven en memoria durante la sesión — nunca en `localStorage`; en la versión demo están precargadas como `value` en los inputs de `chat.html`
- No usar frameworks ni librerías externas sin consenso previo (Chart.js es la excepción aprobada para M3)
- Los documentos en MediDocs se guardan solo como metadatos + inputs; el HTML completo se regenera con Claude al abrirlos (evita llenar los 5MB de localStorage)
- **Ningún módulo toca `localStorage` de datos.** Todo pasa por `js/api.mjs`, que decide si los datos viven en este navegador o en Postgres. Los scripts clásicos lo alcanzan por `window.API`, que publica `js/puente-api.js`. Las únicas claves que quedan sueltas son las dos de estado de interfaz listadas arriba
- **El horario es dato, no texto.** `clinicas.horario_atencion` sigue existiendo porque lo imprime el membrete, pero **se regenera** desde `horarios_base`; nadie lo escribe a mano. Toda pregunta sobre si hay alguien pasa por `en_horario()` / `proxima_apertura()`, que convierten con la zona horaria de la clínica — el servidor está en UTC
- **Nadie promete una hora que el horario no sostenga.** `escalar_a_humano` devuelve `atencionEn` e `instruccion`, y quien redacta (MediBot) solo puede decir lo que esos datos permiten. "En breve te contactamos" un domingo a las 11 de la noche es mentira, y el paciente se queda junto al teléfono
- **Una escalación `vencida` no se cierra sola. Nunca.** Es la garantía entera de la función, y hay una prueba que se cae si alguien agrega un barrido de "limpiar viejas". Silenciarla sin cerrarla haría que en dos semanas nadie mirara esa pestaña
- **Dos superficies, dos criterios.** `api.publico.*` (landing, encuesta) resuelve por *¿hay backend?*; todo lo demás por *¿hay sesión?*. No mezclarlas: `nps.responder()` es el paciente contestando desde su celular y `nps.registrar()` es el panel capturando. Confundirlas hizo que sembrar la demo escribiera en la base de una clínica real mientras las citas se quedaban en el navegador
- **Las páginas de personal exigen sesión cuando hay backend** (`sesionExigirAcceso()`). Sin eso, recepción abriendo el panel sin haber entrado lo ve arrancar en modo local: pantalla completa, vacía, y todo lo que capture se guarda en su navegador. Pensaría que perdió los expedientes
- **Toda rutina de arranque abre con `await window.APIListo`.** No es por el orden de carga —los módulos ES corren antes de `DOMContentLoaded`— sino porque saber si hay una clínica real detrás requiere preguntarle a Supabase, y de eso dependen decisiones como no sembrar datos de demostración
- El cruce de pacientes por teléfono se hace **por los últimos 10 dígitos**, y vive en un solo lugar (`api-local.mjs` / columna generada en Postgres). Antes estaba copiado en `app.js`, `admin.js`, `medidocs.js` y `pacientes.js` con criterios distintos, y por eso el mismo número escrito con guiones creaba un expediente duplicado
- **Todo lo del inbox pasa por `conversaciones-store.js`**, que a su vez delega en `api.mjs`. Ningún otro archivo del módulo toca conversaciones, mensajes ni pacientes
- Los adaptadores de canal son funciones **puras** — sin DOM, sin localStorage, sin fetch. Es lo que permite probarlos en node y lo que hará que conectar un webhook real sea cableado y no reescritura

---

## Lo construido — Fase 1 (Core)

### Página principal (`index.html`) — 2 junio 2026

- **Navbar** fijo con transición de transparente a blanco al hacer scroll; menú hamburger en móvil
- **Hero** con título, descripción, CTA de agendamiento, estadísticas de la clínica y tarjeta ilustrativa de cita confirmada
- **Grid de especialidades** (8 tarjetas): Medicina General, Cardiología, Pediatría, Ginecología, Traumatología, Dermatología, Oftalmología, Neurología — al hacer clic pre-seleccionan la especialidad en el formulario y hacen scroll automático
- **Sección "¿Cómo funciona?"** con 4 pasos visuales
- **Formulario de solicitud de cita** con:
  - Datos del paciente (nombre, apellidos, teléfono, email)
  - Selector de especialidad → filtra médicos disponibles
  - Selector de médico → muestra horarios disponibles
  - Selector de fecha (rango: mañana hasta 60 días)
  - Botones de horario dinámicos
  - Tipo de consulta (primera vez, seguimiento, urgencia, revisión)
  - Campo de notas adicionales
- **Modal de confirmación** con resumen de datos antes de enviar
- **Pantalla de éxito** con folio generado automáticamente (`CIT-AAMMDD-XXXX`)
- **Footer** con columnas de especialidades, navegación y contacto

### Panel de administración (`admin.html`) — 3 junio 2026

- **Header fijo** oscuro con accesos a "Ver sitio", "Exportar CSV" y "Cargar muestra"
- **4 tarjetas de estadísticas**: Total de citas · Citas de hoy · Pendientes · Confirmadas
- **Barra de filtros**: búsqueda por texto libre, filtro por fecha, médico y estado; botón "Hoy"; botón "Limpiar"
- **Tabla de citas** con columnas: Folio · Paciente · Médico/Especialidad · Fecha/hora · Tipo · Estado · Acciones
- **Cambio de estado inline** por dropdown (Pendiente / Confirmada / Atendida / Cancelada); persiste en localStorage
- **Eliminar cita** con confirmación de diálogo nativo
- **Exportar CSV** con BOM UTF-8 para compatibilidad con Excel
- **Datos de muestra** (9 citas realistas) para demostración inmediata
- **Toast de notificaciones** no intrusivo en esquina inferior derecha
- **Sincronización entre pestañas** vía evento `storage`

### Chat con agente de IA (`chat.html`) — 3–4 junio 2026

- Interfaz estilo WhatsApp: fondo oscuro, burbujas, campo fijo abajo
- Loop agéntico con máx. 12 iteraciones; llamada directa al browser con `anthropic-dangerous-direct-browser-access: true`
- **13 tools disponibles:** `listar_especialidades`, `listar_doctores`, `leer_todas_las_citas`, `buscar_citas`, `crear_cita`, `actualizar_estado_cita`, `eliminar_cita`, `enviar_email_paciente`, `ver_satisfaccion_pacientes`, `buscar_paciente`, `ver_documentos_paciente`, `ver_notas_paciente`, `ver_nps_paciente`
- Typing indicator con texto dinámico por tool activa
- Demo pre-cargado con credenciales en atributos `value` del HTML

---

## Fase 2 — Nuevas funcionalidades (Plan activo)

### Estrategia general

El objetivo es expandir MediCita de "agente de citas" a "suite de productividad para clínicas". Los nuevos módulos están diseñados para que la asistente (no el médico) los use diariamente, liberando su tiempo y generando valor visible. Esto elimina la percepción de MediCita como amenaza al puesto y la convierte en una herramienta que potencia a la asistente.

Los módulos se monetizan por nivel de plan:
- **Plan Esencial** ($800/mes): solo core (citas + agente básico) — sin cambios
- **Plan Profesional** ($1,800/mes): + M1 MediPost + M2 MediFollow
- **Plan Premium** ($3,200/mes): + M3 MediAnalytics + M4 MediDocs + todo lo anterior

---

### Módulo 1 — MediPost: generador de contenido para redes sociales ← IMPLEMENTAR PRIMERO

**Estado:** ✅ Completo (23 junio 2026) — Mejora de prompt IA en imagen (23 junio 2026)

**Mejora — Prompt IA para imagen (23 junio 2026):** El bloque `[SUGERENCIA_IMAGEN]` ahora devuelve dos partes separadas por `|`: descripción en español para la asistente + prompt en inglés optimizado para generadores de imágenes IA. En la UI se muestra la descripción como siempre, más una caja monoespaciada con el prompt copiable y tres botones de acceso rápido: Adobe Firefly (con prompt pre-llenado en URL vía `encodeURIComponent`), Leonardo AI y Canva IA (solo abren la página, con tooltip indicando que se debe pegar el prompt).

**Concepto:** La asistente llena un formulario simple (tipo de post, especialidad, tono, red social), Claude genera el caption completo con hashtags y sugerencia de imagen, y la asistente lo copia y publica manualmente. No hay OAuth ni publicación automática en v1 — el flujo manual es suficiente para la propuesta de valor.

**Por qué primero:** Es el más visible en demo. En 10 segundos se puede mostrar el resultado a un prospecto. Cierra ventas.

**Archivos a crear:**
- `medipost.html` — página principal del módulo
- `css/medipost.css` — estilos propios
- `js/medipost.js` — lógica: formulario, llamada a Claude API, render de resultado, historial

**Archivos a modificar:**
- `admin.html` — agregar acceso a MediPost en el header (junto a "Ver sitio" y "Exportar CSV")

**Llamada a Claude API:**
- Vía el proxy serverless `/api/chat` (mismo que usa `chat.js` actualmente) — sin API Key en el cliente, la clave vive en `ANTHROPIC_API_KEY` del entorno del servidor
- Sin tool use — respuesta simple de texto con estructura definida por el prompt
- El prompt instruye a Claude a devolver el resultado en secciones claramente delimitadas: `[CAPTION]`, `[HASHTAGS]`, `[SUGERENCIA_IMAGEN]`, `[LLAMADA_A_ACCION]`
- Parsear la respuesta en JS para mostrar cada sección en su propio bloque con botón "Copiar"

**Tipos de post a soportar:**
1. Consejo de salud (por especialidad)
2. Presentación de servicio o doctor
3. Recordatorio estacional (vacunas, revisiones periódicas)
4. Promoción o descuento
5. Testimonio anonimizado de paciente
6. Dato curioso de salud

**Redes a soportar:** Instagram · Facebook · Google Business · LinkedIn

**Persistencia:**
- Clave `medicita_posts` en localStorage
- Guardar: id, tipo, especialidad, red, caption, hashtags, creadoEn, borrador (bool)
- Máximo 50 posts guardados (FIFO cuando se llena)

**UX clave:**
- Selector visual de red social con íconos (no dropdown)
- Selector visual de tono: Profesional · Cercano · Educativo · Motivacional
- Preview del post con formato visual (simula cómo se vería en la red)
- Botones "Copiar caption" y "Copiar hashtags" independientes
- Botón "Regenerar" para pedir otra versión sin cambiar los inputs
- Historial de los últimos 10 posts generados en sidebar o sección inferior
- Indicador de caracteres (Instagram recomienda <125 para caption principal)

**Limitación conocida:** No publica automáticamente — requiere OAuth con cada red social, lo cual necesita backend y app aprobada por Meta/Google. En v1, el flujo es generar → copiar → publicar manualmente. Documentar esto claramente en la UI con un mensaje tipo "Copia el contenido y publícalo en tu red social".

---

### Módulo 2 — MediFollow: seguimiento post-consulta automatizado

**Estado:** ✅ Completo (23 junio 2026)

**Paso 1 completado (23 junio 2026):**
- `encuesta.html` + `css/encuesta.css` + `js/encuesta.js` — encuesta NPS mobile-first. Lee folio de URL, valida formato, detecta respuesta duplicada, muestra formulario con botones visuales 1–10 (código de color: rojo/ambar/verde), guarda en `medicita_nps`, pantalla de gracias con mensaje adaptado a la puntuación.
- Configuración global de clínica (`medicita_config_clinica`): modal "⚙️ Configurar clínica" en header de `admin.html` con 7 campos (nombreClinica, nombreMedico, especialidadPrincipal, ciudad, telefono, email, logoUrl). Persiste en localStorage. `medipost.js` lee esta config para personalizar el prompt de sistema de Claude.

**Paso 2 completado (23 junio 2026):**
- Trigger en `admin.js`: al cambiar estado a "Atendida", llama `registrarSeguimientoPendiente()` + `enviarEmailSeguimientoInmediato()`.
- Email inmediato: HTML branded con link a `encuesta.html?folio=XXXX` + recomendaciones post-consulta + datos de clínica desde `medicita_config_clinica`.
- Emails diferidos día 3 y día 30: `buildEmailDiferidoHTML()` con contenido adaptado a cada momento.
- Sección "Seguimientos pendientes" en `admin.html` (entre stats y filtros): tabla con estado por paciente, chips de estado (Enviado / En N días / ⏰ Enviar ahora), botones de envío manual.
- Badge "⏰ N pendientes" animado en el header de admin, oculto si N=0.
- Configuración de EmailJS (Service ID + Template ID + Public Key) integrada en el modal "Configurar clínica" — se guarda solo en memoria, no en localStorage. Al guardar el modal, inicializa `emailjs.init()`.
- CDN de EmailJS v4 cargado en `admin.html`.

**Paso 3 completado (23 junio 2026):**
- Dashboard NPS en `admin.html`: quinta tarjeta de estadísticas "Satisfacción" con promedio en color semántico (verde ≥8, ambar 6–7, rojo ≤5). Sección "Opiniones de pacientes" con tabla de últimas 5 respuestas (folio, paciente, puntuación coloreada, comentario, fecha); botón "Ver todas" que expande la lista completa. Se actualiza automáticamente vía storage event si el paciente responde desde otra pestaña.
- Tool `ver_satisfaccion_pacientes` en `chat.js`: MediBot puede responder preguntas como "¿cómo está la satisfacción?" o "¿cuántos seguimientos pendientes tenemos?". Devuelve: promedioNPS, totalRespuestas, últimas 5 opiniones (con nombre del paciente cruzado desde `medicita_citas`), y seguimientosPendientes.

**Concepto:** Al cambiar el estado de una cita a "Atendida" en admin.js, se dispara automáticamente un email de seguimiento al paciente. Adicionalmente, admin.html muestra una cola de seguimientos diferidos (día 3 y día 30) que la asistente envía manualmente con un clic.

**Archivos creados (Paso 1):**
- `encuesta.html` — página de encuesta NPS mobile-first
- `css/encuesta.css` — estilos propios de la encuesta
- `js/encuesta.js` — lógica: validar folio, botones NPS, guardar en `medicita_nps`

**Archivos modificados (Paso 1):**
- `admin.html` — botón "⚙️ Configurar clínica" en header + modal con 7 campos
- `js/admin.js` — lógica completa del modal de config (leer/guardar `medicita_config_clinica`)
- `css/admin.css` — estilos del modal y del botón config
- `js/medipost.js` — `buildSystemPromptMP()` ahora lee `medicita_config_clinica` e inyecta nombre, ciudad y especialidad de la clínica

**Archivos modificados (Paso 3):**
- `admin.html` — quinta tarjeta de stats (Satisfacción NPS) + sección "Opiniones de pacientes" con tabla y botón "Ver todas"
- `js/admin.js` — `renderStats()` actualizado con promedio NPS; nueva `renderOpinionesRecientes()`; storage listener para `medicita_nps`
- `css/admin.css` — stats-grid de 5 columnas, `.card-satisfaccion`, colores NPS, estilos `.nps-card`
- `js/chat.js` — tool `ver_satisfaccion_pacientes` (definición + handler + mención en system prompt)

**Email inmediato (al marcar Atendida):**
- Asunto: "Gracias por tu visita, [nombre] — ¿cómo te sentiste?"
- Contenido: agradecimiento + link a `encuesta.html?folio=XXXX` + instrucciones post-consulta genéricas
- Usa EmailJS igual que el resto del sistema

**Emails diferidos (día 3 y día 30):**
- No son automáticos (requeriría backend/cron). Son recordatorios visuales en admin.html
- Badge "⏰ 2 seguimientos pendientes" en el header de admin
- La asistente abre la sección "Seguimientos", ve los pendientes por fecha y hace clic en "Enviar" para cada uno
- Al enviar, se actualiza `medicita_followup_pendientes` marcando `emailEnviado_3d: true` o `emailEnviado_30d: true`

**Encuesta NPS (`encuesta.html`):**
- Diseño limpio y mobile-first (el paciente la abre desde su celular)
- Pregunta principal: "Del 1 al 10, ¿qué tan probable es que recomiendes a tu médico?" con botones visuales
- Campo de texto opcional: "¿Algo que quieras comentarnos?"
- Al enviar: guarda en `medicita_nps` y muestra pantalla de agradecimiento
- La clave es que el `folio` en la URL vincula la respuesta con la cita correcta

**Dashboard NPS en admin.html (implementado en Paso 3):**
- Quinta tarjeta "Satisfacción" con promedio NPS y color semántico (verde/ambar/rojo)
- Sección "Opiniones de pacientes" con tabla de últimas 5 respuestas; botón "Ver todas" para expandir

---

### Módulo 3 — MediAnalytics: panel de inteligencia del consultorio

**Estado:** ✅ Completo (23 junio 2026)

**Concepto:** Nueva pestaña "Analytics" en admin.html que muestra gráficas de ocupación, no-shows, distribución por especialidad y horarios de mayor demanda. Botón "Analizar con IA" que manda el resumen de datos a Claude y recibe insights en lenguaje natural.

**Archivos a crear:**
- `js/analytics.js` — funciones de cálculo de métricas + renderizado de gráficas con Chart.js + llamada a Claude para insights

**Archivos a modificar:**
- `admin.html` — nueva pestaña "Analytics" en la navegación del panel + sección con gráficas y botón de IA
- `css/admin.css` — estilos para gráficas, tarjetas de métricas y sección de insights

**Dependencia nueva:** Chart.js vía CDN (`https://cdn.jsdelivr.net/npm/chart.js`) — aprobado en convenciones

**Métricas a mostrar:**
1. Ocupación semanal (citas atendidas vs total de slots disponibles) — gráfica de barras
2. Distribución por especialidad — gráfica de dona
3. Distribución por estado (pendiente/confirmada/atendida/cancelada) — gráfica de dona
4. Horarios de mayor demanda (heatmap simplificado: día × franja horaria) — tabla con colores
5. Tasa de no-shows (canceladas / total) — número grande con color semántico
6. Pacientes nuevos vs recurrentes (por nombre+teléfono) — gráfica de barras

**Selector de rango:** Última semana · Último mes · Últimos 3 meses · Todo el tiempo

**Insights de IA:**
- Botón "Analizar con IA" visible y con buen peso visual
- Al hacer clic: construir un resumen estructurado de los datos en texto y mandarlo a Claude API (sin tool use, respuesta simple)
- Prompt instruye a Claude a devolver 3–5 insights accionables en español, con formato de lista
- Mostrar los insights en un panel con diseño de "recomendaciones del consultor"
- Ejemplos de insights que Claude puede detectar: "Los martes tienen 40% de no-shows — considera llamar de confirmación el lunes", "La Dra. García tiene 3 slots sin ocupar cada semana a las 7am", "15 pacientes no han regresado en más de 90 días"

---

### Módulo 4 — MediDocs: generador de documentos clínicos

**Estado:** ✅ Completo (23 junio 2026)

**Concepto:** Página dedicada donde la asistente selecciona el tipo de documento, vincula una cita existente (autocompletado por folio) e ingresa los datos clínicos mínimos. Claude genera el documento formateado con el membrete de la clínica. Se puede imprimir directamente o enviar por email al paciente vía EmailJS.

**Archivos a crear:**
- `medidocs.html` — página principal del módulo con formulario + preview
- `css/medidocs.css` — estilos del formulario, preview del documento y `@media print`
- `js/medidocs.js` — lógica: formulario, llamada a Claude, render de preview, imprimir, enviar, historial

**Archivos a modificar:**
- `admin.html` — botón "Generar documento" en la columna Acciones de cada cita en la tabla

**Tipos de documento soportados:**
1. Nota de consulta (formato SOAP simplificado: Subjetivo, Objetivo, Análisis, Plan)
2. Receta médica con membrete
3. Carta de referencia a especialista
4. Constancia de atención médica
5. Constancia de incapacidad temporal
6. Consentimiento informado (genérico)

**Flujo técnico:**
1. Asistente selecciona tipo de documento
2. Busca cita por folio (autocompletado desde `medicita_citas`) — se precargan nombre, médico, fecha
3. Ingresa los campos clínicos del formulario (diferentes por tipo de doc)
4. Clic en "Generar documento"
5. Claude API genera el texto del documento (sin tool use, respuesta simple con formato HTML interno)
6. Preview se muestra en pantalla derecha con diseño de membrete
7. Botón "Imprimir" → `window.print()` con `@media print` que oculta el formulario y muestra solo el documento
8. Botón "Enviar por email" → EmailJS con el HTML del documento
9. Metadatos guardados en `medicita_docs`: `{id, folio, tipodoc, inputs, creadoEn}` — el HTML se regenera desde los inputs cuando se necesita

**Membrete configurable:**
- Nombre de la clínica, dirección, teléfono, email, logo (URL de imagen)
- Guardado en `localStorage` bajo `medicita_config_clinica`
- Se puede editar desde una sección de configuración en el mismo `medidocs.html`

**Consideración de localStorage:**
- Guardar solo metadatos + inputs del formulario, NO el HTML generado
- Al abrir un documento del historial: recuperar inputs + llamar a Claude de nuevo para regenerar
- Máximo 100 documentos en historial (FIFO)

**@media print:**
- Ocultar: formulario, header de admin, botones, sidebar
- Mostrar: solo el documento con membrete, a full width, con tipografía apropiada para impresión
- Fuente de impresión: serif para el cuerpo del documento (más formal), sans para campos de datos

---

## Decisiones técnicas globales para Fase 2

| Decisión | Elegida | Descartada | Razón |
|---|---|---|---|
| Publicar en redes | Copiar/pegar manual | OAuth con Instagram/Meta API | OAuth requiere backend + app aprobada. Fuera de scope v1. |
| Emails diferidos (día 3, 30) | Recordatorio visual + envío manual | setTimeout / cron job | setTimeout no persiste. Cron requiere backend. |
| Gráficas | Chart.js vía CDN | D3.js / CSS puras | Chart.js es suficiente, buena doc, sin build step. |
| PDF en MediDocs | `window.print()` + CSS @media print | jsPDF | Sin dependencias extra. Suficiente para docs clínicos en v1. |
| Almacenamiento docs | Metadatos + regeneración con Claude | HTML completo en localStorage | Evita llenar los 5MB del localStorage. |
| API Key en nuevos módulos | Misma mecánica que chat.js (input en UI → memoria) | Hardcoded | Consistencia con el resto del proyecto. |

**Banner de upsell a backend:** Agregar en `admin.html` un banner discreto: *"Los datos se guardan en este dispositivo. Actualiza al Plan Premium para sincronización en la nube."* — convierte la limitación técnica de localStorage en argumento de venta.

---

### Módulo 5 — MediPacientes: directorio de pacientes

**Estado:** ✅ Completo (24 junio 2026)

**Concepto:** CRM básico de pacientes integrado en el panel de administración. Los perfiles se crean automáticamente al agendar una cita o al cargar datos de muestra, y se mantienen sincronizados con las citas, documentos y respuestas NPS de cada paciente. La asistente puede ver el historial completo de cada paciente desde una sola pantalla.

**Clave localStorage:** `medicita_pacientes` — array de perfiles (ver estructura en sección de claves)

**Monetización:** Plan Premium — se incluye junto con M3 y M4 en el plan de $3,200/mes.

**Archivos creados:**
- `js/pacientes.js` — lógica del directorio: CRUD localStorage, render cards/tabla, búsqueda/filtros, modal nuevo/editar, panel perfil individual, notas con historial, exportar CSV, interconexión

**Archivos modificados:**
- `admin.html` — pestaña "Pacientes" + panel lateral `#panel-perfil-pac` (slide-in) + botón "Exportar CSV" + sección de métricas de pacientes en pestaña Analytics
- `css/admin.css` — estilos del directorio, panel lateral, tabs del perfil, listas de citas/docs/notas, badge VIP, separador y KPIs demográficos en analytics
- `js/app.js` — `vincularPacienteDesdeIndex()` al confirmar cita + pre-fill de datos desde `sessionStorage` (para "Agendar nueva cita" desde perfil)
- `js/admin.js` — `pacientesAsegurarVinculo()` en `cambiarEstado()` y `cargarDatosMuestra()` + `getPacVIPMap()` + badge ⭐ VIP en tabla de citas
- `js/analytics.js` — `renderMetricasPacientes()` + gráficas de sexo, ciudades, origen + KPIs de edad promedio, % VIP, total
- `js/medidocs.js` — `vincularDocConPacienteMD()` al guardar documento

**Interconexión automática:**
- **Desde `index.html`:** Al confirmar cita, `app.js` busca paciente por teléfono. Si existe: agrega folio a `foliosCitas`. Si no: crea perfil básico automático.
- **Desde `admin.html`:** Al cambiar estado de cita (o cargar muestra), `admin.js` asegura que el paciente tenga el folio vinculado.
- **Desde `medidocs.html`:** Al guardar documento, `medidocs.js` agrega el ID del documento a `foliosDocs` del paciente.

**Funcionalidad Paso 1 — Directorio:**
- Pestaña "👥 Pacientes" entre Opiniones y Analytics
- Barra de búsqueda libre (nombre, teléfono, email)
- Filtros: VIP, Sexo, Cómo nos encontró
- Toggle de vista: 🗂 Cards | 📋 Tabla
- Cards con: avatar iniciales, nombre, estrellas VIP, contacto, total citas, especialidad frecuente, última cita
- Modal completo: 4 secciones (Identificación · Datos médicos · Info adicional · VIP + Notas)
- Selector VIP: 3 botones estrella

**Funcionalidad Paso 2 — Perfil individual + Integraciones:**
- Botón "👤 Ver perfil" en cada card y fila de tabla
- Panel lateral slide-in desde la derecha (460px) con overlay
- 4 pestañas internas: Datos · Citas · Docs · Notas
  - **Datos:** todos los campos del paciente en modo lectura + botón "Editar datos"
  - **Citas:** lista de citas vinculadas (fecha, médico, estado) + botón "Agendar nueva cita" (abre index.html con datos pre-llenados via sessionStorage)
  - **Docs:** lista de documentos generados con tipo, fecha y link a MediDocs
  - **Notas:** textarea para agregar notas internas con timestamp + historial de hasta 20 notas (campo `historialNotas[]` en el perfil)
- Botón "⬇ Exportar CSV" en header de la pestaña → descarga directorio completo con todos los campos
- Badge "⭐ VIP" en tabla de citas de admin para pacientes con calificación 3
- Métricas de pacientes en pestaña Analytics: dona sexo, barras ciudades, dona origen, KPIs edad promedio / % VIP / total

---

## Fase B1 — Cimientos del backend (Supabase)

**Estado:** ✅ Completo (26 julio 2026)

**Por qué existe:** las dos funciones que siguen —escalar a un humano y contacto proactivo del agente— son *imposibles* sin backend, no difíciles. Una pestaña del navegador no puede despertar a las 9 am a recordarle su cita a un paciente, y un webhook de WhatsApp no puede escribir en el `localStorage` de nadie.

**B1 no rompió nada.** El sistema sigue corriendo como antes; encima existe ahora una base de datos real, con autenticación real y verificada por pruebas.

### Modelo de despliegue

**Un proyecto de Supabase por clínica** ($25 USD el primero, $10 cada adicional). Cada cliente tiene su base; nadie comparte tabla con nadie.

Aun así, el esquema está diseñado como multi-inquilino: `clinica_id` + RLS en las 11 tablas. Suena contradictorio y no lo es — agregar `clinica_id` hoy cuesta casi nada y deja las dos puertas abiertas; agregarlo después, con expedientes reales adentro, es la migración que nadie quiere hacer. RLS queda además como segunda cerradura.

### Doble modo — por qué no se tiró el código viejo

| Sin sesión | Con sesión |
|---|---|
| `api-local.mjs` → `localStorage` | `api-remoto.mjs` → Supabase |
| Es la demo pública: clicable por cualquiera sin registrarse | Es una clínica de verdad |

El interruptor es la sesión, y vive en `supabase-client.mjs`. La demo abierta es la herramienta de venta, así que conservar el camino local no es deuda: es un requisito de producto.

### Archivos

```
supabase/migrations/     0001 utilidades · 0002 clínicas y staff · 0003 pacientes
                         0004 citas · 0005 conversaciones y módulos · 0006 RPC públicas
                         0007 testimonios públicos · 0008 campos faltantes de posts
supabase/seed-clinica.sql  Alta de una clínica nueva (se pega en el panel)
supabase/reset-datos.sql   Vaciar los datos de una clínica (se pega en el panel)
supabase/cron.sql          El reloj de las escalaciones (pg_cron + pg_net)
docs/nueva-clinica.md      Procedimiento completo de aprovisionamiento
js/supabase-client.mjs     Cliente por CDN + detección de modo
js/api.mjs                 Interfaz única (39 métodos) + despachador
js/api-local.mjs           Implementación localStorage
js/api-remoto.mjs          Implementación Supabase + traducción de formas
js/sesion.mjs              Autenticación real (+ fallback de demo desde B2)
js/migrar.mjs              localStorage → Postgres, idempotente
js/config-local.ejemplo.mjs  Plantilla de credenciales de desarrollo
login.html + css/login.css
migrar.html
scripts/servidor.mjs       Servidor estático de desarrollo (npm run dev)
scripts/bundle-migraciones.mjs  Concatena las migraciones para pegarlas de una
scripts/verificar-supabase.mjs  Comprueba el proyecto real (npm run db:verificar)
tests/db-harness.mjs       Postgres en WASM + entorno de Supabase simulado
tests/db-aislamiento.test.mjs · db-flujos.test.mjs · api-paridad.test.mjs
```

**Convención nueva:** los archivos `.mjs` son módulos ES; los `.js` siguen siendo scripts clásicos que definen globales. La distinción no es cosmética — en node, un `.js` sin `"type": "module"` es CommonJS y no se puede importar.

### Dónde viven las credenciales

En el repositorio, las etiquetas `<meta name="supabase-url">` y `<meta name="supabase-anon-key">` quedan **en marcador (`TU_…`) a propósito**, y con marcador el sistema cae en modo local.

No es por ocultar la publishable key —es pública por diseño, va escrita en el HTML de cualquier despliegue y cualquiera puede leerla; lo que protege los datos es RLS—. Es porque **este repositorio es la plantilla de la siguiente clínica**: si viniera con las credenciales de un cliente anterior, un despliegue nuevo arrancaría escribiendo en la base de otra clínica. Eso no sería una fuga, sería un cruce de expedientes, y silencioso.

Para desarrollar se copia `js/config-local.ejemplo.mjs` como `js/config-local.mjs` (está en `.gitignore`). Aplica a todas las páginas de una vez y **solo se carga en localhost**, para que ningún despliegue real pida un archivo que nunca va a existir. Es también de donde `npm run db:verificar` toma las credenciales.

La `sb_secret_…` (antes *service_role*) no aparece en ninguna parte del repositorio ni del frontend: se salta RLS por completo y vive solo en variables de entorno de Vercel.

### Contrato de formas

Lo que sale de `api.mjs` son **las mismas formas que ya vivían en localStorage** (camelCase, `folio`, `creadoEn`). Postgres usa snake_case y la traducción se concentra en los mapeadores `deDb*`/`aDb*` de `api-remoto.mjs`.

Es deliberado: cuando los 9 módulos pasen a esta capa (B2), no van a cambiar *cómo* leen un paciente, solo *de dónde*.

### Seguridad — lo que la base garantiza

- **RLS en las 11 tablas.** Verificado por prueba automática, no por inspección: `tests/db-aislamiento.test.mjs` levanta dos clínicas y comprueba tabla por tabla que ninguna alcanza los datos de la otra, ni leyendo ni escribiendo.
- **El rol anónimo no tiene política sobre ninguna tabla.** Los dos flujos públicos (pedir cita desde la landing, responder la encuesta) pasan por funciones `SECURITY DEFINER` que validan por dentro. La anon key va escrita en el HTML y es pública por diseño; lo que protege es RLS.
- **La landing lee `clinica_publica`**, una vista que expone solo lo que la clínica publica de todos modos. El plan contratado no sale por ahí.
- **`solicitar_cita` frena abuso**: máximo 5 solicitudes por teléfono cada 24 h.
- **La service role key nunca toca el frontend.** Solo variables de entorno de Vercel.

### Invariantes que ahora sostiene la base, no el código

| Antes (buena voluntad del JS) | Ahora (garantía de Postgres) |
|---|---|
| Cruce de teléfonos copiado en 4 archivos | Columna generada `telefono_clave` (últimos 10 dígitos) + índice único |
| Idempotencia de mensajes por convención | Índice único sobre la clave del proveedor |
| Identidad de conversación por búsqueda esperanzada | Índice único: clave externa, o canal + teléfono |
| Resumen del último mensaje actualizado por quien escribe | Disparador — importa porque los webhooks insertarán sin pasar por el navegador |
| Una encuesta por cita, comprobada en el navegador | Índice único sobre `cita_id` |

### Dos bugs que encontraron las pruebas

1. **Colisión de folios y de códigos de paciente.** `CIT-AAMMDD-XXXX` y `PAC-YYYYMMDD-XXXX` llevan 4 dígitos aleatorios: 10 000 combinaciones por día. Con ~60 registros diarios la probabilidad de choque ronda el 16%, y ahora son únicos en la base. Sin reintento, el formulario se le caería en la cara a un paciente. `solicitar_cita` reintenta hasta 12 veces, y si el choque fue de teléfono, reutiliza el expediente existente (que además cubre la carrera de dos solicitudes simultáneas).
2. **Pruebas intermitentes** por levantar varios Postgres en WebAssembly en paralelo. Se corrigió con `--test-concurrency=1`.

### Lo que NO entró en B1

Los 9 módulos seguían leyendo `localStorage` directamente: **el corte fue B2**. Un estado híbrido habría sido peor que el anterior — `pacientes` lo leen cinco archivos distintos, y tenerlo a medias en Postgres rompería los vínculos.

Por lo mismo, `js/sesion.js` (el gate falso) siguió existiendo durante B1. **En B2 se borró**: el inbox ya usa `js/sesion.mjs`.

---

## Fase B2 — El corte: los módulos pasan a `js/api.mjs`

**Estado:** ✅ Completo (26 julio 2026)

Los 9 módulos dejaron de tocar `localStorage`. Ahora todos leen y escriben por `js/api.mjs`, que decide —según el modo— si eso significa este navegador o Postgres. Se hizo de golpe: `pacientes` lo leen cinco archivos, y a medias los vínculos entre expediente, cita, documento y conversación se habrían roto en silencio.

### El puente: scripts clásicos ↔ módulos ES

Los 9 módulos son `<script src>` clásicos; `api.mjs` es un módulo ES, y un script clásico no puede `import`. Lo cruza **una sola pieza**, `js/puente-api.js`, que publica `window.API`, `window.APIListo` y `window.MODO_DATOS`. Lo mismo hace `js/puente-sesion.js` con `window.Sesion` para el inbox.

**Los puentes son scripts clásicos, no módulos, y eso importa.** El primer intento fue `puente-api.mjs` con `<script type="module">`, dando por hecho que los módulos corren antes de `DOMContentLoaded`. Eso solo vale para módulos **sin `await` de nivel superior**: `supabase-client.mjs` tiene uno —el que intenta cargar `config-local.mjs`— y un módulo suspendido ahí **no** retrasa el evento. Cada módulo arrancaba con `window.API` sin definir, reventaba con `API is not defined` y dejaba la página sin un solo manejador de eventos registrado: los botones simplemente no respondían.

La guardia `await window.APIListo` tampoco salvaba nada, porque en ese instante `window.APIListo` era `undefined` y `await undefined` resuelve de inmediato. Siendo scripts clásicos sin `defer`, los puentes se ejecutan durante el parseo, antes que `admin.js` y compañía, así que la promesa ya existe cuando alguien la espera. El módulo se carga con `import()` dinámico, permitido desde un script clásico.

Cada rutina de arranque abre con `await window.APIListo`. No es por el orden de carga —los módulos ES corren antes de `DOMContentLoaded`— sino porque **saber si hay una clínica real detrás requiere preguntarle a Supabase**, y de eso dependen decisiones que no admiten equivocarse: `sembrarDemoSiVacio()` inyectaba nueve citas de muestra en la primera visita, y contra una base de producción eso habría metido pacientes inventados al expediente de una clínica real.

### Async de punta a punta, no una copia síncrona en memoria

Se descartó hidratar una instantánea síncrona al arrancar, que habría sido un diff mucho menor. La razón: en modo remoto hay varias personas trabajando a la vez —recepción y consultorio—, y una instantánea síncrona queda obsoleta sin avisar. Eso es exactamente el problema que el backend viene a resolver, y sería absurdo reintroducirlo en la capa de arriba.

El costo real resultó moderado: los 76 puntos de contacto tenían, sin excepción, un ancestro que era manejador de evento o rutina de arranque, así que el `await` se propagó dentro de cada archivo y no cruzó a otros.

### El bug que B2 destapó: la superficie sin sesión

`modoActual()` devuelve `"remoto"` solo si hay **sesión**. Pero tres flujos del sistema ocurren por diseño **sin** sesión: un paciente pide cita desde la landing, responde la encuesta, y la landing muestra los datos de la clínica.

Con el interruptor original, en la landing de una clínica real la cita de un paciente se habría guardado en el `localStorage` de su propio navegador. La clínica nunca se habría enterado, y el paciente se habría presentado con un folio que no existía en ninguna parte. Lo mismo con las respuestas de la encuesta.

B1 había construido las piezas correctas —la vista `clinica_publica` y las funciones `SECURITY DEFINER` `solicitar_cita` y `responder_encuesta`— y nada las alcanzaba nunca.

La corrección es `api.publico`, que resuelve contra el backend **siempre que exista uno**, haya sesión o no. Para esa superficie el criterio correcto no es *¿hay sesión?* sino *¿hay backend?*.

### Testimonios: un hueco de privacidad que ya existía

La sección de opiniones de la landing cruzaba en el navegador las respuestas NPS con las citas para sacar el nombre del paciente. Es decir: **la página pública cargaba el arreglo completo de citas** —nombres, teléfonos, correos y notas de todos los pacientes— para mostrar un nombre de pila.

Se resolvió con la vista `testimonios_publicos` (migración 0007), calcada del patrón ya probado de `clinica_publica`: expone nombre de pila más inicial, puntuación, comentario y fecha, y nada más. El recorte se aplica **también en modo local**, para que la página no quede escrita contra un contrato que solo se cumple en uno de los dos modos. Cinco pruebas de aislamiento lo sostienen.

### Otros dos huecos encontrados al conectar

1. **`posts` perdía tres de cuatro campos.** La tabla tenía columnas para caption y hashtags, pero no para la sugerencia de imagen, el prompt en inglés ni la llamada a la acción. Una clínica con backend habría guardado la mitad de cada post sin ningún error visible. Corregido en la migración 0008.
2. **Los documentos no traían folio en remoto.** `api-local` devolvía `folio`; `api-remoto`, solo `cita_id`. El historial de MediDocs habría salido con la columna en blanco y el botón de regenerar no habría encontrado su cita. Se emparejó con un join.

### `conversaciones-store.js`, la costura que sí sirvió

Sus funciones devolvían `Promise` desde el primer día, aunque `localStorage` fuera síncrono. Eso permitió migrarlo reescribiendo cuerpos sin tocar **una sola llamada** en `conversaciones.js`, `chat.js` ni los adaptadores. Sus 65 pruebas pasaron sin cambiar una aserción — solo hubo que inyectarle la capa de datos, porque en node no hay `window`.

---

## Fase E — Horarios reales y escalación a humano

**Estado:** ✅ Completo (28 julio 2026)

Son las dos funciones que motivaron todo el backend, y hasta B2 eran *imposibles*, no difíciles: una pestaña del navegador no puede despertarse a las 11 de la noche a re-alertar de un paciente que nadie atendió.

### Por qué el horario tuvo que ir primero

El ruteo de una escalación depende del horario, y `clinicas.horario_atencion` era **texto libre** (`'Lun–Vie 9:00–14:00'`): sirve para imprimirlo en el membrete y para nada más. Ninguna máquina puede responder con eso si el consultorio está abierto ahora, ni cuándo vuelve a abrir — y la promesa que el agente le hace al paciente sale justo de ahí.

El otro requisito lo puso el uso: **la agenda de un consultorio es volátil**. El médico opera un jueves, se va a un congreso, mueve su tarde. Por eso son dos tablas y no una, y la interfaz lo dice con esas palabras: la *semana habitual* se cambia poco, los *próximos cambios* se cambian todo el tiempo.

| Tabla | Qué es |
|---|---|
| `horarios_base` | Bloques recurrentes por día. Varias filas cubren mañana y tarde sin campos raros |
| `horarios_excepciones` | Cierres, vacaciones o un día con otro horario. **Pisan** a la base en esa fecha |

Tres funciones sostienen todo lo demás: `horario_del_dia()`, `en_horario()` y `proxima_apertura()`. La última devuelve **`NULL`** si no encuentra horario en 14 días, en vez de una fecha cualquiera: es exactamente lo que el agente le diría a un paciente.

`clinicas.zona_horaria` es nueva y no es cosmética. Supabase corre en UTC: sin conversión explícita, las 3 de la tarde en Guadalajara se evalúan como las 21:00 y el consultorio sale cerrado seis horas antes de estarlo. De paso, `generar_folio_cita()` y `generar_codigo_paciente()` dejaron de tener `'America/Mexico_City'` incrustado — se reemplazaron **sin cambiar su firma**, para no reescribir `solicitar_cita()` por un prefijo de fecha.

### El ciclo de la escalación

```
pendiente ──(alguien la toma)──> reconocida ──> resuelta
    │
    └──(nadie la toma a tiempo)──> sube de nivel ──> vencida
```

- **Ruteo:** `urgencia_medica` y `duda_clinica` al doctor, `queja` a admin, el resto a recepción. Si no hay nadie con ese rol se cae al que sí existe: enrutar a un rol vacío es enrutar a nadie.
- **Plazos:** 5 / 15 / 60 minutos según urgencia. Fuera de horario el reloj **empieza cuando abren** — vencer una escalación de madrugada solo produce alertas que nadie puede atender, y enseña al personal a ignorarlas.
- **Salvo `urgencia_medica`**, que nunca espera: va al doctor con el reloj corriendo aunque sea domingo.
- **La escalera** (`promover_escalaciones`, en `pg_cron` cada minuto): nivel 0 → 1 amplía de un rol a todo el personal; 1 → 2 encola correo; 2 → 3 la marca **`vencida`**, marca su conversación y **se queda en rojo hasta que un humano la cierre**.
- **"La tomo"** detiene la escalera en seco. **Cerrar exige nota**: un cierre sin nota es indistinguible de alguien limpiando la lista para que deje de parpadear.

### La regla del 911

Ante `urgencia_medica`, lo primero que el agente dice es **llama al 911 o ve a urgencias ahora**, y solo después menciona la escalación. Está en la función (que devuelve la `instruccion`) y en el prompt, en los dos lados. Un agente de IA no retiene una posible emergencia en una cola. Ante la duda se trata como urgencia: equivocarse hacia ese lado no le cuesta nada a nadie, y hacia el otro sí.

### El reloj, y por qué está fuera de las migraciones

`pg_cron` y `pg_net` se habilitan a mano en el panel de Supabase, así que su programación vive en **`supabase/cron.sql`**, no en una migración — si no, el esquema no se podría probar contra un Postgres pelón, que es como corren las pruebas.

Son dos trabajos. El primero sube la escalera, entero dentro de Postgres. El segundo solo **toca el timbre**: `pg_net` hace un POST a `/api/avisar` con un token, y toda la lógica de armar y mandar el correo vive en `api/avisar.js`, donde se puede leer y arreglar sin migrar la base. El correo sale por la **API REST de EmailJS**, con la misma cuenta que ya usa MediFollow: cero proveedores nuevos por clínica.

Entre la escalera y el envío está `avisos_pendientes`, una bandeja de salida. Separarlos permite reintentar un correo sin volver a mover la escalación, y deja el hueco para que WhatsApp sea después solo otro remitente.

### MediBot dividido

Estaba ambiguo y era un hueco real: su prompt le habla al paciente, el inbox registra sus turnos como `remitente: "paciente"`, y sin embargo tenía `eliminar_cita`, `leer_todas_las_citas` y `ver_notas_paciente`. Contra el backend RLS ya le devolvería cero renglones a quien no tiene sesión, pero en la demo no hay nada que lo frene.

- **Personal** (con sesión): las 13 herramientas de siempre más las tres de horario. Sin `escalar_a_humano` — ya eres el humano.
- **Paciente** (sin sesión): consultar, agendar, preguntar el horario y `escalar_a_humano`.

Se decide por la sesión, no por un parámetro de URL, que sería una reja que se abre escribiéndola. Hay **segunda reja** en `ejecutarHerramienta`: no ofrecer la herramienta basta para que el modelo no la use, pero un prompt inyectado en un mensaje del paciente puede pedirla por su nombre. En modo demostración —donde no hay frontera que defender— sí existe `?perfil=paciente`, para poder enseñar el otro lado en una demostración de ventas.

### Modo demostración

Sin backend no hay reloj, y no se finge que lo haya. La escalera avanza cuando el panel llama a `escalaciones.promover()`, o sea **mientras la pestaña esté abierta**, y la pestaña lo dice con todas sus letras. En modo remoto ese método es un **no-op deliberado**: si el panel también empujara, dos relojes moverían las mismas filas y el nivel avanzaría al doble en las clínicas que dejan el panel abierto.

### Limitación conocida

Un MediBot **sin sesión no puede escribir su conversación en el inbox**: `conversacionesUpsert` necesita `clinica_actual()`, que exige sesión. La escalación no depende de eso —lleva nombre, teléfono y resumen propios, que es lo que hace falta para devolver el contacto—, pero el hilo de esa charla no queda registrado hasta que exista ingesta anónima. Es el mismo hueco que tienen los webhooks de terceros.

---

## Fase 0 — MediInbox: inbox unificado de conversaciones

**Estado:** ✅ Completo (26 julio 2026)

**Concepto:** El lugar donde toda conversación con un paciente queda registrada, buscable y vinculada a su expediente, **sin importar por qué canal llegó**. No es "el historial de MediBot": MediBot es apenas el primer canal que lo alimenta. Está diseñado para recibir WhatsApp, agentes de voz (ElevenLabs y similares), Doctoralia y lo que venga.

Se llama Fase 0 porque es la capa sobre la que se apoyan las integraciones con terceros, aunque se construyó después de la Fase 2.

### Arquitectura — 4 módulos con fronteras duras

| Archivo | Responsabilidad | Regla |
|---|---|---|
| `conversaciones-store.js` | Persistencia | Delega en `js/api.mjs` desde B2. Que sus funciones devolvieran `Promise` desde el primer día —aunque localStorage fuera síncrono— es lo que permitió migrarlo reescribiendo cuerpos y sin tocar una sola llamada. |
| `conversaciones-adapters.js` | Normalización por canal | Funciones **puras** `(payload) → {conversacion, mensajes[]}`. Sin DOM, sin localStorage, sin fetch. Por eso se prueban en node. |
| `conversaciones-envio.js` | Salida por canal | Decide si un mensaje realmente sale o queda pendiente. La UI nunca miente sobre esto. |
| `conversaciones.js` | Vista | No toca localStorage; todo pasa por el store. |

### Los adaptadores están escritos contra el payload REAL de cada proveedor

No contra un formato inventado. Ese es el punto entero del diseño:

- `adaptarMediBot` — formato Messages API de Anthropic. Filtra la fontanería de tool use: los bloques `text` son el hilo, los `tool_use` se guardan en `metadata.herramientas`, los `tool_result` se descartan (un `role:"user"` con bloques `tool_result` **no** es algo que dijo el paciente).
- `adaptarWhatsApp` — webhook de WhatsApp Cloud API: `entry[].changes[].value` con `contacts[]` y `messages[]`. Soporta texto, audio, botones e interactivos.
- `adaptarVozElevenLabs` — webhook post-call de ElevenLabs Agents: `data.transcript[]`, `data.analysis`, `data.metadata`. Si `analysis.call_successful !== "success"`, la conversación entra marcada como `requiere_atencion_humana` — el agente no pudo resolverlo y alguien debe devolver la llamada.
- `adaptarChatWeb` — widget genérico del sitio.

El día que exista backend, el webhook llama al mismo adaptador con el mismo payload. Es cableado, no reescritura.

### Identidad y vínculo con el expediente

- **Upsert de conversación:** por `claveExterna` si el canal la aporta (`conversation_id` de ElevenLabs, id de sesión de MediBot); si no, por la dupla canal + teléfono, que es lo correcto para WhatsApp donde el hilo es continuo.
- **Cruce de teléfonos (`claveTel`):** compara por los **últimos 10 dígitos**. WhatsApp entrega `525588112233` y el expediente guarda `55 8811 2233`; sin esto, ninguna conversación de WhatsApp se vincularía a su paciente.
- **Idempotencia:** cada mensaje lleva id determinista derivado del proveedor (`MSG-wa-<wamid>`, `MSG-11l-<conv>-<i>`, `MSG-mb-<sesion>-<i>`). Reingerir el mismo payload no duplica nada.

### Captura en vivo desde MediBot

`chat.js` vuelca la conversación **completa** al inbox tras cada turno (en el `finally` de `procesarMensaje`). Funciona porque los ids son deterministas: los mensajes ya guardados se reconocen y solo se agrega lo nuevo. Antes de esto, todo lo que decía un paciente se perdía al recargar.

El teléfono se descubre a media conversación (cuando el bot llama a `crear_cita`), y el vínculo con el expediente se completa retroactivamente sin romper el hilo.

### Honestidad en el envío

Hoy **ningún canal tiene salida viva**: WhatsApp necesita la Business API con backend, un agente de voz no recibe texto, y la sesión del visitante ya terminó. El único envío real es por correo vía EmailJS.

Por eso el compositor **no finge**: el mensaje se guarda en el hilo con `estadoEnvio: "pendiente"` y un chip visible con el motivo, más la opción explícita de mandarlo por correo si el paciente tiene email. Nunca hay sustitución silenciosa de canal ni un ✓ enviado falso. `capacidadCanal()` centraliza qué puede hacer cada canal, para que la vista no tenga ese conocimiento regado.

Las notas internas (`tipo: "nota_interna"`) quedan en el hilo, se ven distintas y **no** aparecen como último mensaje en la lista.

### Control de acceso — depende del modo (desde B2)

`js/sesion.js` ya no existe. El inbox usa `js/sesion.mjs`, y lo que pasa depende de si el despliegue tiene backend:

- **Con backend:** autenticación real contra Supabase Auth. El rol sale de `perfiles_staff`, protegido por RLS. Sin sesión no se entra: se redirige a `login.html`. El aviso de demostración **no** aparece, porque ahí sí hay seguridad de verdad y decir lo contrario sería mentir en la otra dirección.
- **Sin backend (la demo pública):** `sesionEsDemo()` es verdadero y sigue existiendo el selector de rol, que además sirve para enseñar las vistas por rol en una demostración de ventas. El rol se guarda en `medicita_sesion` y **cualquiera lo cambia con devtools en dos segundos**. Por eso el aviso de `sesionAvisoDemo()` sigue visible en ese modo; **no quitarlo**.

### Vista

Dos paneles estilo WhatsApp Web, tema claro y clínico. Izquierda: buscador (que busca también **dentro** del cuerpo de los mensajes, sin acentos), chips de canal y de estado, lista por `actualizadaEn` desc con borde ámbar en las que requieren atención. Derecha: hilo con burbujas por remitente, separadores de día, audio con transcripción colapsable, y el compositor. En móvil colapsa a una columna con la clase `viendo-hilo`.

"Ver perfil" escribe `medicita_tab_activa = "pacientes"` antes de abrir `admin.html` — usa el contrato que admin ya tenía, sin modificar `admin.js`.

### Limitación conocida

Un webhook de WhatsApp o ElevenLabs **no puede escribir en el localStorage de un navegador**. La ingesta real de terceros requiere la fase backend. Lo que ya está resuelto es el formato: los adaptadores y sus pruebas existen y funcionan contra los payloads reales.

---

## Historial de construcción

- **2 junio 2026** — index.html, styles.css, data.js, app.js (formulario + persistencia localStorage)
- **3 junio 2026** — admin.html, admin.css, admin.js (panel de administración completo)
- **3 junio 2026** — chat.html, chat.css, chat.js (agente MediBot con 7 tools + EmailJS)
- **4 junio 2026** — Demo pre-cargado con credenciales en chat.html; demo.html (página de presentación)
- **23 junio 2026** — Plan Fase 2 definido: MediPost · MediFollow · MediAnalytics · MediDocs
- **23 junio 2026** — M1 MediPost completo: `medipost.html`, `css/medipost.css`, `js/medipost.js` + enlace en `admin.html`
- **23 junio 2026** — M1 MediPost mejora: prompt IA para imagen (bloque `[SUGERENCIA_IMAGEN]` con descripción en español + prompt en inglés; botones Adobe Firefly / Leonardo AI / Canva IA)
- **23 junio 2026** — M2 MediFollow Paso 1: `encuesta.html` + `css/encuesta.css` + `js/encuesta.js`; modal "Configurar clínica" en `admin.html`; `medipost.js` inyecta config de clínica en prompt de sistema
- **23 junio 2026** — M2 MediFollow Paso 2: trigger email al marcar "Atendida" (EmailJS + registro en `medicita_followup_pendientes`); sección "Seguimientos pendientes" en `admin.html` con badge animado, tabla de día 3/día 30 y botones de envío manual; campos EmailJS en modal de config (solo en memoria)
- **23 junio 2026** — M2 MediFollow Paso 3 (completo): dashboard NPS en `admin.html` (5ª tarjeta + sección opiniones); tool `ver_satisfaccion_pacientes` en `chat.js`
- **23 junio 2026** — Reorganización `admin.html` en sistema de 4 pestañas: Citas · Seguimientos · Opiniones · Analytics (placeholder). Stats y filtros siempre visibles fuera de las pestañas. Tab activa persiste en `medicita_tab_activa` (localStorage). Badge de seguimientos en header cambia a la pestaña correcta automáticamente. CSS en `admin.css`; lógica de tabs en script inline (sin modificar `admin.js`).
- **23 junio 2026** — M3 MediAnalytics completo: `js/analytics.js` + estilos en `admin.css` + Chart.js CDN en `admin.html`. Pestaña Analytics reemplaza placeholder con: selector de rango (semana/mes/trimestre/todo), 3 KPIs grandes (ocupación/no-shows/recurrentes), gráfica de barras por día de semana, gráfica de dona por especialidad, heatmap de horarios (días × franjas), sección de insights IA con botón "✨ Analizar con IA" via `/api/chat`.
- **23 junio 2026** — M4 MediDocs completo: `medidocs.html` + `css/medidocs.css` + `js/medidocs.js`. Generador de 6 tipos de documentos clínicos (Nota SOAP, Receta, Carta de referencia, Constancia de atención, Incapacidad temporal, Consentimiento informado). Membrete desde `medicita_config_clinica`, historial últimos 10 docs en `medicita_docs`, impresión via `window.print()` + `@media print`, envío EmailJS. Botón "📄 Doc" por fila en tabla de citas en `admin.html` + enlace en header. **Fase 2 completa.**
- **24 junio 2026** — M5 MediPacientes Paso 1: `js/pacientes.js` + pestaña "👥 Pacientes" en `admin.html` (entre Opiniones y Analytics). Directorio con cards/tabla, búsqueda libre, filtros VIP/sexo/origen, modal completo con 4 secciones y selector de estrellas VIP. Interconexión automática: `app.js` crea perfil al agendar cita; `admin.js` vincula al cambiar estado o cargar muestra; `medidocs.js` vincula documentos generados. Clave `medicita_pacientes` en localStorage.
- **24 junio 2026** — M5 MediPacientes Paso 2 (completo): Panel lateral slide-in `#panel-perfil-pac` con 4 pestañas internas (Datos/Citas/Docs/Notas). Notas con historial timestamped (`historialNotas[]`, máx 20). "Agendar nueva cita" pre-llena index.html via `sessionStorage`. Botón "⬇ Exportar CSV" en directorio. Badge "⭐ VIP" en tabla de citas de admin. Métricas de pacientes en pestaña Analytics: gráficas de sexo, ciudades, origen + KPIs edad/VIP/total. **M5 completo.**
- **24 junio 2026** — Prompt 1: datos de muestra en seguimientos/opiniones (`cargarDatosMuestra()` agrega 4 registros de followup y 5 NPS, sin duplicar por folio); rediseño cohesivo de botones del header en `admin.html`/`admin.css` (grupos + separadores, altura 36px, outlined para módulos, ghost para utilidades, filled azul solo para Exportar CSV, SVG inline en todos); búsqueda sin acentos con `normalizarTexto()` en `chat.js` (buscar_citas) y `admin.js` (citasFiltradas).
- **24 junio 2026** — Membrete MediDocs: membrete profesional de 4 zonas en `medidocs.js`/`medidocs.css` — Zona 1 (header con avatar SVG, datos médico, logo/fallback clínica), Zona 2 (banda paciente con grid 2+1+1 / 1+1+2, datos de edad/peso/estatura desde `medicita_pacientes` si existen), Zona 3 (contenido clínico con acento azul y líneas guía), Zona 4 (onda SVG 3 capas + banda azul con horarios/dirección/contacto/firma). Claude genera solo el cuerpo clínico (sin firma). `@media print` optimizado con `@page { margin: 0 }`, colores preservados, SVG onda imprimible. 3 campos nuevos en config clínica (`admin.html`/`admin.js`): cedulaProfesional, horarioAtencion, direccionConsultorio.
- **24 junio 2026** — Cita manual desde admin: botón "+ Nueva cita" en header (Grupo 2), modal completo con secciones Paciente/Cita, detección de paciente existente por teléfono (blur → banner verde/gris), selects en cascada (especialidad → médico → horario desde data.js), toggle "Confirmar inmediatamente" (default ON), folio automático mismo formato que index.html, vinculación automática con MediPacientes (crea perfil si es nuevo, vincula folio si ya existe), toast diferenciado. Archivos modificados: `admin.html`, `js/admin.js`, `css/admin.css`.
- **24 junio 2026** — Seguro médico: campos `tieneSeguro`/`nombreSeguro`/`numeroPoliza` en pacientes, formulario `index.html`, modal nueva cita y perfil de paciente en admin. Aseguradoras: GNP, AXA, Metlife, Mapfre, HDI, IMSS, ISSSTE + campo libre "Otro". Toggle con transición suave (max-height). Se persiste en `medicita_citas` y `medicita_pacientes`. Archivos modificados: `index.html`, `css/styles.css`, `js/app.js`, `admin.html`, `css/admin.css`, `js/pacientes.js`, `js/admin.js`.
- **25 junio 2026** — Prompt 4: 4 nuevas tools en MediBot (`buscar_paciente`, `ver_documentos_paciente`, `ver_notas_paciente`, `ver_nps_paciente`); typing indicator diferenciado "Buscando en expediente…" para las 4 tools de expediente. Total de tools: 13. Archivo modificado: `js/chat.js`.
- **25 junio 2026** — Rediseño index.html: landing médica profesional con 7 secciones (navbar, hero, stats bar, médico, servicios, formulario+mapa, opiniones, footer). Todo alimentado desde `medicita_config_clinica` via `poblarLanding()`. Opiniones dinámicas desde NPS via `cargarOpinionesNPS()`. Animaciones fade-in con IntersectionObserver. Campos nuevos en modal "Configurar clínica" de admin.html (sección "Personalización de landing"): fraseHero, fotoHero, fotoMedico, bioMedico, formacionMedico, totalPacientes, anosExperiencia, calificacionPromedio, serviciosClinica, whatsapp, facebook, instagram. Archivos modificados: `index.html`, `css/styles.css`, `js/app.js`, `admin.html`, `js/admin.js`.
- **25 junio 2026** — Panel personalización: modal "Configurar clínica" expandido en 5 pestañas (🏥 Clínica / 👨‍⚕️ Médico / 🌐 Landing / 🎨 Apariencia / 👁 Vista previa). Pestaña Apariencia agrega `colorPrimario` (color picker), `colorAcento` y `tipografia` (radio 3 fuentes) a `medicita_config_clinica`. Live preview de colores en `--azul-principal`/`--ambar` sin guardar; restauración automática al cancelar. Vista previa en tiempo real (mini hero + stats bar + tarjeta médico, `transform: scale(0.75)`). `aplicarAparienciaConfig()` en DOMContentLoaded de `admin.js`. `aplicarAparienciaLanding()` en DOMContentLoaded de `app.js` — aplica `--color-primary`/`--color-accent`/font-family en `index.html`. Archivos modificados: `admin.html`, `css/admin.css`, `js/admin.js`, `js/app.js`.
- **25 junio 2026** — Calendario MediPost: vista mensual con grid 7 columnas en `medipost.html`. Pastillas de post por día (red + tipo abreviado + primeras 25 chars del caption, ámbar=programado/verde=publicado, máx 2 por celda + "+N más"). Drag & drop HTML5 nativo para reprogramar (arrastra pastilla a otro día → toast + actualiza `fechaProgramada`). Clic en pastilla → popover con detalles + "Reprogramar" (datepicker nativo) + "Ver post completo". Clic en día vacío → tooltip "¿Programar?" con "Crear nuevo" (scroll al generador) o "Asignar existente" (overlay con lista de posts sin fecha). Campo `fechaProgramada: null` agregado al objeto post en `medicita_posts`. Historial reemplazado por lista vertical con `max-height: 320px`/`overflow-y: auto`, badges de estado (Programado/Publicado/Sin fecha), botón "Programar"/"Reprogramar" con datepicker inline. Archivos modificados: `medipost.html`, `js/medipost.js`, `css/medipost.css`.
- **29 junio 2026** — Tabla comparativa de planes en `demo.html`: reemplaza las 3 tarjetas por tabla de 4 columnas (Característica / Esencial / Profesional / Premium) con 4 secciones agrupadas (Capacidad · Módulos incluidos · Módulos avanzados · Solo Plan Premium), columna Profesional destacada en azul suave, precios mensuales actualizados a $800 / $1,800 / $3,200 MXN. Pie de tabla con nota de ajuste de plan.
- **29 junio 2026** — Páginas legales: `terminos.html` (13 secciones, T&C completos) y `privacidad.html` (11 secciones, LFPDPPP). Ambas con navbar idéntico a `demo.html` (logo + "← Volver a la demo"), footer completo, índice de secciones clicable con anchor links y diseño responsive consistente con el resto del proyecto. Links a ambas páginas agregados en el footer de `demo.html`.
- **8 julio 2026** — Auto-seed de datos de muestra en la demo: en la primera visita a `admin.html` (localStorage vacío y sin bandera `medicita_demo_seeded`), `sembrarDemoSiVacio()` carga automáticamente los datos de muestra (citas, seguimientos, NPS, pacientes) para que ningún visitante vea la demo vacía. La bandera `medicita_demo_seeded` evita re-poblar si el usuario borra los datos intencionalmente. Botón "Cargar muestra" sigue disponible para recargar manualmente (ahora con `cargarDatosMuestra(auto)` — toast de bienvenida en modo auto). Listener `storage` para `medicita_nps` agregado en `app.js` para refrescar las opiniones de la landing cuando el iframe de admin siembra el NPS en paralelo. Archivos modificados: `js/admin.js`, `js/app.js`.
- **26 julio 2026** — **Fase B1 — Cimientos del backend**: Supabase (un proyecto por clínica) + esquema multi-inquilino con RLS en las 11 tablas. Nuevos: `supabase/migrations/` (6 archivos), `supabase/seed-clinica.sql`, `docs/nueva-clinica.md`, `js/supabase-client.mjs`, `js/api.mjs` (interfaz de 39 métodos), `js/api-local.mjs`, `js/api-remoto.mjs`, `js/sesion.mjs`, `js/migrar.mjs`, `login.html`, `css/login.css`, `migrar.html`, `package.json`, y 65 pruebas nuevas (`tests/db-harness.mjs`, `db-aislamiento`, `db-flujos`, `api-paridad`) que corren contra un Postgres real en WebAssembly, sin Docker. Total: 130 pruebas. Modo doble: sin sesión el sistema sigue en `localStorage` (la demo pública no se tocó); con sesión, contra Supabase. Los 9 módulos **todavía no** usan la capa nueva — ese corte es B2. Dos bugs cazados por las pruebas: colisión de folios y de códigos de paciente por usar 4 dígitos aleatorios contra un índice único (se resolvió con reintento, que de paso cubre la carrera de dos solicitudes simultáneas del mismo teléfono), y pruebas intermitentes por levantar varios Postgres WASM en paralelo.
- **26 julio 2026** — **Fase 0 — MediInbox completo**: inbox unificado multicanal. Nuevos: `conversaciones.html`, `css/conversaciones.css`, `js/sesion.js`, `js/conversaciones-store.js`, `js/conversaciones-adapters.js`, `js/conversaciones-envio.js`, `js/conversaciones-demo.js`, `js/conversaciones.js`, y `tests/` (65 pruebas con el runner nativo de node, cero dependencias). Modificados: `js/chat.js` (captura idempotente de la conversación al inbox tras cada turno + captura del teléfono en `crear_cita`), `chat.html` (carga store y adaptadores), `admin.html` + `css/admin.css` (botón MediInbox en el header). Adaptadores escritos contra los payloads reales de WhatsApp Cloud API y ElevenLabs Agents. Claves nuevas: `medicita_conversaciones`, `medicita_mensajes`, `medicita_sesion`. Dos bugs cazados por las pruebas durante la construcción: el cruce de teléfonos fallaba con la lada 52 de WhatsApp (se corrigió con `claveTel`, últimos 10 dígitos) y reingerir duplicaba los hilos de MediBot y chat web por falta de ids deterministas.
- **1 julio 2026** — Branding Symbiotiq: logos copiados desde el proyecto `symbiotiq-web` a `assets/symbiotiq/` (`logo.png`, `logo-white.png`, `logo-icon.png`, `logo-icon-white.png`). Insignia "creado por Symbiotiq" con logo agregada en: header de `admin.html`, `medipost.html`, `medidocs.html` y `chat.html` (variante blanca, fondos oscuros); footer de `demo.html`, `terminos.html`, `privacidad.html` e `index.html` (variante blanca); pie de `encuesta.html` (variante a color, fondo claro). Refuerza que los módulos de la suite fueron creados por Symbiotiq en todas las superficies del sistema, no solo en la demo comercial. Archivos modificados: `admin.html`, `chat.html`, `medipost.html`, `medidocs.html`, `demo.html`, `terminos.html`, `privacidad.html`, `index.html`, `encuesta.html`, `css/admin.css`, `css/medipost.css`, `css/medidocs.css`, `css/chat.css`, `css/styles.css`, `css/encuesta.css`.
- **26 julio 2026** — **Fase B2 — El corte**: los 9 módulos dejaron de tocar `localStorage` y pasan por `js/api.mjs`. Nuevos: `js/puente-api.js` y `js/puente-sesion.js` (la única frontera entre los scripts clásicos y los módulos ES), `supabase/migrations/0007_testimonios_publicos.sql` y `0008_posts_campos_faltantes.sql`, `tests/datos-para-pruebas.js`. Borrado: `js/sesion.js` — el inbox usa `js/sesion.mjs`, que ahora trae un modo de demostración explícito (`esDemo`) para que la demo pública conserve el selector de rol sin fingir seguridad. Etiquetas `<meta>` de Supabase (en marcador) agregadas a las 7 páginas que faltaban. 138 pruebas en verde, 8 nuevas. **Tres bugs heredados que el corte destapó:** (1) la superficie sin sesión —pedir cita desde la landing y responder la encuesta— caía en modo local aunque hubiera backend, así que en una clínica real la cita del paciente se habría guardado en el `localStorage` de su propio navegador y la clínica nunca la habría visto; las funciones `SECURITY DEFINER` que B1 construyó para eso no las alcanzaba nadie. Se separó `api.publico`, que resuelve por *¿hay backend?* y no por *¿hay sesión?*. (2) La tabla `posts` no tenía columnas para la sugerencia de imagen, el prompt en inglés ni la llamada a la acción: tres de las cuatro cosas que genera MediPost se habrían perdido en silencio. (3) Los documentos no traían `folio` en remoto, así que el historial de MediDocs habría salido en blanco. **Y un hueco de privacidad que ya existía en local:** la landing pública cargaba el arreglo completo de citas —nombres, teléfonos, correos, notas— para sacar un nombre de pila en la sección de opiniones; ahora lo resuelve la vista `testimonios_publicos`, con el mismo recorte en los dos modos.
- **28 julio 2026** — **B2 verificado en el navegador, en los dos modos.** Ocho hallazgos, cuatro míos de B2 y cuatro heredados. (1) **El puente cargaba tarde**: era `puente-api.mjs` con `<script type="module">`, dando por hecho que los módulos corren antes de `DOMContentLoaded`. Eso solo vale sin `await` de nivel superior, y `supabase-client.mjs` tiene uno — así que cada módulo arrancaba con `window.API` sin definir y moría antes de registrar un solo manejador: ningún botón respondía. La guardia `await window.APIListo` tampoco servía, porque `await undefined` resuelve de inmediato. Ahora son scripts clásicos (`puente-api.js`, `puente-sesion.js`) que definen la promesa de forma síncrona y cargan el módulo con `import()` dinámico. (2) `actualizarBadgeSeguimientos` hacía `.filter` sobre una Promise y tumbaba el arranque del panel tres líneas antes de la siembra. (3) La siembra de demo usaba `nps.responder()`, que vive en la superficie pública, así que mandaba las opiniones de muestra al Supabase real mientras las citas se quedaban en localStorage — se separó `nps.registrar()`. (4) `api-remoto.citasCrear` no generaba folio (la columna es NOT NULL) ni vinculaba el expediente: toda cita creada desde MediBot o desde "+ Nueva cita" moría contra Postgres, mientras la landing seguía funcionando porque va por la RPC. (5) El botón "Confirmar" de la landing leía `e.currentTarget` después de un `await`, cuando ya es `null`: quedaba deshabilitado para siempre y el paciente solo podía agendar una cita por carga de página. **Heredados:** (6) los ids internos llevaban 4 dígitos aleatorios, y como el store descarta ids repetidos por idempotencia, dos mensajes creados en el mismo milisegundo hacían desaparecer uno del hilo sin ningún error — lo cazó una prueba intermitente; ahora usan UUID, y folio y código de paciente conservan su formato con reintento. (7) El panel sin sesión corría en modo local en silencio aunque hubiera backend. (8) `/api/chat` daba 404 en local desde B1. 142 pruebas.
- **28 julio 2026** — **Fase E — Horarios reales y escalación a humano.** Las dos funciones que motivaron el backend, y que hasta B2 eran imposibles: una pestaña del navegador no puede despertarse a las 11 de la noche. **MediHorario primero, porque la escalación lee de ahí**: `horario_atencion` era texto libre y ninguna máquina puede responder con eso si el consultorio está abierto. Nuevos: `0009_horarios.sql` (zona horaria, `horarios_base`, `horarios_excepciones`, `en_horario`, `proxima_apertura`, `horario_texto`), `0010_escalaciones.sql` (escalaciones, bandeja de salida, ruteo, escalera, acuse), `supabase/cron.sql`, `js/horarios.js`, `js/escalaciones.js`, `api/avisar.js`, y dos archivos de pruebas. La landing dejó de ofrecer días cerrados y MediBot consulta y edita el horario. **MediBot se dividió en perfil paciente y personal**: su prompt le hablaba al paciente y el inbox lo registra como canal de paciente, pero tenía `eliminar_cita` y `ver_notas_paciente`. **La escalera vive en `pg_cron`** y `pg_net` solo toca el timbre de `/api/avisar`, que manda por la API REST de EmailJS con la cuenta que ya usa MediFollow. Tres invariantes con prueba propia: una `vencida` **no se cierra sola jamás**, acusarla **detiene la escalera en seco**, y `proxima_apertura` devuelve **NULL** en vez de inventar una fecha. Dos cosas que las pruebas corrigieron: `citas.hora` es texto y no `time` (la comparación de citas afectadas por un cierre no compilaba), y `SELECT INTO` no acepta un elemento de arreglo como destino. 206 pruebas (56 nuevas).
- **26 julio 2026** — **B1 puesto en marcha contra un proyecto real.** Esquema aplicado, clínica dada de alta y `npm run db:verificar` en verde: 11 tablas, la vista pública, las 3 funciones anónimas, y RLS negándole a la llave pública un solo renglón de cada tabla. Nuevos: `scripts/servidor.mjs` (+ `npm run dev`), `scripts/bundle-migraciones.mjs`, `scripts/verificar-supabase.mjs`, `js/config-local.ejemplo.mjs`. Cuatro cosas que salieron mal y se corrigieron: (1) el flujo de recuperación de contraseña estaba a medias — el correo salía pero al volver no había pantalla donde escribir la nueva; se agregó, junto con `sesionCambiarContrasena()` y el aviso de enlace vencido; (2) los errores de Supabase se traducían adivinando sobre el texto en inglés, así que `email_not_confirmed` caía en el mensaje genérico — ahora se traducen por código, lo que importa porque ese caso no se arregla cambiando la contraseña; (3) `db:verificar` sondeaba las funciones con cuerpo vacío y PostgREST devuelve 404 tanto si faltan como si los argumentos no cuadran — daba tres falsas alarmas por clínica; (4) `seed-clinica.sql` obligaba a cambiar el nombre de la clínica en tres lugares, y olvidar uno dejaba al personal sin clínica — se reescribió como bloque `DO` con un solo lugar editable, probado contra pglite en cuatro escenarios. Las credenciales salieron del repositorio: los `<meta>` quedan en marcador y el desarrollo usa `js/config-local.mjs` (ignorado por git). No es por ocultar la publishable key, que es pública por diseño, sino porque el repo es la plantilla de la siguiente clínica y no debe venir apuntando a la base de la anterior.

---

## Próximos pasos activos

### Completado — Fase 2 terminada ✅
- [x] **M1 MediPost** — `medipost.html` + `css/medipost.css` + `js/medipost.js` + enlace en `admin.html`
- [x] **M2 Paso 1** — `encuesta.html` + `css/encuesta.css` + `js/encuesta.js` + modal config clínica en `admin.html`

### Pendiente
- [x] **M2 Paso 2** — Trigger email al marcar "Atendida" + sección "Seguimientos" + badge + emails día 3/30 con envío manual
- [x] **M2 Paso 3** — Dashboard NPS (5ª tarjeta + sección opiniones) + tool `ver_satisfaccion_pacientes` en `chat.js`
- [x] **M3 MediAnalytics** — nueva pestaña en `admin.html` + `js/analytics.js` + Chart.js
- [x] **M4 MediDocs** — `medidocs.html` + `css/medidocs.css` + `js/medidocs.js`

### M5 MediPacientes ✅ Completo
- [x] **Paso 1** — `js/pacientes.js` + pestaña Pacientes + modal + interconexión con app.js / admin.js / medidocs.js
- [x] **Paso 2** — Panel lateral de perfil (4 pestañas: Datos/Citas/Docs/Notas) + historial de notas + exportar CSV + badge VIP en tabla + métricas de pacientes en Analytics

### Rediseño index.html ✅ Completo
- [x] Landing médica profesional con 7 secciones, `poblarLanding()`, `cargarOpinionesNPS()`, campos nuevos en config

### Calendario MediPost ✅ Completo
- [x] Vista mensual, pastillas drag & drop, historial con scroll, campo `fechaProgramada`

### Fase 0 — MediInbox ✅ Completo
- [x] Modelos `Conversacion` y `Mensaje` + capa de persistencia con forma async
- [x] Adaptadores contra payloads reales: MediBot, WhatsApp Cloud API, ElevenLabs Agents, chat web
- [x] Control de acceso por rol (gate de demo, documentado como tal)
- [x] Vista de 2 paneles con filtros por canal/estado y buscador
- [x] Compositor con dispatcher de salida honesto por canal
- [x] Captura en vivo desde MediBot + 65 pruebas automatizadas

### Fase B1 — Backend ✅ Completo
- [x] Esquema con RLS en las 11 tablas + funciones para los flujos públicos
- [x] Autenticación real (`login.html` + `js/sesion.mjs`), un usuario por persona
- [x] Capa de datos de doble modo (`api.mjs` + local + remoto)
- [x] Migración `localStorage` → Postgres, idempotente
- [x] Aprovisionamiento documentado + 65 pruebas contra Postgres real

### Fase B2 — El corte ✅ Completo
- [x] Los 9 módulos pasan a `js/api.mjs` a través de `window.API` (puente `js/puente-api.js`)
- [x] `conversaciones.html` pasa a `js/sesion.mjs` y se borra `js/sesion.js`
- [x] Etiquetas `<meta>` de Supabase en las 7 páginas que faltaban (en marcador, ver *Dónde viven las credenciales*)
- [x] Superficie pública sin sesión (`api.publico`) — landing, encuesta y solicitud de cita
- [x] Vista `testimonios_publicos` (migración 0007) y columnas faltantes de `posts` (0008)
- [x] 138 pruebas en verde

### Fase E — Horarios y escalación ✅ Completo
- [x] **MediHorario:** `horarios_base` + `horarios_excepciones` + `zona_horaria`, panel propio, la landing respeta el horario y MediBot lo consulta y lo edita
- [x] **Escalación a humano:** `escalar_a_humano` en MediBot, ruteo por motivo y horario, escalera de re-alerta con `pg_cron`, acuse que la detiene y estado `vencida` que no se cierra solo
- [x] **MediBot dividido** en perfil paciente y perfil personal
- [x] 206 pruebas en verde

### ← SIGUIENTE PASO
- [ ] **Contacto proactivo:** cron + tabla de tareas programadas + consentimiento por canal + tope de frecuencia + salida fácil. El reloj (`pg_cron`) y la bandeja de salida (`avisos_pendientes`) ya existen desde la Fase E: esto es agregarle un productor, no construir la infraestructura.
  **Restricción que condiciona el diseño, no un detalle:** WhatsApp no permite texto libre fuera de las 24 h posteriores al último mensaje del paciente — solo plantillas pre-aprobadas por Meta y con opt-in registrado. Mandar texto libre proactivo tumba el número. Texto generado por Claude funciona por correo y SMS; en WhatsApp, solo dentro de la ventana o con plantillas. Súmale la LFPDPPP: contacto proactivo con datos de salud exige consentimiento registrado.

### Integración con Doctoralia
- [ ] Adaptador `adaptarDoctoralia(payload)` en `js/conversaciones-adapters.js`, contra la forma real de su API/webhook (mensajes de pacientes y solicitudes de cita)
- [ ] Mapear el estado de la cita de Doctoralia al ciclo de `medicita_citas` para no duplicar agenda
- [ ] Definir la identidad de la conversación: `claveExterna` con el id de Doctoralia, o canal + teléfono si su API no expone uno estable
- [ ] Agregar `doctoralia` a `CANALES` en el store, a `CANAL_INFO` en la vista y a `CAPACIDADES` en el dispatcher de envío
- [ ] Pruebas del adaptador nuevo en `tests/adapters.test.js` con un payload de ejemplo real
- [ ] **Bloqueador conocido:** la ingesta real necesita backend que reciba el webhook — un webhook no puede escribir en el localStorage del navegador

### Backlog core (pendiente de Fase 1)
- [ ] Sección "Mis citas" en `index.html` para que el paciente vea y cancele sus citas
- [ ] Validación de conflictos de horario (no permitir dos citas al mismo médico, misma fecha y hora)
- [ ] Gestión de médicos y horarios (CRUD en localStorage)
- [ ] Vista de agenda por día/semana (calendario) en admin.html

### Fase futura — Backend
- [ ] API REST (Node.js + Express) para persistir citas en base de datos real
- [ ] Autenticación de pacientes y panel protegido
- [ ] Mover llamada a Anthropic API al backend (no exponer API Key en cliente)
- [ ] Publicación automática en redes sociales (OAuth Meta/Google)
- [ ] Emails diferidos reales (cron job)
- [ ] Cumplimiento NOM-004-SSA3 (normativa mexicana de datos de salud)
