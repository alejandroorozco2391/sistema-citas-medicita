/* ═══════════════════════════════════════════════════════════════════════
   ¿A dónde lleva de verdad `sitio_url`?

   Vive aparte de verificar-supabase.mjs por dos razones. Una: ese script
   corre todo al importarse, así que una prueba que lo importara saldría a
   la red. Dos, y la de fondo: los cinco casos que esta función distingue
   son difíciles de provocar a mano —cambiar las credenciales para simular
   uno cambia también las que el script usa para conectarse— y el que más
   importa, apuntar al proyecto de OTRA clínica, no se puede reproducir sin
   dos proyectos reales.

   Es pura por eso, igual que los adaptadores de canal del inbox.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * ¿A dónde lleva de verdad `sitio_url`?
 *
 * Función pura y exportada para poder probarla: los cinco casos que
 * distingue son difíciles de provocar a mano —cambiar las credenciales para
 * simular uno cambia también las que el script usa para conectarse— y el
 * caso que importa, apuntar al proyecto de otra clínica, no se puede
 * reproducir sin dos proyectos reales.
 *
 * `esLocal` es la sutileza: en localhost las etiquetas <meta> están en
 * marcador A PROPÓSITO, porque las credenciales salen de
 * `js/config-local.mjs`, que `supabase-client.mjs` carga en tiempo de
 * ejecución y solo ahí. Mirar el HTML estático no puede decir nada de ese
 * caso, y la primera versión de esta comprobación daba un ✖ por algo que
 * estaba bien.
 *
 * @returns {{nivel:"ok"|"aviso"|"mal", mensaje:string, detalle?:string[]}[]}
 */
export function evaluarSitio({ sitioUrl, host, html, configServido }) {
  const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(sitioUrl);
  const meta = html.match(/name="supabase-url"\s+content="([^"]*)"/)?.[1] || "";
  const suyo = meta.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const enMarcador = !meta || meta.startsWith("TU_");

  if (esLocal) {
    const cred = configServido && configServido.includes(host)
      ? { nivel: "ok", mensaje: `${sitioUrl} apunta a este proyecto (por js/config-local.mjs)` }
      : configServido
        ? { nivel: "mal", mensaje: `${sitioUrl} sirve un config-local.mjs que NO apunta a ${host}` }
        : { nivel: "mal",
            mensaje: `${sitioUrl} no sirve js/config-local.mjs: ahí el sistema corre en modo local`,
            detalle: ["Copia js/config-local.ejemplo.mjs como js/config-local.mjs."] };

    return [cred, {
      nivel: "aviso",
      mensaje: "`sitio_url` es tu máquina: sirve para probar, no para entregar",
      detalle: [
        "Un paciente no puede abrir tu localhost. Antes de entregar,",
        "ponla en la URL del despliegue de ESTA clínica.",
      ],
    }];
  }

  if (enMarcador) {
    return [{
      nivel: "mal",
      mensaje: `${sitioUrl} corre en MODO LOCAL: sus etiquetas <meta> están en marcador`,
      detalle: [
        "El enlace de baja de cada correo busca al paciente en el",
        'localStorage del visitante y contesta "enlace no válido".',
        "Y lo mismo el enlace a la encuesta.",
        "Cada clínica necesita SU despliegue con sus credenciales;",
        "`js/config-local.mjs` no sirve aquí, solo carga en localhost.",
      ],
    }];
  }

  if (suyo !== host) {
    /* El caso peor, y el que no da error en ninguna parte: los pacientes de
       esta clínica se darían de baja en la base de otra. */
    return [{
      nivel: "mal",
      mensaje: `${sitioUrl} apunta a OTRO proyecto de Supabase (${suyo}), no a ${host}`,
      detalle: [
        "Los enlaces de los correos de esta clínica llevarían a los",
        "expedientes de otra. Es un cruce de clínicas, y silencioso.",
      ],
    }];
  }

  return [{ nivel: "ok", mensaje: `${sitioUrl} apunta a este proyecto` }];
}
