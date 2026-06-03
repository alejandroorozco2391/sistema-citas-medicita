# MediCita — Sistema de Agendamiento de Citas Médicas

Aplicación web para clínicas medianas en México que permite a los pacientes consultar especialidades disponibles y solicitar citas médicas en línea.

## Stack tecnológico

- **Frontend:** HTML5, CSS3, JavaScript puro (sin frameworks)
- **Fuentes:** Inter (Google Fonts)
- **Persistencia:** `localStorage` — clave `medicita_citas`
- **IA:** API de Anthropic (Claude) con tool use, llamada directamente desde el navegador
- **Email:** EmailJS v4 (CDN) — envío de emails HTML desde el frontend sin backend

## Estructura del proyecto

```
sistema-citas-medicas/
├── index.html          # Página principal (formulario de citas para pacientes)
├── admin.html          # Panel de administración (tabla, filtros, cambio de estado)
├── chat.html           # Chat con agente de IA (MediBot)
├── CLAUDE.md           # Este archivo
├── css/
│   ├── styles.css      # Estilos de index.html
│   ├── admin.css       # Estilos del panel de administración
│   └── chat.css        # Estilos del chat (tema oscuro WhatsApp-like)
├── js/
│   ├── data.js         # Datos estáticos (especialidades, doctores, horarios)
│   ├── app.js          # Lógica de index.html + guardarCitaEnStorage()
│   ├── admin.js        # Lógica del panel de administración
│   └── chat.js         # Lógica del chat: loop agéntico, tools, EmailJS
└── assets/             # Reservado para imágenes y recursos estáticos
```

## Lo que se construyó el 2 de junio de 2026

### Página principal (`index.html`)

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

### Estilos (`css/styles.css`)

- Variables CSS centralizadas (colores, sombras, radios, transiciones)
- Diseño responsive con breakpoints en 900px y 640px
- Animación `slideUp` en el modal
- Tarjetas de especialidad con barra de color superior al hover/selección

### Datos (`js/data.js`)

- 8 especialidades con id, nombre, descripción, ícono y color temático
- 9 doctores con sus especialidades y horarios disponibles
- Tipos de consulta

### Lógica (`js/app.js`)

- Render dinámico de tarjetas de especialidades
- Encadenamiento de selectores: especialidad → médico → horarios
- Validación de formulario nativa del navegador + validación custom de horario seleccionado
- Generación de folio único por cita
- Accesibilidad: roles ARIA, navegación por teclado en tarjetas, `aria-live` en alertas

## Lo que se construyó el 3 de junio de 2026

### Persistencia en localStorage (`js/app.js`)

- Nueva función `guardarCitaEnStorage(datos, folio)` que se llama al confirmar una cita
- Las citas se guardan en la clave `medicita_citas` con estructura completa: folio, paciente, médico, fecha, hora, tipo, notas, estado (`"pendiente"` por defecto) y timestamp `creadaEn`

### Panel de administración (`admin.html`)

- **Header fijo** oscuro con accesos a "Ver sitio", "Exportar CSV" y "Cargar muestra"
- **4 tarjetas de estadísticas**: Total de citas · Citas de hoy · Pendientes · Confirmadas
- **Barra de filtros**: búsqueda por texto libre (nombre, folio, médico), filtro por fecha, por médico y por estado; botón "Hoy" para ver solo las citas del día; botón "Limpiar"
- **Tabla de citas** con columnas: Folio · Paciente (teléfono/email como subtítulo) · Médico / Especialidad · Fecha y hora · Tipo · Estado · Acciones
- **Cambio de estado inline** por dropdown (Pendiente / Confirmada / Atendida / Cancelada); se persiste en localStorage al instante
- **Eliminar cita** con confirmación de diálogo nativo
- **Indicador de notas** (ícono 📝 con tooltip nativo) cuando la cita tiene observaciones
- **Exportar CSV** con BOM UTF-8 para compatibilidad con Excel
- **Datos de muestra** (9 citas realistas) para demostración inmediata
- **Toast de notificaciones** no intrusivo en esquina inferior derecha
- **Sincronización entre pestañas**: si el paciente confirma una cita en `index.html` con el panel abierto en otra pestaña, el panel se actualiza automáticamente vía `storage` event

### Estilos (`css/admin.css`)

- Diseño standalone, sin dependencia de `styles.css`, con las mismas variables CSS
- Tabla con scroll horizontal en móvil
- Badges de estado con colores semánticos: ambar · verde · azul · rojo
- Responsive con breakpoints en 900px y 600px

## Lo que se construyó el 3 de junio de 2026 (continuación)

### Chat con agente de IA (`chat.html`, `css/chat.css`, `js/chat.js`)

**Diseño:**
- Interfaz estilo WhatsApp: fondo oscuro (`#0b141a`), burbujas de mensaje, campo de texto fijo abajo
- Pantalla de inicio con campos de configuración: API Key de Anthropic, selector de modelo (Haiku 4.5 / Sonnet 4.6) y sección colapsable de EmailJS
- Chips de sugerencias al iniciar el chat para orientar al usuario

**Agente MediBot:**
- Loop agéntico: el frontend llama a la API de Anthropic, ejecuta tools localmente, devuelve resultados y repite hasta `end_turn` (máx. 12 iteraciones)
- Llamada directa al navegador con header `anthropic-dangerous-direct-browser-access: true`
- La API Key **nunca se hardcodea** — vive solo en memoria de la variable `apiKey` durante la sesión del tab

**7 herramientas (tools) disponibles para el agente:**

| Tool | Acción |
|---|---|
| `listar_especialidades` | Lee de `data.js` |
| `listar_doctores` | Lee de `data.js`, filtrable por especialidad |
| `leer_todas_las_citas` | Lee `localStorage` |
| `buscar_citas` | Filtra `localStorage` por nombre, folio, fecha, médico o estado |
| `crear_cita` | Escribe en `localStorage` (mismo formato que `app.js`) |
| `actualizar_estado_cita` | Modifica estado en `localStorage` |
| `eliminar_cita` | Elimina entrada de `localStorage` |
| `enviar_email_paciente` | Llama a EmailJS con HTML dinámico |

**Integración de EmailJS:**
- CDN `@emailjs/browser@4` incluido en `chat.html`
- Credenciales (Service ID, Template ID, Public Key) se ingresan en la pantalla de inicio; se llama `emailjs.init()` al arrancar el chat
- `sendEmailToPatient()` construye el email HTML completo en JavaScript y llama `emailjs.send()`
- `buildEmailHTML()` genera un email responsive con branding MediCita: encabezado degradado azul, banner de estado con color semántico (verde / rojo / ambar / azul), tabla de detalles de la cita y footer oscuro
- 5 variantes de diseño según la acción: `creada`, `confirmada`, `cancelada`, `pendiente`, `atendida`
- La plantilla de EmailJS solo necesita `{{{html_email}}}` en el cuerpo — el HTML completo se genera en el cliente
- El envío es silencioso: si EmailJS no está configurado o el paciente no tiene email, el agente continúa sin interrumpir el flujo

**Indicadores de UX en el chat:**
- Typing indicator con texto dinámico según la herramienta activa ("Buscando citas…", "Guardando la cita…", "Enviando email al paciente…")
- Folios resaltados automáticamente en las respuestas con estilo `CIT-XXXXXX-XXXX`
- `Enter` envía · `Shift+Enter` nueva línea
- Nueva conversación (conserva `localStorage`) y botón de salir para cambiar API Key
- Sincronización entre pestañas: si se guarda una cita en `index.html`, el panel admin se actualiza vía evento `storage`

## Próximos pasos sugeridos

### Fase 2 — Persistencia local (parcialmente completa)
- [x] Guardar citas solicitadas en `localStorage`
- [x] Panel de administración con tabla, filtros y cambio de estado
- [x] Agente de IA que lee y escribe citas desde el chat
- [x] Notificaciones por email automáticas via EmailJS
- [ ] Sección "Mis citas" en `index.html` para que el paciente vea y cancele sus citas
- [ ] Validación de conflictos de horario (no permitir dos citas al mismo médico, misma fecha y hora)

### Fase 3 — Panel de administración (parcialmente completa)
- [x] Vista de todas las citas con filtros por fecha, médico y estado
- [x] Cambio de estado de citas (confirmada, pendiente, atendida, cancelada)
- [ ] Gestión de médicos y horarios (CRUD en localStorage)
- [ ] Vista de agenda por día/semana (calendario)

### Fase 4 — Backend
- [ ] API REST (Node.js + Express o similar) para persistir citas en base de datos
- [ ] Autenticación de pacientes (registro/login)
- [ ] Panel de administración con sesión protegida
- [ ] Mover la llamada a la API de Anthropic al backend para no exponer la API Key en el cliente

### Fase 5 — Producción
- [ ] Migrar a un framework (React o Vue) si la complejidad lo justifica
- [ ] Tests automatizados (unitarios y de integración)
- [ ] Deploy (Vercel, Netlify o servidor propio)
- [ ] Cumplimiento de normativas mexicanas de datos de salud (NOM-004-SSA3)

## Convenciones del proyecto

- Todo el texto visible al usuario va en **español mexicano**
- Colores principales definidos como variables en `:root` — no usar valores hexadecimales directos en otros lugares
- El objeto `estado` en `app.js` es la única fuente de verdad del estado de la UI; no usar variables globales sueltas
- El array `conversacion` en `chat.js` es el historial de mensajes para la API; no se persiste entre sesiones
- Las credenciales (API Key de Anthropic, claves de EmailJS) solo viven en memoria — nunca en `localStorage` ni hardcodeadas
- No usar frameworks ni librerías externas sin consenso previo
