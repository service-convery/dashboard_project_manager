// === Rendering dei grafici (Chart.js) e snapshot per la stampa ===
// Chart è caricato come global dal tag <script> CDN in dashboard.html, prima
// di questo modulo (gli script classici eseguono prima dei moduli deferred).
import { DAY_LABELS } from "./config.js";
import { state } from "./state.js";

// I grafici usano lo stesso font dell'interfaccia (Red Hat Display).
if (typeof Chart !== "undefined" && Chart.defaults && Chart.defaults.font) {
  Chart.defaults.font.family = "'Red Hat Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
}

export function renderHoursChart(hoursByDay){
  const ctx = document.getElementById("hoursChart");
  const dataH = hoursByDay.map(ms => +(ms / 3600000).toFixed(2));
  const maxVal = Math.max.apply(null, dataH);
  if (state.hoursChart) state.hoursChart.destroy();
  state.hoursChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: DAY_LABELS,
      datasets: [{
        label: "Ore",
        data: dataH,
        backgroundColor: "#3333FF",
        borderRadius: 4,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#FFFFFF", titleColor: "#1A1A2E", bodyColor: "#5A6178",
          borderColor: "#D8DCE4", borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => ctx.parsed.y + " h" }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#5A6178", font: { size: 11 } } },
        y: {
          beginAtZero: true,
          // Se tutti i dati sono 0, forza un asse 0-8h con step di 2h così non si vede
          // una scala assurda tipo "0.1h, 0.2h, ...".
          max: maxVal === 0 ? 8 : undefined,
          ticks: {
            color: "#5A6178",
            font: { size: 11 },
            stepSize: maxVal === 0 ? 2 : undefined,
            callback: (v) => v + "h"
          },
          grid: { color: "#E8ECF2", drawBorder: false }
        }
      }
    }
  });
}

export function renderStatusChart(statusCounts, canvasId = "statusChart", chartKey = "statusChart"){
  const ctx = document.getElementById(canvasId);
  const labels = Array.from(statusCounts.keys());
  const data = Array.from(statusCounts.values());
  // Tinte nettamente distinte (i due viola precedenti erano indistinguibili su mobile).
  const palette = ["#3333FF", "#E8A830", "#2E9E5A", "#9999FF", "#D94452", "#5A6178"];
  if (state[chartKey]) state[chartKey].destroy();
  if (!labels.length) {
    state[chartKey] = new Chart(ctx, {
      type: "doughnut",
      data: { labels: ["Nessun task"], datasets: [{ data: [1], backgroundColor: ["#E8ECF2"], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "65%", plugins: { legend: { display:false }, tooltip: { enabled:false } } }
    });
    return;
  }
  state[chartKey] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_,i) => palette[i % palette.length]),
        borderColor: "#FFFFFF",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#5A6178", font: { size: 11 }, boxWidth: 10, boxHeight: 10, padding: 12, usePointStyle: true, pointStyle: "circle" }
        },
        tooltip: {
          backgroundColor: "#FFFFFF", titleColor: "#1A1A2E", bodyColor: "#5A6178",
          borderColor: "#D8DCE4", borderWidth: 1, padding: 10
        }
      }
    }
  });
}

// Snapshot di una lista di canvas Chart.js come PNG, settati come src dei rispettivi
// <img class="chart-print">. I canvas renderano male in @media print perché il browser
// ne scala le dimensioni fisse; un'immagine bitmap pre-renderizzata è più affidabile.
// `pairs`: array di [canvasId, imgId, chartInstance].
export function snapshotCanvases(pairs){
  try {
    pairs.forEach(([canvasId, imgId, chart]) => {
      const canvas = document.getElementById(canvasId);
      const img = document.getElementById(imgId);
      if (chart) chart.resize();
      if (canvas && img) img.src = canvas.toDataURL("image/png", 1.0);
    });
  } catch (e) {
    console.warn("snapshotCanvases failed:", e);
  }
}

// Snapshot dei chart del tab Settimanale (ore per giorno + status).
export function snapshotChartsForPrint(){
  snapshotCanvases([
    ["hoursChart", "hoursChartPrint", state.hoursChart],
    ["statusChart", "statusChartPrint", state.statusChart],
    ["monthlyStatusChart", "monthlyStatusChartPrint", state.monthlyStatusChart]
  ]);
}
