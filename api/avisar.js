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

  /* Sin token configurado no se puede autenticar a nadie, así que esto es
     lo único que se responde antes de pedir credencial. */
  if (!token) {
    return res.status(500).json({ error: 'Falta ESCALACIONES_TOKEN en el entorno' });
  }

  /* Este endpoint manda correo con la cuenta de la clínica. Sin token
     sería un formulario de spam abierto en su dominio.
     Va ANTES de revisar el resto de la configuración: a un desconocido no
     se le cuenta qué tiene puesto este despliegue y qué no. */
  const enviado = req.headers['x-medicita-token'] ||
    (req.query && req.query.token) || '';
  if (enviado !== token) return res.status(401).json({ error: 'No autorizado' });

  /* Ya autenticado, se revisa TODO de una vez —incluidas las de EmailJS,
     que si no solo se descubrirían fallando aviso por aviso hasta gastar
     los cinco intentos de cada uno. */
  const faltan = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'EMAILJS_SERVICE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY',
  ].filter(v => !process.env[v]);

  if (!process.env.EMAILJS_TEMPLATE_ID_ESCALACION && !process.env.EMAILJS_TEMPLATE_ID) {
    faltan.push('EMAILJS_TEMPLATE_ID_ESCALACION');
  }

  if (faltan.length) {
    return res.status(500).json({
      error: `Faltan variables de entorno: ${faltan.join(', ')}`,
      pista: 'Se ponen en Vercel → Settings → Environment Variables, y hace falta un redeploy para que apliquen.',
    });
  }

  const url = process.env.SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    let pospuestos = 0;

    for (const aviso of cola) {
      let error = null;
      let esFaltaDeConfiguracion = false;
      try {
        await entregar(aviso);
      } catch (e) {
        error = e.message || String(e);
        esFaltaDeConfiguracion = e instanceof SinConfigurar;
      }

      /* Un canal sin credenciales NO es un envío fallido: es un aviso que
         todavía no se puede mandar. Marcarlo como fallido le gastaría uno
         de sus cinco intentos, y una clínica que encienda SMS antes de
         contratar el proveedor perdería en silencio esas cancelaciones. Se
         deja en la cola y se cuenta aparte. */
      if (error && esFaltaDeConfiguracion) {
        pospuestos++;
        console.warn('[avisar] pospuesto:', aviso.id, error);
        continue;
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

    return res.status(200).json({ enviados, fallidos, pospuestos });
  } catch (e) {
    console.error('[avisar] error general:', e.message);
    return res.status(502).json({ error: e.message });
  }
}

/**
 * Reparte por canal.
 *
 * Esta indirección es la razón de que exista la bandeja de salida: agregar
 * WhatsApp o cambiar de proveedor de SMS es escribir una función aquí
 * abajo, sin tocar quién decide MANDAR el aviso ni cuándo.
 */
async function entregar(aviso) {
  switch (aviso.canal) {
    case "email": return mandarCorreo(aviso);
    case "sms":   return mandarSms(aviso);
    default:
      /* Un canal que la base permite y esta función no conoce. Se falla con
         un mensaje que dice exactamente qué falta, en vez de dejar el aviso
         girando en la cola hasta gastar sus cinco intentos. */
      throw new Error(`Canal sin remitente implementado: ${aviso.canal}`);
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

/**
 * Envía un SMS por Twilio.
 *
 * Está escrito y **apagado**: sin las tres variables de entorno, el aviso
 * NO se marca como fallido — se deja en la cola tal cual. La diferencia
 * importa: un aviso fallido gasta uno de sus cinco intentos y termina
 * descartado, y una clínica que encienda `sms_activo` antes de contratar el
 * proveedor perdería en silencio las cancelaciones de esos días.
 *
 * Cambiar de proveedor es reescribir esta función y nada más. Por eso el
 * cuerpo del SMS se arma en la base y aquí solo se entrega.
 */
async function mandarSms(aviso) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const desde = process.env.TWILIO_FROM;

  if (!sid || !token || !desde) {
    throw new SinConfigurar(
      "SMS encendido en la clínica pero sin credenciales del proveedor " +
      "(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)"
    );
  }

  /* México: el número tiene que ir en E.164. Los 10 dígitos nacionales que
     guarda el expediente no lo son, así que se les antepone la lada. Es la
     misma normalización de clave_telefono(), al revés. */
  const digitos = String(aviso.destinatario || "").replace(/\D/g, "");
  const nacional = digitos.length > 10 ? digitos.slice(-10) : digitos;
  if (nacional.length !== 10) {
    throw new Error(`Teléfono no utilizable para SMS: "${aviso.destinatario}"`);
  }

  const cuerpo = new URLSearchParams({
    To: `+52${nacional}`,
    From: desde,
    Body: aviso.cuerpo.slice(0, 320),
  });

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: cuerpo,
  });

  if (!r.ok) {
    const detalle = await r.text();
    throw new Error(`Twilio ${r.status}: ${detalle.slice(0, 200)}`);
  }
}

/** Falta configuración, no falló el envío. No gasta intentos. */
class SinConfigurar extends Error {}
