const IIT_LOGO_URL = new URL(
  "../../../assets/images/iitLogo.png",
  import.meta.url,
).href;
const VLABS_LOGO_URL = new URL(
  "../../../assets/images/vlabsLogo.png",
  import.meta.url,
).href;
const REPORT_KEY = "vlab_exp7_watershed_concept_report";

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
    return JSON.parse(localStorage.getItem(REPORT_KEY) || "{}");
  } catch {
    return {};
  }
}
function renderInput(matrix) {
  return (
    '<div class="matrix" style="grid-template-columns:repeat(' +
    matrix[0].length +
    ',24px)">' +
    matrix
      .flat()
      .map(
        (cell) => '<i class="' + (cell ? "one" : "zero") + '">' + cell + "</i>",
      )
      .join("") +
    "</div>"
  );
}
function boundaryClasses(matrix, row, col) {
  if (matrix[row][col] !== 1) return "";
  const isValley = (nextRow, nextColumn) =>
    nextRow < 0 ||
    nextRow >= matrix.length ||
    nextColumn < 0 ||
    nextColumn >= matrix[0].length ||
    matrix[nextRow][nextColumn] === 0;
  return [
    isValley(row - 1, col) && "boundary-top",
    isValley(row + 1, col) && "boundary-bottom",
    isValley(row, col - 1) && "boundary-left",
    isValley(row, col + 1) && "boundary-right",
  ]
    .filter(Boolean)
    .join(" ");
}
function renderOutput(matrix) {
  const cells = matrix
    .map((row, y) =>
      row
        .map((cell, x) => {
          const boundaries = boundaryClasses(matrix, y, x);
          return (
            '<i class="' +
            (cell ? "terrain " + boundaries : "water") +
            '">' +
            cell +
            "</i>"
          );
        })
        .join(""),
    )
    .join("");
  return (
    '<div class="matrix output-matrix" style="grid-template-columns:repeat(' +
    matrix[0].length +
    ',24px)">' +
    cells +
    '</div><div class="legend"><span><b class="terrain"></b>Elevated terrain</span><span><b class="water"></b>Flooded valley / catchment region</span><span><b class="boundary"></b>Watershed boundary</span></div>'
  );
}
function buildReport(data) {
  if (!data?.input || data.finalStep !== 2) return null;
  const name = escapeHTML(data.imageName || "Plus");
  const date = new Date(data.updatedAt || Date.now()).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" },
  );
  const css =
    "*{box-sizing:border-box}body{margin:0;background:#eef4fb;color:#1f2d3d;font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.65}#scale{width:944px;padding:30px 22px 44px}.page{max-width:900px;margin:auto;padding:26px 28px;background:#fff;border-radius:18px}h2,h3{margin-top:0;color:#243b53}h2{font-size:23px}h3{font-size:17px}p{font-size:15px}.header{display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:24px}.logo{width:78px;height:70px;object-fit:contain}.title{flex:1;text-align:center;border-bottom:3px solid #2f7bfa;padding-bottom:14px}.section{background:#f6f9fc;border:1px solid #e0e8f2;border-radius:14px;padding:22px 24px;margin-bottom:24px}.top{display:flex;justify-content:space-between;gap:14px}.badge,.stamp{margin:0;padding:8px 14px;border-radius:20px;font-size:13px;font-weight:600}.badge{background:#e8f1ff;color:#1f62d0}.stamp{background:#fff;border:1px solid #dce5ef;color:#50657c}.label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#60778f;font-weight:700}.experiment{font-size:25px;font-weight:700;color:#16324b;margin:0 0 18px}.cards,.results{display:flex;gap:12px;flex-wrap:wrap}.card,.result{flex:1 1 150px;background:#fff;border:1px solid #dde6f0;border-radius:14px;padding:14px}.card span{display:block;font-weight:600}.result{flex-basis:380px}.matrix{display:grid;gap:2px;width:max-content;border:1px solid #d1d5db;padding:8px;background:#f9fafb}.matrix i{display:flex;width:24px;height:24px;align-items:center;justify-content:center;border:1px solid #d1d5db;font-style:normal;font-size:11px;font-weight:700}.zero{background:#111827;color:#fff}.one{background:#fff;color:#111827}.terrain{background:#24a148;color:#fff}.water{background:#33ccff;color:#12324a}.output-matrix{gap:0}.output-matrix i{border:0}.boundary-top{border-top:3px solid #ef4444!important}.boundary-bottom{border-bottom:3px solid #ef4444!important}.boundary-left{border-left:3px solid #ef4444!important}.boundary-right{border-right:3px solid #ef4444!important}.legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;font-size:12px}.legend span{display:flex;align-items:center;gap:5px}.legend b{height:14px;width:14px;border:1px solid #16324b}.legend .boundary{background:#fff;box-shadow:inset 0 0 0 3px #ef4444}@media print{body{background:#fff}.page{border-radius:0}#scale{width:100%;padding:0}}";
  return (
    '<!doctype html><html><head><meta charset="UTF-8"><script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script><style>' +
    css +
    '</style></head><body><div id="scale"><div id="pdf-export-root"><main class="page"><div class="header"><img class="logo" src="' +
    IIT_LOGO_URL +
    '"><div class="title"><h2>Virtual Labs Simulation Report</h2></div><img class="logo" src="' +
    VLABS_LOGO_URL +
    '"></div><section class="section"><div class="top"><p class="badge">Image Processing Lab</p><p class="stamp">Generated on ' +
    date +
    '</p></div><p class="label">Experiment Title</p><p class="experiment">Watershed Concept Simulation</p><h2>Experiment Overview</h2><div class="cards"><div class="card"><span>Start Time:</span>' +
    formatTime(data.startedAt) +
    '</div><div class="card"><span>End Time:</span>' +
    formatTime(data.completedAt) +
    '</div><div class="card"><span>Total Time Spent:</span>' +
    formatDuration(data.startedAt, data.completedAt) +
    '</div></div></section><section class="section"><h2>Aim</h2><p>To understand the basic concept of watershed-based image segmentation by representing a binary image as a topographic surface and observing terrain formation, flooding of valleys, and the formation of watershed boundaries between different regions.</p><h2>Simulation Summary</h2><p>The Watershed Concept Simulation demonstrates image segmentation using a topographic interpretation of a binary image. The selected binary ' +
    name +
    ' image is represented as a terrain consisting of elevated regions and lower valleys. Water is then progressively introduced into the valleys, allowing the formation of distinct catchment regions. As flooding progresses, boundaries are established between neighboring regions, representing the watershed lines used to separate different image regions.</p></section><section class="section"><div class="results"><div class="result"><h2>Selected Binary Image/Input</h2><h3>' +
    name +
    " Binary Image (" +
    data.input.length +
    " × " +
    (data.input[0]?.length || 0) +
    ")</h3>" +
    renderInput(data.input) +
    '</div><div class="result"><h2>Final Simulation Output</h2><p>The final topographic terrain shows elevated regions, flooded valleys/catchment regions, and watershed boundaries.</p>' +
    renderOutput(data.input) +
    "</div></div></section></main></div></div></body></html>"
  );
}
export function hasWatershedReportData() {
  const data = readReport();
  return Boolean(data.input && data.finalStep === 2);
}
export function appendWatershedConceptSimulation(entry) {
  if (!entry?.input || entry.finalStep !== 2) return null;
  const data = {
    ...entry,
    input: entry.input.map((row) => [...row]),
    updatedAt: entry.completedAt || new Date().toISOString(),
  };
  const html = buildReport(data);
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(data));
    localStorage.setItem("vlab_exp7_watershed_concept_report_html", html);
    localStorage.setItem("progressreport.html", html);
    localStorage.setItem("vlab:simulation_report_html", html);
  } catch (error) {
    console.error("Could not save Watershed report", error);
  }
  return data;
}
export function downloadWatershedReport() {
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
          "watershed_concept_simulation_report_" + Date.now() + ".pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error("Could not download Watershed report", error);
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
