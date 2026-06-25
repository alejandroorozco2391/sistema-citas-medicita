/* ─── Constantes ──────────────────────────────────────────────────────── */
const API_URL_AN = "/api/chat";
const MODELO_AN = "claude-sonnet-4-6";
const DIAS_SEMANA_AN = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const FRANJAS_AN = ["Mañana (7–12h)", "Tarde (12–17h)", "Noche (17–21h)"];
const COLORES_ESP = [
  "#1a6eb5", "#10b981", "#f59e0b", "#ef4444",
  "#6366f1", "#06b6d4", "#ec4899", "#84cc16",
];

/* ─── Estado ──────────────────────────────────────────────────────────── */
const estadoAN = {
  rango: "mes",
  charts: { dias: null, especialidades: null, sexo: null, ciudades: null, origen: null },
  analizando: false,
};

/* ─── Init ────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  bindRango();
  bindAnalizar();

  // Si analytics es la pestaña activa al cargar (guardada en localStorage)
  const panel = document.getElementById("tab-analytics");
  if (panel && panel.classList.contains("tab-panel--activo")) {
    actualizarAnalytics();
  }

  const btnTab = document.getElementById("tab-btn-analytics");
  if (btnTab) {
    btnTab.addEventListener("click", function () {
      // Pequeño delay para que el panel sea visible antes de renderizar el canvas
      setTimeout(actualizarAnalytics, 60);
    });
  }
});

function bindRango() {
  document.getElementById("an-selector-rango").addEventListener("click", function (e) {
    const btn = e.target.closest(".an-rango-btn");
    if (!btn) return;
    document.querySelectorAll(".an-rango-btn").forEach(function (b) {
      b.classList.remove("activo");
    });
    btn.classList.add("activo");
    estadoAN.rango = btn.dataset.rango;
    actualizarAnalytics();
  });
}

function bindAnalizar() {
  document.getElementById("btn-analizar-ia").addEventListener("click", analizarConIA);
}

function actualizarAnalytics() {
  const todasCitas = leerCitas();
  const citas = filtrarPorRango(todasCitas, estadoAN.rango);
  const metricas = calcularMetricas(citas);

  renderKPIs(metricas);
  renderChartDias(calcularPorDia(citas));
  renderChartEspecialidades(calcularPorEspecialidad(citas));
  renderHeatmap(calcularHeatmap(citas));
  renderMetricasPacientes();
}

/* ─── Lectura y filtrado ──────────────────────────────────────────────── */
function leerCitas() {
  return JSON.parse(localStorage.getItem("medicita_citas") || "[]");
}

function filtrarPorRango(citas, rango) {
  if (rango === "todo") return citas;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diasAtras = rango === "semana" ? 7 : rango === "mes" ? 30 : 90;
  const inicio = new Date(hoy);
  inicio.setDate(inicio.getDate() - diasAtras);
  return citas.filter(function (c) {
    const fecha = new Date(c.fecha + "T00:00:00");
    return fecha >= inicio;
  });
}

/* ─── Cálculo de métricas ─────────────────────────────────────────────── */
function calcularMetricas(citas) {
  const total = citas.length;
  const atendidas = citas.filter(function (c) { return c.estado === "atendida"; }).length;
  const canceladas = citas.filter(function (c) { return c.estado === "cancelada"; }).length;

  const conteos = {};
  citas.forEach(function (c) {
    const key = (c.paciente || "").toLowerCase().trim() + "|" + (c.telefono || "");
    conteos[key] = (conteos[key] || 0) + 1;
  });
  const totalPacientes = Object.keys(conteos).length;
  const recurrentes = Object.values(conteos).filter(function (n) { return n > 1; }).length;

  return {
    total,
    ocupacion: total > 0 ? Math.round((atendidas / total) * 100) : null,
    noShows: total > 0 ? Math.round((canceladas / total) * 100) : null,
    recurrentes: totalPacientes > 0 ? Math.round((recurrentes / totalPacientes) * 100) : null,
  };
}

function calcularPorDia(citas) {
  const conteos = [0, 0, 0, 0, 0, 0, 0]; // Lun=0 … Dom=6
  citas.forEach(function (c) {
    if (!c.fecha) return;
    const d = new Date(c.fecha + "T00:00:00").getDay(); // 0=Dom
    const idx = d === 0 ? 6 : d - 1;
    conteos[idx]++;
  });
  return conteos;
}

function calcularPorEspecialidad(citas) {
  const mapa = {};
  citas.forEach(function (c) {
    const esp = c.especialidad || "Sin especificar";
    mapa[esp] = (mapa[esp] || 0) + 1;
  });
  const entradas = Object.entries(mapa).sort(function (a, b) { return b[1] - a[1]; });
  return {
    labels: entradas.map(function (e) { return e[0]; }),
    datos: entradas.map(function (e) { return e[1]; }),
  };
}

function calcularHeatmap(citas) {
  // matriz[dia][franja]: dia 0=Lun…6=Dom, franja 0=Mañana,1=Tarde,2=Noche
  const matriz = Array.from({ length: 7 }, function () { return [0, 0, 0]; });
  citas.forEach(function (c) {
    if (!c.fecha || !c.hora) return;
    const d = new Date(c.fecha + "T00:00:00").getDay();
    const idxDia = d === 0 ? 6 : d - 1;
    const hora = parseInt(String(c.hora).split(":")[0], 10);
    let franja = -1;
    if (hora >= 7 && hora < 12) franja = 0;
    else if (hora >= 12 && hora < 17) franja = 1;
    else if (hora >= 17 && hora < 21) franja = 2;
    if (franja >= 0) matriz[idxDia][franja]++;
  });
  return matriz;
}

/* ─── Render KPIs ─────────────────────────────────────────────────────── */
function renderKPIs(metricas) {
  setKPI("kpi-ocupacion", metricas.ocupacion, metricas.total);
  setKPI("kpi-noshows", metricas.noShows, metricas.total);
  setKPI("kpi-recurrentes", metricas.recurrentes, metricas.total);
}

function setKPI(id, valor, total) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = (total === 0 || valor === null) ? "—" : valor + "%";
}

/* ─── Render Charts ───────────────────────────────────────────────────── */
function renderChartDias(datos) {
  const canvas = document.getElementById("chart-dias");
  if (!canvas || typeof Chart === "undefined") return;
  if (estadoAN.charts.dias) { estadoAN.charts.dias.destroy(); }
  estadoAN.charts.dias = new Chart(canvas, {
    type: "bar",
    data: {
      labels: DIAS_SEMANA_AN,
      datasets: [{
        data: datos,
        backgroundColor: "rgba(26,110,181,0.75)",
        hoverBackgroundColor: "rgba(26,110,181,1)",
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: "#64748b", font: { size: 11 } },
          grid: { color: "rgba(226,232,240,0.8)" },
          border: { dash: [4, 4] },
        },
        x: {
          ticks: { color: "#64748b", font: { size: 12, weight: "600" } },
          grid: { display: false },
        },
      },
    },
  });
}

function renderChartEspecialidades(datos) {
  const canvas = document.getElementById("chart-especialidades");
  if (!canvas || typeof Chart === "undefined") return;
  if (estadoAN.charts.especialidades) { estadoAN.charts.especialidades.destroy(); }
  if (datos.labels.length === 0) return;

  estadoAN.charts.especialidades = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: datos.labels,
      datasets: [{
        data: datos.datos,
        backgroundColor: COLORES_ESP,
        borderWidth: 2,
        borderColor: "#fff",
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            font: { size: 11 },
            color: "#64748b",
            padding: 12,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      cutout: "62%",
    },
  });
}

/* ─── Render Heatmap ──────────────────────────────────────────────────── */
function renderHeatmap(matriz) {
  const tabla = document.getElementById("heatmap-tabla");
  if (!tabla) return;

  const maximo = Math.max(1, ...matriz.flat());

  let html = "<thead><tr><th></th>";
  FRANJAS_AN.forEach(function (f) {
    html += `<th>${f}</th>`;
  });
  html += "</tr></thead><tbody>";

  DIAS_SEMANA_AN.forEach(function (dia, i) {
    html += `<tr><td class="heatmap-dia">${dia}</td>`;
    matriz[i].forEach(function (val) {
      const alpha = val === 0 ? 0 : (0.12 + (val / maximo) * 0.75);
      const bg = val === 0 ? "var(--fondo)" : `rgba(26,110,181,${alpha.toFixed(2)})`;
      const textColor = alpha > 0.5 ? "#fff" : "#1e293b";
      const label = val > 0 ? val : "";
      html += `<td class="heatmap-celda" style="background:${bg};color:${textColor}">${label}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  tabla.innerHTML = html;
}

/* ─── IA Insights ─────────────────────────────────────────────────────── */
async function analizarConIA() {
  if (estadoAN.analizando) return;

  const citas = filtrarPorRango(leerCitas(), estadoAN.rango);
  const metricas = calcularMetricas(citas);
  const resultado = document.getElementById("an-ia-resultado");
  const btnAnalizar = document.getElementById("btn-analizar-ia");

  estadoAN.analizando = true;
  btnAnalizar.disabled = true;
  btnAnalizar.textContent = "⏳ Analizando…";
  resultado.innerHTML = '<div class="an-ia-cargando"><div class="an-spinner"></div><span>Claude está analizando tus datos…</span></div>';

  try {
    const resumen = construirResumen(citas, metricas);
    const texto = await llamarClaudeAN(resumen);
    renderInsights(texto, resultado);
  } catch (err) {
    resultado.innerHTML = `<p class="an-ia-error">No se pudo obtener el análisis: ${escaparHtmlAN(err.message)}</p>`;
  } finally {
    estadoAN.analizando = false;
    btnAnalizar.disabled = false;
    btnAnalizar.textContent = "✨ Analizar con IA";
  }
}

function construirResumen(citas, metricas) {
  const rangoLabel = { semana: "última semana", mes: "último mes", trimestre: "últimos 3 meses", todo: "todo el historial" }[estadoAN.rango];
  const porDia = calcularPorDia(citas);
  const porEsp = calcularPorEspecialidad(citas);
  const heatmap = calcularHeatmap(citas);

  const diasTexto = DIAS_SEMANA_AN.map(function (d, i) { return `${d}: ${porDia[i]} citas`; }).join(", ");
  const espTexto = porEsp.labels.slice(0, 5).map(function (l, i) { return `${l}: ${porEsp.datos[i]}`; }).join(", ") || "Sin datos";
  const franjasTexto = FRANJAS_AN.map(function (f, fi) {
    const total = heatmap.reduce(function (s, dia) { return s + dia[fi]; }, 0);
    return f.split(" ")[0] + ": " + total + " citas";
  }).join(", ");

  return `Datos del ${rangoLabel}:

MÉTRICAS:
- Total de citas: ${metricas.total}
- Tasa de ocupación (atendidas): ${metricas.ocupacion !== null ? metricas.ocupacion + "%" : "sin datos"}
- Tasa de cancelaciones: ${metricas.noShows !== null ? metricas.noShows + "%" : "sin datos"}
- Pacientes recurrentes: ${metricas.recurrentes !== null ? metricas.recurrentes + "%" : "sin datos"}

DISTRIBUCIÓN POR DÍA:
${diasTexto}

TOP ESPECIALIDADES:
${espTexto}

FRANJAS HORARIAS:
${franjasTexto}`;
}

async function llamarClaudeAN(resumen) {
  const resp = await fetch(API_URL_AN, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_AN,
      max_tokens: 700,
      system: "Eres un consultor de gestión de clínicas médicas. Analizas datos operativos y generas insights accionables en español mexicano, claros y directos. Tus recomendaciones son prácticas y específicas para el día a día de una clínica.",
      messages: [{
        role: "user",
        content: resumen + "\n\nGenera entre 3 y 5 insights accionables. Cada insight: identifica un patrón concreto y propone una acción específica. Formato: lista, un insight por línea, precedido por un emoji relevante. Sin introducción ni conclusión.",
      }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(function () { return {}; });
    throw new Error(err.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n\n");
}

function renderInsights(texto, contenedor) {
  const lineas = texto.split("\n").filter(function (l) { return l.trim().length > 0; });
  const items = lineas.map(function (l) {
    return `<div class="an-insight-item">${escaparHtmlAN(l)}</div>`;
  }).join("");
  contenedor.innerHTML = `<div class="an-insights-lista">${items}</div>`;
}

function escaparHtmlAN(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════════════════════════════
   M5 — Métricas de Pacientes
   ═══════════════════════════════════════════════════════════════════ */

function leerPacientesAN() {
  return JSON.parse(localStorage.getItem("medicita_pacientes") || "[]");
}

function renderMetricasPacientes() {
  const pacs = leerPacientesAN();
  const total = pacs.length;

  // Sexo
  const sexoMap = {};
  pacs.forEach(function (p) {
    const s = p.sexo || "No especificado";
    sexoMap[s] = (sexoMap[s] || 0) + 1;
  });
  renderChartSexoPac(sexoMap);

  // Top 5 ciudades
  const ciudadMap = {};
  pacs.forEach(function (p) {
    if (!p.ciudad) return;
    ciudadMap[p.ciudad] = (ciudadMap[p.ciudad] || 0) + 1;
  });
  const ciudadesOrdenadas = Object.entries(ciudadMap)
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 5);
  renderChartCiudadesPac({
    labels: ciudadesOrdenadas.map(function (e) { return e[0]; }),
    datos: ciudadesOrdenadas.map(function (e) { return e[1]; }),
  });

  // Origen
  const origenMap = {};
  pacs.forEach(function (p) {
    const o = p.comoNosEncontro || "No especificado";
    origenMap[o] = (origenMap[o] || 0) + 1;
  });
  renderChartOrigenPac(origenMap);

  // KPIs demográficos
  const vipCount = pacs.filter(function (p) { return (p.calificacion || 1) >= 3; }).length;
  const hoy = new Date();
  const edades = pacs
    .filter(function (p) { return p.fechaNacimiento; })
    .map(function (p) {
      return Math.floor((hoy - new Date(p.fechaNacimiento + "T00:00:00")) / (365.25 * 24 * 3600 * 1000));
    })
    .filter(function (e) { return e >= 0 && e < 120; });
  const edadProm = edades.length
    ? Math.round(edades.reduce(function (s, e) { return s + e; }, 0) / edades.length)
    : null;

  const setEl = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  setEl("kpi-edad-prom",   edadProm !== null ? edadProm + " años" : "—");
  setEl("kpi-vip-pct",     total > 0 ? Math.round((vipCount / total) * 100) + "%" : "—");
  setEl("kpi-total-pac-an", total > 0 ? total : "—");
}

function renderChartSexoPac(mapaRaw) {
  const canvas = document.getElementById("chart-pac-sexo");
  if (!canvas || typeof Chart === "undefined") return;
  if (estadoAN.charts.sexo) { estadoAN.charts.sexo.destroy(); }
  const entradas = Object.entries(mapaRaw).filter(function (e) { return e[0] !== "No especificado" || e[1] > 0; });
  if (!entradas.length) return;
  estadoAN.charts.sexo = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: entradas.map(function (e) { return e[0]; }),
      datasets: [{ data: entradas.map(function (e) { return e[1]; }), backgroundColor: COLORES_ESP, borderWidth: 2, borderColor: "#fff", hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 }, color: "#64748b", padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
      },
    },
  });
}

function renderChartCiudadesPac(datos) {
  const canvas = document.getElementById("chart-pac-ciudades");
  if (!canvas || typeof Chart === "undefined") return;
  if (estadoAN.charts.ciudades) { estadoAN.charts.ciudades.destroy(); }
  if (!datos.labels.length) return;
  estadoAN.charts.ciudades = new Chart(canvas, {
    type: "bar",
    data: {
      labels: datos.labels,
      datasets: [{ data: datos.datos, backgroundColor: "rgba(26,110,181,0.75)", hoverBackgroundColor: "rgba(26,110,181,1)", borderRadius: 6, borderSkipped: false }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1, color: "#64748b", font: { size: 11 } }, grid: { color: "rgba(226,232,240,0.8)" } },
        y: { ticks: { color: "#64748b", font: { size: 12 } }, grid: { display: false } },
      },
    },
  });
}

function renderChartOrigenPac(mapaRaw) {
  const canvas = document.getElementById("chart-pac-origen");
  if (!canvas || typeof Chart === "undefined") return;
  if (estadoAN.charts.origen) { estadoAN.charts.origen.destroy(); }
  const entradas = Object.entries(mapaRaw);
  if (!entradas.length) return;
  estadoAN.charts.origen = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: entradas.map(function (e) { return e[0]; }),
      datasets: [{ data: entradas.map(function (e) { return e[1]; }), backgroundColor: COLORES_ESP, borderWidth: 2, borderColor: "#fff", hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 }, color: "#64748b", padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
      },
    },
  });
}
