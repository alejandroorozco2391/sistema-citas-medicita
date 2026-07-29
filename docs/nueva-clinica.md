# Dar de alta una clínica nueva

Procedimiento completo para poner en marcha un cliente. Toma unos 20 minutos.

El modelo es **un proyecto de Supabase por clínica**: cada cliente tiene su propia base de datos, nadie comparte tabla con nadie. Cuesta $25 USD el primer proyecto y $10 por cada adicional.

---

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Nombre: algo identificable, por ejemplo `medicita-consultorio-lopez`
3. Región: **la más cercana a México** (`us-east-1`), por latencia
4. Guarda la contraseña de la base de datos que te genera — no se vuelve a mostrar

Del proyecto vas a necesitar tres datos (Project Settings → API):

| Dato | A dónde va | ¿Es secreto? |
|---|---|---|
| **Project URL** | Etiquetas `<meta>` del HTML | No |
| **Publishable key** (`sb_publishable_…`) | Etiquetas `<meta>` del HTML | **No.** Es pública por diseño; va escrita en el HTML y cualquiera puede leerla. Lo que protege los datos son las políticas de RLS. |
| **Secret key** (`sb_secret_…`) | Variables de entorno de Vercel, nada más | **Sí, y mucho.** Se salta RLS por completo. Nunca en el HTML, nunca en el repositorio, nunca en un mensaje. |

> **Sobre los nombres de las llaves.** Supabase renombró su esquema de llaves: la **publishable** sustituye a la vieja *anon key*, y la **secret** a la vieja *service_role*. Son dos llaves distintas — una no hace el trabajo de la otra. Si un proyecto todavía muestra `anon` / `service_role`, la equivalencia es esa.
>
> La URL que va en el `<meta>` es la **base** del proyecto (`https://xxxx.supabase.co`), sin `/rest/v1/`. Ese sufijo es el endpoint REST y el cliente lo agrega solo.

---

## 2. Aplicar el esquema

Dos caminos. El segundo no requiere instalar nada.

### Opción A — con la CLI (recomendada si vas a administrar varias clínicas)

```bash
npm install                      # una sola vez en el repo
npx supabase login               # pide un access token del panel
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push
```

El `project-ref` es la parte central de la URL: en `https://abcdefgh.supabase.co`, es `abcdefgh`.

Si es la primera vez en este repo y la CLI se queja de que falta `supabase/config.toml`, corre `npx supabase init` — genera el archivo de configuración sin tocar las migraciones que ya existen.

`db push` lleva registro de qué migraciones ya aplicó, así que **correrlo dos veces es inocuo**: solo aplica lo que falte.

### Opción B — pegando el SQL en el panel (sin instalar nada)

Abre **SQL Editor** en el panel y pega el contenido de:

```
supabase/migraciones-completas.sql
```

Son las migraciones concatenadas en orden, en un solo archivo, para no tener que pegar seis veces. Es un artefacto **generado**: si cambias el esquema, edita los archivos numerados de `supabase/migrations/` y regenéralo con `npm run db:bundle`.

Si prefieres ir de una en una, el orden es obligatorio — cada archivo da por hecho lo del anterior:

```
0001_utilidades.sql · 0002_clinicas_y_staff.sql · 0003_pacientes.sql
0004_citas.sql · 0005_conversaciones_y_modulos.sql · 0006_rpc_publicas.sql
0007_testimonios_publicos.sql · 0008_posts_campos_faltantes.sql
0009_horarios.sql · 0010_escalaciones.sql
```

`supabase/cron.sql` **no** va aquí: necesita extensiones que se habilitan a mano y la URL del despliegue, así que es el paso 6.

---

## 3. Crear las cuentas del personal

En el panel: **Authentication → Users → Add user**.

Crea una cuenta por persona, no una compartida para toda la clínica. No es purismo:

- La escalación a un humano necesita saber **a quién** avisar.
- La NOM-004-SSA3 pide poder rastrear quién tocó cada expediente.
- Cuando alguien renuncia, se desactiva su cuenta sin cambiarle la contraseña a todo el mundo.

Marca **Auto Confirm User** para que no tengan que verificar el correo.

---

## 4. Vincular la clínica y su personal

Abre `supabase/seed-clinica.sql` y cambia **solo el bloque `DATOS A LLENAR`** del inicio — el resto del archivo usa esas variables, así que no hay forma de cambiar un nombre en un lugar y olvidarlo en otro. Pégalo completo en el **SQL Editor**.

Si por ahora solo hay una persona, deja `v2_email` en `''` y esa segunda alta se omite.

Correrlo dos veces es inocuo: no duplica la clínica ni el personal. Si un correo no existe todavía en Authentication, avisa con un `WARNING` en vez de fallar en silencio — un perfil que no se creó es un usuario que no va a poder entrar.

Ese archivo hace tres cosas: crea la fila de la clínica, vincula cada cuenta con su rol, y al final corre **dos comprobaciones**. Léelas:

- La primera debe listar a cada persona con su rol y su clínica. Si sale vacía, el correo no coincide con el de Authentication.
- La segunda debe salir **vacía**. Lista tablas sin RLS, y una tabla sin RLS es una tabla que cualquiera puede leer con la anon key. **Si sale algo, no pongas la clínica en producción.**

---

## 5. Configurar el frontend

En cada HTML que necesite backend, rellena las dos etiquetas:

```html
<meta name="supabase-url"      content="https://abcdefgh.supabase.co">
<meta name="supabase-anon-key" content="sb_publishable_...">
```

Con los valores de marcador (`TU_…`) el sistema corre en **modo local** (localStorage) — que es exactamente como debe seguir funcionando la demo pública de ventas. No es un error, es el diseño.

> **Por qué en el repositorio quedan en marcador.** No es por ocultar la publishable key: es pública, va escrita en el HTML de cualquier despliegue y cualquiera puede leerla. Es porque **este repositorio es la plantilla de la siguiente clínica**. Si viniera con las credenciales de un cliente anterior, un despliegue nuevo arrancaría escribiendo en la base de datos de otra clínica hasta que alguien se acordara de cambiarlas. Eso no sería una fuga, sería un cruce de expedientes — que es peor, y silencioso.

### Para desarrollar en tu máquina

No edites los HTML. Copia la plantilla:

```bash
cp js/config-local.ejemplo.mjs js/config-local.mjs
```

y pon ahí la URL y la publishable key. Ese archivo está en `.gitignore`, aplica a todas las páginas de una vez, y **solo se carga en localhost** — así ningún despliegue real pide un archivo que nunca va a existir.

Es también de donde `npm run db:verificar` toma las credenciales.

Para levantar el sitio:

```bash
npm run dev      # http://localhost:5173
```

Hace falta un servidor de verdad: los archivos `.mjs` son módulos ES y el navegador los rechaza bajo `file://`. Abrir `login.html` con doble clic hace que el script nunca corra, el formulario se envíe de forma nativa y la página se recargue — se ve como si el botón "no hiciera nada".

### Autenticación: URLs permitidas

En **Authentication → URL Configuration**:

- **Site URL:** el dominio del despliegue (`https://clinica.vercel.app`), o `http://localhost:5173` para desarrollar
- **Redirect URLs:** agrega ese mismo origen con `/**`

Sin esto, el enlace de recuperación de contraseña **no lleva a ningún lado**: Supabase solo redirige a orígenes de su lista blanca, y si el tuyo no está, usa el Site URL — que por omisión es `http://localhost:3000`, donde no hay nada corriendo.

En Vercel, agrega las variables de entorno del proyecto:

```
ANTHROPIC_API_KEY=...           # proxy de Claude (MediPost, MediDocs, insights)
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   # solo aquí, jamás en el frontend

# Avisos de escalación (ver el paso 6)
ESCALACIONES_TOKEN=...          # invéntala larga y al azar
EMAILJS_SERVICE_ID=...
EMAILJS_TEMPLATE_ID_ESCALACION=...
EMAILJS_PUBLIC_KEY=...
EMAILJS_PRIVATE_KEY=...         # la privada, no la publishable del navegador
```

---

## 6. El reloj de las escalaciones

Sin esto, la escalación a humano funciona a medias: se crea, se ve en el panel y se puede tomar — pero **la re-alerta no ocurre si nadie tiene el panel abierto**, que es justo el caso que importa. Un paciente que pidió un humano a las 11 de la noche no puede depender de que alguien tenga una pestaña abierta.

1. **Panel de Supabase → Database → Extensions**: habilita `pg_cron` y `pg_net`.
2. Abre `supabase/cron.sql`, cambia **solo sus dos primeras líneas** (la URL de `/api/avisar` de este despliegue y el mismo `ESCALACIONES_TOKEN` que pusiste en Vercel) y pégalo en el **SQL Editor**.
3. Al final trae dos consultas de comprobación: la primera debe listar los dos trabajos con `active = true`, y la segunda —tras un minuto— que hayan corrido sin error.

Son dos trabajos, y están separados a propósito:

- **`medicita-promover-escalaciones`** sube de nivel las escalaciones sin acuse y, al final de la escalera, las marca como *vencidas*. Corre entero dentro de Postgres.
- **`medicita-vaciar-avisos`** solo toca el timbre: `pg_net` hace un POST a `/api/avisar` con el token, y toda la lógica de armar y mandar el correo vive en `api/avisar.js`, donde se puede leer y arreglar sin migrar la base.

**Sobre EmailJS**: la función usa la API REST con la **llave privada**, no la publishable del navegador. En el panel de EmailJS hay que permitir el envío desde fuera del navegador (*Account → Security → API requests*); si esa cuenta no lo permite, se cambia el remitente dentro de `mandarCorreo()` en `api/avisar.js` y nada más — por eso hay una bandeja de salida en medio.

Si decides no poner el reloj, dilo en la entrega: el sistema sigue siendo útil, pero la promesa de "si nadie la toma, vuelve a avisar" no se cumple con el panel cerrado.

---

## 7. Migrar datos existentes (si los hay)

Si la clínica venía usando el sistema en modo local y quiere conservar lo capturado:

1. Que abra `migrar.html` **en el mismo navegador** donde tiene los datos (viven en ese navegador, no en la nube)
2. Que inicie sesión
3. La página muestra el inventario de lo que encontró antes de tocar nada
4. Al confirmar, sube todo respetando los vínculos entre expedientes, citas, conversaciones y documentos

La migración es **idempotente**: si se corta a la mitad, se vuelve a correr y continúa donde iba, sin duplicar.

Los datos locales **no se borran automáticamente**. La opción de limpiarlos aparece solo después de una migración exitosa, y es decisión de quien la corre.

---

## 8. Verificación antes de entregar

```bash
npm run db:verificar    # contra el proyecto real, ya desplegado
npm run test:all        # 206 pruebas contra un Postgres simulado
```

Las dos comprueban cosas distintas y hacen falta las dos:

- **`test:all`** verifica que el esquema **está bien diseñado**. Levanta un Postgres real en WebAssembly (sin Docker), crea dos clínicas y comprueba tabla por tabla que ninguna alcanza los datos de la otra.
- **`db:verificar`** verifica que el proyecto **está bien aplicado**. Se conecta al proyecto de verdad con la llave pública e intenta leer las tablas protegidas. Si alguna devuelve renglones, RLS no está haciendo su trabajo y esa clínica **no sale a producción**.

Y a mano, en el navegador:

- [ ] `login.html` deja entrar con la cuenta creada
- [ ] Una cuenta sin perfil **no** entra y ve un mensaje claro
- [ ] `index.html` muestra los datos de la clínica sin iniciar sesión
- [ ] Se puede pedir una cita desde la landing sin sesión
- [ ] Esa cita aparece en el panel al iniciar sesión
- [ ] `encuesta.html?folio=XXXX` acepta una respuesta y rechaza la segunda
- [ ] La pestaña Horarios guarda la semana y el membrete se actualiza solo
- [ ] Cerrar un día quita ese día del formulario de la landing
- [ ] Pedirle un humano a MediBot crea la escalación y el panel la muestra
- [ ] Dejarla sin tomar sube su nivel al minuto (`select * from cron.job_run_details`)

---

## Vaciar un proyecto que se usó para pruebas

Lo normal al montar la primera clínica es haber capturado citas y pacientes de mentira mientras se probaba. Entregar el sistema con esos datos adentro se ve mal y, peor, se confunden con los reales en cuanto empiecen a llegar.

Para eso está `supabase/reset-datos.sql`. Se edita **solo su bloque `QUÉ BORRAR`** y se pega en el **SQL Editor**:

- `v_nombre_clinica` — el nombre exacto, tal como está en la tabla `clinicas`. Hay que escribirlo a mano a propósito: obliga a mirar qué se está borrando. Un nombre que no exista **aborta con error** en vez de borrar cero renglones y reportar éxito.
- `v_borrar_clinica` — en `false` (lo normal) borra los datos y deja viva la clínica y su personal, así que el sistema arranca vacío pero funcional. En `true` borra también la clínica y los perfiles, y el proyecto queda como recién migrado.

Borra las nueve tablas de datos por `clinica_id`, así que en un proyecto con varias clínicas **no toca a las demás** — hay pruebas que lo verifican renglón por renglón (`tests/db-reset.test.mjs`).

> **No se puede deshacer.** En Supabase no hay papelera. Si el proyecto ya tiene expedientes reales, haz respaldo antes (Database → Backups) o no lo corras.

Dos cosas que **no** borra, a propósito:

- **Las cuentas de Authentication → Users.** Se quitan desde el panel. Y conviene hacerlo en ese orden: si borras el perfil pero dejas la cuenta, esa persona puede entrar a un sistema sin clínica.
- **El `localStorage` del navegador con el que probaste.** Vive en tu máquina, no en la base. Se limpia desde las herramientas de desarrollo (Application → Local Storage) o con el botón de la demo.

---

## Solución de problemas

**"Tu usuario no tiene una clínica asignada"**
La cuenta existe en Authentication pero le falta su fila en `perfiles_staff`, o la tiene con `activo = false`. Revisa el paso 4.

**La landing sale vacía de datos de la clínica**
La fila de `clinicas` tiene `activa = false`, o las etiquetas `<meta>` traen los valores de marcador. La vista `clinica_publica` solo muestra clínicas activas.

**"Demasiadas solicitudes desde este teléfono"**
Es el freno de abuso de `solicitar_cita`: máximo 5 por teléfono cada 24 horas. Existe porque la anon key es pública y sin él un script podría llenar la agenda. Si estorba durante una demostración, usa otro número.

**Una migración reporta muchos "omitidos"**
Normal si los datos locales traen registros huérfanos: mensajes cuya conversación ya no existe, o encuestas de folios borrados. El reporte detalla el motivo de cada uno.
