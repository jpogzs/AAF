/* ============================================================================
   PROGRAMMATIC SORT (AUTO SORT COLUMN)
   ============================================================================ */
function sortTableByColumn(tableId, colIndex, ascending = true) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const tbody = table.tBodies[0];
  if (!tbody) return;

  const rows = [...tbody.rows];

  rows.sort((a, b) => {
    const x = parseFloat(a.cells[colIndex].dataset.seconds || "0");
    const y = parseFloat(b.cells[colIndex].dataset.seconds || "0");
    return ascending ? x - y : y - x;
  });

  tbody.innerHTML = "";
  rows.forEach(r => tbody.appendChild(r));
}


/* ============================================================================
   SORTABLE TABLE
   ============================================================================ */
document.addEventListener("click", (e) => {
  try {
    const ascClass = "asc";
    const noSort = "no-sort";
    const nullLast = "n-last";
    const tableClass = "sortable";

    function findElementRecursive(el, tag) {
      return el.nodeName === tag
        ? el
        : findElementRecursive(el.parentNode, tag);
    }

    const alt = e.shiftKey || e.altKey;
    const th = findElementRecursive(e.target, "TH");
    const tr = th.parentNode;
    const thead = tr.parentNode;
    const table = thead.parentNode;

    function getValue(el) {
      const v = alt ? el.dataset.sortAlt : el.dataset.sort;
      return v ?? el.textContent;
    }

    if (
      thead.nodeName !== "THEAD" ||
      !table.classList.contains(tableClass) ||
      th.classList.contains(noSort)
    )
      return;

    /* ---- Column Index ---- */
    let colIndex;
    let tbr = +th.dataset.sortTbr;
    const cells = tr.cells;

    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === th) colIndex = +th.dataset.sortCol || i;
      else cells[i].setAttribute("aria-sort", "none");
    }

    /* ---- Sort Direction ---- */
    let direction = "descending";
    if (
      th.getAttribute("aria-sort") === "descending" ||
      (table.classList.contains(ascClass) &&
        th.getAttribute("aria-sort") !== "ascending")
    ) {
      direction = "ascending";
    }
    th.setAttribute("aria-sort", direction);

    const reverse = direction === "ascending";
    const nullLastEnabled = table.classList.contains(nullLast);

    /* ---- Comparator ---- */
    const compare = (a, b, index) => {
      const x = getValue(b.cells[index]);
      const y = getValue(a.cells[index]);

      if (nullLastEnabled) {
        if (x === "" && y !== "") return -1;
        if (y === "" && x !== "") return 1;
      }

      const num = +x - +y;
      const result = isNaN(num) ? x.localeCompare(y) : num;
      return reverse ? -result : result;
    };

    /* ---- Sort TBODY ---- */
    for (let i = 0; i < table.tBodies.length; i++) {
      const oldBody = table.tBodies[i];
      const rows = [...oldBody.rows];

      rows.sort((a, b) => {
        const r = compare(a, b, colIndex);
        return r === 0 && !isNaN(tbr) ? compare(a, b, tbr) : r;
      });

      const newBody = oldBody.cloneNode();
      newBody.append(...rows);
      table.replaceChild(newBody, oldBody);
    }
  } catch {}
});


/* ============================================================================
   FETCH HELPERS
   ============================================================================ */
function fetchWithRetry(url, options = {}, retries = 10, delay = 1000) {
  return fetch(url, options)
    .then(r => {
      if (!r.ok) throw new Error('Network error');
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
   MAIN POGI SCRIPT (Load Time → Teams → Task Data → Reports)
   COMBINED: BeingMeasured + ReadyToMeasure
   ============================================================================ */

fetchWithRetry('https://worldtimeapi.org/api/timezone/PST8PDT')
  .then(timeData => {
    const ocTime = new Date(timeData.datetime.split('.')[0] + '.000');

    // --- FETCH TEAM DATA ---
    return fetch('https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Team')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(teamData => ({
        ocTime,
        dictTeam: new Map(teamData.map(t => [t.teamId, t.name]))
      }));
  })
  .then(({ ocTime, dictTeam }) => {

    // --- FETCH LOCATION DATA ---
    return fetch('https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Location')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(locationData => ({
        ocTime,
        dictTeam,
        dictLocation: new Map(locationData.map(l => [l.id, l.description]))
      }));
  })
  .then(({ ocTime, dictTeam, dictLocation }) => {

    /* -----------------------------
       BOTH API URLs
    -------------------------------*/
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

    /* ============================================================================
       FUNCTION TO PROCESS ANY API LIST
    ============================================================================ */
    function processList(apiData, isRTM = false, isTraining = false) {
      apiData.forEach(item => {
        fileCount++;

        fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Report/${item.reportID}`)
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(report => {

            const productName = report.isHipsterJob ? "Hipster" : item.primaryProductName;
            const pmText = report.pmReportID ? " [PM]" : "";

            /* ---- Fetch TaskState ---- */
            fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/TaskState/id/${item.taskStateID}`)
              .then(r => r.ok ? r.json() : Promise.reject())
              .then(task => {

                /* ---- Fetch User ---- */
                const userID = isRTM ? task.preferredUserID : task.userID;

                fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/User/id?ids=${userID}`)
                  .then(r => r.ok ? r.json() : Promise.reject())
                  .then(user => {

                    /* ---- Fetch Measurement Items ---- */
                    fetch(`https://api.cmh.platform-prod2.evinternal.net/operations-center/api/Report/${item.reportID}/measurement-items`)
                      .then(r => r.ok ? r.json() : Promise.reject())
                      .then(mItems => {

                        const mText = mItems.measurementItems
                          .map(m => "*" + m.name.replace(' ', ''))
                          .join("  ");

                        /* ============================================================================
                           TABLE ROW
                        ============================================================================ */
                        temp += `
                          <tr>
                            <td>${isRTM ? "Ready To Measure" : "Being Measured"}</td>
                            <td>${isTraining ? "Training" : "Live"}</td>
                            <td>${item.reportID}</td>
                            <td>${user[0].userName}</td>
                            <td>${user[0].techUsername}</td>
                            <td>${dictTeam.get(user[0].teamId)}</td>
                            <td>${dictLocation.get(user[0].locationId)}</td>
                            <td>${productName}</td>
                            <td>${mText}${pmText}</td>
                        `;

                        /* ---- Elapsed Time ---- */
                        const stateTime = new Date(task.stateTime);
                        const minutes = (ocTime - stateTime) / 60000;

                        const h = String(Math.abs(Math.floor(minutes / 60))).padStart(2, '0');
                        const m = String(Math.abs(Math.floor(minutes % 60))).padStart(2, '0');
                        const s = String(Math.abs(Math.floor(((minutes % 60) % 1) * 60))).padStart(2, '0');
                        const elapsed = `${h}:${m}:${s}`;

const isTrainingRow = isTraining;   // already passed into processList()

temp += (minutes >= 180 && !isTrainingRow)
  ? `<td class="elapsed" data-seconds="${Math.floor(minutes * 60)}" style="color:red;">${elapsed}</td>`
  : `<td class="elapsed" data-seconds="${Math.floor(minutes * 60)}">${elapsed}</td>`;


                        /* ---- Due Time ---- */
                        const due = (new Date(item.dueDate) - ocTime) / 60000;

                        const hd = String(Math.abs(Math.floor(due / 60))).padStart(2, '0');
                        const md = String(Math.abs(Math.floor(due % 60))).padStart(2, '0');
                        const sd = String(Math.abs(Math.floor(((due % 60) % 1) * 60))).padStart(2, '0');
                        const dueText = `${hd}:${md}:${sd}`;

                        temp += due < 0
                          ? `<td class="due" data-seconds="${Math.floor(due * 60)}" style="color:red;">-${dueText}</td>`
                          : `<td class="due" data-seconds="${Math.floor(due * 60)}">${dueText}</td>`;

                        temp += `</tr>`;

                        /* ---- Inject ---- */
                        document.getElementById('fileCount').innerHTML = `Reports (${fileCount})`;
                        document.getElementById('data').innerHTML = temp;

applyAllFilters();
// Auto-sort by the "Due In" column (ascending)
sortTableByColumn("myTable", 10, true);
                      });
                  });
              });
          });
      });
    }

    /* ============================================================================
       RUN BOTH APIs
    ============================================================================ */
    fetch(apiBMUrl)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => processList(data, false));

    fetch(apiRTMUrl)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => processList(data, true));

// TRAINING BM
fetch(apiTrainingBM)
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(data => processList(data, false, true));

// TRAINING RTM
fetch(apiTrainingRTM)
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(data => processList(data, true, true));


  });



/* ============================================================================
   SEARCH FILTER (Default = "")
   ============================================================================ */
$(document).ready(function () {

  $("#myInput").val("");

  const value = "";
  $("#data tr").filter(function () {
    $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
  });

$("#myInput").on("keyup", applyAllFilters);

});



function applyAllFilters() {
  const searchValue = document.getElementById("myInput").value.trim().toLowerCase();
  const defaultValue = document.getElementById("defaultFilter").value.trim().toLowerCase();
  const showLive = document.getElementById("chkLive").checked;
  const showTraining = document.getElementById("chkTraining").checked;

  $("#data tr").each(function () {
    const text = $(this).text().toLowerCase();

    // --- Filter 1: Search box (empty = match all)
    const matchSearch = searchValue === "" ? true : text.includes(searchValue);

    // --- Filter 2: Default dropdown (empty = match all)
    const matchDefault = defaultValue === "" ? true : text.includes(defaultValue);

    // --- Filter 3: Live / Training checkboxes
    const isLive = text.includes("live");
    const isTrainingRow = text.includes("training");

    // If neither checkbox is checked, allow all rows to pass this filter.
    // Otherwise, pass if the row is Live and showLive is checked OR the row is Training and showTraining is checked.
    const matchLiveTraining =
      (!showLive && !showTraining)
        ? true
        : ((isLive && showLive) || (isTrainingRow && showTraining));

    // --- Final decision: stack ALL filters
    const show = matchSearch && matchDefault && matchLiveTraining;
    $(this).toggle(show);
  });

  // Update visible count
  const visibleCount = $("#data tr:visible").length;
  document.getElementById("fileCount").innerHTML = `Reports (${visibleCount})`;
}



/* ============================================================================
   DYNAMIC ELAPSED TIME UPDATE
   ============================================================================ */
setInterval(() => {
  document.querySelectorAll('#data td.elapsed').forEach(td => {

    let sec = parseInt(td.dataset.seconds, 10);
    sec++;
    td.dataset.seconds = sec;

    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');

    // Detect if this row is Training
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


/* ============================================================================
   DYNAMIC DUE-IN COUNTDOWN
   ============================================================================ */
setInterval(() => {
  document.querySelectorAll('#data td.due').forEach(td => {

    let sec = parseInt(td.dataset.seconds, 10);
    sec--;
    td.dataset.seconds = sec;

    const abs = Math.abs(sec);

    const h = abs >= 3600 ? String(Math.floor(abs / 3600)).padStart(2, '0') : "00";
    const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
    const s = String(abs % 60).padStart(2, '0');


if (sec < 0) {
    // due file → negative
    td.style.color = "red";

    td.textContent = `-${h}:${m}:${s}`;
}
else if (sec < 3600) {
    // less than 1 hour → RED
    td.style.color = "red";
    td.textContent = `${h}:${m}:${s}`;
} 
else if (sec < 7200) {
    // less than 2 hours → ORANGE
    td.style.color = "orangered";
    td.textContent = `${h}:${m}:${s}`;
}
else if (sec < 10800) {
    // less than 3 hours → YELLOW
    td.style.color = "DarkOrange"; // 'yellow' also works, gold looks better
    td.textContent = `${h}:${m}:${s}`;
}
else {
    // normal
    td.style.color = "";
    td.textContent = `${h}:${m}:${s}`;
}
  });
}, 1000);

/* ============================================================================
   PAGE RELOAD TIMER (Visible Countdown + Auto Reload)
   ============================================================================ */

let reloadSeconds = 600; // 10 minutes

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


$(document).ready(function () {
  // Initialize defaults
  $("#myInput").val("");

  // Bind filters once
  $("#myInput").on("keyup", applyAllFilters);
  $("#defaultFilter").on("change", applyAllFilters);
  $("#chkLive").on("change", applyAllFilters);
  $("#chkTraining").on("change", applyAllFilters);

  // (Optional) Initial run so the count is correct on load
  applyAllFilters();
});
