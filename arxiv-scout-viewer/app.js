(() => {
  "use strict";

  const COLUMN_DEFINITIONS = {
    score: { label: "Score", sortable: true },
    band: { label: "Band", sortable: true },
    title: { label: "Title", sortable: true },
    concepts: { label: "Matched concepts", sortable: false },
    categories: { label: "Categories", sortable: false },
    published: { label: "Published", sortable: true },
    arxiv_id: { label: "arXiv", sortable: true },
    match_count: { label: "Match count", sortable: true },
    matched_terms: { label: "Matched terms", sortable: false },
    interest_points: { label: "Interest points", sortable: true },
    negative_points: { label: "Negative points", sortable: true },
    match_kinds: { label: "Match kinds", sortable: false },
    assessment: { label: "My assessment", sortable: true },
    url: { label: "URL", sortable: false }
  };

  const DEFAULT_COLUMNS = ["score", "band", "title", "concepts", "categories", "published", "arxiv_id"];
  const ALL_BANDS = ["HIGH", "LEAD", "WEAK", "NONE"];

  const state = {
    fileName: null,
    run: null,
    results: [],
    filteredResults: [],
    evaluations: {},
    selectedResultId: null,
    filters: {
      search: "",
      bands: new Set(ALL_BANDS),
      scoreMode: "all",
      concept: "all",
      category: "all",
      assessment: "all"
    },
    sort: { field: "score", direction: "desc" },
    columns: [...DEFAULT_COLUMNS],
    columnOrder: Object.keys(COLUMN_DEFINITIONS),
    page: 1,
    pageSize: 50
  };

  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "uploadButton", "fileInput", "dropZone", "errorBanner", "workspace", "runId", "schemaBadge", "runMeta",
      "summaryGrid", "searchInput", "columnsButton", "filtersButton", "exportButton", "resetButton", "bandTabs",
      "activeFilterCount", "resultSummary", "pageSizeSelect", "resultsTable", "tableHead", "tableBody", "previousPage",
      "nextPage", "pageStatus", "drawerBackdrop", "detailDrawer", "detailTitle", "drawerBody", "closeDrawerButton",
      "columnsDialog", "columnList", "selectDefaultColumns", "selectAllColumns", "filtersDialog", "scoreModeFilter",
      "conceptFilter", "categoryFilter", "assessmentFilter", "clearAdvancedFilters", "runDetailsButton", "runDetailsDialog",
      "runDetailsBody", "statisticsButton", "statisticsDialog", "statisticsBody", "exportDialog", "exportFilteredButton",
      "exportEvaluationsButton"
    ].forEach(id => el[id] = document.getElementById(id));

    el.uploadButton.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", event => {
      const [file] = event.target.files;
      if (file) loadFile(file);
      event.target.value = "";
    });

    ["dragenter", "dragover"].forEach(name => el.dropZone.addEventListener(name, event => {
      event.preventDefault();
      el.dropZone.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach(name => el.dropZone.addEventListener(name, event => {
      event.preventDefault();
      el.dropZone.classList.remove("dragging");
    }));
    el.dropZone.addEventListener("drop", event => {
      const [file] = event.dataTransfer.files;
      if (file) loadFile(file);
    });

    el.searchInput.addEventListener("input", event => {
      state.filters.search = event.target.value.trim().toLowerCase();
      state.page = 1;
      applyFiltersAndRender();
    });

    el.pageSizeSelect.addEventListener("change", event => {
      state.pageSize = Number(event.target.value);
      state.page = 1;
      renderTable();
    });

    el.previousPage.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
      }
    });
    el.nextPage.addEventListener("click", () => {
      if (state.page < totalPages()) {
        state.page += 1;
        renderTable();
      }
    });

    el.columnsButton.addEventListener("click", () => {
      renderColumnDialog();
      el.columnsDialog.showModal();
    });
    el.filtersButton.addEventListener("click", () => el.filtersDialog.showModal());
    el.exportButton.addEventListener("click", () => el.exportDialog.showModal());
    el.runDetailsButton.addEventListener("click", () => {
      renderRunDetails();
      el.runDetailsDialog.showModal();
    });
    el.statisticsButton.addEventListener("click", () => {
      renderStatistics();
      el.statisticsDialog.showModal();
    });

    el.selectDefaultColumns.addEventListener("click", () => {
      state.columns = [...DEFAULT_COLUMNS];
      renderColumnDialog();
      renderTable();
      saveViewerPreferences();
    });
    el.selectAllColumns.addEventListener("click", () => {
      state.columns = [...state.columnOrder];
      renderColumnDialog();
      renderTable();
      saveViewerPreferences();
    });

    [el.scoreModeFilter, el.conceptFilter, el.categoryFilter, el.assessmentFilter].forEach(control => {
      control.addEventListener("change", () => {
        state.filters.scoreMode = el.scoreModeFilter.value;
        state.filters.concept = el.conceptFilter.value;
        state.filters.category = el.categoryFilter.value;
        state.filters.assessment = el.assessmentFilter.value;
        state.page = 1;
        applyFiltersAndRender();
      });
    });

    el.clearAdvancedFilters.addEventListener("click", () => {
      state.filters.scoreMode = "all";
      state.filters.concept = "all";
      state.filters.category = "all";
      state.filters.assessment = "all";
      syncFilterControls();
      state.page = 1;
      applyFiltersAndRender();
    });

    el.resetButton.addEventListener("click", resetView);
    el.closeDrawerButton.addEventListener("click", closeDrawer);
    el.drawerBackdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && el.detailDrawer.classList.contains("open")) closeDrawer();
    });

    el.exportFilteredButton.addEventListener("click", exportFilteredResults);
    el.exportEvaluationsButton.addEventListener("click", exportEvaluations);
  }

  async function loadFile(file) {
    clearError();
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      showError("Please choose a .json file.");
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = validateRun(parsed);
      if (!validation.valid) throw new Error(validation.message);

      state.fileName = file.name;
      state.run = parsed;
      state.results = parsed.results.map(normalizeResult);
      state.evaluations = loadEvaluations(parsed.run_id);
      state.selectedResultId = null;
      state.page = 1;
      restoreViewerPreferences();
      resetFiltersOnly();

      populateDynamicFilters();
      renderRunSummary();
      renderBandTabs();
      applyFiltersAndRender();

      el.workspace.classList.remove("hidden");
      el.dropZone.classList.add("hidden");
    } catch (error) {
      showError(`Could not load this file: ${error.message}`);
    }
  }

  function validateRun(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return invalid("Top-level JSON must be an object.");
    if (!("schema_version" in data)) return invalid("Missing schema_version.");
    if (!data.run_id) return invalid("Missing run_id.");
    if (!Array.isArray(data.results)) return invalid("Expected a results array.");
    if (!data.counts || typeof data.counts !== "object") return invalid("Missing counts object.");

    const badRecord = data.results.findIndex(record => !record || typeof record !== "object" || !record.arxiv_id || !record.title);
    if (badRecord !== -1) return invalid(`Result ${badRecord + 1} is missing an arxiv_id or title.`);

    return { valid: true };
  }

  function invalid(message) { return { valid: false, message }; }

  function normalizeResult(result) {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const interestPoints = matches.filter(m => m.kind !== "negative").reduce((sum, m) => sum + Number(m.points || 0), 0);
    const negativePoints = matches.filter(m => m.kind === "negative" || Number(m.points || 0) < 0).reduce((sum, m) => sum + Number(m.points || 0), 0);
    return {
      ...result,
      categories: Array.isArray(result.categories) ? result.categories : [],
      matches,
      score: Number(result.score || 0),
      band: String(result.band || "NONE").toUpperCase(),
      _derived: {
        concepts: unique(matches.map(m => m.concept).filter(Boolean)),
        terms: unique(matches.map(m => m.term).filter(Boolean)),
        kinds: unique(matches.map(m => m.kind).filter(Boolean)),
        matchCount: matches.length,
        interestPoints,
        negativePoints
      }
    };
  }

  function renderRunSummary() {
    const run = state.run;
    el.runId.textContent = run.run_id;
    el.schemaBadge.textContent = `schema v${run.schema_version}`;

    const created = formatDateTime(run.created_at);
    const source = run.source || "unknown source";
    const cats = run.parameters?.categories?.join(" · ") || "No categories supplied";
    el.runMeta.textContent = `${state.fileName} · ${source} · ${cats} · ${created}`;

    const counts = run.counts || {};
    const items = [
      ["Retrieved", counts.retrieved ?? state.results.length],
      ["Positive", counts.positive_score ?? state.results.filter(r => r.score > 0).length],
      ["HIGH", counts.high ?? countBand("HIGH")],
      ["LEAD", counts.lead ?? countBand("LEAD")],
      ["WEAK", counts.weak ?? countBand("WEAK")],
      ["Nonpositive", counts.nonpositive ?? state.results.filter(r => r.score <= 0).length]
    ];
    el.summaryGrid.innerHTML = items.map(([label, value]) => `
      <div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>
    `).join("");
  }

  function renderBandTabs() {
    const tabs = [{ label: "All", value: "ALL", count: state.results.length }]
      .concat(ALL_BANDS.map(band => ({ label: band, value: band, count: countBand(band) })));

    el.bandTabs.innerHTML = tabs.map(tab => {
      const active = tab.value === "ALL"
        ? state.filters.bands.size === ALL_BANDS.length
        : state.filters.bands.size === 1 && state.filters.bands.has(tab.value);
      return `<button class="band-tab ${active ? "active" : ""}" type="button" data-band="${tab.value}">${tab.label} ${tab.count}</button>`;
    }).join("");

    el.bandTabs.querySelectorAll("[data-band]").forEach(button => {
      button.addEventListener("click", () => {
        const band = button.dataset.band;
        state.filters.bands = band === "ALL" ? new Set(ALL_BANDS) : new Set([band]);
        state.page = 1;
        renderBandTabs();
        applyFiltersAndRender();
      });
    });
  }

  function populateDynamicFilters() {
    const concepts = unique(state.results.flatMap(r => r._derived.concepts)).sort(localeCompare);
    const categories = unique(state.results.flatMap(r => r.categories)).sort(localeCompare);

    fillSelect(el.conceptFilter, "All concepts", concepts);
    fillSelect(el.categoryFilter, "All categories", categories);
    syncFilterControls();
  }

  function fillSelect(select, allLabel, values) {
    select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(prettyToken(value))}</option>`).join("");
  }

  function applyFiltersAndRender() {
    const search = state.filters.search;
    state.filteredResults = state.results.filter(result => {
      if (!state.filters.bands.has(result.band)) return false;
      if (state.filters.scoreMode === "positive" && result.score <= 0) return false;
      if (state.filters.scoreMode === "zero" && result.score !== 0) return false;
      if (state.filters.scoreMode === "negative" && result.score >= 0) return false;
      if (state.filters.concept !== "all" && !result._derived.concepts.includes(state.filters.concept)) return false;
      if (state.filters.category !== "all" && !result.categories.includes(state.filters.category)) return false;

      const assessment = state.evaluations[result.arxiv_id]?.assessment || "unreviewed";
      if (state.filters.assessment !== "all" && assessment !== state.filters.assessment) return false;

      if (search) {
        const haystack = [
          result.title,
          result.arxiv_id,
          ...result.categories,
          ...result._derived.concepts,
          ...result._derived.terms
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    sortFilteredResults();
    const pages = totalPages();
    if (state.page > pages) state.page = Math.max(1, pages);
    updateActiveFilterCount();
    renderTable();
  }

  function sortFilteredResults() {
    const { field, direction } = state.sort;
    const factor = direction === "asc" ? 1 : -1;
    state.filteredResults.sort((a, b) => compareValues(columnValue(a, field), columnValue(b, field)) * factor);
  }

  function renderTable() {
    renderTableHead();
    const start = (state.page - 1) * state.pageSize;
    const pageResults = state.filteredResults.slice(start, start + state.pageSize);

    if (!pageResults.length) {
      el.tableBody.innerHTML = `<tr><td class="empty-state" colspan="${state.columns.length}">No results match the current filters.</td></tr>`;
    } else {
      el.tableBody.innerHTML = pageResults.map(result => `
        <tr class="result-row" data-id="${escapeAttr(result.arxiv_id)}">
          ${state.columns.map(column => `<td class="${column === "title" ? "title-cell" : ""}">${renderCell(result, column)}</td>`).join("")}
        </tr>
      `).join("");

      el.tableBody.querySelectorAll("tr.result-row").forEach(row => {
        row.addEventListener("click", event => {
          if (event.target.closest("a,button,input,label")) return;
          openDrawer(row.dataset.id);
        });
      });
    }

    const end = Math.min(start + state.pageSize, state.filteredResults.length);
    el.resultSummary.textContent = state.filteredResults.length
      ? `Showing ${start + 1}–${end} of ${state.filteredResults.length} results (${state.results.length} in run)`
      : `0 of ${state.results.length} results`;

    const pages = totalPages();
    el.pageStatus.textContent = `Page ${Math.min(state.page, pages)} of ${pages}`;
    el.previousPage.disabled = state.page <= 1;
    el.nextPage.disabled = state.page >= pages;
  }

  function renderTableHead() {
    el.tableHead.innerHTML = `<tr>${state.columns.map(column => {
      const def = COLUMN_DEFINITIONS[column];
      const sortableClass = def.sortable ? "sortable" : "";
      const marker = state.sort.field === column ? (state.sort.direction === "asc" ? " ↑" : " ↓") : "";
      return `<th class="${sortableClass}" data-column="${column}" scope="col">${escapeHtml(def.label)}${marker}</th>`;
    }).join("")}</tr>`;

    el.tableHead.querySelectorAll("th.sortable").forEach(header => {
      header.addEventListener("click", () => {
        const field = header.dataset.column;
        if (state.sort.field === field) state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        else state.sort = { field, direction: field === "score" ? "desc" : "asc" };
        applyFiltersAndRender();
      });
    });
  }

  function renderCell(result, column) {
    switch (column) {
      case "score": return renderScore(result.score);
      case "band": return renderBand(result.band);
      case "title": return escapeHtml(result.title);
      case "concepts": return renderChips(result._derived.concepts.map(prettyToken), "—");
      case "categories": return renderChips(result.categories, "—");
      case "published": return escapeHtml(formatShortDate(result.published));
      case "arxiv_id": return `<a class="table-link" href="${escapeAttr(result.url || `https://arxiv.org/abs/${result.arxiv_id}`)}" target="_blank" rel="noopener">${escapeHtml(result.arxiv_id)} ↗</a>`;
      case "match_count": return String(result._derived.matchCount);
      case "matched_terms": return renderChips(result._derived.terms, "—");
      case "interest_points": return renderScore(result._derived.interestPoints);
      case "negative_points": return renderScore(result._derived.negativePoints);
      case "match_kinds": return renderChips(result._derived.kinds.map(prettyToken), "—");
      case "assessment": return `<span class="assessment-label">${escapeHtml(assessmentLabel(state.evaluations[result.arxiv_id]?.assessment || "unreviewed"))}</span>`;
      case "url": return result.url ? `<a class="table-link" href="${escapeAttr(result.url)}" target="_blank" rel="noopener">Open ↗</a>` : "—";
      default: return "—";
    }
  }

  function renderScore(value) {
    const numeric = Number(value || 0);
    const cls = numeric > 0 ? "positive" : numeric < 0 ? "negative" : "zero";
    const text = numeric > 0 ? `+${numeric}` : String(numeric);
    return `<span class="score ${cls}">${text}</span>`;
  }

  function renderBand(band) {
    const cls = ["HIGH", "LEAD", "WEAK", "NONE"].includes(band) ? band.toLowerCase() : "none";
    return `<span class="badge ${cls}">${escapeHtml(band)}</span>`;
  }

  function renderChips(values, fallback = "—") {
    if (!values?.length) return fallback;
    return values.map(value => `<span class="chip">${escapeHtml(String(value))}</span>`).join("");
  }

  function openDrawer(id) {
    const result = state.results.find(r => r.arxiv_id === id);
    if (!result) return;
    state.selectedResultId = id;
    el.detailTitle.textContent = result.title;
    renderDrawerBody(result);
    el.drawerBackdrop.classList.remove("hidden");
    el.detailDrawer.classList.add("open");
    el.detailDrawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    el.drawerBackdrop.classList.add("hidden");
    el.detailDrawer.classList.remove("open");
    el.detailDrawer.setAttribute("aria-hidden", "true");
  }

  function renderDrawerBody(result) {
    const evaluation = state.evaluations[result.arxiv_id] || { assessment: "unreviewed", note: "" };
    const matchesHtml = result.matches.length
      ? result.matches.map(match => {
          const points = Number(match.points || 0);
          const cls = points < 0 ? "negative" : "positive";
          return `<div class="match-card">
            <div class="match-points ${cls}">${points > 0 ? "+" : ""}${points}</div>
            <div>
              <div class="match-concept">${escapeHtml(prettyToken(match.concept || "Unknown concept"))}</div>
              <div class="match-term">${escapeHtml(prettyToken(match.kind || "match"))} · term: “${escapeHtml(match.term || "—")}”</div>
            </div>
          </div>`;
        }).join("")
      : `<p class="muted">No scoring matches were recorded for this title.</p>`;

    el.drawerBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-field"><span>Score</span>${renderScore(result.score)}</div>
        <div class="detail-field"><span>Band</span>${renderBand(result.band)}</div>
        <div class="detail-field"><span>Published</span>${escapeHtml(formatDateTime(result.published))}</div>
        <div class="detail-field"><span>arXiv ID</span><a class="table-link" href="${escapeAttr(result.url || `https://arxiv.org/abs/${result.arxiv_id}`)}" target="_blank" rel="noopener">${escapeHtml(result.arxiv_id)} ↗</a></div>
      </div>

      <section class="detail-section">
        <h3>Categories</h3>
        <div>${renderChips(result.categories)}</div>
      </section>

      <section class="detail-section">
        <h3>Why it matched</h3>
        ${matchesHtml}
      </section>

      <section class="detail-section">
        <h3>My assessment</h3>
        <div class="assessment-box">
          <div class="assessment-options">
            ${assessmentOption("relevant", "Relevant", evaluation.assessment)}
            ${assessmentOption("maybe", "Maybe", evaluation.assessment)}
            ${assessmentOption("not_relevant", "Not relevant", evaluation.assessment)}
            ${assessmentOption("missed", "Missed by scorer", evaluation.assessment)}
          </div>
          <label>
            <span class="sr-only">Evaluation note</span>
            <textarea id="evaluationNote" placeholder="Optional note about why this title was or was not useful…">${escapeHtml(evaluation.note || "")}</textarea>
          </label>
          <p id="saveStatus" class="save-status">Saved locally in this browser.</p>
        </div>
      </section>

      <section class="detail-section">
        <details>
          <summary>Raw JSON</summary>
          <pre class="raw-block">${escapeHtml(JSON.stringify(stripDerived(result), null, 2))}</pre>
        </details>
      </section>
    `;

    el.drawerBody.querySelectorAll('input[name="assessment"]').forEach(input => {
      input.addEventListener("change", () => saveSelectedEvaluation());
    });
    const note = el.drawerBody.querySelector("#evaluationNote");
    note.addEventListener("input", debounce(saveSelectedEvaluation, 350));
  }

  function assessmentOption(value, label, selected) {
    const checked = value === selected ? "checked" : "";
    return `<label class="assessment-option"><input type="radio" name="assessment" value="${value}" ${checked}> <span>${escapeHtml(label)}</span></label>`;
  }

  function saveSelectedEvaluation() {
    if (!state.selectedResultId) return;
    const selected = el.drawerBody.querySelector('input[name="assessment"]:checked');
    const note = el.drawerBody.querySelector("#evaluationNote")?.value.trim() || "";

    if (!selected && !note) {
      delete state.evaluations[state.selectedResultId];
    } else {
      state.evaluations[state.selectedResultId] = {
        assessment: selected?.value || "unreviewed",
        note,
        updated_at: new Date().toISOString()
      };
    }
    persistEvaluations();
    const status = el.drawerBody.querySelector("#saveStatus");
    if (status) status.textContent = "Saved locally.";
    applyFiltersAndRender();
  }

  function renderColumnDialog() {
    el.columnList.innerHTML = state.columnOrder.map((column, index) => {
      const checked = state.columns.includes(column) ? "checked" : "";
      return `<div class="column-row" data-column="${column}">
        <label class="column-toggle"><input type="checkbox" ${checked}> <span>${escapeHtml(COLUMN_DEFINITIONS[column].label)}</span></label>
        <div class="column-actions">
          <button class="move-button" type="button" data-move="up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="move-button" type="button" data-move="down" ${index === state.columnOrder.length - 1 ? "disabled" : ""}>↓</button>
        </div>
      </div>`;
    }).join("");

    el.columnList.querySelectorAll(".column-row").forEach(row => {
      const column = row.dataset.column;
      row.querySelector('input[type="checkbox"]').addEventListener("change", event => {
        if (event.target.checked) {
          if (!state.columns.includes(column)) state.columns.push(column);
        } else {
          state.columns = state.columns.filter(c => c !== column);
          if (!state.columns.length) state.columns = ["title"];
        }
        state.columns.sort((a, b) => state.columnOrder.indexOf(a) - state.columnOrder.indexOf(b));
        renderTable();
        saveViewerPreferences();
      });
      row.querySelectorAll("[data-move]").forEach(button => {
        button.addEventListener("click", () => moveColumn(column, button.dataset.move));
      });
    });
  }

  function moveColumn(column, direction) {
    const index = state.columnOrder.indexOf(column);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= state.columnOrder.length) return;
    [state.columnOrder[index], state.columnOrder[target]] = [state.columnOrder[target], state.columnOrder[index]];
    state.columns.sort((a, b) => state.columnOrder.indexOf(a) - state.columnOrder.indexOf(b));
    renderColumnDialog();
    renderTable();
    saveViewerPreferences();
  }

  function renderRunDetails() {
    const run = state.run;
    const entries = [
      ["File", state.fileName],
      ["Run ID", run.run_id],
      ["Schema version", run.schema_version],
      ["Created", formatDateTime(run.created_at)],
      ["Source", run.source || "—"],
      ["Categories", run.parameters?.categories?.join(", ") || "—"],
      ["Max results", run.parameters?.max_results ?? "—"],
      ["Since hours", run.parameters?.since_hours ?? "null"],
      ["Config", run.parameters?.config || "—"]
    ];
    el.runDetailsBody.innerHTML = `<div class="kv-grid">${entries.map(([key, value]) => `<div class="key">${escapeHtml(String(key))}</div><div>${escapeHtml(String(value))}</div>`).join("")}</div>`;
  }

  function renderStatistics() {
    const positive = state.results.filter(r => r.score > 0).length;
    const zero = state.results.filter(r => r.score === 0).length;
    const negative = state.results.filter(r => r.score < 0).length;
    const reviewed = Object.values(state.evaluations).filter(e => e.assessment && e.assessment !== "unreviewed").length;
    const falsePositiveCandidates = state.results.filter(r => r.score > 0 && state.evaluations[r.arxiv_id]?.assessment === "not_relevant").length;
    const falseNegativeCandidates = state.results.filter(r => r.score <= 0 && ["relevant", "missed"].includes(state.evaluations[r.arxiv_id]?.assessment)).length;

    const conceptCounts = new Map();
    state.results.forEach(result => result.matches.forEach(match => {
      if (!match.concept) return;
      conceptCounts.set(match.concept, (conceptCounts.get(match.concept) || 0) + 1);
    }));
    const concepts = [...conceptCounts.entries()].sort((a, b) => b[1] - a[1]);

    el.statisticsBody.innerHTML = `
      <div class="stats-grid">
        ${statCard("Positive", positive)}
        ${statCard("Zero", zero)}
        ${statCard("Negative", negative)}
        ${statCard("Reviewed", reviewed)}
        ${statCard("Possible false positives", falsePositiveCandidates)}
        ${statCard("Possible false negatives", falseNegativeCandidates)}
      </div>
      <h3 style="margin-top:20px">Matched concepts</h3>
      <ol class="ranking">
        ${concepts.length ? concepts.map(([concept, count]) => `<li><code>${escapeHtml(concept)}</code><strong>${count}</strong></li>`).join("") : `<li><span class="muted">No concepts recorded.</span></li>`}
      </ol>
    `;
  }

  function statCard(label, value) {
    return `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function exportFilteredResults() {
    const payload = {
      source_run_id: state.run.run_id,
      exported_at: new Date().toISOString(),
      filters: serializableFilters(),
      count: state.filteredResults.length,
      results: state.filteredResults.map(stripDerived)
    };
    downloadJson(`${safeFileBase()}_filtered.json`, payload);
    el.exportDialog.close();
  }

  function exportEvaluations() {
    const evaluations = Object.entries(state.evaluations).map(([arxiv_id, evaluation]) => {
      const result = state.results.find(r => r.arxiv_id === arxiv_id);
      return {
        arxiv_id,
        title: result?.title || null,
        score: result?.score ?? null,
        band: result?.band ?? null,
        assessment: evaluation.assessment || "unreviewed",
        note: evaluation.note || "",
        updated_at: evaluation.updated_at || null
      };
    });
    const payload = {
      schema_version: 1,
      source_run_id: state.run.run_id,
      source_file: state.fileName,
      exported_at: new Date().toISOString(),
      count: evaluations.length,
      evaluations
    };
    downloadJson(`${safeFileBase()}_evaluations.json`, payload);
    el.exportDialog.close();
  }

  function resetView() {
    resetFiltersOnly();
    state.sort = { field: "score", direction: "desc" };
    state.columns = [...DEFAULT_COLUMNS];
    state.columnOrder = Object.keys(COLUMN_DEFINITIONS);
    state.page = 1;
    state.pageSize = 50;
    el.pageSizeSelect.value = "50";
    el.searchInput.value = "";
    syncFilterControls();
    renderBandTabs();
    saveViewerPreferences();
    applyFiltersAndRender();
  }

  function resetFiltersOnly() {
    state.filters.search = "";
    state.filters.bands = new Set(ALL_BANDS);
    state.filters.scoreMode = "all";
    state.filters.concept = "all";
    state.filters.category = "all";
    state.filters.assessment = "all";
    if (el.searchInput) el.searchInput.value = "";
    syncFilterControls();
  }

  function syncFilterControls() {
    if (!el.scoreModeFilter) return;
    el.scoreModeFilter.value = state.filters.scoreMode;
    el.conceptFilter.value = optionExists(el.conceptFilter, state.filters.concept) ? state.filters.concept : "all";
    el.categoryFilter.value = optionExists(el.categoryFilter, state.filters.category) ? state.filters.category : "all";
    el.assessmentFilter.value = state.filters.assessment;
  }

  function updateActiveFilterCount() {
    let count = 0;
    if (state.filters.search) count += 1;
    if (state.filters.bands.size !== ALL_BANDS.length) count += 1;
    if (state.filters.scoreMode !== "all") count += 1;
    if (state.filters.concept !== "all") count += 1;
    if (state.filters.category !== "all") count += 1;
    if (state.filters.assessment !== "all") count += 1;
    el.activeFilterCount.textContent = String(count);
    el.activeFilterCount.classList.toggle("hidden", count === 0);
  }

  function columnValue(result, field) {
    switch (field) {
      case "score": return result.score;
      case "band": return bandRank(result.band);
      case "title": return result.title;
      case "published": return new Date(result.published || 0).getTime();
      case "arxiv_id": return result.arxiv_id;
      case "match_count": return result._derived.matchCount;
      case "interest_points": return result._derived.interestPoints;
      case "negative_points": return result._derived.negativePoints;
      case "assessment": return assessmentLabel(state.evaluations[result.arxiv_id]?.assessment || "unreviewed");
      default: return "";
    }
  }

  function bandRank(band) {
    return ({ NONE: 0, WEAK: 1, LEAD: 2, HIGH: 3 })[band] ?? -1;
  }

  function compareValues(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function totalPages() { return Math.max(1, Math.ceil(state.filteredResults.length / state.pageSize)); }
  function countBand(band) { return state.results.filter(r => r.band === band).length; }

  function serializableFilters() {
    return {
      search: state.filters.search,
      bands: [...state.filters.bands],
      score_mode: state.filters.scoreMode,
      concept: state.filters.concept,
      category: state.filters.category,
      assessment: state.filters.assessment
    };
  }

  function loadEvaluations(runId) {
    try { return JSON.parse(localStorage.getItem(evaluationKey(runId)) || "{}") || {}; }
    catch { return {}; }
  }

  function persistEvaluations() {
    if (!state.run) return;
    try { localStorage.setItem(evaluationKey(state.run.run_id), JSON.stringify(state.evaluations)); }
    catch { /* localStorage can be unavailable in hardened/private contexts */ }
  }

  function evaluationKey(runId) { return `arxivScoutEvaluations:${runId}`; }
  function preferencesKey() { return "arxivScoutViewer:preferences:v1"; }

  function saveViewerPreferences() {
    try {
      localStorage.setItem(preferencesKey(), JSON.stringify({
        columns: state.columns,
        columnOrder: state.columnOrder,
        pageSize: state.pageSize
      }));
    } catch { /* ignore */ }
  }

  function restoreViewerPreferences() {
    try {
      const prefs = JSON.parse(localStorage.getItem(preferencesKey()) || "null");
      if (!prefs) return;
      if (Array.isArray(prefs.columnOrder)) {
        const valid = prefs.columnOrder.filter(c => COLUMN_DEFINITIONS[c]);
        const missing = Object.keys(COLUMN_DEFINITIONS).filter(c => !valid.includes(c));
        state.columnOrder = [...valid, ...missing];
      }
      if (Array.isArray(prefs.columns)) {
        const valid = prefs.columns.filter(c => COLUMN_DEFINITIONS[c]);
        if (valid.length) state.columns = valid.sort((a, b) => state.columnOrder.indexOf(a) - state.columnOrder.indexOf(b));
      }
      if ([25,50,100,250].includes(Number(prefs.pageSize))) {
        state.pageSize = Number(prefs.pageSize);
        el.pageSizeSelect.value = String(state.pageSize);
      }
    } catch { /* ignore malformed preferences */ }
  }

  function downloadJson(fileName, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function safeFileBase() {
    return (state.fileName || state.run?.run_id || "arxiv-scout-run").replace(/\.json$/i, "").replace(/[^a-z0-9._-]+/gi, "_");
  }

  function stripDerived(result) {
    const { _derived, ...raw } = result;
    return raw;
  }

  function assessmentLabel(value) {
    return ({
      unreviewed: "Unreviewed",
      relevant: "Relevant",
      maybe: "Maybe",
      not_relevant: "Not relevant",
      missed: "Missed by scorer"
    })[value] || prettyToken(value);
  }

  function prettyToken(value) {
    return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatShortDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short"
    }).format(date);
  }

  function showError(message) {
    el.errorBanner.textContent = message;
    el.errorBanner.classList.remove("hidden");
  }
  function clearError() {
    el.errorBanner.textContent = "";
    el.errorBanner.classList.add("hidden");
  }

  function unique(values) { return [...new Set(values)]; }
  function localeCompare(a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }); }
  function optionExists(select, value) { return [...select.options].some(option => option.value === value); }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function escapeAttr(value) { return escapeHtml(value); }
})();
