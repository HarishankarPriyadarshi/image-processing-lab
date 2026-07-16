(function initHoverDefinitions() {
  function setup() {
    if (document.querySelector(".hover-tooltip")) return;
    if (!document.body) return;

    const tooltipLayer = document.createElement("div");
    tooltipLayer.className = "hover-tooltip";
    tooltipLayer.innerHTML =
      '<div class="hover-tooltip__body"><div class="hover-tooltip__accent"></div><div class="hover-tooltip__text"></div></div>';
      const tooltipText = tooltipLayer.querySelector(".hover-tooltip__text");
      document.body.appendChild(tooltipLayer);

      const tooltips = [
        {
          id: "mcb",
          selector: ".mcb-toggle, .mcb-block img",
          text: "Purpose: To ensure the safety of equipment and users by tripping during electrical faults."
        },
        {
          id: "starter",
          selector: ".starter-body, .starter-handle",
        text: "Purpose: Limits the starting current of a DC motor by using external armature resistance, which is cut out as the motor speeds up, and provides overload and no-voltage protection. \n\n Ratings: Voltage - 220V DC, 7.5 HP"
      },
      {
        id: "lamp-load",
        selector: ".lamp-bulb",
        text: "Purpose: It helps in observing how the terminal voltage varies with the load current. \n\n Ratings: 2 kW (Each bulb has a rating of 200 W)."
      },
      {
        id: "ammeter-1",
        selector: ".meter-card:nth-of-type(1) > img",
        text: "Purpose: To measure the current drawn by the DC shunt motor during operation."
      },
      {
        id: "voltmeter-1",
        selector: ".meter-card:nth-of-type(2) > img",
        text: "Purpose:  To measure the voltage of the main supply."
      },
      {
        id: "ammeter-2",
        selector: ".meter-card:nth-of-type(3) > img",
        text: "Purpose:  To measure the load current (IL) delivered by the DC shunt generator."
      },
      {
        id: "voltmeter-2",
        selector: ".meter-card:nth-of-type(4) > img",
        text: "Purpose: It is connected in parallel across the generator terminals to measure the terminal voltage (V) of the DC shunt generator."
      },
       {
        id: "dc-motor",
        selector: ".motor-box > img",
        text: "Purpose: It acts as a prime mover, converting electrical energy into mechanical energy to drive the DC shunt generator. \n\n Ratings: 5HP, Voltage - 220 V DC, Max. Current - 19 A, Speed - 1500 RPM Winding Type - Shunt"
      },
      {
        id: "coupler",
        selector: ".coupler > img",
        text: "Purpose: The shaft is used to mechanically couple the DC shunt motor with the DC shunt generator."
      },
      {
        id: "dc-generator",
        selector: ".generator-body, .generator-rotor",
        text: "Purpose: It converts the mechanical energy received from the motor into electrical energy and supplies power to the load for studying the load characteristics of a DC shunt generator. \n\n Ratings:  3 kW, Voltage - 220 V DC, Max. Current - 13.6 A, Speed - 1500 RPM" 
      },
      // {
      //   id: "output-graph",
      //   selector: ".graph-section, #graphPlot, #graphBars",
      //   text: "Output Graph: Plots terminal voltage (V) versus load current (A) using the readings you add to the table."
      // },
      // {
      //   id: "instructions",
      //   selector: ".instructions-wrapper, .instructions-btn, .instructions-panel, #instructionModal",
      //   text: "Instructions: Shows the required wiring sequence and the steps to run the experiment."
      // },
      // {
      //   id: "controls",
      //   selector: "#pill-stack",
      //   text: "Controls: Use these buttons to run the simulation (Speaking, Check, Auto Connect, Add To Table, Reset)."
      // }
    ];

    tooltips.forEach(({ selector }) => {
      document.querySelectorAll(selector).forEach((el) => el.removeAttribute("title"));
    });

    let activeTarget = null;

    function findEntry(target) {
      if (!target || target.nodeType !== 1) return null;
      for (const entry of tooltips) {
        const match = target.closest(entry.selector);
        if (match) return { match, text: entry.text, id: entry.id };
      }
      return null;
    }

    function moveTip(event) {
      const padding = 16;
      const offsetX = 14;
      const offsetY = 14;

      const maxLeft = window.innerWidth - tooltipLayer.offsetWidth - padding;
      const maxTop = window.innerHeight - tooltipLayer.offsetHeight - padding;

      const desiredLeft = event.clientX + offsetX;
      const desiredTop = event.clientY + offsetY;

      tooltipLayer.style.left = Math.max(padding, Math.min(desiredLeft, maxLeft)) + "px";
      tooltipLayer.style.top = Math.max(padding, Math.min(desiredTop, maxTop)) + "px";
    }

    function showTip(text, event) {
      if (!tooltipText) return;
      tooltipText.textContent = text;
      moveTip(event);
      tooltipLayer.classList.add("show");
    }

    function hideTip() {
      tooltipLayer.classList.remove("show");
    }

      function attachLeaveHandler(target) {
        target.addEventListener(
          "mouseleave",
          () => {
            if (activeTarget === target) {
              activeTarget = null;
              hideTip();
            }
          },
          { once: true }
        );
      }

      // Ensure MCB definition shows when its image is clicked.
      const mcbImage = document.querySelector(".mcb-toggle");
      if (mcbImage) {
        mcbImage.addEventListener("click", function (event) {
          const entry = tooltips.find(t => t.id === "mcb");
          if (!entry) return;
          if (activeTarget === mcbImage) {
            activeTarget = null;
            hideTip();
            return;
          }
          activeTarget = mcbImage;
          showTip(entry.text, event);
          attachLeaveHandler(mcbImage);
        });
      }

      document.addEventListener("click", function (event) {
        const searchTarget = event.target.closest("img") || event.target;
        const found = findEntry(searchTarget);
        if (!found || !found.match) {
          if (activeTarget) {
            activeTarget = null;
            hideTip();
          }
          return;
        }
        // Ensure we attach to the actual image element for leave handling.
        if (found.id === "mcb" && found.match.tagName !== "IMG") {
          const mcbImgEl = document.querySelector(".mcb-toggle");
          if (mcbImgEl) found.match = mcbImgEl;
        }
        if (found.match.tagName !== "IMG") {
          if (activeTarget) {
            activeTarget = null;
            hideTip();
          }
          return;
        }
        if (activeTarget === found.match) {
          activeTarget = null;
          hideTip();
          return;
        }
        activeTarget = found.match;
        showTip(found.text, event);
        attachLeaveHandler(activeTarget);
      });

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          activeTarget = null;
          hideTip();
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }
})();
