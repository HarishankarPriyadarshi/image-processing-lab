const IIT_LOGO_URL = new URL("../../../assets/images/iitLogo.png", import.meta.url).href;
const VLABS_LOGO_URL = new URL("../../../assets/images/vlabsLogo.png", import.meta.url).href;

function opGlyph(op) {
  const common =
    'style="display:inline-block;vertical-align:middle;margin:0 3px;"';
  if (op === "+") {
    return `<svg width="13" height="13" viewBox="0 0 12 12" ${common} aria-hidden="true"><rect x="5" y="1" width="2" height="10" rx="1" fill="currentColor"/><rect x="1" y="5" width="10" height="2" rx="1" fill="currentColor"/></svg>`;
  }
  if (op === "-") {
    return `<svg width="13" height="13" viewBox="0 0 12 12" ${common} aria-hidden="true"><rect x="1" y="5" width="10" height="2" rx="1" fill="currentColor"/></svg>`;
  }
  if (op === "*" || op === "×") {
    return `<svg width="13" height="13" viewBox="0 0 12 12" ${common} aria-hidden="true"><line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  if (op === "/" || op === "÷") {
    return `<svg width="13" height="13" viewBox="0 0 12 12" ${common} aria-hidden="true"><circle cx="6" cy="2.6" r="1.3" fill="currentColor"/><rect x="1" y="5" width="10" height="2" rx="1" fill="currentColor"/><circle cx="6" cy="9.4" r="1.3" fill="currentColor"/></svg>`;
  }
  return op;
}

function escapeHTML(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

const MORPHOLOGY_HISTORY_KEY = "vlab_exp4_morphology_operation_history";
const MORPHOLOGY_HTML_KEY = "vlab_exp4_morphology_simulation_report_html";
const MORPHOLOGY_UPDATED_KEY =
  "vlab_exp4_morphology_simulation_report_updated_at";

function formatOperationName(operation) {
  const names = {
    dilation: "Dilation",
    erosion: "Erosion",
    opening: "Opening",
    closing: "Closing",
  };
  return names[operation] || operation;
}

function countForeground(matrix) {
  return (matrix || []).reduce(
    (total, row) =>
      total + row.reduce((sum, cell) => sum + (cell === 1 ? 1 : 0), 0),
    0,
  );
}

function formatClockTime(ts) {
  if (!ts) return "--:--:--";
  const date = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDateTime(ts) {
  if (!ts) return "--";
  return new Date(ts).toLocaleString();
}
function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return "--:--:--";

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  const difference = Math.max(0, end - start);

  const totalSeconds = Math.floor(difference / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, "0");

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function renderBinaryMatrix(matrix) {
  if (!matrix || !matrix.length) return "<p>No matrix data available.</p>";

  const size = matrix.length;
  const cells = matrix
    .map((row, rowIndex) =>
      row
        .map((cell, colIndex) => {
          const isPadding =
            (size === 9 && row.length === 9 && rowIndex === 0) ||
            (size === 9 &&
              row.length === 9 &&
              (rowIndex === size - 1 ||
                colIndex === 0 ||
                colIndex === row.length - 1));
          return `<div class="matrix-cell ${isPadding ? "padding-cell" : ""} ${
            cell === 1 ? "one-cell" : "zero-cell"
          }">${cell}</div>`;
        })
        .join(""),
    )
    .join("");

  return `<div class="binary-matrix" style="grid-template-columns:repeat(${matrix[0].length}, 22px);">${cells}</div>`;
}

function getActiveUserHash() {
  try {
    return localStorage.getItem("vlab_exp2_active_user_hash");
  } catch (e) {
    return null;
  }
}

function readMorphologyHistory() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(MORPHOLOGY_HISTORY_KEY) || "[]",
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeMorphologyHistory(history) {
  try {
    localStorage.setItem(MORPHOLOGY_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.error("Could not save morphology operation history", e);
  }
}
function getOperationDescription(operationName) {
  switch (operationName?.toLowerCase()) {
    case "dilation":
      return "Dilation increases the size of objects in an image.";

    case "erosion":
      return "Erosion reduces the size of objects in a binary image.";

    case "opening":
      return "Opening removes small objects or noise from an image while preserving the shape and size of larger objects.";

    case "closing":
      return "Closing fills small holes and gaps in objects while preserving their overall shape.";

    default:
      return "";
  }
}
function buildOperationSection(entry) {
  // Stage Summary is required only for compound operations
  const showStageSummary =
    entry.operation === "opening" || entry.operation === "closing";

  const stageRows = showStageSummary
    ? entry.stages
        .map(
          (stage, index) => `<tr>
            <td>${index + 1}</td>
            <td>${escapeHTML(stage.label)}</td>
            <td>${countForeground(stage.image)}</td>
          </tr>`,
        )
        .join("")
    : "";

  const stageBlocks = showStageSummary
    ? entry.stages
        .map(
          (stage, index) => `<div class="results-card matrix-card">
            <h3>Stage ${index + 1}: ${escapeHTML(stage.label)}</h3>
            ${renderBinaryMatrix(stage.image)}
          </div>`,
        )
        .join("")
    : "";

  return `<div class="report-page">
    <div class="section">
      <div class="report-overview-top">
        <p class="badge">Operation ${entry.sequence}</p>
        <p class="report-stamp">${escapeHTML(
          formatDateTime(entry.completedAt),
        )}</p>
      </div>

      <h2>${escapeHTML(entry.operationName)}</h2>

      <p class="desc">
        ${escapeHTML(entry.operationName)} was performed on the
        ${escapeHTML(entry.imageName || "selected")} Binary image pattern using a
         3x3 
          structuring element.
      </p>

      <div class="info-grid">
        <div class="info-card">
          <span class="label">Input Foreground:</span>
          ${entry.stats.inputForeground}
        </div>

        <div class="info-card">
          <span class="label">Output Foreground:</span>
          ${entry.stats.outputForeground}
        </div>

        <div class="info-card">
          <span class="label">Foreground Change:</span>
          ${entry.stats.foregroundChange}
        </div>


      </div>
    </div>

    <div class="section results-section">
      <h2>Input, Kernel, and Output</h2>

      <div class="matrix-row">
        <div class="results-card matrix-card">
          <h3>Input A</h3>
          ${renderBinaryMatrix(entry.inputImage)}
        </div>

        <div class="results-card matrix-card">
          <h3>Kernel B</h3>
          ${renderBinaryMatrix(entry.kernel)}
        </div>

        <div class="results-card matrix-card">
          <h3>Output</h3>
          ${renderBinaryMatrix(entry.outputImage)}
          <p class="desc">
  ${escapeHTML(getOperationDescription(entry.operationName))}
</p>
        </div>
      </div>


    </div>

    ${
      showStageSummary
        ? `
    <div class="section results-section">
      <h2>Stage Summary</h2>

      <div class="table-shell">
        <table class="compact-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Stage</th>
              <th>Foreground Pixels</th>
            </tr>
          </thead>

          <tbody>
            ${stageRows}
          </tbody>
        </table>
      </div>

      <div class="stage-grid">
        ${stageBlocks}
      </div>
    </div>
    `
        : ""
    }
  </div>`;
}

function getDynamicMorphologySummary(history) {
  if (!history || history.length === 0) {
    return {
      aim: "To study morphological image processing operations on binary images by applying Dilation, Erosion, Opening, and Closing using a structuring element (kernel), and to observe their effects on foreground regions.",
      summary: "No morphology operation has been completed yet.",
    };
  }

  // Get unique operations while preserving execution order
  const operations = [
    ...new Set(history.map((entry) => entry.operation).filter(Boolean)),
  ];

  const names = operations.map(formatOperationName);

  const descriptions = {
    dilation:
      "Dilation expanded the foreground regions by adding pixels around their boundaries according to the shape and size of the kernel.",

    erosion:
      "Erosion shrank the foreground regions by removing pixels from their boundaries according to the shape and size of the kernel.",

    opening:
      "Opening, consisting of Erosion followed by Dilation, removed small foreground noise while preserving the general shape of larger objects.",

    closing:
      "Closing, consisting of Dilation followed by Erosion, filled small gaps and holes in foreground regions while preserving their general shape.",
  };

  let operationDescription = operations
    .map((operation) => descriptions[operation])
    .filter(Boolean);

  let summary;

  if (operations.length === 1) {
    // Only one operation performed
    summary =
      `The selected binary image was processed using a structuring element (kernel) to perform ` +
      `<b>${names[0]}</b>. ${operationDescription[0]} ` +
      `The kernel movement and resulting image were visualized step-by-step to observe how ` +
      `${names[0]} transformed the input image.`;
  } else {
    // Multiple operations performed
    const operationText =
      names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

    summary =
      `The selected binary image was processed using a structuring element (kernel) through ` +
      `<b>${operationText}</b>. ` +
      `${operationDescription.join(" ")}` +
      ` The kernel movement, intermediate stages, and resulting images were visualized ` +
      `step-by-step for each completed operation.`;
  }

  return {
    aim: "To study morphological image processing operations on binary images by applying Dilation, Erosion, Opening, and Closing using a structuring element (kernel), and to observe their effects on foreground regions.",
    summary,
  };
}
function buildMorphologyReportHtml(history) {
  const dynamicContent = getDynamicMorphologySummary(history);

  const generatedOn = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const firstTime = history[0]?.startedAt || history[0]?.completedAt;
  const lastTime = history[history.length - 1]?.completedAt;
  const operationList = history
    .map(
      (entry) =>
        `<li>${entry.sequence}. ${escapeHTML(entry.operationName)}</li>`,
    )
    .join("");
  const totalInputForeground = history.reduce(
    (sum, entry) => sum + entry.stats.inputForeground,
    0,
  );
  const totalOutputForeground = history.reduce(
    (sum, entry) => sum + entry.stats.outputForeground,
    0,
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
    background: #eef4fb;
    color: #1f2d3d;
    margin: 0;
    padding: 0;
    line-height: 1.65;
    overflow-x: hidden;
  }
  #report-viewport { width: 100%; overflow: hidden; position: relative; }
  #report-scale-inner { width: 944px; transform-origin: top left; padding: 30px 22px 44px; box-sizing: border-box; }
  .report-page { width: 100%; max-width: 900px; margin: 0 auto 16px; padding: 26px 28px 22px; background-color: #ffffff; border-radius: 18px; box-sizing: border-box; }
  .report-page:last-of-type { margin-bottom: 0; }
  h1, h2, h3 { color: #1f2d3d; margin-top: 0; font-weight: 700; }
  h2 { font-size: 23px; margin-bottom: 16px; color: #243b53; }
  h3 { font-size: 17px; margin-bottom: 10px; color: #2d4b68; }
  p { margin: 0 0 12px; font-size: 15px; }

  .vl-logo { height: 70px; width: 78px; object-fit: contain; flex-shrink: 0; }
  .header-row { display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
  .report-title-block { flex: 1 1 220px; min-width: 0; text-align: center; margin: 0; padding-bottom: 14px; border-bottom: 3px solid #2f7bfa; }
  .report-subtitle { margin: 8px 0 0; font-size: 14px; color: #5c6f84; }
  .report-overview-top { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
  .badge { margin: 0; padding: 8px 14px; border-radius: 20px; background: #e8f1ff; color: #1f62d0; font-weight: 600; font-size: 13px; }
  .report-stamp { margin: 0; padding: 8px 12px; border-radius: 999px; background: #ffffff; border: 1px solid #dce5ef; color: #50657c; font-size: 13px; font-weight: 600; }
  .report-experiment-label { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #60778f; font-weight: 700; }
  .report-experiment-title { margin: 0 0 18px; font-size: 25px; line-height: 1.3; font-weight: 700; color: #16324b; overflow-wrap: break-word; }
  .info-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .info-card { background: #fff; border: 1px solid #e5e9f2; border-radius: 10px; padding: 12px 14px; font-size: 14px; min-height: 60px; box-sizing: border-box; flex: 1 1 150px; min-width: 130px; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
  .label { font-weight: 600; color: #1f2d3d; display: block; margin-bottom: 2px; }
  .section { background-color: #f6f9fc; padding: 22px 24px; margin-bottom: 24px; border-radius: 14px; border: 1px solid #e0e8f2; }
  .section:last-child { margin-bottom: 0; }
  .results-card { background: #ffffff; border: 1px solid #dde6f0; border-radius: 14px; padding: 18px; box-sizing: border-box; page-break-inside: avoid !important; break-inside: avoid !important; }
  .results-card h3 { margin-bottom: 12px; text-align: left; }
  .table-shell { overflow-x: auto; overflow-y: hidden; border: 1px solid #dce6f2; border-radius: 12px; -webkit-overflow-scrolling: touch; page-break-inside: avoid !important; break-inside: avoid !important; }
  table.compact-table { width: 100%; min-width: 420px; border-collapse: collapse; table-layout: fixed; margin-top: 0; }
  .compact-table th, .compact-table td { border: 1px solid #e5e9f2; padding: 10px 12px; text-align: center; font-size: 14px; vertical-align: middle; }
  .compact-table th { background-color: #1f62d0; color: #fff; font-weight: 700; }
  .compact-table tr:nth-child(even) { background-color: #f8fbff; }
  .matrix-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .matrix-card { flex: 1 1 230px; min-width: 230px; overflow-x: auto; }
  .stage-grid { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; }
  .binary-matrix { display: grid; gap: 2px; width: max-content; border: 1px solid #d1d5db; padding: 8px; background: #f9fafb; }
  .matrix-cell { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border: 1px solid #d1d5db; font-size: 11px; font-weight: 700; }
  .zero-cell { background: #111827; color: #ffffff; }
  .one-cell { background: #ffffff; color: #111827; }
  .padding-cell { background: #374151; color: #ffffff; }
  .report-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; max-width: 900px; margin: 30px auto 10px; padding: 0 22px; }
  .print-btn, .download-btn { flex: 0 1 140px; min-width: 0; padding: 10px 18px; font-size: 14px; border: none; border-radius: 30px; color: white; cursor: pointer; transition: all 0.25s ease; }
  .print-btn { background-color: #1f62d0; }
  .download-btn { background-color: #1f8d38; }
  .print-btn:hover, .download-btn:hover { transform: translateY(-2px); }
  .print-btn:disabled, .download-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
  @media print {
    .print-btn, .download-btn, .report-actions { display: none !important; }
    body { margin: 0; padding: 0; background: #ffffff; }
    .report-page { margin: 0 0 14px; padding: 24px 26px 22px; border: none !important; border-radius: 0 !important; box-shadow: none !important; }
    #report-scale-inner { transform: none !important; width: 100% !important; }
    #report-viewport { height: auto !important; width: 100% !important; }
  }
</style>
</head>
<body id="report-root">
  <div id="report-viewport">
    <div id="report-scale-inner">
      <div id="pdf-export-root">
        <div class="report-page">
          
          <div class="header-row">
        <img src="${IIT_LOGO_URL}" class="vl-logo" onerror="this.style.display='none'">
        <div class="report-title-block">
          <p class="report-kicker"></p>
          <h2>Virtual Labs Simulation Report</h2>
        </div>
        <img src="${VLABS_LOGO_URL}" class="vl-logo" onerror="this.style.display='none'">
      </div>
          <div class="section report-overview">
            <div class="report-overview-top">
              <p class="badge">Image Processing Lab</p>
              <p class="report-stamp">Generated on ${generatedOn}</p>
            </div>
            <p class="report-experiment-label">Experiment Title</p>
            <p class="report-experiment-title">Morphology-Based Edge Detection</p>
            <div class="info-grid">
  <div class="info-card">
    <span class="label">Start Time:</span>${formatClockTime(firstTime)}
  </div>

  <div class="info-card">
    <span class="label">End Time:</span>${formatClockTime(lastTime)}
  </div>

  <div class="info-card">
    <span class="label">Total Time Spent:</span>${formatDuration(
      firstTime,
      lastTime,
    )}
  </div>

  <div class="info-card">
    <span class="label">Completed Operations:</span>${history.length}
  </div>
</div>
          </div>
          <div class="section">
           <h2>Aim</h2>
            <p>${dynamicContent.aim}</p>
            <h2>Summary</h2>
              <p>${dynamicContent.summary}</p>
               <h3>Execution Order</h3>
            <ul>${operationList}</ul>
            
          </div>
        </div>
        ${history.map(buildOperationSection).join("")}
      </div>
      <div class="report-actions">
        <button class="download-btn" onclick="downloadPdfReport(this)">DOWNLOAD</button>
        <button class="print-btn" onclick="window.print()">PRINT</button>
      </div>
    </div>
  </div>
  <script>
    async function downloadPdfReport(btn) {
      if (typeof html2canvas === 'undefined' || typeof (window.jspdf ? window.jspdf.jsPDF : window.jsPDF) === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
      }
      btn.disabled = true;
      var originalText = btn.textContent;
      btn.textContent = 'Preparing PDF...';
      var root = document.getElementById('pdf-export-root');
      try {
        const canvas = await html2canvas(root, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: 944,
          windowHeight: root.scrollHeight,
          scrollX: 0,
          scrollY: 0,
        });
        const JsPDFCtor = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        const pdf = new JsPDFCtor({ unit: 'pt', format: 'a4', orientation: 'portrait' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const usableWidth = pageWidth - margin * 2;
        const usableHeight = pageHeight - margin * 2;
        const imgWidth = usableWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const scaleRatio = imgHeight / canvas.height;
        let renderedCanvasY = 0;
        let firstPage = true;
        while (renderedCanvasY < canvas.height) {
          const canvasPageHeight = usableHeight / scaleRatio;
          const breakAt = Math.min(renderedCanvasY + canvasPageHeight, canvas.height);
          const sliceHeightPx = breakAt - renderedCanvasY;
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeightPx;
          pageCanvas
            .getContext('2d')
            .drawImage(canvas, 0, renderedCanvasY, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
          if (!firstPage) pdf.addPage();
          pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.98), 'JPEG', margin, margin, imgWidth, sliceHeightPx * scaleRatio);
          renderedCanvasY = breakAt;
          firstPage = false;
        }
        pdf.save('morphology_simulation_report_' + Date.now() + '.pdf');
      } catch (err) {
        console.error(err);
        alert('Could not generate the PDF report.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  </script>
</body>
</html>`;
}

function persistMorphologyReport(history) {
  const html = buildMorphologyReportHtml(history);
  const updatedAt = String(Date.now());

  try {
    localStorage.setItem(MORPHOLOGY_HTML_KEY, html);
    localStorage.setItem(MORPHOLOGY_UPDATED_KEY, updatedAt);
    localStorage.setItem("progressreport.html", html);
    localStorage.setItem("vlab:simulation_report_html", html);
    localStorage.setItem(
      "vlab:simulation_report_data",
      JSON.stringify({
        source: "morphology",
        experiment: "morphology",
        updatedAt,
        operations: history,
      }),
    );

    const activeHash = getActiveUserHash();
    if (activeHash) {
      localStorage.setItem(
        `vlab_exp2_user_${activeHash}_simulation_report_html`,
        html,
      );
      localStorage.setItem(
        `vlab_exp2_user_${activeHash}_simulation_report_updated_at`,
        updatedAt,
      );
    }
  } catch (e) {
    console.error("Could not persist morphology report", e);
  }

  try {
    window.parent?.postMessage(
      {
        type: "vlab:simulation_report_generated",
        html,
        updatedAt,
        source: "morphology",
      },
      "*",
    );
    window.opener?.postMessage(
      {
        type: "vlab:simulation_report_generated",
        html,
        updatedAt,
        source: "morphology",
      },
      "*",
    );
  } catch (e) {}

  return html;
}

export function startMorphologyReportSession() {
  writeMorphologyHistory([]);
  try {
    localStorage.removeItem(MORPHOLOGY_HTML_KEY);
    localStorage.removeItem(MORPHOLOGY_UPDATED_KEY);
    localStorage.removeItem("progressreport.html");
    localStorage.removeItem("vlab:simulation_report_html");
    localStorage.removeItem("vlab:simulation_report_data");
  } catch (e) {
    console.error(e);
  }
}

export function getMorphologyOperationHistory() {
  return readMorphologyHistory();
}

export function hasMorphologyReportHistory() {
  return readMorphologyHistory().length > 0;
}
export function appendMorphologyOperation({
  operation,
  imageName,
  inputImage,
  kernel,
  outputImage,
  stages = [],
  totalSteps = 49,
  startedAt,
  completedAt = new Date().toISOString(),
}) {
  if (!inputImage || !kernel || !outputImage) {
    console.warn(
      "appendMorphologyOperation: missing completed operation data.",
    );
    return null;
  }

  const history = readMorphologyHistory();

  const stats = {
    inputForeground: countForeground(inputImage),
    outputForeground: countForeground(outputImage),
  };

  stats.foregroundChange = stats.outputForeground - stats.inputForeground;

  const entry = {
    sequence: 0,
    experiment: "morphology",
    operation,
    operationName: formatOperationName(operation),
    imageName,
    inputImage,
    kernel,
    outputImage,
    stages,
    totalSteps,
    startedAt: startedAt || completedAt,
    completedAt,
    stats,
  };

  /*
   * If the same operation already exists,
   * replace it with the latest result.
   *
   * Otherwise add it as a new operation.
   */
  const existingIndex = history.findIndex(
    (item) => item.operation === operation,
  );

  let nextHistory;

  if (existingIndex !== -1) {
    // Replace the old operation with the latest one
    nextHistory = [...history];
    nextHistory[existingIndex] = {
      ...entry,
      sequence: existingIndex + 1,
    };
  } else {
    // Add a new operation
    nextHistory = [
      ...history,
      {
        ...entry,
        sequence: history.length + 1,
      },
    ];
  }

  /*
   * Re-number the operations after replacement/addition
   * so Execution Order always remains 1, 2, 3, 4...
   */
  nextHistory = nextHistory.map((item, index) => ({
    ...item,
    sequence: index + 1,
  }));

  writeMorphologyHistory(nextHistory);
  persistMorphologyReport(nextHistory);

  return entry;
}

export function buildCurrentMorphologyReport() {
  const history = readMorphologyHistory();
  if (!history.length) return null;
  return persistMorphologyReport(history);
}

export function downloadMorphologyReport() {
  const html = buildCurrentMorphologyReport();
  if (!html) return false;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = "944px";
  iframe.style.height = "1400px";
  iframe.style.border = "none";

  iframe.onload = () => {
    setTimeout(async () => {
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        const root = doc.getElementById("pdf-export-root");
        if (!root) {
          document.body.removeChild(iframe);
          return;
        }

        let waited = 0;
        while (
          (typeof win.html2canvas === "undefined" ||
            typeof (win.jspdf?.jsPDF || win.jsPDF) === "undefined") &&
          waited < 5000
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          waited += 100;
        }

        if (
          typeof win.html2canvas === "undefined" ||
          typeof (win.jspdf?.jsPDF || win.jsPDF) === "undefined"
        ) {
          document.body.removeChild(iframe);
          return;
        }

        if (doc.fonts && doc.fonts.ready) {
          try {
            await doc.fonts.ready;
          } catch (e) {}
        }

        void root.offsetHeight;
        await new Promise((resolve) => setTimeout(resolve, 200));

        const canvas = await win.html2canvas(root, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          windowWidth: 944,
          windowHeight: root.scrollHeight,
          scrollX: 0,
          scrollY: 0,
        });

        const JsPDFCtor = win.jspdf ? win.jspdf.jsPDF : win.jsPDF;
        const pdf = new JsPDFCtor({
          unit: "pt",
          format: "a4",
          orientation: "portrait",
        });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const usableWidth = pageWidth - margin * 2;
        const usableHeight = pageHeight - margin * 2;
        const imgWidth = usableWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const scaleRatio = imgHeight / canvas.height;
        let renderedCanvasY = 0;
        let firstPage = true;

        while (renderedCanvasY < canvas.height) {
          const canvasPageHeight = usableHeight / scaleRatio;
          const breakAt = Math.min(
            renderedCanvasY + canvasPageHeight,
            canvas.height,
          );
          const sliceHeightPx = breakAt - renderedCanvasY;
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeightPx;
          pageCanvas
            .getContext("2d")
            .drawImage(
              canvas,
              0,
              renderedCanvasY,
              canvas.width,
              sliceHeightPx,
              0,
              0,
              canvas.width,
              sliceHeightPx,
            );

          if (!firstPage) pdf.addPage();
          pdf.addImage(
            pageCanvas.toDataURL("image/jpeg", 0.98),
            "JPEG",
            margin,
            margin,
            imgWidth,
            sliceHeightPx * scaleRatio,
          );
          renderedCanvasY = breakAt;
          firstPage = false;
        }

        const pdfBlob = pdf.output("blob");
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `morphology_simulation_report_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        document.body.removeChild(iframe);
      } catch (err) {
        console.error("Could not download morphology report", err);
        document.body.removeChild(iframe);
      }
    }, 1200);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  return true;
}

export function generateMorphologyReport(params) {
  return appendMorphologyOperation(params);
}
