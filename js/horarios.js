/* ═══════════════════════════════════════════════════════════════════════
   MediHorario — pestaña "Horarios" del panel

   La agenda de un consultorio es volátil: el médico opera un jueves, se
   va a un congreso, mueve su tarde. Por eso son dos cosas separadas y la
   interfaz lo dice con esas palabras:

     · la semana habitual — se cambia poco
     · los próximos cambios — se cambian todo el tiempo

   Script clásico, como el resto de los módulos del panel: habla con la
   capa de datos por `window.API`, que publica js/puente-api.js.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const DIAS = [
    { n: 1, nombre: "Lunes" },
    { n: 2, nombre: "Martes" },
    { n: 3, nombre: "Miércoles" },
    { n: 4, nombre: "Jueves" },
    { n: 5, nombre: "Viernes" },
    { n: 6, nombre: "Sábado" },
    { n: 0, nombre: "Domingo" },
  ];

  /* Fuente de verdad de la rejilla mientras se edita. Se vuelca a la base
     solo al Guardar: así "quitar bloque" se puede deshacer recargando. */
  let semana = [];
  let excepciones = [];

  const $ = (id) => document.getElementById(id);

  /* ─── Utilidades ────────────────────────────────────────────────────── */

  function hhmm(v) {
    const m = String(v || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  }

  function bloquesDe(dia) {
    return semana
      .filter((b) => Number(b.diaSemana) === dia)
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  }

  /** "2026-08-04" → "martes 4 de agosto". Sin `new Date(fecha)` a secas:
      eso lo interpreta como UTC y en México puede caer un día antes. */
  function fechaLarga(iso) {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  }

  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function avisar(mensaje, tipo) {
    if (typeof mostrarToast === "function") mostrarToast(mensaje, tipo || "ok");
  }

  /* ─── Estado de arriba ──────────────────────────────────────────────── */

  async function renderEstado() {
    const punto = $("hor-estado-punto");
    const texto = $("hor-estado-texto");
    if (!punto || !texto) return;

    const abierto = await window.API.horarios.abiertoAhora();
    punto.className = `hor-estado-punto ${abierto ? "abierto" : "cerrado"}`;

    if (abierto) {
      texto.textContent = "Abierto ahora";
      return;
    }

    const proxima = await window.API.horarios.proximaApertura();
    if (!proxima) {
      /* Sin horario cargado no se inventa una fecha: es exactamente lo
         que el agente le diría a un paciente, y sería mentira. */
      texto.textContent = "Cerrado — todavía no hay horario cargado";
      return;
    }

    const d = new Date(proxima);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    const hora = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

    texto.textContent = mismoDia
      ? `Cerrado — abre hoy a las ${hora}`
      : `Cerrado — abre ${fechaLarga(proxima)} a las ${hora}`;
  }

  /* ─── La semana ─────────────────────────────────────────────────────── */

  function renderSemana() {
    const cont = $("hor-semana");
    if (!cont) return;

    cont.innerHTML = DIAS.map((dia) => {
      const bloques = bloquesDe(dia.n);
      const filas = bloques.length
        ? bloques
            .map(
              (b, i) => `
          <div class="hor-bloque">
            <input type="time" class="hor-input" value="${b.horaInicio}"
                   data-dia="${dia.n}" data-i="${i}" data-campo="horaInicio"
                   aria-label="Hora de inicio, ${dia.nombre}" />
            <span class="hor-guion">a</span>
            <input type="time" class="hor-input" value="${b.horaFin}"
                   data-dia="${dia.n}" data-i="${i}" data-campo="horaFin"
                   aria-label="Hora de fin, ${dia.nombre}" />
            <button type="button" class="hor-quitar" data-dia="${dia.n}" data-i="${i}"
                    aria-label="Quitar este bloque de ${dia.nombre}">✕</button>
          </div>`
            )
            .join("")
        : `<p class="hor-cerrado-txt">Cerrado</p>`;

      return `
        <div class="hor-dia ${bloques.length ? "" : "hor-dia--cerrado"}">
          <div class="hor-dia-nombre">${dia.nombre}</div>
          <div class="hor-dia-bloques">${filas}</div>
          <button type="button" class="hor-agregar" data-dia="${dia.n}">+ Agregar bloque</button>
        </div>`;
    }).join("");
  }

  function conectarSemana() {
    const cont = $("hor-semana");
    if (!cont) return;

    cont.addEventListener("click", (e) => {
      const agregar = e.target.closest(".hor-agregar");
      if (agregar) {
        const dia = Number(agregar.dataset.dia);
        const ultimo = bloquesDe(dia).slice(-1)[0];
        semana.push({
          diaSemana: dia,
          horaInicio: ultimo ? ultimo.horaFin : "09:00",
          horaFin: ultimo ? "19:00" : "14:00",
        });
        renderSemana();
        return;
      }

      const quitar = e.target.closest(".hor-quitar");
      if (quitar) {
        const dia = Number(quitar.dataset.dia);
        const bloque = bloquesDe(dia)[Number(quitar.dataset.i)];
        semana = semana.filter((b) => b !== bloque);
        renderSemana();
      }
    });

    cont.addEventListener("change", (e) => {
      const input = e.target.closest(".hor-input");
      if (!input) return;
      const bloque = bloquesDe(Number(input.dataset.dia))[Number(input.dataset.i)];
      if (bloque) bloque[input.dataset.campo] = hhmm(input.value);
      renderSemana();
    });
  }

  /* ─── Excepciones ───────────────────────────────────────────────────── */

  function renderExcepciones() {
    const cont = $("hor-exc-lista");
    if (!cont) return;

    if (!excepciones.length) {
      cont.innerHTML = `<p class="hor-vacio">Sin cambios programados. La semana habitual aplica tal cual.</p>`;
      return;
    }

    cont.innerHTML = excepciones
      .map(
        (e) => `
      <div class="hor-exc-item ${e.cerrado ? "hor-exc-item--cerrado" : ""}">
        <div class="hor-exc-fecha">${fechaLarga(e.fecha)}</div>
        <div class="hor-exc-que">
          ${e.cerrado
            ? `<span class="hor-chip hor-chip--cerrado">Cerrado</span>`
            : `<span class="hor-chip hor-chip--horario">${e.horaInicio} a ${e.horaFin}</span>`}
          ${e.motivo ? `<span class="hor-exc-motivo">${escapar(e.motivo)}</span>` : ""}
        </div>
        <button type="button" class="hor-quitar" data-exc="${e.id}"
                aria-label="Quitar el cambio del ${fechaLarga(e.fecha)}">✕</button>
      </div>`
      )
      .join("");
  }

  function escapar(s) {
    const d = document.createElement("div");
    d.textContent = String(s || "");
    return d.innerHTML;
  }

  /* La Agenda dibuja su rejilla desde el horario y lo cachea por fecha, así
     que tiene que enterarse cuando cambia. El evento `storage` no sirve: no
     se dispara en el documento que escribió, y con backend no existe. */
  const avisarCambioDeHorario = () =>
    document.dispatchEvent(new CustomEvent("medicita:horario-cambio"));

  async function recargarExcepciones() {
    /* Solo de hoy en adelante: el historial de cierres pasados no ayuda a
       nadie a decidir nada, y la lista se volvería ilegible en un mes. */
    excepciones = await window.API.horarios.excepciones(hoyISO(), null);
    renderExcepciones();
    avisarCambioDeHorario();
  }

  /**
   * Lo que se le dice a quien acaba de cerrar el día.
   *
   * Lo importante es la segunda mitad: quien no tiene correo NO se avisa
   * solo, y si el sistema se queda callado, esa persona se presenta a un
   * consultorio cerrado y nadie sabe que faltó avisarle.
   */
  function avisarResultado(r) {
    if (!r) return avisar("Cambio programado");

    const sin = r.sinCorreo || [];
    let texto = `Cambio programado · ${r.canceladas} cita${r.canceladas === 1 ? "" : "s"} cancelada${r.canceladas === 1 ? "" : "s"}`;
    if (r.avisados) texto += ` · ${r.avisados} avisado${r.avisados === 1 ? "" : "s"} por correo`;
    if (r.soloDemo && r.avisados) texto += " (en la demo no sale ningún correo)";

    avisar(texto);

    if (sin.length) {
      /* Un `alert` y no un toast: esto hay que hacerlo a mano y ahora, y un
         toast se desvanece en cuatro segundos. */
      const lineas = sin.map(
        (c) => `  • ${c.nombre}${c.hora ? ` (${c.hora})` : ""} — ${c.telefono || "sin teléfono"}`
      );
      alert(
        `Hay ${sin.length} paciente${sin.length === 1 ? "" : "s"} SIN CORREO.\n` +
        "Nadie les avisó. Hay que llamarles:\n\n" +
        lineas.join("\n")
      );
    }
  }

  /* ─── Citas que quedan fuera ────────────────────────────────────────── */

  /**
   * Muestra a quién deja plantado un cierre y espera la decisión.
   * Devuelve true si hay que seguir adelante.
   *
   * Si no hay citas afectadas no interrumpe: preguntar por nada entrena a
   * la gente a decir que sí sin leer.
   */
  /**
   * Resuelve a `false` si se cancela el diálogo, o a `{ avisar }` con lo que
   * la persona decidió hacer con las citas afectadas.
   *
   * Antes solo advertía y devolvía true/false, que dejaba el problema entero
   * en manos de quien tuviera tiempo de llamar uno por uno — y una urgencia
   * del médico es justo cuando nadie tiene ese tiempo.
   */
  function confirmarAfectadas(citas, descripcion) {
    return new Promise((resolver) => {
      if (!citas.length) return resolver({ avisar: false });

      $("hor-afectadas-desc").textContent =
        `${citas.length === 1 ? "Hay 1 cita agendada" : `Hay ${citas.length} citas agendadas`} ` +
        `que quedan fuera de horario ${descripcion}.`;

      $("hor-afectadas-lista").innerHTML = citas
        .map(
          (c) => `
        <div class="hor-afectada">
          <span class="hor-afectada-hora">${c.hora || "sin hora"}</span>
          <span class="hor-afectada-nombre">${escapar(`${c.nombre} ${c.apellidos || ""}`.trim())}</span>
          <span class="hor-afectada-contacto">${escapar(c.telefono || c.email || "")}</span>
        </div>`
        )
        .join("");

      const modal = $("modal-hor-afectadas");
      modal.classList.remove("oculto");

      const cerrar = (resultado) => {
        modal.classList.add("oculto");
        $("btn-hor-afectadas-confirmar").onclick = null;
        $("btn-hor-afectadas-cancelar").onclick = null;
        $("btn-hor-afectadas-x").onclick = null;
        resolver(resultado);
      };

      $("btn-hor-afectadas-confirmar").onclick = () =>
        cerrar({ avisar: $("hor-cancelar-avisar")?.checked !== false });
      $("btn-hor-afectadas-cancelar").onclick = () => cerrar(false);
      $("btn-hor-afectadas-x").onclick = () => cerrar(false);
    });
  }

  /* ─── Guardar ───────────────────────────────────────────────────────── */

  async function guardarSemana() {
    const btn = $("btn-hor-guardar");
    btn.disabled = true;
    try {
      const texto = await window.API.horarios.guardarBase(semana);
      $("hor-membrete-texto").textContent = texto || "—";
      await renderEstado();
      avisarCambioDeHorario();
      avisar("Horario semanal guardado");
    } catch (e) {
      avisar(e.message || "No se pudo guardar el horario", "error");
    } finally {
      /* En una variable y no `e.currentTarget`: después de un await ya es
         null, y el botón se quedaría deshabilitado para siempre. */
      btn.disabled = false;
    }
  }

  async function agregarExcepcion(e) {
    e.preventDefault();

    const fecha = $("hor-exc-fecha").value;
    if (!fecha) return avisar("Falta la fecha", "error");

    const cerrado = $("hor-exc-tipo").value === "cerrado";
    const horaInicio = hhmm($("hor-exc-inicio").value);
    const horaFin = hhmm($("hor-exc-fin").value);

    if (!cerrado && (!horaInicio || !horaFin || horaFin <= horaInicio)) {
      return avisar("El horario alternativo no es válido", "error");
    }

    const btn = $("btn-hor-exc-agregar");
    btn.disabled = true;
    try {
      const afectadas = await window.API.horarios.citasAfectadas(
        fecha,
        cerrado ? null : horaInicio,
        cerrado ? null : horaFin
      );
      const decision = await confirmarAfectadas(
        afectadas,
        cerrado ? "ese día" : "con el nuevo horario"
      );
      if (!decision) return;

      const motivo = $("hor-exc-motivo").value.trim();

      await window.API.horarios.agregarExcepcion({
        fecha, cerrado, horaInicio, horaFin, motivo,
      });

      /* Se cancela DESPUÉS de guardar el cierre, no antes: si el cierre
         fallara, habríamos cancelado las citas de un día que sigue abierto. */
      let resultado = null;
      if (decision.avisar && afectadas.length) {
        resultado = await window.API.horarios.cancelarBloque({
          fecha,
          horaInicio: cerrado ? null : horaInicio,
          horaFin: cerrado ? null : horaFin,
          motivo,
        });
      }

      $("hor-exc-motivo").value = "";
      await recargarExcepciones();
      await renderEstado();
      avisarResultado(resultado);
    } catch (err) {
      avisar(err.message || "No se pudo guardar el cambio", "error");
    } finally {
      btn.disabled = false;
    }
  }

  /* ─── Arranque ──────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", async () => {
    /* Saber si hay una clínica real detrás exige preguntarle a Supabase, y
       de eso depende contra qué se escribe. */
    await window.APIListo;
    if (!$("hor-semana")) return;   // otra página cargó este script

    conectarSemana();

    $("btn-hor-guardar").addEventListener("click", guardarSemana);
    $("hor-exc-form").addEventListener("submit", agregarExcepcion);

    $("hor-exc-tipo").addEventListener("change", (e) => {
      $("hor-exc-horas").classList.toggle("oculto", e.target.value === "cerrado");
    });

    $("btn-hor-copiar").addEventListener("click", () => {
      const lunes = bloquesDe(1);
      if (!lunes.length) return avisar("Primero carga el horario del lunes", "error");
      semana = semana.filter((b) => Number(b.diaSemana) === 1 || Number(b.diaSemana) === 0 || Number(b.diaSemana) === 6);
      for (const dia of [2, 3, 4, 5]) {
        for (const b of lunes) {
          semana.push({ diaSemana: dia, horaInicio: b.horaInicio, horaFin: b.horaFin });
        }
      }
      renderSemana();
      avisar("Copiado a martes–viernes. Falta guardar.");
    });

    $("hor-exc-lista").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-exc]");
      if (!btn) return;
      btn.disabled = true;
      try {
        await window.API.horarios.quitarExcepcion(btn.dataset.exc);
        await recargarExcepciones();
        await renderEstado();
        avisar("Cambio eliminado");
      } catch (err) {
        btn.disabled = false;
        avisar(err.message || "No se pudo eliminar", "error");
      }
    });

    $("hor-exc-fecha").min = hoyISO();

    try {
      semana = (await window.API.horarios.base()).map((b) => ({
        diaSemana: Number(b.diaSemana),
        horaInicio: hhmm(b.horaInicio),
        horaFin: hhmm(b.horaFin),
      }));
      renderSemana();

      const cfg = await window.API.clinica.obtener();
      $("hor-membrete-texto").textContent = cfg.horarioAtencion || "—";

      await recargarExcepciones();
      await renderEstado();
    } catch (e) {
      console.error("[horarios] No se pudo cargar el horario:", e);
      avisar("No se pudo cargar el horario", "error");
    }
  });
})();
