const IIT_LOGO_URL = new URL(
  "../../../assets/images/iitLogo.png",
  import.meta.url,
).href;
const VLABS_LOGO_URL = new URL(
  "../../../assets/images/vlabsLogo.png",
  import.meta.url,
).href;
const REPORT_KEY = "vlab_exp2_derivative_concept_report";
const REPORT_HTML_KEY = "vlab_exp2_derivative_concept_report_html";

const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const formatTime = (value) =>
  value ? new Date(value).toLocaleTimeString() : "--:--:--";
const operatorName = (operator) =>
  String(operator || "").replace(/^\w/, (letter) => letter.toUpperCase());
function formatDuration(start, end) {
  if (!start || !end) return "--:--:--";
  const seconds = Math.max(
    0,
    Math.floor((new Date(end) - new Date(start)) / 1000),
  );
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
function readReport() {
  try {
    const data = JSON.parse(localStorage.getItem(REPORT_KEY) || "{}");
    return Array.isArray(data.results) ? data : { results: [] };
  } catch {
    return { results: [] };
  }
}
const cloneMatrix = (matrix) =>
  Array.isArray(matrix)
    ? matrix.map((row) => (Array.isArray(row) ? [...row] : []))
    : [];
const isCompleteResult = (entry) =>
  Boolean(
    entry?.operator &&
    entry?.input?.length &&
    entry?.kernelX?.length &&
    entry?.output?.length,
  );
function renderMatrix(matrix, type = "input") {
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0]))
    return '<p class="empty">No data available.</p>';
  const maximum =
    type === "output"
      ? Math.max(
          ...matrix.flat().map((value) => Math.abs(Number(value) || 0)),
          1,
        )
      : 1;
  const cells = matrix
    .flat()
    .map((cell) => {
      const value = Number(cell) || 0,
        shade =
          type === "output"
            ? Math.max(
                0,
                Math.min(255, Math.round((Math.abs(value) / maximum) * 255)),
              )
            : null;
      const style =
        type === "output"
          ? ' style="background:rgb(' +
            shade +
            "," +
            shade +
            "," +
            shade +
            ");color:" +
            (shade > 145 ? "#111827" : "#fff") +
            '"'
          : "";
      const className =
        type === "input" ? (value ? "one" : "zero") : "kernel-cell";
      return (
        '<i class="' + className + '"' + style + ">" + escapeHTML(cell) + "</i>"
      );
    })
    .join("");
  return (
    '<div class="matrix" style="grid-template-columns:repeat(' +
    matrix[0].length +
    ',24px)">' +
    cells +
    "</div>"
  );
}
function renderKernels(entry) {
  const x =
    '<div class="kernel"><h4>' +
    (entry.kernelY?.length ? "Kernel X" : "Kernel") +
    "</h4>" +
    renderMatrix(entry.kernelX, "kernel") +
    "</div>";
  const y = entry.kernelY?.length
    ? '<div class="kernel"><h4>Kernel Y</h4>' +
      renderMatrix(entry.kernelY, "kernel") +
      "</div>"
    : "";
  return '<div class="kernel-pair">' + x + y + "</div>";
}

function buildSummary(results) {
  const firstOrder = results
    .filter((entry) => entry.derivativeOrder === "First-order")
    .map((entry) => operatorName(entry.operator));

  const secondOrder = results
    .filter((entry) => entry.derivativeOrder === "Second-order")
    .map((entry) => operatorName(entry.operator));

  const total = results.length;
  const parts = [];

  if (firstOrder.length) {
    parts.push(
      "first-order derivative operators (" + firstOrder.join(", ") + ")",
    );
  }

  if (secondOrder.length) {
    parts.push(
      "the second-order derivative operator" +
        (secondOrder.length > 1 ? "s" : "") +
        " (" +
        secondOrder.join(", ") +
        ")",
    );
  }

  return (
    "A total of " +
    total +
    " derivative operator" +
    (total > 1 ? "s were" : " was") +
    " applied to selected binary image patterns. " +
    parts.join(" and ") +
    " were used to detect intensity transitions and object boundaries. " +
    "The resulting edge maps were generated from the corresponding derivative responses, " +
    "allowing the detected edge structure of each selected image to be observed."
  );
}
function buildReport(data) {
  const results = (data?.results || []).filter(isCompleteResult);
  if (!results.length) return null;
  const completedOperations = new Set(results.map((entry) => entry.operator))
    .size;
  const started = results
    .map((entry) => entry.startedAt)
    .filter(Boolean)
    .sort()[0];
  const completed = results
    .map((entry) => entry.completedAt || entry.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const date = new Date(completed || Date.now()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const executionOrder =
    '<ol class="execution-order">' +
    results
      .map(
        (entry) => "<li>" + escapeHTML(operatorName(entry.operator)) + "</li>",
      )
      .join("") +
    "</ol>";
  const sections = results
    .map(
      (entry) =>
        '<section class="section operator-section"><div class="operator-heading"><h2>' +
        escapeHTML(operatorName(entry.operator)) +
        " Operator</h2><span>Derivative Order: " +
        escapeHTML(entry.derivativeOrder) +
        '</span></div><div class="result-row"><div class="result"><h3>Input Image</h3><p>' +
        escapeHTML(entry.imageName) +
        " (" +
        entry.input.length +
        " × " +
        (entry.input[0]?.length || 0) +
        ")</p>" +
        renderMatrix(entry.input) +
        '</div><div class="result"><h3>Kernel(s)</h3><p>Kernel Size: ' +
        escapeHTML(entry.kernelSize) +
        "</p>" +
        renderKernels(entry) +
        '</div><div class="result"><h3>Final Edge Output</h3><p>' +
        entry.output.length +
        " × " +
        (entry.output[0]?.length || 0) +
        "</p>" +
        renderMatrix(entry.output, "output") +
        '</div></div><div class="observation"><h3>Observation</h3><p>' +
        escapeHTML(entry.observation) +
        "</p></div></section>",
    )
    .join("");
  const css =
    "*{box-sizing:border-box}body{margin:0;background:#eef4fb;color:#1f2d3d;font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.5}#scale{width:944px;padding:30px 22px 44px}.page{max-width:900px;margin:auto;padding:26px 28px;background:#fff;border-radius:18px}h2,h3,h4{margin-top:0;color:#243b53}h2{font-size:23px}h3{font-size:16px;margin-bottom:5px}h4{font-size:15px;margin-bottom:6px}p{font-size:15px;margin:0 0 10px}.header{display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:24px}.logo{width:78px;height:70px;object-fit:contain}.title{flex:1;text-align:center;border-bottom:3px solid #2f7bfa;padding-bottom:14px}.section{background:#f6f9fc;border:1px solid #e0e8f2;border-radius:14px;padding:18px 20px;margin-bottom:18px}.top,.operator-heading{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.badge,.stamp,.operator-heading span{margin:0;padding:8px 14px;border-radius:20px;font-size:13px;font-weight:600}.badge,.operator-heading span{background:#e8f1ff;color:#1f62d0}.stamp{background:#fff;border:1px solid #dce5ef;color:#50657c}.label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#60778f;font-weight:700}.experiment{font-size:25px;font-weight:700;color:#16324b;margin:0 0 18px}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{flex:1 1 150px;background:#fff;border:1px solid #dde6f0;border-radius:14px;padding:14px}.card span{display:block;font-weight:600;font-size:15px;}.execution-order{margin:0;padding-left:25px;font-size:14px}.execution-order li{padding:2px 0}.result-row{display:flex;gap:10px;align-items:stretch}.result{flex:1 1 0;background:#fff;border:1px solid #dde6f0;border-radius:12px;padding:12px;min-width:0}.matrix{display:grid;gap:2px;width:max-content;max-width:100%;border:1px solid #d1d5db;padding:6px;background:#f9fafb}.matrix i{display:flex;width:24px;height:24px;align-items:center;justify-content:center;border:1px solid #d1d5db;font-style:normal;font-size:10px;font-weight:700}.zero{background:#111827;color:#fff}.one{background:#fff;color:#111827}.kernel-cell{background:#edf3fa;color:#16324b}.kernel-pair{display:flex;gap:8px;flex-wrap:wrap}.kernel{min-width:0}.observation{margin-top:12px;padding:12px 14px;background:#fff;border-radius:0 10px 10px 0}.observation p{margin:0}.empty{color:#60778f}@media print{body{background:#fff}.page{border-radius:0}#scale{width:100%;padding:0}}";
  return (
    '<!doctype html><html><head><meta charset="UTF-8"><script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script><style>' +
    css +
    '</style></head><body><div id="scale"><div id="pdf-export-root"><main class="page"><div class="header"><img class="logo" src="' +
    IIT_LOGO_URL +
    '"><div class="title"><h2>Virtual Labs Simulation Report</h2></div><img class="logo" src="' +
    VLABS_LOGO_URL +
    '"></div><section class="section"><div class="top"><p class="badge">Image Processing Lab</p><p class="stamp">Generated on ' +
    date +
    '</p></div><p class="label">Experiment Title</p><p class="experiment">Derivative-Based Edge Detection</p><div class="cards"><div class="card"><span>Start Time:</span>' +
    formatTime(started) +
    '</div><div class="card"><span>End Time:</span>' +
    formatTime(completed) +
    '</div><div class="card"><span>Total Time Spent:</span>' +
    formatDuration(started, completed) +
    '</div><div class="card"><span>Completed Operations:</span>' +
    completedOperations +
    '/5</div></div></section><section class="section"><h2>Aim</h2><p>To study derivative-based edge detection by applying first-order and second-order derivative operators to digital images and observe the resulting edge information.</p><h2>Simulation Summary</h2><p>' +
    escapeHTML(buildSummary(results)) +
    "</p> </p><h2>Execution Order</h2><p>" +
    executionOrder +
    '</p></section><section class="section">' +
    sections +
    "</main></div></div></body></html>"
  );
}
export function hasDerivativeReportData() {
  return readReport().results.some(isCompleteResult);
}
export function appendDerivativeSimulation(entry) {
  if (!isCompleteResult(entry)) return null;
  const report = readReport();
  const result = {
    ...entry,
    input: cloneMatrix(entry.input),
    kernelX: cloneMatrix(entry.kernelX),
    kernelY: cloneMatrix(entry.kernelY),
    output: cloneMatrix(entry.output),
    updatedAt: entry.completedAt || new Date().toISOString(),
  };
  report.results = report.results.filter(
    (item) => item.operator !== result.operator,
  );
  report.results.push(result);
  const html = buildReport(report);
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(report));
    localStorage.setItem(REPORT_HTML_KEY, html);
    localStorage.setItem("progressreport.html", html);
    localStorage.setItem("vlab:simulation_report_html", html);
  } catch (error) {
    console.error("Could not save derivative report", error);
  }
  return result;
}
export function downloadDerivativeReport() {
  const html = buildReport(readReport());
  if (!html) return false;
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;left:-99999px;top:0;width:944px;height:1400px;border:0;";
  iframe.onload = () =>
    setTimeout(async () => {
      try {
        const win = iframe.contentWindow,
          doc = iframe.contentDocument,
          root = doc.getElementById("pdf-export-root");
        let waited = 0;
        while (
          (!root || !win.html2canvas || !(win.jspdf?.jsPDF || win.jsPDF)) &&
          waited < 5000
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          waited += 100;
        }
        if (!root || !win.html2canvas || !(win.jspdf?.jsPDF || win.jsPDF))
          throw new Error("PDF libraries did not load");
        const canvas = await win.html2canvas(root, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#fff",
            windowWidth: 944,
            windowHeight: root.scrollHeight,
          }),
          Pdf = win.jspdf?.jsPDF || win.jsPDF,
          pdf = new Pdf({ unit: "pt", format: "a4" }),
          margin = 10,
          width = pdf.internal.pageSize.getWidth() - 20,
          ratio = width / canvas.width,
          pageHeight = (pdf.internal.pageSize.getHeight() - 20) / ratio;
        for (let y = 0, first = true; y < canvas.height; ) {
          const slice = Math.min(pageHeight, canvas.height - y),
            part = doc.createElement("canvas");
          part.width = canvas.width;
          part.height = slice;
          part
            .getContext("2d")
            .drawImage(
              canvas,
              0,
              y,
              canvas.width,
              slice,
              0,
              0,
              canvas.width,
              slice,
            );
          if (!first) pdf.addPage();
          pdf.addImage(
            part.toDataURL("image/jpeg", 0.98),
            "JPEG",
            margin,
            margin,
            width,
            slice * ratio,
          );
          y += slice;
          first = false;
        }
        const url = URL.createObjectURL(pdf.output("blob")),
          link = document.createElement("a");
        link.href = url;
        link.download =
          "derivative_edge_detection_report_" + Date.now() + ".pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error("Could not download derivative report", error);
        window.alert(
          "Could not generate the PDF report. Please check your internet connection and try again.",
        );
      } finally {
        iframe.remove();
      }
    }, 1200);
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  return true;
}
