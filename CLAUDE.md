# MediCita — Sistema de Agendamiento de Citas Médicas

Aplicación web para clínicas medianas en México que permite a los pacientes consultar especialidades disponibles y solicitar citas médicas en línea.

## Stack tecnológico

- **Frontend:** HTML5, CSS3, JavaScript puro (sin frameworks)
- **Fuentes:** Inter (Google Fonts)
- **Persistencia:** `localStorage` — múltiples claves por módulo (ver abajo)
- **IA:** API de Anthropic (Claude) con tool use, llamada directamente desde el navegador
- **Email:** EmailJS v4 (CDN) — envío de emails HTML desde el frontend sin backend
- **Gráficas:** Chart.js vía CDN (se agrega en Módulo 3 — MediAnalytics)

## Estructura del proyecto

```
sistema-citas-medicas/
├── index.html          # Página principal (formulario de citas para pacientes)
├── admin.html          # Panel de administración (tabla, filtros, cambio de estado)
├── chat.html           # Chat con agente de IA (MediBot)
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
│   ├── medipost.css    # [NUEVO M1] Estilos del generador de posts
│   ├── encuesta.css    # [NUEVO M2] Estilos de la encuesta NPS (mobile-first)
│   └── medidocs.css    # [NUEVO M4] Estilos del generador de documentos + @media print
├── js/
│   ├── data.js         # Datos estáticos (especialidades, doctores, horarios)
│   ├── app.js          # Lógica de index.html + guardarCitaEnStorage()
│   ├── admin.js        # Lógica del panel de administración
│   ├── chat.js         # Lógica del chat: loop agéntico, tools, EmailJS
│   ├── medipost.js     # [NUEVO M1] Lógica del generador de posts
│   ├── analytics.js    # [NUEVO M3] Cálculo de métricas + integración Chart.js
│   ├── medidocs.js     # [NUEVO M4] Lógica del generador de documentos
│   └── encuesta.js     # [NUEVO M2] Lógica de la encuesta NPS
└── assets/             # Reservado para imágenes y recursos estáticos
```

## Claves de localStorage

| Clave | Módulo | Contenido |
|---|---|---|
| `medicita_citas` | Core | Array de citas (folio, paciente, médico, fecha, hora, tipo, estado, notas, creadaEn) |
| `medicita_posts` | M1 MediPost | Array de posts generados (id, tipo, especialidad, red, caption, hashtags, creadoEn, borrador) |
| `medicita_nps` | M2 MediFollow | Array de respuestas NPS (folio, puntuacion, comentario, fechaRespuesta) |
| `medicita_followup_pendientes` | M2 MediFollow | Array de folios con seguimiento diferido pendiente (folio, fechaAtendida, emailEnviado_3d, emailEnviado_30d) |
| `medicita_docs` | M4 MediDocs | Array de metadatos de documentos (id, folio, tipodoc, inputs, creadoEn) — solo metadatos, el HTML se regenera |
| `medicita_pacientes` | M5 MediPacientes | Array de perfiles de paciente (ver estructura abajo) |
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
