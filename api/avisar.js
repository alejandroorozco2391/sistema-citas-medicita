/* ═══════════════════════════════════════════════════════════════════════
   Vacía la bandeja de avisos de escalaciones.

   La escalera de escalaciones vive en Postgres (promover_escalaciones, en
   0010) y encola avisos en `avisos_pendientes`. Esta función los entrega.

   Están separados a propósito: un correo que falla se reintenta sin
   volver a mover la escalación, y el día que haya WhatsApp será otro
   remitente aquí adentro, no otra escalera.

   Quién la llama: pg_cron, cada minuto, vía pg_net (ver supabase/cron.sql).
   Lo único que manda es el token; toda la lógica está de este lado, donde
   se puede leer y probar.
   ═══════════════════════════════════════════════════════════════════════ */

/* Después de esto se deja de intentar. Un correo que falló cinco veces
   tiene un problema que no se arregla insistiendo, y la escalación sigue
   viéndose en rojo en el panel de todos modos. */
const MAX_INTENTOS = 5;

/* Por corrida. La cola normal trae dos o tres; el tope es para que un
   atasco no agote el tiempo de la función. */
const LOTE = 20;

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.ESCALACIONES_TOKEN;
  const url = process.env.SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!token || !url || !llave) {
    return res.status(500).json({
      error: 'Faltan ESCALACIONES_TOKEN, SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
    });
  }

  /* Este endpoint manda correo con la cuenta de la clínica. Sin token
     sería un formulario de spam abierto en su dominio. */
  const enviado = req.headers['x-medicita-token'] ||
    (req.query && req.query.token) || '';
  if (enviado !== token) return res.status(401).json({ error: 'No autorizado' });

  const cabeceras = {
    apikey: llave,
    Authorization: `Bearer ${llave}`,
    'Content-Type': 'application/json',
  };

  try {
    const cola = await fetch(
      `${url}/rest/v1/avisos_pendientes` +
      `?estado=eq.pendiente&intentos=lt.${MAX_INTENTOS}` +
      `&order=creado_en.asc&limit=${LOTE}`,
      { headers: cabeceras }
    ).then(r => r.json());

    if (!Array.isArray(cola)) {
      return res.status(502).json({ error: 'Respuesta inesperada de Supabase', detalle: cola });
    }
    if (cola.length === 0) return res.status(200).json({ enviados: 0, fallidos: 0 });

    let enviados = 0;
    let fallidos = 0;

    for (const aviso of cola) {
      let error = null;
      try {
        await mandarCorreo(aviso);
      } catch (e) {
        error = e.message || String(e);
      }

      const intentos = (aviso.intentos || 0) + 1;
      const parche = error
        ? {
            intentos,
            ultimo_error: error.slice(0, 500),
            /* Se agota el crédito: se marca fallido y deja de reintentarse.
               Queda el último error escrito para poder diagnosticarlo. */
            estado: intentos >= MAX_INTENTOS ? 'fallido' : 'pendiente',
          }
        : { intentos, estado: 'enviado', enviado_en: new Date().toISOString(), ultimo_error: '' };

      await fetch(`${url}/rest/v1/avisos_pendientes?id=eq.${aviso.id}`, {
        method: 'PATCH',
        headers: cabeceras,
        body: JSON.stringify(parche),
      });

      if (error) { fallidos++; console.error('[avisar]', aviso.id, error); }
      else enviados++;
    }

    return res.status(200).json({ enviados, fallidos });
  } catch (e) {
    console.error('[avisar] error general:', e.message);
    return res.status(502).json({ error: e.message });
  }
}

/**
 * Envía por la API REST de EmailJS, con la misma cuenta y plantilla que
 * ya usa MediFollow para los correos de seguimiento. Cero proveedores
 * nuevos que dar de alta por clínica.
 *
 * La private key solo existe aquí: en el navegador EmailJS usa la
 * publishable, y esta se salta el límite de origen.
 */
async function mandarCorreo(aviso) {
  const servicio = process.env.EMAILJS_SERVICE_ID;
  const plantilla = process.env.EMAILJS_TEMPLATE_ID_ESCALACION || process.env.EMAILJS_TEMPLATE_ID;
  const publica = process.env.EMAILJS_PUBLIC_KEY;
  const privada = process.env.EMAILJS_PRIVATE_KEY;

  if (!servicio || !plantilla || !publica || !privada) {
    throw new Error('Faltan las credenciales de EmailJS en el entorno');
  }

  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: servicio,
      template_id: plantilla,
      user_id: publica,
      accessToken: privada,
      template_params: {
        to_email: aviso.destinatario,
        subject: aviso.asunto,
        message: aviso.cuerpo,
      },
    }),
  });

  if (!r.ok) {
    const detalle = await r.text();
    throw new Error(`EmailJS ${r.status}: ${detalle.slice(0, 200)}`);
  }
}
