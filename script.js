/* ============================================================================
   Globals
   ============================================================================ */
let pendingFetches = 0;
let reloadTimerStarted = false;
let dynamicTimersStarted = false;

/* ============================================================================
   UTILITY: Safe element-ancestor finder
   - Walks up the DOM until it finds a node with `nodeName === tag` or reaches
     the root. Returns null if not found.
   ============================================================================ */
function findElementRecursive(el, tag) {
  tag = tag.toUpperCase();
  while (el) {
    if (el.nodeName === tag) return el;
    el = el.parentNode;
  }
  return null;
}

/* ============================================================================
   PROGRAMMATIC SORT (auto-sort a table column)
   - tableId: id of the table element
   - colIndex: column index to sort by
   - ascending: true => ascending, false => descending
   ============================================================================ */
function sortTableByColumn(tableId, colIndex, ascending = true) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const tbody = table.tBodies[0];
  if (!tbody) return;

  const rows = Array.from(tbody.rows);

  rows.sort((a, b) => {
    const x = parseFloat(a.cells[colIndex]?.dataset.seconds || "0");
    const y = parseFloat(b.cells[colIndex]?.dataset.seconds || "0");
    return ascending ? x - y : y - x;
  });

  tbody.innerHTML = "";
  rows.forEach(r => tbody.appendChild(r));
}

/* ============================================================================
   SORTABLE TABLE (header click handler)
   - Requires table to have class 'sortable'
   - Respects 'no-sort' on TH
   - Respects optional dataset attributes: data-sort, data-sort-alt,
     data-sort-col, data-sort-tbr
   - Keeps the original reversed comparator semantics
   ============================================================================ */
document.addEventListener("click", (e) => {
  try {
    const ASC_CLASS = "asc";
    const NO_SORT = "no-sort";
    const NULL_LAST = "n-last";
    const TABLE_CLASS = "sortable";

    const altKey = e.shiftKey || e.altKey;
    const th = findElementRecursive(e.target, "TH");
    if (!th) return;

    const tr = th.parentNode;
    const thead = tr?.parentNode;
    const table = thead?.parentNode;

    if (!thead || thead.nodeName !== "THEAD") return;
    if (!table || !table.classList.contains(TABLE_CLASS)) return;
    if (th.classList.contains(NO_SORT)) return;

    function getValue(cell) {
      const v = altKey ? cell.dataset.sortAlt : cell.dataset.sort;
      return v ?? cell.textContent.trim();
    }

    /* ---- Column index (allow dataset override) ---- */
    let colIndex;
    const cells = tr.cells;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === th) colIndex = Number(th.dataset.sortCol) || i;
      else cells[i].setAttribute("aria-sort", "none");
    }

    /* ---- Sort direction (toggle) ---- */
    let direction = "descending";
    const current = th.getAttribute("aria-sort");
    if (
      current === "descending" ||
      (table.classList.contains(ASC_CLASS) && current !== "ascending")
    ) {
      direction = "ascending";
    }
    th.setAttribute("aria-sort", direction);
    const reverse = direction === "ascending";

    const nullLastEnabled = table.classList.contains(NULL_LAST);

    /* ---- Comparator (keeps existing reversed getValue order) ----
       Note: x = getValue(b.cells[index]), y = getValue(a.cells[index])
       preserves previous behavior (reverse ordering inside the comparator).
    ------------------------------------------------------------------ */
    const compare = (a, b, index) => {
      const x = getValue(b.cells[index]);
      const y = getValue(a.cells[index]);

      if (nullLastEnabled) {
        if (x === "" && y !== "") return -1;
        if (y === "" && x !== "") return 1;
      }

      // numeric comparison if possible, otherwise localeCompare
      const num = +x - +y;
      const result = Number.isNaN(num) ? String(x).localeCompare(String(y)) : num;
      return reverse ? -result : result;
    };

    /* ---- Sort each TBODY (supports multiple TBODYs) ---- */
    for (let i = 0; i < table.tBodies.length; i++) {
      const oldBody = table.tBodies[i];
      const rows = Array.from(oldBody.rows);

      // Allow tie-breaker column (data-sort-tbr)
      const tbr = Number(th.dataset.sortTbr);
      rows.sort((a, b) => {
        const r = compare(a, b, colIndex);
        return r === 0 && !Number.isNaN(tbr) ? compare(a, b, tbr) : r;
      });

      const newBody = oldBody.cloneNode();
      newBody.append(...rows);
      table.replaceChild(newBody, oldBody);
    }
  } catch (err) {
    // keep failures visible during development but avoid breaking UI
    console.error("sortable click handler error:", err);
  }
});

/* ============================================================================
   FETCH WITH RETRY
   - returns parsed JSON or throws
   ============================================================================ */
function fetchWithRetry(url, options = {}, retries = 10, delay = 1000) {
  return fetch(url, options)
    .then(r => {
      if (!r.ok) throw new Error("Network error");
      return r.json();
    })
    .catch(err => {
      if (retries > 0) {
        return new Promise(res => setTimeout(res, delay))
          .then(() => fetchWithRetry(url, options, retries - 1, delay));
      }
      throw err;
    });
}

/* ============================================================================
   MAIN: Load time -> Teams -> Locations -> Task lists -> Reports
   - Combines BeingMeasured + ReadyToMeasure + Training variants
   ============================================================================ */
(function main() {
  // get reliable time first (keeps old behavior)
  fetchWithRetry('https://timeapi.io/api/Time/current/zone?timeZone=America/Los_Angeles')
  .then(timeData => {
    const ocTime = new Date(timeData.dateTime);


      // --- Teams ---
      return fetch('https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Team')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(teamData => ({
          ocTime,
          dictTeam: new Map(teamData.map(t => [t.teamId, t.name]))
        }));
    })
    .then(({ ocTime, dictTeam }) => {
      // --- Locations ---
      return fetch('https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Location')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(locationData => ({
          ocTime,
          dictTeam,
          dictLocation: new Map(locationData.map(l => [l.id, l.description]))
        }));
    })
    .then(({ ocTime, dictTeam, dictLocation }) => {
      /* ---------------------------------------------------------------------
         API endpoints (original strings preserved)
      --------------------------------------------------------------------- */
      const apiBMUrl =
        'https://api.cmh.platform-prod.evinternal.net/operations-center/api/TaskTrafficView/?type=16&value=beingmeasured&type=30&value=test&type=30&value=training&type=26&value=true&type=18&value=HQ&';

      const apiRTMUrl =
        'https://api.cmh.platform-prod.evinternal.net/operations-center/api/TaskTrafficView/?type=16&value=readytomeasure&type=30&value=test&type=30&value=training&type=26&value=true&type=18&value=HQ&type=15&value=null&';

      const apiTrainingRTM =
        'https://api.cmh.platform-prod.evinternal.net/operations-center/api/TaskTrafficView/?type=16&value=readytomeasure&type=29&value=test&type=29&value=training&type=26&value=true&type=18&value=HQ&type=15&value=null&';

      const apiTrainingBM =
        'https://api.cmh.platform-prod.evinternal.net/operations-center/api/TaskTrafficView/?type=16&value=beingmeasured&type=29&value=test&type=29&value=training&type=26&value=true&type=18&value=HQ&';

      let temp = "";
      let fileCount = 0;

      /* ==========================================================================
         Helper: process a list of items returned by TaskTrafficView
         - isRTM: ready-to-measure vs being-measured
         - isTraining: training flag
         ========================================================================== */
      function processList(apiData = [], isRTM = false, isTraining = false) {
        if (!Array.isArray(apiData)) return;

        apiData.forEach(item => {
          pendingFetches++; // start counting a full report chain
          fileCount++;

          // Fetch report
          fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Report/${item.reportID}`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(report => {
              const productName = report.isHipsterJob ? "Hipster" : item.primaryProductName;
              const pmText = report.pmReportID ? " [PM]" : "";

   // Fetch task state (original)
return fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/TaskState/id/${item.taskStateID}`)
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(task => {

    // --- NEW FETCH: TaskState by task.taskID ---
    return fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/TaskState/${task.taskID}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(task2 => {

        // detect rework in ANY field
        let isRework = JSON.stringify(task2).includes("Rework");

        return { report, productName, pmText, task, isRework };
      });
  });

            })
            .then(({ report, productName, pmText, task, isRework }) => {
  // Determine userID depending on RTM vs BM
  const userID = isRTM ? task.preferredUserID : task.userID;

  // Fetch user
  return fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/User/id?ids=${userID}`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(user => ({ report, productName, pmText, task, isRework, user }));
})
.then(({ report, productName, pmText, task, isRework, user }) => {
  // Fetch measurement items
  return fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Report/${item.reportID}/measurement-items`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(mItems => ({ report, productName, pmText, task, isRework, user, mItems }));
})
.then(({ report, productName, pmText, task, isRework, user, mItems }) => {
  // Build measurement items text
  const mText = (mItems.measurementItems || [])
    .map(m => "*" + (m.name || "").replace(/\s+/g, ''))
    .join("  ");

  temp += `
<tr>
<td>
  ${isRTM
    ? `Ready To Measure${isRework ? " (Rework)" : ""}`
    : `Being Measured${isRework ? " (Rework)" : ""}`}
</td>


  <td>${isTraining ? "Training" : "Live"}</td>
  <td>${item.reportID}</td>
  <td>${user[0]?.userName ?? ""}</td>
  <td>${user[0]?.techUsername ?? ""}</td>
  <td>${dictTeam.get(user[0]?.teamId) ?? ""}</td>
  <td>${dictLocation.get(user[0]?.locationId) ?? ""}</td>
  <td>${productName}</td>
  <td>${mText}${pmText}</td>
`;

              // Elapsed time (minutes -> seconds)
              const stateTime = new Date(task.stateTime);
              const minutes = (ocTime - stateTime) / 60000;
              const h = String(Math.abs(Math.floor(minutes / 60))).padStart(2, '0');
              const m = String(Math.abs(Math.floor(minutes % 60))).padStart(2, '0');
              const s = String(Math.abs(Math.floor(((minutes % 60) % 1) * 60))).padStart(2, '0');
              const elapsed = `${h}:${m}:${s}`;

              const isTrainingRow = isTraining;
              const elapsedSec = Math.floor(minutes * 60);

              // Color elapsed if >= 3 hours (10800s) and not training
              if (minutes >= 180 && !isTrainingRow) {
                temp += `<td class="elapsed" data-seconds="${elapsedSec}" style="color:red;">${elapsed}</td>`;
              } else {
                temp += `<td class="elapsed" data-seconds="${elapsedSec}">${elapsed}</td>`;
              }

              // Due time (minutes -> seconds, with color tiers)
              const due = (new Date(item.dueDate) - ocTime) / 60000;
              const dueSec = Math.floor(due * 60);
              const absSec = Math.abs(dueSec);
              const hd2 = String(Math.floor(absSec / 3600)).padStart(2, '0');
              const md2 = String(Math.floor((absSec % 3600) / 60)).padStart(2, '0');
              const sd2 = String(absSec % 60).padStart(2, '0');

              let dueColor = "";
              let dueDisplay = `${hd2}:${md2}:${sd2}`;

              if (dueSec < 0) {
                dueColor = "red";
                dueDisplay = `-${dueDisplay}`;
              } else if (dueSec < 3600) {
                dueColor = "red";
              } else if (dueSec < 7200) {
                dueColor = "orangered";
              } else if (dueSec < 10800) {
                dueColor = "DarkOrange";
              }

              temp += `
  <td class="due" data-seconds="${dueSec}" style="color:${dueColor};">
    ${dueDisplay}
  </td>
</tr>
`;

              // Inject to DOM
              document.getElementById('fileCount').innerHTML = `Reports (${fileCount})`;
              document.getElementById('data').innerHTML = temp;

              // apply filters and sort AFTER injecting this row set
              applyAllFilters();
initColumnVisibility("myTable");
              sortTableByColumn("myTable", 10, true);

              // End of this full report chain
              pendingFetches--;
              if (pendingFetches === 0) {
                startDynamicTimers();
                if (!reloadTimerStarted) startReloadTimer();
              }
            })
            .catch(err => {
              console.error("report chain error:", err);
              // ensure we decrement pendingFetches even on failure
              pendingFetches = Math.max(0, pendingFetches - 1);
            });
        });
      }

      /* ==========================================================================
         Run all APIs (BM, RTM, Training variants)
         ========================================================================== */
      fetch(apiBMUrl)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => processList(data, false))
        .catch(err => console.error("apiBMUrl error:", err));

      fetch(apiRTMUrl)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => processList(data, true))
        .catch(err => console.error("apiRTMUrl error:", err));

      fetch(apiTrainingBM)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => processList(data, false, true))
        .catch(err => console.error("apiTrainingBM error:", err));

      fetch(apiTrainingRTM)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => processList(data, true, true))
        .catch(err => console.error("apiTrainingRTM error:", err));
    })
    .catch(err => {
      console.error("initial main chain error:", err);
    });
})();

/* ============================================================================
   FILTERS / SEARCH
   - Single consolidated document-ready block (jQuery)
   ============================================================================ */
$(document).ready(function () {
  // Initialize controls
  $("#myInput").val("");
  applyAllFilters();

  // Bind filter events once
  $("#myInput").on("keyup", applyAllFilters);
  $("#defaultFilter").on("change", applyAllFilters);
  $("#chkLive").on("change", applyAllFilters);
  $("#chkTraining").on("change", applyAllFilters);
});

$(document).ready(function () {
  const liveKey = "chkLiveState";
  const trainingKey = "chkTrainingState";

  // Restore previous state from localStorage
  const savedLive = localStorage.getItem(liveKey);
  const savedTraining = localStorage.getItem(trainingKey);

  if (savedLive !== null) $("#chkLive").prop("checked", savedLive === "true");
  if (savedTraining !== null) $("#chkTraining").prop("checked", savedTraining === "true");

  // Save state on change
  $("#chkLive").on("change", function () {
    localStorage.setItem(liveKey, $(this).is(":checked"));
    applyAllFilters();
  });

  $("#chkTraining").on("change", function () {
    localStorage.setItem(trainingKey, $(this).is(":checked"));
    applyAllFilters();
  });
});


/* ============================================================================
   applyAllFilters()
   - searchValue: free text box
   - defaultValue: dropdown
   - showLive / showTraining: checkboxes
   - Updates visible count
   ============================================================================ */
function applyAllFilters() {
  const searchValue = (document.getElementById("myInput")?.value || "").trim().toLowerCase();
  const defaultValue = (document.getElementById("defaultFilter")?.value || "").trim().toLowerCase();
  const showLive = document.getElementById("chkLive")?.checked ?? false;
  const showTraining = document.getElementById("chkTraining")?.checked ?? false;

  $("#data tr").each(function () {
    const text = $(this).text().toLowerCase();

    // --- Filter 1: Search box (empty = match all)
    const matchSearch = searchValue === "" ? true : text.includes(searchValue);

    // --- Filter 2: Default dropdown (empty = match all, multiple OR values)
const matchDefault = defaultValue === ""
  ? true
  : defaultValue.split('|').some(val => text.includes(val.trim()));


    // --- Filter 3: Live / Training checkboxes
    const isLive = text.includes("live");
    const isTrainingRow = text.includes("training");

    const matchLiveTraining =
      (!showLive && !showTraining)
        ? true
        : ((isLive && showLive) || (isTrainingRow && showTraining));

    const show = matchSearch && matchDefault && matchLiveTraining;
    $(this).toggle(show);
  });

  // Update visible count
  const visibleCount = $("#data tr:visible").length;
  document.getElementById("fileCount").innerHTML = `Reports (${visibleCount})`;
}

/* ============================================================================
   DYNAMIC TIMERS
   - startDynamicTimers: starts elapsed and due countdowns (only once)
   ============================================================================ */
function startDynamicTimers() {
  if (dynamicTimersStarted) return;
  dynamicTimersStarted = true;

  // ELAPSED: increments elapsed seconds per .elapsed cell
  setInterval(() => {
    document.querySelectorAll('#data td.elapsed').forEach(td => {
      let sec = parseInt(td.dataset.seconds || "0", 10);
      sec++;
      td.dataset.seconds = sec;

      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');

      const row = td.closest("tr");
      const isTrainingRow = row && row.children[1]?.textContent.trim() === "Training";

      if (sec >= 10800 && !isTrainingRow) {
        td.style.color = "red";
      } else {
        td.style.color = "";
      }

      td.textContent = `${h}:${m}:${s}`;
    });
  }, 1000);

  // DUE: decrements due seconds per .due cell
  setInterval(() => {
    document.querySelectorAll('#data td.due').forEach(td => {
      let sec = parseInt(td.dataset.seconds || "0", 10);
      sec--;
      td.dataset.seconds = sec;

      const abs = Math.abs(sec);
      const h = abs >= 3600 ? String(Math.floor(abs / 3600)).padStart(2, '0') : "00";
      const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
      const s = String(abs % 60).padStart(2, '0');

      if (sec < 0) {
        td.style.color = "red";
        td.textContent = `-${h}:${m}:${s}`;
      } else if (sec < 3600) {
        td.style.color = "red";
        td.textContent = `${h}:${m}:${s}`;
      } else if (sec < 7200) {
        td.style.color = "orangered";
        td.textContent = `${h}:${m}:${s}`;
      } else if (sec < 10800) {
        td.style.color = "DarkOrange";
        td.textContent = `${h}:${m}:${s}`;
      } else {
        td.style.color = "";
        td.textContent = `${h}:${m}:${s}`;
      }
    });
  }, 1000);
}

/* ============================================================================
   PAGE RELOAD TIMER (visible countdown + auto reload)
   - starts only once; reload interval kept at 600s (10 minutes)
   ============================================================================ */
function startReloadTimer() {
  reloadTimerStarted = true;
  let reloadSeconds = 300; // 10 minutes

  setInterval(() => {
    reloadSeconds--;

    const m = String(Math.floor(reloadSeconds / 60)).padStart(2, "0");
    const s = String(reloadSeconds % 60).padStart(2, "0");

    const t = document.getElementById("reloadTimer");
    if (t) t.textContent = `Auto Reload in: ${m}:${s}`;

    if (reloadSeconds <= 0) {
      window.location.reload();
    }
  }, 1000);
}


/* ============================================================================
   COLUMN VISIBILITY (hide/show specific columns)
   - Persists state in localStorage
   - Hides TH + corresponding TDs
   ============================================================================ */

const COLUMN_VIS_KEY = "hiddenColumns_myTable";

/* Initialize column controls after headers exist */
function initColumnVisibility(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const thead = table.tHead;
  if (!thead) return;

  const headerRow = thead.rows[0];
  const controls = document.getElementById("columnControls");
  if (!controls) return;

  controls.innerHTML = "";

  const hiddenCols = getHiddenColumns();

  [...headerRow.cells].forEach((th, index) => {
    const colName = th.textContent.trim() || `Column ${index + 1}`;
    const id = `colToggle_${index}`;

    const label = document.createElement("label");
    label.style.marginRight = "10px";
    label.style.whiteSpace = "nowrap";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = !hiddenCols.includes(index);

    cb.addEventListener("change", () => {
      toggleColumn(tableId, index, !cb.checked);
    });

    label.appendChild(cb);
    label.append(` ${colName}`);
    controls.appendChild(label);

    // Apply persisted state
    if (hiddenCols.includes(index)) {
      applyColumnHidden(tableId, index, true);
    }
  });
}

/* Hide or show a column */
function toggleColumn(tableId, colIndex, hide) {
  applyColumnHidden(tableId, colIndex, hide);

  let hiddenCols = getHiddenColumns();
  if (hide && !hiddenCols.includes(colIndex)) hiddenCols.push(colIndex);
  if (!hide) hiddenCols = hiddenCols.filter(i => i !== colIndex);

  localStorage.setItem(COLUMN_VIS_KEY, JSON.stringify(hiddenCols));
}

/* Apply visibility to TH + all rows */
function applyColumnHidden(tableId, colIndex, hide) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const method = hide ? "add" : "remove";

  // Header
  table.tHead?.rows[0]?.cells[colIndex]?.classList[method]("hidden-column");

  // Body rows (supports multiple TBODYs)
  [...table.tBodies].forEach(tbody => {
    [...tbody.rows].forEach(row => {
      row.cells[colIndex]?.classList[method]("hidden-column");
    });
  });
}

/* Get persisted hidden columns */
function getHiddenColumns() {
  try {
    return JSON.parse(localStorage.getItem(COLUMN_VIS_KEY)) || [];
  } catch {
    return [];
  }
}

/* ============================================================================
   INITIALIZE COLUMN VISIBILITY
   ============================================================================ */
document.addEventListener("DOMContentLoaded", () => {
  initColumnVisibility("myTable");
});

