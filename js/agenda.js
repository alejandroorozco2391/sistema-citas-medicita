/* ═══════════════════════════════════════════════════════════════════════
   Agenda — pestaña "Agenda" del panel

   La tabla de Citas responde "¿qué hay de Fulano?". Esto responde "¿cómo
   viene mi día?", que es la pregunta con la que alguien abre el panel por
   la mañana, y que hasta ahora se contestaba filtrando una tabla por fecha
   y leyendo renglones sueltos.

   La diferencia de fondo es que aquí **los huecos vacíos se ven**. Una
   tabla solo puede mostrar lo que existe; una agenda muestra también lo que
   falta, y eso es justo lo que hace falta saber cuando suena el teléfono y
   alguien pregunta "¿me puede dar algo el jueves?".

   Por eso la rejilla se dibuja desde el HORARIO de la clínica (Fase E) y no
   desde las citas: un día cerrado no tiene huecos que ofrecer, y un día sin
   horario cargado se dibuja con las horas de los médicos, como antes.

   Script clásico, como el resto de los módulos del panel: habla con la capa
   de datos por `window.API`, que publica js/puente-api.js.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ─── Fechas y franjas ──────────────────────────────────────────────
     La aritmética vive en js/agenda-rejilla.js, aparte y probada en node:
     es todo cuenta de fechas y de horas, que es exactamente donde este
     proyecto ya se equivocó dos veces. Aquí solo se le pone nombre corto.

     Y va ANTES de `estadoAg`, que arranca en el día de hoy: un `const` no
     se puede leer antes de su declaración, y con los alias abajo el módulo
     entero moría al cargar sin registrar un solo manejador. */

  const hoyISO = agHoy;
  const aFecha = agFecha;
  const sumarDias = agSumarDias;
  const hhmm = agHhmm;

  const largo = (v) =>
    aFecha(v).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  const corto = (v) =>
    aFecha(v).toLocaleDateString("es-MX", { weekday: "short", day: "numeric" });

  const estadoAg = {
    /** Ancla de la vista. En "dia" es el día; en "semana", cualquier día de ella. */
    fecha: hoyISO(),
    vista: "dia",
    medico: "",
    citas: [],
    /** fecha ISO → [{horaInicio, horaFin}] ya resuelto (excepción sobre base) */
    horario: new Map(),
  };

  /* ─── Días que abarca la vista ───────────────────────────────────────── */

  function diasDeLaVista() {
    return estadoAg.vista === "dia" ? [estadoAg.fecha] : agSemanaDe(estadoAg.fecha);
  }

  /* ─── Horas de la rejilla ────────────────────────────────────────────── */

  /**
   * Las franjas de media hora de ese día, según el horario de la clínica.
   *
   * `[]` de agFranjas significa "no hay bloques ese día", y eso es distinto
   * de "esta clínica no cargó su horario": lo primero es un día cerrado y lo
   * segundo hay que tratarlo como antes de MediHorario, con las horas de los
   * médicos. Confundirlos deja la agenda en blanco sin decir por qué.
   */
  function franjasDe(fecha) {
    const bloques = estadoAg.horario.get(fecha) || [];
    if (bloques.length) return agFranjas(bloques);
    return hayHorarioCargado() ? [] : franjasDeMedicos();
  }

  const hayHorarioCargado = () =>
    [...estadoAg.horario.values()].some((b) => b.length > 0);

  function franjasDeMedicos() {
    const horas = new Set();
    (window.DOCTORES || []).forEach((d) => (d.horarios || []).forEach((h) => horas.add(hhmm(h))));
    return [...horas].sort();
  }

  /* ─── Datos ──────────────────────────────────────────────────────────── */

  async function cargar() {
    const dias = diasDeLaVista();

    const todas = await API.citas.listar();
    estadoAg.citas = todas.filter(
      (c) => dias.includes(String(c.fecha).slice(0, 10)) && c.estado !== "cancelada"
    );

    /* El horario se pide día por día porque `delDia()` ya resuelve la
       excepción encima de la base, que es la única forma correcta de saber
       si ESE día se atiende. */
    estadoAg.horario = new Map();
    for (const f of dias) {
      try {
        estadoAg.horario.set(f, (await API.horarios.delDia(f)) || []);
      } catch (e) {
        console.warn("No se pudo leer el horario de", f, e);
        estadoAg.horario.set(f, []);
      }
    }
  }

  /* ─── Render ─────────────────────────────────────────────────────────── */

  function citasDe(fecha, franja) {
    return estadoAg.citas.filter((c) => {
      if (String(c.fecha).slice(0, 10) !== fecha) return false;
      if (estadoAg.medico && c.doctor !== estadoAg.medico) return false;
      return agEnFranja(c.hora, franja);
    });
  }

  /** Las citas sin hora no caben en ninguna franja, y no por eso desaparecen. */
  function sinHora(fecha) {
    return estadoAg.citas.filter(
      (c) => String(c.fecha).slice(0, 10) === fecha &&
             !hhmm(c.hora) &&
             (!estadoAg.medico || c.doctor === estadoAg.medico)
    );
  }

  function render() {
    $("ag-titulo").textContent = estadoAg.vista === "dia"
      ? largo(estadoAg.fecha)
      : rangoSemana();

    const cuerpo = $("ag-cuerpo");
    cuerpo.innerHTML = estadoAg.vista === "dia" ? htmlDia() : htmlSemana();
    renderResumen();

    cuerpo.querySelectorAll("[data-folio]").forEach((el) => {
      el.addEventListener("click", () => abrirCita(el.dataset.folio));
    });
  }

  function rangoSemana() {
    const dias = diasDeLaVista();
    const a = aFecha(dias[0]);
    const b = aFecha(dias[6]);
    const mesA = a.toLocaleDateString("es-MX", { month: "long" });
    const mesB = b.toLocaleDateString("es-MX", { month: "long" });
    return mesA === mesB
      ? `${a.getDate()} – ${b.getDate()} de ${mesB}`
      : `${a.getDate()} de ${mesA} – ${b.getDate()} de ${mesB}`;
  }

  function renderResumen() {
    const dias = diasDeLaVista();
    const visibles = estadoAg.citas.filter(
      (c) => !estadoAg.medico || c.doctor === estadoAg.medico
    );

    let huecos = 0;
    for (const f of dias) {
      for (const franja of franjasDe(f)) {
        if (citasDe(f, franja).length === 0) huecos++;
      }
    }

    const n = visibles.length;
    /* Los huecos son el dato que una tabla no puede dar, así que van en el
       resumen y no escondidos en la rejilla: es la respuesta a "¿me puede
       dar algo el jueves?". */
    $("ag-resumen").textContent = n === 0 && huecos === 0
      ? "Ese día el consultorio no atiende."
      : `${n} cita${n === 1 ? "" : "s"} · ${huecos} hueco${huecos === 1 ? "" : "s"} libre${huecos === 1 ? "" : "s"}`;
  }

  function chipCita(c) {
    const hora = hhmm(c.hora);
    return `
      <button type="button" class="ag-cita ag-estado-${escapar(c.estado)}"
              data-folio="${escapar(c.folio)}"
              title="${escapar(`${c.nombre} ${c.apellidos} · ${c.doctor} · ${c.tipo || ""}`)}">
        ${hora ? `<span class="ag-cita-hora">${hora}</span>` : ""}
        <span class="ag-cita-nombre">${escapar(`${c.nombre} ${c.apellidos}`.trim())}</span>
        <span class="ag-cita-medico">${escapar(c.doctor || "")}</span>
      </button>`;
  }

  function htmlDia() {
    const f = estadoAg.fecha;
    const franjas = franjasDe(f);
    const suelta = sinHora(f);

    if (!franjas.length) {
      return bloqueCerrado(f, suelta);
    }

    const filas = franjas.map((franja) => {
      const cs = citasDe(f, franja);
      return `
        <div class="ag-fila ${cs.length ? "" : "ag-fila-libre"}">
          <div class="ag-hora">${franja}</div>
          <div class="ag-slot">
            ${cs.length ? cs.map(chipCita).join("") : '<span class="ag-libre">libre</span>'}
          </div>
        </div>`;
    }).join("");

    return `<div class="ag-dia">${filas}</div>${htmlSinHora(suelta)}`;
  }

  function htmlSemana() {
    const dias = diasDeLaVista();

    /* La rejilla usa la unión de las franjas de todos los días: si el sábado
       solo se abre de 9 a 12, no tiene por qué encoger los demás. */
    const franjas = [...new Set(dias.flatMap(franjasDe))].sort();

    if (!franjas.length) {
      return `<p class="agenda-vacia">Esta semana no hay horario de atención cargado.</p>`;
    }

    const cabeza = dias.map((f) => {
      const cerrado = (estadoAg.horario.get(f) || []).length === 0 && hayHorarioCargado();
      return `<div class="ag-col-cabeza ${f === hoyISO() ? "ag-hoy-col" : ""} ${cerrado ? "ag-col-cerrada" : ""}">
                ${escapar(corto(f))}${cerrado ? '<span class="ag-cerrado-etq">cerrado</span>' : ""}
              </div>`;
    }).join("");

    const filas = franjas.map((franja) => {
      const celdas = dias.map((f) => {
        const abre = franjasDe(f).includes(franja);
        if (!abre) return `<div class="ag-celda ag-celda-cerrada"></div>`;
        const cs = citasDe(f, franja);
        return `<div class="ag-celda ${cs.length ? "" : "ag-celda-libre"}">${cs.map(chipCita).join("")}</div>`;
      }).join("");
      return `<div class="ag-sem-fila"><div class="ag-hora">${franja}</div>${celdas}</div>`;
    }).join("");

    const sueltas = dias.flatMap(sinHora);

    return `
      <div class="ag-semana">
        <div class="ag-sem-fila ag-sem-cabeza"><div class="ag-hora"></div>${cabeza}</div>
        ${filas}
      </div>
      ${htmlSinHora(sueltas)}`;
  }

  function bloqueCerrado(fecha, suelta) {
    const conHorario = hayHorarioCargado();
    return `
      <p class="agenda-vacia">
        ${conHorario
          ? `El ${escapar(largo(fecha))} el consultorio no atiende.`
          : "No hay horario de atención cargado. Cárgalo en la pestaña 🗓 Horarios para ver los huecos libres."}
      </p>
      ${htmlSinHora(suelta)}`;
  }

  /** Citas sin hora asignada. Aparte, pero visibles: si no, se pierden. */
  function htmlSinHora(citas) {
    if (!citas.length) return "";
    return `
      <div class="ag-sinhora">
        <h4>Sin hora asignada</h4>
        <p class="ag-sinhora-nota">Se pidieron sin horario. Asígnales uno desde la pestaña 📋 Citas.</p>
        <div class="ag-sinhora-lista">${citas.map(chipCita).join("")}</div>
      </div>`;
  }

  /* ─── Abrir una cita ─────────────────────────────────────────────────── */

  /**
   * Lleva a la pestaña de Citas con esa cita filtrada.
   *
   * No se duplica aquí el cambio de estado ni el borrado: ya existen en la
   * tabla, con su confirmación y su disparo de seguimiento al marcar
   * "Atendida". Tener dos caminos para lo mismo es tener dos sitios donde
   * arreglar el siguiente error.
   */
  function abrirCita(folio) {
    const busqueda = $("filtro-busqueda");
    if (busqueda) {
      busqueda.value = folio;
      busqueda.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const btn = document.querySelector('.tabs-nav-btn[data-tab="citas"]');
    if (btn) btn.click();
  }

  /* ─── Utilidades ─────────────────────────────────────────────────────── */

  function escapar(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function refrescar() {
    try {
      await cargar();
      render();
    } catch (e) {
      console.error("Agenda:", e);
      $("ag-cuerpo").innerHTML =
        `<p class="agenda-vacia">No se pudo cargar la agenda. ${escapar(e.message || "")}</p>`;
    }
  }

  /* Una sola mutación del panel pasa varias veces por `cargarCitas()` —
     confirmar una cita recarga, re-renderiza y vuelve a recargar— y cada
     refresco de aquí pide el horario día por día. Sin agrupar, mover una
     cita en la semana dispara medio centenar de consultas. */
  let pendiente = null;
  function refrescarPronto() {
    clearTimeout(pendiente);
    pendiente = setTimeout(refrescar, 150);
  }

  /* ─── Arranque ───────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", async () => {
    /* Como toda rutina de arranque del panel: saber si hay una clínica real
       detrás requiere preguntarle a Supabase. */
    await window.APIListo;

    const sel = $("ag-medico");
    (window.DOCTORES || []).forEach((d) => {
      const o = document.createElement("option");
      o.value = d.nombre;
      o.textContent = d.nombre;
      sel.appendChild(o);
    });

    const paso = () => (estadoAg.vista === "dia" ? 1 : 7);

    $("ag-anterior").addEventListener("click", () => {
      estadoAg.fecha = sumarDias(estadoAg.fecha, -paso());
      refrescar();
    });
    $("ag-siguiente").addEventListener("click", () => {
      estadoAg.fecha = sumarDias(estadoAg.fecha, paso());
      refrescar();
    });
    $("ag-hoy").addEventListener("click", () => {
      estadoAg.fecha = hoyISO();
      refrescar();
    });

    sel.addEventListener("change", () => {
      estadoAg.medico = sel.value;
      render();                       // filtrar no cambia los datos cargados
    });

    document.querySelectorAll(".ag-btn-vista").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".ag-btn-vista").forEach((b) => b.classList.remove("activa"));
        btn.classList.add("activa");
        estadoAg.vista = btn.dataset.vista;
        refrescar();
      });
    });

    await refrescar();

    /* La agenda se queda abierta mientras alguien contesta el teléfono, así
       que tiene que reflejar lo que capture otra pestaña. Es el mismo
       contrato de `storage` que ya usa el resto del panel. */
    window.addEventListener("storage", (e) => {
      if (e.key === "medicita_citas" || e.key === "medicita_horarios") refrescarPronto();
    });

    /* Y lo que capture ESTA pestaña desde la tabla o "+ Nueva cita": el
       evento `storage` no se dispara en el mismo documento que escribió. */
    document.addEventListener("medicita:citas-cambiaron", refrescarPronto);
  });
})();
