/* ═══════════════════════════════════════════════════════════════════════
   conversaciones.js — Lógica de la vista de MediInbox

   No toca localStorage directamente: todo pasa por conversaciones-store.js.
   El objeto `estado` es la única fuente de verdad de la UI, igual que en
   app.js — nada de variables globales sueltas.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Estado ──────────────────────────────────────────────────────────── */
const estado = {
  rol: null,
  nombreStaff: "",
  filtros: { canal: "todos", estado: "todos", texto: "" },
  convActivaId: null,
  conversaciones: [],
  mensajes: [],
  pacienteActivo: null,
  rolPendiente: null,
};

const CANAL_INFO = {
  whatsapp: { label: "WhatsApp", icono: "🟢" },
  voz: { label: "Llamada", icono: "📞" },
  medibot: { label: "MediBot", icono: "🤖" },
  chat_web: { label: "Chat web", icono: "💻" },
};

const ESTADO_LABEL = {
  abierta: "Abierta",
  requiere_atencion_humana: "Requiere atención",
  resuelta: "Resuelta",
};

const ROLES_PERMITIDOS = ["doctor", "recepcionista", "admin"];

/* ─── Utilidades ──────────────────────────────────────────────────────── */
function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iniciales(nombre) {
  const partes = String(nombre || "?").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes[1]?.[0] || "")).toUpperCase();
}

/** Nombre a mostrar. El dato puede venir vacío a propósito (lead anónimo). */
function nombreMostrado(conv) {
  if (conv.nombreContacto) return conv.nombreContacto;
  if (conv.telefono) return conv.telefono;
  return CANAL_INFO[conv.canal] ? `Contacto de ${CANAL_INFO[conv.canal].label}` : "Contacto sin nombre";
}

function horaRelativa(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h`;
  const dias = Math.floor(hrs / 24);
  if (dias === 1) return "ayer";
  if (dias < 7) return `${dias} d`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function horaCorta(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function etiquetaDia(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86400000);
  const mismo = (a, b) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return "Hoy";
  if (mismo(d, ayer)) return "Ayer";
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

function duracionLegible(seg) {
  if (seg == null) return "";
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return m ? `${m} min ${s}s` : `${s}s`;
}

/* ─── Toast ───────────────────────────────────────────────────────────── */
let _toastTimer = null;
function toast(mensaje, esError) {
  const el = $("toast");
  el.textContent = mensaje;
  el.classList.toggle("toast-error", Boolean(esError));
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("visible"));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => (el.hidden = true), 250);
  }, 3200);
}

/* ─── Apariencia desde la config de la clínica ────────────────────────── */
function aplicarApariencia() {
  let cfg = {};
  try {
    cfg = JSON.parse(localStorage.getItem("medicita_config_clinica") || "{}");
  } catch {
    cfg = {};
  }
  const raiz = document.documentElement;
  if (cfg.colorPrimario) raiz.style.setProperty("--azul-principal", cfg.colorPrimario);
  if (cfg.colorAcento) raiz.style.setProperty("--ambar", cfg.colorAcento);
  if (cfg.tipografia) document.body.style.fontFamily = `${cfg.tipografia}, sans-serif`;
  return cfg;
}

/* ═══════════════════════════════════════════════════════════════════════
   Gate de rol
   ═══════════════════════════════════════════════════════════════════════ */
function renderGate() {
  const cont = $("gate-roles");
  cont.innerHTML = sesionRoles()
    .map(
      r => `
      <button type="button" class="gate-rol-btn" data-rol="${r.id}">
        <span class="gate-rol-icono" aria-hidden="true">${r.icono}</span>
        <span class="gate-rol-label">${escapeHtml(r.label)}</span>
        <span class="gate-rol-desc">${escapeHtml(r.desc)}</span>
      </button>`
    )
    .join("");

  cont.querySelectorAll(".gate-rol-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      cont.querySelectorAll(".gate-rol-btn").forEach(b => b.classList.remove("activo"));
      btn.classList.add("activo");
      estado.rolPendiente = btn.dataset.rol;
      $("gate-entrar").disabled = false;
    });
  });

  $("gate-aviso-texto").textContent = sesionAvisoDemo();
  $("cv-aviso-demo-texto").textContent = sesionAvisoDemo();
}

function mostrarGate() {
  $("gate-rol").hidden = false;
  document.body.style.overflow = "hidden";
}

function ocultarGate() {
  $("gate-rol").hidden = true;
  document.body.style.overflow = "";
}

function entrarConRol() {
  if (!estado.rolPendiente) return;
  const s = sesionIniciar(estado.rolPendiente, $("gate-nombre").value);
  estado.rol = s.rol;
  estado.nombreStaff = s.nombre;
  ocultarGate();
  actualizarBotonRol();
  arrancarInbox();
}

function actualizarBotonRol() {
  const r = ROLES[estado.rol];
  $("btn-rol-texto").textContent = r ? `${r.icono} ${estado.nombreStaff || r.label}` : "Rol";
}

/* ═══════════════════════════════════════════════════════════════════════
   Lista de conversaciones
   ═══════════════════════════════════════════════════════════════════════ */
async function refrescarLista() {
  estado.conversaciones = await listarConversaciones(estado.filtros);
  renderLista();
  await renderMetricas();
}

async function renderMetricas() {
  const m = await contarPorEstado();
  const partes = [`<span class="metrica">${m.total} conversaciones</span>`];
  if (m.requiere_atencion_humana > 0) {
    partes.push(
      `<span class="metrica metrica-atencion">⏰ ${m.requiere_atencion_humana} requieren atención</span>`
    );
  }
  if (m.noLeidos > 0) {
    partes.push(`<span class="metrica metrica-nuevos">${m.noLeidos} sin leer</span>`);
  }
  $("lista-metricas").innerHTML = partes.join("");
}

function renderLista() {
  const ul = $("lista-conversaciones");
  const vacio = $("lista-vacia");

  if (!estado.conversaciones.length) {
    ul.innerHTML = "";
    vacio.hidden = false;
    $("lista-vacia-texto").textContent =
      estado.filtros.texto || estado.filtros.canal !== "todos" || estado.filtros.estado !== "todos"
        ? "No hay conversaciones que coincidan con el filtro."
        : "Todavía no hay conversaciones registradas.";
    return;
  }
  vacio.hidden = true;

  ul.innerHTML = estado.conversaciones
    .map(c => {
      const info = CANAL_INFO[c.canal] || { label: c.canal, icono: "💬" };
      const nombre = nombreMostrado(c);
      const preview = c.ultimoMensaje
        ? (c.ultimoMensaje.remitente === "staff" || c.ultimoMensaje.remitente === "agente" ? "Tú: " : "") +
          c.ultimoMensaje.texto
        : "Sin mensajes";

      const clases = ["conv-item"];
      if (c.id === estado.convActivaId) clases.push("activo");
      if (c.noLeidos > 0) clases.push("no-leido");
      if (c.estado === "requiere_atencion_humana") clases.push("atencion");

      return `
        <li class="${clases.join(" ")}" data-id="${escapeHtml(c.id)}" tabindex="0" role="button">
          <div class="conv-avatar">${escapeHtml(iniciales(nombre))}</div>
          <div class="conv-cuerpo">
            <div class="conv-linea1">
              <span class="conv-nombre">${escapeHtml(nombre)}</span>
              <span class="conv-hora">${escapeHtml(horaRelativa(c.actualizadaEn))}</span>
            </div>
            <div class="conv-linea2">
              <span class="conv-canal conv-canal-${escapeHtml(c.canal)}" title="${escapeHtml(info.label)}">${info.icono}</span>
              <span class="conv-preview">${escapeHtml(preview)}</span>
              ${c.noLeidos > 0 ? `<span class="conv-badge-no-leidos">${c.noLeidos}</span>` : ""}
            </div>
          </div>
        </li>`;
    })
    .join("");

  ul.querySelectorAll(".conv-item").forEach(li => {
    li.addEventListener("click", () => abrirConversacion(li.dataset.id));
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrirConversacion(li.dataset.id);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Hilo
   ═══════════════════════════════════════════════════════════════════════ */
async function abrirConversacion(id) {
  const conv = await obtenerConversacion(id);
  if (!conv) return;

  estado.convActivaId = id;
  await marcarLeida(id);
  estado.mensajes = await listarMensajes(id);
  estado.pacienteActivo = conv.pacienteId ? await resolverPaciente(conv.telefono) : null;

  $("hilo-vacio").hidden = true;
  $("hilo-contenido").hidden = false;
  $("inbox-layout").classList.add("viendo-hilo");

  renderCabeceraHilo(conv);
  renderMensajes();
  renderCompositor(conv);

  await refrescarLista();
}

function renderCabeceraHilo(conv) {
  const info = CANAL_INFO[conv.canal] || { label: conv.canal, icono: "💬" };
  const nombre = nombreMostrado(conv);

  $("hilo-avatar").textContent = iniciales(nombre);
  $("hilo-nombre").textContent = nombre;

  const meta = [`${info.icono} ${info.label}`];
  if (conv.telefono) meta.push(conv.telefono);
  if (conv.canalMeta?.duracionSeg) meta.push(`Duración ${duracionLegible(conv.canalMeta.duracionSeg)}`);
  if (!conv.pacienteId) meta.push("Sin expediente");
  $("hilo-meta").textContent = meta.join(" · ");

  $("sel-estado").value = conv.estado;

  const btnPerfil = $("btn-ver-perfil");
  btnPerfil.hidden = !conv.pacienteId;
}

function renderMensajes() {
  const cont = $("hilo-mensajes");

  if (!estado.mensajes.length) {
    cont.innerHTML = `<p class="hilo-sin-mensajes">Esta conversación no tiene mensajes.</p>`;
    return;
  }

  let html = "";
  let diaPrevio = "";

  for (const m of estado.mensajes) {
    const dia = etiquetaDia(m.fecha);
    if (dia !== diaPrevio) {
      html += `<div class="msg-separador"><span>${escapeHtml(dia)}</span></div>`;
      diaPrevio = dia;
    }
    html += burbujaHTML(m);
  }

  cont.innerHTML = html;
  cont.scrollTop = cont.scrollHeight;
}

function burbujaHTML(m) {
  // Los mensajes de sistema son rastro de lo que hizo el bot, no conversación.
  if (m.remitente === "sistema") {
    return `<div class="msg msg-sistema"><span>${escapeHtml(m.contenido)}</span></div>`;
  }

  const esNota = m.tipo === "nota_interna";
  const clase = esNota ? "msg-nota" : `msg-${escapeHtml(m.remitente)}`;

  let cuerpo = "";

  if (m.tipo === "audio") {
    cuerpo += `<div class="msg-audio">🎧 Mensaje de voz${
      m.duracionSeg ? ` · ${escapeHtml(duracionLegible(m.duracionSeg))}` : ""
    }</div>`;
    if (m.contenido && m.contenido !== "(mensaje de voz)") {
      cuerpo += `<details class="msg-detalle"><summary class="msg-detalle-sum">Ver transcripción</summary>
                 <div class="msg-texto">${escapeHtml(m.contenido)}</div></details>`;
    }
  } else {
    cuerpo += `<div class="msg-texto">${escapeHtml(m.contenido).replace(/\n/g, "<br>")}</div>`;
  }

  const herramientas = m.metadata?.herramientas || [];
  if (herramientas.length) {
    cuerpo += `<div class="msg-herramientas">${herramientas
      .map(h => `<span>${escapeHtml(h)}</span>`)
      .join("")}</div>`;
  }

  const estadoChip = chipEstadoEnvio(m);
  const autor = esNota
    ? `Nota interna · ${escapeHtml(m.autorNombre || "Staff")}`
    : escapeHtml(m.autorNombre || "");

  return `
    <div class="msg ${clase}">
      <div class="msg-burbuja">
        ${autor ? `<div class="msg-autor">${autor}</div>` : ""}
        ${cuerpo}
        <div class="msg-pie">
          <span class="msg-hora">${escapeHtml(horaCorta(m.fecha))}</span>
          ${estadoChip}
        </div>
      </div>
    </div>`;
}

function chipEstadoEnvio(m) {
  if (m.tipo === "nota_interna") return "";
  const mapa = {
    enviado: { txt: "✓ Enviado", clase: "msg-estado-enviado" },
    pendiente: { txt: "⏳ Pendiente de envío", clase: "msg-estado-pendiente" },
    fallido: { txt: "✕ No se pudo enviar", clase: "msg-estado-fallido" },
  };
  const e = mapa[m.estadoEnvio];
  if (!e) return "";
  const detalle = m.metadata?.detalleEnvio ? ` title="${escapeHtml(m.metadata.detalleEnvio)}"` : "";
  return `<span class="msg-estado ${e.clase}"${detalle}>${e.txt}</span>`;
}

/* ─── Compositor ──────────────────────────────────────────────────────── */
function renderCompositor(conv) {
  const cap = capacidadCanal(conv.canal);
  const box = $("compositor-capacidad");
  const email = estado.pacienteActivo?.email || "";

  if (cap.salidaViva) {
    box.innerHTML = "";
    box.hidden = true;
  } else {
    box.hidden = false;
    box.innerHTML = `
      <span aria-hidden="true">ℹ️</span>
      <span>${escapeHtml(cap.motivo)} El mensaje quedará registrado como <strong>pendiente</strong>${
        email ? ", o puedes enviarlo por correo." : "."
      }</span>`;
  }

  const wrap = $("wrap-forzar-email");
  if (email && !cap.salidaViva) {
    wrap.hidden = false;
    $("forzar-email-dir").textContent = `(${email})`;
  } else {
    wrap.hidden = true;
    $("chk-forzar-email").checked = false;
  }
}

async function enviarDesdeCompositor() {
  const input = $("inp-mensaje");
  const texto = input.value.trim();
  if (!texto || !estado.convActivaId) return;

  const conv = await obtenerConversacion(estado.convActivaId);
  if (!conv) return;

  const esNota = $("chk-nota-interna").checked;
  const forzarEmail = $("chk-forzar-email").checked;

  // Una nota interna nunca sale a ningún lado: se guarda y punto.
  if (esNota) {
    await agregarMensaje(conv.id, {
      remitente: "staff",
      autorNombre: estado.nombreStaff || "Staff",
      tipo: "nota_interna",
      contenido: texto,
      estadoEnvio: "enviado",
    });
    input.value = "";
    ajustarAltoTextarea();
    await recargarHiloYLista();
    toast("Nota interna guardada");
    return;
  }

  const cfg = aplicarApariencia();
  const resultado = await enviarMensaje(conv, texto, {
    forzarEmail,
    emailPaciente: estado.pacienteActivo?.email || "",
    nombreClinica: cfg.nombreClinica || "tu clínica",
  });

  const msg = await agregarMensaje(conv.id, {
    remitente: "staff",
    autorNombre: estado.nombreStaff || "Staff",
    tipo: "texto",
    contenido: texto,
    estadoEnvio: resultado.estado,
    metadata: resultado.detalle ? { detalleEnvio: resultado.detalle, via: resultado.via } : { via: resultado.via },
  });

  input.value = "";
  ajustarAltoTextarea();
  $("chk-forzar-email").checked = false;
  await recargarHiloYLista();

  if (resultado.estado === "enviado") toast(resultado.detalle || "Mensaje enviado");
  else if (resultado.estado === "pendiente") toast("Guardado como pendiente de envío");
  else toast(resultado.detalle || "No se pudo enviar", true);

  return msg;
}

async function recargarHiloYLista() {
  if (estado.convActivaId) {
    estado.mensajes = await listarMensajes(estado.convActivaId);
    renderMensajes();
  }
  await refrescarLista();
}

function ajustarAltoTextarea() {
  const ta = $("inp-mensaje");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}

/* ═══════════════════════════════════════════════════════════════════════
   Modal de EmailJS
   ═══════════════════════════════════════════════════════════════════════ */
function abrirModalEmail() {
  $("modal-email").hidden = false;
}

function cerrarModalEmail() {
  $("modal-email").hidden = true;
}

function guardarConfigEmail() {
  const listo = configurarEmailJS(
    $("ejs-service").value,
    $("ejs-template").value,
    $("ejs-public").value
  );
  cerrarModalEmail();
  toast(listo ? "Envío por correo activado en esta sesión" : "Faltan datos para activar el correo", !listo);
  if (estado.convActivaId) obtenerConversacion(estado.convActivaId).then(c => c && renderCompositor(c));
}

/* ═══════════════════════════════════════════════════════════════════════
   Eventos
   ═══════════════════════════════════════════════════════════════════════ */
let _debounce = null;

function conectarEventos() {
  /* Gate */
  $("gate-entrar").addEventListener("click", entrarConRol);
  $("gate-nombre").addEventListener("keydown", e => {
    if (e.key === "Enter") entrarConRol();
  });

  $("btn-rol").addEventListener("click", () => {
    sesionCerrar();
    estado.rolPendiente = null;
    $("gate-entrar").disabled = true;
    document.querySelectorAll(".gate-rol-btn").forEach(b => b.classList.remove("activo"));
    mostrarGate();
  });

  /* Aviso */
  $("cv-aviso-cerrar").addEventListener("click", () => {
    $("cv-aviso-demo").hidden = true;
  });

  /* Buscador */
  $("inp-buscar").addEventListener("input", e => {
    const v = e.target.value;
    $("btn-limpiar-busqueda").hidden = !v;
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      estado.filtros.texto = v;
      refrescarLista();
    }, 220);
  });

  $("btn-limpiar-busqueda").addEventListener("click", () => {
    $("inp-buscar").value = "";
    $("btn-limpiar-busqueda").hidden = true;
    estado.filtros.texto = "";
    refrescarLista();
  });

  /* Chips de filtro */
  document.querySelectorAll(".chip-canal").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip-canal").forEach(c => c.classList.remove("activo"));
      chip.classList.add("activo");
      estado.filtros.canal = chip.dataset.canal;
      refrescarLista();
    });
  });

  document.querySelectorAll(".chip-estado").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip-estado").forEach(c => c.classList.remove("activo"));
      chip.classList.add("activo");
      estado.filtros.estado = chip.dataset.estado;
      refrescarLista();
    });
  });

  /* Hilo */
  $("sel-estado").addEventListener("change", async e => {
    if (!estado.convActivaId) return;
    await cambiarEstado(estado.convActivaId, e.target.value);
    await refrescarLista();
    toast(`Marcada como "${ESTADO_LABEL[e.target.value]}"`);
  });

  $("btn-ver-perfil").addEventListener("click", e => {
    e.preventDefault();
    // Se usa el contrato que admin.html ya tiene para recordar su pestaña
    // activa, así no hace falta modificar admin.js.
    localStorage.setItem("medicita_tab_activa", "pacientes");
    window.open("admin.html", "_blank");
  });

  $("hilo-volver").addEventListener("click", () => {
    $("inbox-layout").classList.remove("viendo-hilo");
    estado.convActivaId = null;
    $("hilo-contenido").hidden = true;
    $("hilo-vacio").hidden = false;
    renderLista();
  });

  /* Compositor */
  $("btn-enviar").addEventListener("click", enviarDesdeCompositor);
  $("inp-mensaje").addEventListener("input", ajustarAltoTextarea);
  $("inp-mensaje").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarDesdeCompositor();
    }
  });

  /* Modal EmailJS */
  $("btn-config-email").addEventListener("click", abrirModalEmail);
  $("modal-email-cerrar").addEventListener("click", cerrarModalEmail);
  $("modal-email-cancelar").addEventListener("click", cerrarModalEmail);
  $("modal-email-guardar").addEventListener("click", guardarConfigEmail);
  $("modal-email").addEventListener("click", e => {
    if (e.target === $("modal-email")) cerrarModalEmail();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("modal-email").hidden) cerrarModalEmail();
  });

  /* Sincronización entre pestañas: si MediBot registra una conversación
     en otra pestaña, la lista se entera sin recargar. */
  window.addEventListener("storage", e => {
    if (e.key === "medicita_conversaciones" || e.key === "medicita_mensajes") {
      recargarHiloYLista();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Arranque
   ═══════════════════════════════════════════════════════════════════════ */
async function arrancarInbox() {
  await sembrarDemoSiVacio();
  await refrescarLista();
}

document.addEventListener("DOMContentLoaded", async () => {
  aplicarApariencia();
  renderGate();
  conectarEventos();

  if (sesionRequiereRol(ROLES_PERMITIDOS)) {
    estado.rol = sesionRolActual();
    estado.nombreStaff = sesionNombreActual();
    actualizarBotonRol();
    await arrancarInbox();
  } else {
    mostrarGate();
  }
});
