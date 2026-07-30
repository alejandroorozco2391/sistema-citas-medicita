/* ═══════════════════════════════════════════════════════════════════════
   Baja de los correos automáticos.

   Es la pieza que vuelve defendible todo lo demás. Los recordatorios y los
   seguimientos nacen encendidos —cuelgan de una cita que el paciente pidió,
   así que son parte del servicio y no publicidad— y lo que sostiene ese
   argumento en la práctica es que salirse cueste un clic.

   De ahí tres decisiones:

   · **Un clic, sin cuenta.** El token del correo es la credencial. Pedirle
     iniciar sesión a alguien para que deje de escribirle es no dejarlo irse.

   · **Dos opciones, no una.** Casi nadie quiere dejar de saber que tiene
     cita mañana; lo que molesta es el "¿cómo te fue?". Con una sola casilla,
     esa persona apaga las dos cosas y después se pierde su consulta.

   · **Se puede deshacer.** Un clic accidental en un correo no debería
     costarle a nadie sus recordatorios para siempre.
   ═══════════════════════════════════════════════════════════════════════ */

let token = "";

document.addEventListener("DOMContentLoaded", async () => {
  /* Igual que el resto del sistema: sin esperar aquí no se sabe si hay una
     clínica real detrás, y toda la página depende de eso. */
  await window.APIListo;

  token = (new URLSearchParams(location.search).get("t") || "").trim();

  if (!token) return mostrar("baja-invalido");

  let estado;
  try {
    estado = await API.publico.consultarBaja(token);
  } catch (e) {
    console.warn("No se pudo consultar el enlace de baja:", e);
    return mostrar("baja-invalido");
  }

  if (!estado || !estado.valido) return mostrar("baja-invalido");

  if (estado.clinica) {
    document.getElementById("baja-clinica").textContent = estado.clinica;
  }

  pintar(estado);

  document.querySelectorAll(".baja-opcion").forEach((btn) => {
    btn.addEventListener("click", () => aplicar(btn.dataset.alcance, btn));
  });
  document.getElementById("btn-baja-deshacer")
    .addEventListener("click", (e) => aplicar("reactivar", e.currentTarget));
});

function pintar(estado) {
  const nombre = (estado.nombre || "").trim();
  document.getElementById("baja-saludo").textContent = nombre
    ? `${nombre}, elige qué prefieres recibir.`
    : "Elige qué prefieres recibir.";

  /* Si ya está dado de baja, no se le vuelve a ofrecer darse de baja: se le
     enseña cómo estaba y el botón de deshacer. */
  if (estado.dadoDeBaja || (!estado.recordatorios && !estado.seguimientos)) {
    document.getElementById("baja-confirmacion").textContent =
      "Ya no te enviamos correos automáticos.";
    return mostrar("baja-listo");
  }

  mostrar("baja-opciones");
}

async function aplicar(alcance, boton) {
  const error = document.getElementById("baja-error");
  if (error) error.textContent = "";

  /* Se captura el botón antes del await. Después de un await
     `e.currentTarget` ya es null, y ese descuido nos dejó una vez el botón
     de Confirmar de la landing deshabilitado para siempre. */
  const original = boton ? boton.textContent : "";
  if (boton) { boton.disabled = true; boton.textContent = "Guardando…"; }

  let estado;
  try {
    estado = await API.publico.darseDeBaja(token, alcance);
  } catch (e) {
    if (boton) { boton.disabled = false; boton.textContent = original; }
    if (error) error.textContent = e.message || "No se pudo guardar. Inténtalo de nuevo.";
    return;
  }

  if (boton) { boton.disabled = false; boton.textContent = original; }

  if (alcance === "reactivar") {
    return pintar(estado);
  }

  document.getElementById("baja-confirmacion").textContent = alcance === "seguimientos"
    ? "Ya no te enviaremos correos de seguimiento. Seguirás recibiendo el recordatorio de tus citas."
    : "Ya no te enviaremos correos automáticos. Tus citas siguen agendadas igual.";

  mostrar("baja-listo");
}

function mostrar(id) {
  ["baja-validando", "baja-invalido", "baja-opciones", "baja-listo"].forEach((k) => {
    document.getElementById(k).classList.toggle("oculto", k !== id);
  });
}
