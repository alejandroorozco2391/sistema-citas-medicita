/* ═══════════════════════════════════════════════════════════════════════
   Escalaciones a humano — pestaña del panel

   Toda la función se sostiene sobre una sola idea: un paciente pidió
   hablar con una persona, y o alguien lo atiende o el sistema sigue
   avisando. Esta pantalla es donde eso se ve.

   Dos decisiones que se notan al usarla:

     · "La tomo" detiene la alerta. No es un adorno: quien la toma se
       está haciendo responsable, y por eso queda su nombre.
     · Una escalación vencida NO se puede quitar de la vista sin cerrarla,
       y cerrarla exige decir qué se hizo. Si se pudiera silenciar, en dos
       semanas nadie miraría esta pestaña.

   Script clásico, como el resto del panel.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* 25 segundos. Es una consulta chica y de esta cadencia depende cuánto
     tarda recepción en enterarse; más espaciado y la insignia llega tarde,
     más seguido y se vuelve ruido contra la base. */
  const SONDEO_MS = 25000;

  const MOTIVO_LABEL = {
    urgencia_medica:    "Posible urgencia",
    duda_clinica:       "Duda clínica",
    queja:              "Queja",
    agenda:             "Agenda",
    administrativo:     "Administrativo",
    peticion_explicita: "Pidió hablar con alguien",
    bot_no_pudo:        "El asistente no pudo",
  };

  const DESTINO_LABEL = { doctor: "Doctor(a)", recepcionista: "Recepción", admin: "Admin" };

  const NIVEL_LABEL = [
    "Avisado a su destino",
    "Avisado a todo el personal",
    "Avisado también por correo",
    "Sin atender",
  ];

  let filtro = "abiertas";
  let lista = [];
  let sonidoActivo = false;
  let vistosIds = new Set();
  let primeraCarga = true;

  const $ = (id) => document.getElementById(id);

  function escapar(s) {
    const d = document.createElement("div");
    d.textContent = String(s || "");
    return d.innerHTML;
  }

  function avisar(mensaje, tipo) {
    if (typeof mostrarToast === "function") mostrarToast(mensaje, tipo || "ok");
  }

  /** "hace 3 min". Es el dato que más importa de un vistazo. */
  function desdeHace(iso) {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} d`;
  }

  /* ─── Aviso sonoro ──────────────────────────────────────────────────── */

  /* Un pitido sintetizado con WebAudio en vez de un archivo: no hay que
     servir un .mp3 ni pedirle al navegador que lo precargue, y suena
     igual en los dos modos. */
  function pitar() {
    if (!sonidoActivo) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      vol.gain.setValueAtTime(0.0001, ctx.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(vol).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close(), 700);
    } catch { /* sin audio disponible: la insignia sigue estando */ }
  }

  function notificar(escalacion) {
    pitar();
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification("Un paciente espera atención", {
        body: `${escalacion.contactoNombre || "Alguien"} — ${MOTIVO_LABEL[escalacion.motivo] || escalacion.motivo}`,
        tag: escalacion.id,
      });
    } catch { /* algunos navegadores la bloquean fuera de un service worker */ }
  }

  /* ─── Render ────────────────────────────────────────────────────────── */

  function renderInsignia(conteo) {
    const btn = $("badge-escalaciones-btn");
    const num = $("badge-escalaciones-num");
    if (!btn || !num) return;

    num.textContent = conteo.total;
    btn.classList.toggle("oculto", conteo.total === 0);
    /* Las vencidas laten más fuerte: llevan más tiempo sin que nadie
       conteste y son las que no pueden pasar desapercibidas. */
    btn.classList.toggle("hay-vencidas", conteo.vencidas > 0);
  }

  function renderLista() {
    const cont = $("esc-lista");
    if (!cont) return;

    if (!lista.length) {
      cont.innerHTML = `<p class="esc-vacio">${
        filtro === "abiertas"
          ? "Nadie está esperando. Todo atendido."
          : "Todavía no hay escalaciones."
      }</p>`;
      return;
    }

    cont.innerHTML = lista.map((e) => {
      const abierta = e.estado === "pendiente" || e.estado === "vencida";
      const esUrgencia = e.motivo === "urgencia_medica";

      return `
      <article class="esc-item esc-item--${e.estado}">
        <div class="esc-item-cab">
          <span class="esc-motivo ${esUrgencia ? "esc-motivo--urgente" : ""}">
            ${escapar(MOTIVO_LABEL[e.motivo] || e.motivo)}
          </span>
          ${e.urgencia === "alta" ? '<span class="esc-chip esc-chip--alta">Urgencia alta</span>' : ""}
          <span class="esc-chip esc-chip--estado esc-chip--${e.estado}">${etiquetaEstado(e)}</span>
          <span class="esc-tiempo">${desdeHace(e.creadoEn)}</span>
        </div>

        <div class="esc-item-quien">
          <strong>${escapar(e.contactoNombre || "Sin nombre")}</strong>
          ${e.contactoTelefono ? `<a class="esc-tel" href="tel:${escapar(e.contactoTelefono)}">${escapar(e.contactoTelefono)}</a>` : ""}
          <span class="esc-destino">→ ${escapar(DESTINO_LABEL[e.destinoRol] || e.destinoRol)}</span>
        </div>

        ${e.resumen ? `<p class="esc-resumen">${escapar(e.resumen)}</p>` : ""}

        ${e.reconocidaPor ? `<p class="esc-meta">La tomó ${escapar(e.reconocidaPor)}</p>` : ""}
        ${e.notaCierre ? `<p class="esc-meta esc-meta--cierre">Cierre: ${escapar(e.notaCierre)}</p>` : ""}

        <div class="esc-acciones">
          ${abierta ? `<button type="button" class="esc-btn esc-btn--tomar" data-tomar="${e.id}">La tomo</button>` : ""}
          ${e.estado !== "resuelta" ? `<button type="button" class="esc-btn esc-btn--cerrar" data-cerrar="${e.id}">Resuelta</button>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  function etiquetaEstado(e) {
    if (e.estado === "vencida") return "Sin atender";
    if (e.estado === "reconocida") return "Tomada";
    if (e.estado === "resuelta") return "Resuelta";
    return NIVEL_LABEL[e.nivel] || "Esperando";
  }

  /* ─── Ciclo ─────────────────────────────────────────────────────────── */

  async function refrescar({ avisarNuevas = false } = {}) {
    /* Sin backend la escalera no la mueve nadie más, así que la empuja el
       panel antes de leer. Con backend esto es un no-op: la sube pg_cron,
       y dos relojes sobre las mismas filas la harían avanzar al doble. */
    await window.API.escalaciones.promover();

    lista = await window.API.escalaciones.listar(
      filtro === "abiertas" ? { abiertas: true } : {}
    );
    renderLista();

    const conteo = await window.API.escalaciones.contarAbiertas();
    renderInsignia(conteo);

    if (avisarNuevas && !primeraCarga) {
      for (const e of lista) {
        if ((e.estado === "pendiente" || e.estado === "vencida") && !vistosIds.has(e.id)) {
          notificar(e);
          break;   // un aviso por vuelta, no uno por escalación
        }
      }
    }
    vistosIds = new Set(lista.map((e) => e.id));
    primeraCarga = false;
  }

  /* ─── Cerrar ────────────────────────────────────────────────────────── */

  function pedirNotaDeCierre(escalacion) {
    return new Promise((resolver) => {
      const modal = $("modal-esc-cerrar");
      const nota = $("esc-cerrar-nota");

      $("esc-cerrar-desc").textContent =
        `${escalacion.contactoNombre || "Este paciente"} — ${MOTIVO_LABEL[escalacion.motivo] || escalacion.motivo}`;
      nota.value = "";
      modal.classList.remove("oculto");
      nota.focus();

      const cerrar = (valor) => {
        modal.classList.add("oculto");
        $("btn-esc-cerrar-confirmar").onclick = null;
        $("btn-esc-cerrar-cancelar").onclick = null;
        $("btn-esc-cerrar-x").onclick = null;
        resolver(valor);
      };

      $("btn-esc-cerrar-confirmar").onclick = () => {
        if (!nota.value.trim()) {
          avisar("Escribe qué se hizo antes de cerrarla", "error");
          nota.focus();
          return;
        }
        cerrar(nota.value.trim());
      };
      $("btn-esc-cerrar-cancelar").onclick = () => cerrar(null);
      $("btn-esc-cerrar-x").onclick = () => cerrar(null);
    });
  }

  /* ─── Arranque ──────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", async () => {
    await window.APIListo;
    if (!$("esc-lista")) return;   // otra página cargó este script

    /* En la demo no hay reloj del lado del servidor, y se dice. */
    $("esc-aviso-demo").classList.toggle("oculto", window.MODO_DATOS === "remoto");

    $("esc-lista").addEventListener("click", async (e) => {
      const tomar = e.target.closest("[data-tomar]");
      const cerrar = e.target.closest("[data-cerrar]");
      if (!tomar && !cerrar) return;

      const boton = tomar || cerrar;
      const id = boton.dataset.tomar || boton.dataset.cerrar;
      const escalacion = lista.find((x) => x.id === id);
      boton.disabled = true;

      try {
        if (tomar) {
          await window.API.escalaciones.reconocer(id);
          avisar("Tomada. Ya no vuelve a alertar.");
        } else {
          const nota = await pedirNotaDeCierre(escalacion || {});
          if (nota === null) { boton.disabled = false; return; }
          await window.API.escalaciones.resolver(id, nota);
          avisar("Escalación cerrada");
        }
        await refrescar();
      } catch (err) {
        avisar(err.message || "No se pudo actualizar", "error");
      } finally {
        boton.disabled = false;
      }
    });

    document.querySelectorAll(".esc-filtro").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll(".esc-filtro").forEach((b) => b.classList.remove("activo"));
        btn.classList.add("activo");
        filtro = btn.dataset.filtro;
        await refrescar();
      });
    });

    $("btn-esc-sonido").addEventListener("click", async () => {
      sonidoActivo = !sonidoActivo;
      $("btn-esc-sonido").textContent = sonidoActivo ? "🔔 Aviso activado" : "🔔 Activar aviso";
      $("btn-esc-sonido").classList.toggle("activo", sonidoActivo);

      if (sonidoActivo) {
        pitar();   // que se oiga de una vez cómo va a sonar
        if ("Notification" in window && Notification.permission === "default") {
          try { await Notification.requestPermission(); } catch { /* el usuario puede negarse */ }
        }
      }
    });

    try {
      await refrescar();
    } catch (e) {
      console.error("[escalaciones] No se pudieron cargar:", e);
    }

    /* El primer setInterval del proyecto. Hasta aquí nada se refrescaba
       solo, y una escalación que solo aparece al recargar no sirve. */
    setInterval(() => {
      refrescar({ avisarNuevas: true }).catch((e) =>
        console.warn("[escalaciones] sondeo:", e)
      );
    }, SONDEO_MS);
  });
})();
