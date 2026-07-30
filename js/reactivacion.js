/* ═══════════════════════════════════════════════════════════════════════
   Pacientes por reactivar — dentro de la pestaña de Pacientes

   Es la única parte del sistema que le escribe a alguien que NO pidió nada.
   Todo lo demás —recordatorios, seguimientos, la encuesta— cuelga de una
   cita que el propio paciente solicitó. Esto es publicidad hecha con un
   dato de salud, y la ley mexicana los trata como sensibles.

   De ahí las dos cosas que definen esta pantalla:

   · **Solo aparece quien lo aceptó por escrito.** El filtro está en la
     función SQL, no aquí: una lista de candidatos no puede depender de que
     la vista se acuerde de filtrar.

   · **Hay un botón por renglón y NO uno de "enviar a todos".** Encontrar
     candidatos es automático; mandar es una decisión. Un lote de "vuelve"
     que sale solo es exactamente lo que termina marcando el dominio de la
     clínica como spam — y eso se lleva también los correos que sus
     pacientes sí querían recibir.

   Script clásico, como el resto del panel: habla por `window.API`.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let candidatos = [];
  let oculto = false;

  /* ─── Datos ──────────────────────────────────────────────────────────── */

  async function refrescar() {
    const card = $("reactivar-card");
    if (!card || oculto) return;

    const dias = Number($("reac-dias")?.value || 180);

    try {
      candidatos = (await API.pacientes.porReactivar(dias)) || [];
    } catch (e) {
      console.warn("Reactivación:", e);
      candidatos = [];
    }

    /* Sin candidatos, la tarjeta no se enseña vacía: una sección que casi
       siempre dice "no hay nada" es una sección que se deja de mirar. */
    if (!candidatos.length) {
      card.classList.add("oculto");
      return;
    }

    card.classList.remove("oculto");
    render();
  }

  /* ─── Render ─────────────────────────────────────────────────────────── */

  function render() {
    const n = candidatos.length;
    const pendientes = candidatos.filter((c) => !c.yaInvitado).length;

    $("reac-resumen").textContent = pendientes === n
      ? `${n} sin volver, ninguno invitado todavía`
      : `${n} sin volver · ${pendientes} por invitar`;

    $("reac-lista").innerHTML = candidatos.map(renglon).join("");

    $("reac-lista").querySelectorAll("[data-invitar]").forEach((btn) => {
      btn.addEventListener("click", () => invitar(btn.dataset.invitar, btn));
    });
  }

  function renglon(c) {
    const meses = Math.floor(c.diasSinVenir / 30);
    const cuanto = meses >= 12
      ? `${Math.floor(meses / 12)} año${meses >= 24 ? "s" : ""}`
      : `${meses} mes${meses === 1 ? "" : "es"}`;

    return `
      <div class="reac-fila ${c.yaInvitado ? "reac-fila-hecha" : ""}">
        <div class="reac-datos">
          <div class="reac-nombre">${esc(`${c.nombre} ${c.apellidos}`.trim())}</div>
          <div class="reac-detalle">
            Última visita hace ${esc(cuanto)} ·
            ${c.totalVisitas} consulta${c.totalVisitas === 1 ? "" : "s"} ·
            ${esc(c.email)}
          </div>
        </div>
        ${c.yaInvitado
          /* No desaparece de la lista: esconderlo haría creer que se pasó
             por alto. Se marca, y el botón no se ofrece porque fallaría. */
          ? `<span class="reac-hecha">✓ Invitado este trimestre</span>`
          : `<button type="button" class="reac-btn" data-invitar="${esc(c.id)}">Invitar a volver</button>`}
      </div>`;
  }

  /* ─── Invitar ────────────────────────────────────────────────────────── */

  async function invitar(id, boton) {
    const c = candidatos.find((x) => x.id === id);
    if (!c) return;

    /* `prompt` devuelve null al cancelar y "" al aceptar sin escribir nada.
       Hay que distinguirlos ANTES de normalizar: con `(prompt() || "")`,
       cancelar producía "" y el correo salía igual — que es lo contrario de
       lo que quiso quien le dio a Cancelar. */
    const respuesta = prompt(
      `Mensaje para ${c.nombre}:\n\n` +
      "Déjalo vacío para usar el texto de siempre.",
      ""
    );
    if (respuesta === null) return;
    const mensaje = respuesta.trim();

    const etiqueta = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Enviando…";

    let r;
    try {
      r = await API.pacientes.invitarAVolver(id, mensaje);
    } catch (e) {
      r = { ok: false, error: e.message || "No se pudo invitar." };
    } finally {
      boton.disabled = false;
      boton.textContent = etiqueta;
    }

    if (!r.ok) { mostrarToast(r.error, "error"); return; }

    /* En la demo no hay bandeja que drenar, y se dice: fingir un envío es
       justo lo que el compositor del inbox tampoco hace con los canales sin
       salida viva. */
    mostrarToast(r.soloDemo
      ? `Invitación apuntada para ${r.paciente}. En la demo no sale ningún correo.`
      : `Invitación en camino a ${r.destinatario}.`, "ok");

    await refrescar();
  }

  /* ─── Utilidades ─────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  /* ─── Arranque ───────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", async () => {
    await window.APIListo;
    if (!$("reactivar-card")) return;

    $("reac-dias").addEventListener("change", refrescar);
    $("reac-ocultar").addEventListener("click", () => {
      oculto = true;
      $("reactivar-card").classList.add("oculto");
    });

    await refrescar();
  });

  /* Lo llama pacientes.js al cambiar un consentimiento: marcar la casilla y
     que el paciente no aparezca en la lista haría pensar que no se guardó. */
  window.refrescarReactivar = refrescar;
})();
