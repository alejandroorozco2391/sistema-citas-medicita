/* ═══════════════════════════════════════════════════════════════════════
   La prueba que justifica todo el diseño de RLS.

   Se levantan dos clínicas con expedientes, citas, conversaciones y notas,
   y se verifica que un usuario de la clínica A no puede leer NI ESCRIBIR
   una sola fila de la B — tabla por tabla.

   Si algo de este archivo falla, no se despliega. Son datos médicos.
   ═══════════════════════════════════════════════════════════════════════ */

import test from "node:test";
import assert from "node:assert";
import {
  crearBase, comoUsuario, comoAnonimo, sembrarClinica, TABLAS_CON_CLINICA,
} from "./db-harness.mjs";

/* Una sola base para todo el archivo: levantar Postgres cuesta. */
const db = await crearBase();
const A = await sembrarClinica(db, { nombre: "Clínica Norte", sufijo: "1" });
const B = await sembrarClinica(db, { nombre: "Clínica Sur", sufijo: "2" });

test("las migraciones dejan RLS activo en TODAS las tablas de public", async () => {
  const { rows } = await db.query(`
    select tablename, rowsecurity from pg_tables
    where schemaname = 'public' order by tablename
  `);
  assert.ok(rows.length >= 11, "deben existir al menos 11 tablas");
  const sinRls = rows.filter(r => !r.rowsecurity).map(r => r.tablename);
  assert.deepStrictEqual(
    sinRls, [],
    `sin RLS, la anon key basta para leer estas tablas completas: ${sinRls.join(", ")}`
  );
});

test("toda tabla con datos de clínica tiene al menos una política", async () => {
  const { rows } = await db.query(`
    select tablename, count(*)::int as n from pg_policies
    where schemaname = 'public' group by tablename
  `);
  const conPolitica = new Set(rows.map(r => r.tablename));
  for (const tabla of TABLAS_CON_CLINICA) {
    assert.ok(conPolitica.has(tabla), `${tabla} tiene RLS pero ninguna política: nadie podría leerla`);
  }
});

/* ═══ Lectura entre clínicas ════════════════════════════════════════════ */

for (const tabla of TABLAS_CON_CLINICA) {
  test(`un usuario de la clínica A no ve NADA de la B en ${tabla}`, async () => {
    const filas = await comoUsuario(db, A.usuarios.admin, async () => {
      const { rows } = await db.query(`select clinica_id from ${tabla}`);
      return rows;
    });

    assert.ok(filas.length > 0, `${tabla}: la prueba no sirve si A tampoco ve lo suyo`);
    const ajenas = filas.filter(f => f.clinica_id !== A.clinicaId);
    assert.strictEqual(
      ajenas.length, 0,
      `FUGA DE DATOS en ${tabla}: ${ajenas.length} fila(s) de otra clínica`
    );
  });
}

test("el contenido de los mensajes de otra clínica es inalcanzable", async () => {
  const filas = await comoUsuario(db, A.usuarios.doctor, async () => {
    const { rows } = await db.query("select contenido from mensajes");
    return rows;
  });
  assert.ok(
    !filas.some(f => f.contenido.includes("Clínica Sur")),
    "se filtró el texto de una conversación ajena"
  );
});

test("las notas internas de otra clínica no se filtran", async () => {
  const { rows } = await db.query("select count(*)::int as n from notas_paciente");
  assert.strictEqual(rows[0].n, 2, "hay una nota por clínica en la base");

  const vistas = await comoUsuario(db, A.usuarios.recepcionista, async () => {
    const { rows } = await db.query("select clinica_id from notas_paciente");
    return rows;
  });
  assert.strictEqual(vistas.length, 1, "A solo debe ver la suya");
});

/* ═══ Escritura entre clínicas ══════════════════════════════════════════ */

test("A no puede insertar una fila marcada como de la clínica B", async () => {
  await comoUsuario(db, A.usuarios.admin, async () => {
    await assert.rejects(
      () => db.query(
        `insert into pacientes (clinica_id, nombre, telefono) values ($1, 'Intruso', '5599999999')`,
        [B.clinicaId]
      ),
      /row-level security|violates/i,
      "el WITH CHECK debe rechazar escribir en otra clínica"
    );
  });
});

test("A no puede modificar un expediente de B", async () => {
  const { rows: [antes] } = await db.query(
    "select nombre from pacientes where id = $1", [B.pacienteId]
  );

  await comoUsuario(db, A.usuarios.admin, async () => {
    await db.query("update pacientes set nombre = 'Alterado' where id = $1", [B.pacienteId]);
  });

  const { rows: [despues] } = await db.query(
    "select nombre from pacientes where id = $1", [B.pacienteId]
  );
  assert.strictEqual(despues.nombre, antes.nombre, "el UPDATE no debió alcanzar ninguna fila de B");
});

test("A no puede borrar datos de B", async () => {
  await comoUsuario(db, A.usuarios.admin, async () => {
    await db.query("delete from citas where id = $1", [B.citaId]);
  });
  const { rows } = await db.query("select count(*)::int as n from citas where id = $1", [B.citaId]);
  assert.strictEqual(rows[0].n, 1, "la cita de B sigue viva");
});

/* ═══ El visitante sin cuenta ═══════════════════════════════════════════ */

test("la anon key no lee NINGUNA tabla, aunque tenga permisos de tabla", async () => {
  for (const tabla of TABLAS_CON_CLINICA) {
    const n = await comoAnonimo(db, async () => {
      const { rows } = await db.query(`select count(*)::int as n from ${tabla}`);
      return rows[0].n;
    });
    assert.strictEqual(n, 0, `FUGA: un anónimo lee ${tabla}`);
  }
});

test("la anon key no lee la tabla clinicas ni el personal", async () => {
  const clinicas = await comoAnonimo(db, async () => {
    const { rows } = await db.query("select count(*)::int as n from clinicas");
    return rows[0].n;
  });
  assert.strictEqual(clinicas, 0);

  const staff = await comoAnonimo(db, async () => {
    const { rows } = await db.query("select count(*)::int as n from perfiles_staff");
    return rows[0].n;
  });
  assert.strictEqual(staff, 0, "los correos del personal no son públicos");
});

test("la anon key sí lee la vista pública, que es lo que necesita la landing", async () => {
  const filas = await comoAnonimo(db, async () => {
    const { rows } = await db.query("select nombre_clinica from clinica_publica order by nombre_clinica");
    return rows;
  });
  assert.strictEqual(filas.length, 2);
  assert.strictEqual(filas[0].nombre_clinica, "Clínica Norte");
});

test("la vista pública no expone el plan contratado", async () => {
  await comoAnonimo(db, async () => {
    await assert.rejects(
      () => db.query("select plan from clinica_publica"),
      /column .*plan.* does not exist/i,
      "el plan es de la relación comercial, no del paciente"
    );
  });
});

test("una clínica desactivada desaparece de la vista pública", async () => {
  await db.query("update clinicas set activa = false where id = $1", [B.clinicaId]);
  const n = await comoAnonimo(db, async () => {
    const { rows } = await db.query("select count(*)::int as n from clinica_publica");
    return rows[0].n;
  });
  await db.query("update clinicas set activa = true where id = $1", [B.clinicaId]);
  assert.strictEqual(n, 1);
});

/* ═══ Roles dentro de la misma clínica ══════════════════════════════════ */

test("solo un admin edita la configuración de la clínica", async () => {
  await comoUsuario(db, A.usuarios.recepcionista, async () => {
    await db.query("update clinicas set ciudad = 'Hackeada' where id = $1", [A.clinicaId]);
  });
  const { rows: [c1] } = await db.query("select ciudad from clinicas where id = $1", [A.clinicaId]);
  assert.strictEqual(c1.ciudad, "CDMX", "recepción no debe poder cambiar la config");

  await comoUsuario(db, A.usuarios.admin, async () => {
    await db.query("update clinicas set ciudad = 'Monterrey' where id = $1", [A.clinicaId]);
  });
  const { rows: [c2] } = await db.query("select ciudad from clinicas where id = $1", [A.clinicaId]);
  assert.strictEqual(c2.ciudad, "Monterrey", "el admin sí");
});

test("solo un admin da de alta personal", async () => {
  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'nuevo@ejemplo.mx') returning id"
  );

  await comoUsuario(db, A.usuarios.doctor, async () => {
    await assert.rejects(
      () => db.query(
        `insert into perfiles_staff (usuario_id, clinica_id, nombre, rol)
         values ($1, $2, 'Colado', 'admin')`,
        [u.id, A.clinicaId]
      ),
      /row-level security|violates/i,
      "un doctor no puede crearse compañeros, ni ascenderse a admin"
    );
  });
});

test("el personal sí ve a sus compañeros de clínica, y solo a esos", async () => {
  const filas = await comoUsuario(db, A.usuarios.doctor, async () => {
    const { rows } = await db.query("select clinica_id from perfiles_staff");
    return rows;
  });
  assert.strictEqual(filas.length, 3, "los 3 roles de su clínica");
  assert.ok(filas.every(f => f.clinica_id === A.clinicaId));
});

test("un usuario desactivado deja de ver todo", async () => {
  await db.query("update perfiles_staff set activo = false where usuario_id = $1", [A.usuarios.doctor]);
  const n = await comoUsuario(db, A.usuarios.doctor, async () => {
    const { rows } = await db.query("select count(*)::int as n from pacientes");
    return rows[0].n;
  });
  await db.query("update perfiles_staff set activo = true where usuario_id = $1", [A.usuarios.doctor]);
  assert.strictEqual(n, 0, "dar de baja a alguien debe cortarle el acceso de inmediato");
});

test("un usuario autenticado sin perfil no ve nada", async () => {
  const { rows: [u] } = await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'huerfano@ejemplo.mx') returning id"
  );
  const n = await comoUsuario(db, u.id, async () => {
    const { rows } = await db.query("select count(*)::int as n from pacientes");
    return rows[0].n;
  });
  assert.strictEqual(n, 0, "tener cuenta no es tener acceso");
});
