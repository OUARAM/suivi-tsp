// =========================================================================
// DASHBOARD.JS — page index.html (Tableau de bord + Historique), Supabase
// =========================================================================

let currentTab = 'dashboard';
let filters = { search: '', ligne: 'all', cat: 'all' };
let historyDays = null;
let selectedDay = null;
let historyDayRows = null;

function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderNav('dashboard')}
    ${renderSubTabs()}
    <div id="tabContent"></div>
  `;
  renderTabContent();
  attachNavHandlers();
  attachSubTabHandlers();
}

function renderSubTabs() {
  const all = buildAllRecords();
  const anomCount = all.filter(isAnomaly).length;
  return `
    <div class="tabs">
      <button class="tab-btn ${currentTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
        🚨 Anomalies ${anomCount > 0 ? `<span class="tab-badge">${anomCount}</span>` : ''}
      </button>
      <button class="tab-btn ${currentTab === 'history' ? 'active' : ''}" data-tab="history">
        🗓 Historique
      </button>
    </div>
  `;
}

function attachSubTabHandlers() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tab;
      if (t === 'history') openHistoryTab();
      else { currentTab = t; render(); }
    });
  });
}

function renderTabContent() {
  const el = document.getElementById('tabContent');
  el.innerHTML = currentTab === 'history' ? renderHistory() : renderDashboard();
  attachAnomalyCardHandlers();
  attachContentFilterHandlers();
}

// -------------------------------------------------------------------------
// TABLEAU DE BORD
// -------------------------------------------------------------------------
function renderDashboard() {
  const all = buildAllRecords();
  const anomalies = all.filter(isAnomaly);

  const critCount = anomalies.filter(r => recordSeverity(r) >= 4).length;
  const watchCount = anomalies.filter(r => recordSeverity(r) === 3 || recordSeverity(r) === 1).length;
  const openCount = anomalies.filter(r => r.statut === 'Ouvert').length;
  const equipTouched = new Set(anomalies.map(r => r._cat + '-' + r.code)).size;

  let filtered = anomalies;
  if (filters.cat !== 'all') filtered = filtered.filter(r => r._cat === filters.cat);
  if (filters.ligne !== 'all') filtered = filtered.filter(r => r.ligne === filters.ligne);
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter(r =>
      (r.code || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.crible || '').toLowerCase().includes(q) ||
      (r.composant || '').toLowerCase().includes(q) ||
      (r.anomalie || '').toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => recordSeverity(b) - recordSeverity(a));

  const lignes = [...new Set(all.map(r => r.ligne).filter(Boolean))].sort();

  return `
    <div class="kpis">
      <div class="kpi crit"><div class="num">${critCount}</div><div class="lbl">Critiques (panne / hors service)</div></div>
      <div class="kpi warn"><div class="num">${watchCount}</div><div class="lbl">À surveiller / dégradés</div></div>
      <div class="kpi info"><div class="num">${openCount}</div><div class="lbl">Actions ouvertes</div></div>
      <div class="kpi"><div class="num">${equipTouched}</div><div class="lbl">Équipements concernés</div></div>
    </div>

    <div class="filterbar">
      <input type="text" id="searchInput" placeholder="Rechercher un code, une anomalie…" value="${escapeAttr(filters.search)}">
      <select id="catFilter">
        <option value="all">Toutes catégories</option>
        <option value="crible" ${filters.cat==='crible'?'selected':''}>Cribles</option>
        <option value="bande" ${filters.cat==='bande'?'selected':''}>Bandes</option>
        <option value="broyeur" ${filters.cat==='broyeur'?'selected':''}>Broyeurs</option>
        <option value="pompe" ${filters.cat==='pompe'?'selected':''}>Pompes</option>
      </select>
      <select id="ligneFilter">
        <option value="all">Toutes lignes</option>
        ${lignes.map(l => `<option value="${l}" ${filters.ligne===l?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>

    <div class="section-title">
      <span>${filtered.length} anomalie${filtered.length!==1?'s':''} détectée${filtered.length!==1?'s':''}</span>
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="ico">✅</div>
        <div class="title">${anomalies.length===0 ? "Aucune anomalie signalée" : "Aucun résultat pour ces filtres"}</div>
        <div>${anomalies.length===0 ? "Tous les équipements sont en bon état." : "Essayez d'élargir votre recherche."}</div>
      </div>
    ` : `
      <div class="cards">
        ${filtered.map(r => renderAnomalyCard(r)).join('')}
      </div>
    `}
  `;
}

function attachContentFilterHandlers() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filters.search = e.target.value;
      const pos = e.target.selectionStart;
      renderTabContent();
      const ni = document.getElementById('searchInput');
      if (ni) { ni.focus(); ni.setSelectionRange(pos, pos); }
    });
  }
  const catFilter = document.getElementById('catFilter');
  if (catFilter) catFilter.addEventListener('change', (e) => { filters.cat = e.target.value; renderTabContent(); });
  const ligneFilter = document.getElementById('ligneFilter');
  if (ligneFilter) ligneFilter.addEventListener('change', (e) => { filters.ligne = e.target.value; renderTabContent(); });

  const historyBackBtn = document.getElementById('historyBackBtn');
  if (historyBackBtn) {
    historyBackBtn.addEventListener('click', () => { selectedDay = null; historyDayRows = null; renderTabContent(); });
  }
  document.querySelectorAll('[data-history-day]').forEach(card => {
    card.addEventListener('click', () => openHistoryDay(card.dataset.historyDay));
  });
}

// -------------------------------------------------------------------------
// HISTORIQUE — journal réel tiré de la table "releves" (jamais écrasée)
// -------------------------------------------------------------------------
async function openHistoryTab() {
  currentTab = 'history';
  selectedDay = null;
  historyDayRows = null;
  historyDays = null;
  render();

  const { data, error } = await supabaseClient
    .from('releves')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) { console.error(error); historyDays = []; renderTabContent(); return; }

  const daySet = new Set((data || []).map(r => r.created_at.slice(0, 10)));
  historyDays = [...daySet].sort().reverse();
  renderTabContent();
}

async function openHistoryDay(day) {
  selectedDay = day;
  historyDayRows = null;
  renderTabContent();

  const start = day + 'T00:00:00.000Z';
  const end = day + 'T23:59:59.999Z';
  const { data, error } = await supabaseClient
    .from('releves')
    .select('*, equipements(categorie, code, ligne, description, composant)')
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: false });

  if (error) { console.error(error); historyDayRows = []; renderTabContent(); return; }

  const userIds = [...new Set((data || []).map(r => r.saisi_par).filter(Boolean))];
  const names = await fetchProfilNames(userIds);
  historyDayRows = (data || []).map(r => ({
    etat: r.etat, anomalie: r.anomalie, statut: r.statut, commentaire: r.commentaire,
    createdAt: r.created_at, saisiPar: r.saisi_par ? (names[r.saisi_par] || '—') : '—',
    categorie: r.equipements?.categorie, code: r.equipements?.code,
    ligne: r.equipements?.ligne, description: r.equipements?.description, composant: r.equipements?.composant
  }));
  renderTabContent();
}

function formatDateFr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderHistory() {
  if (selectedDay) return renderHistoryDayDetail();

  if (historyDays === null) {
    return `<div class="loading-screen"><div class="spinner"></div><div>Chargement de l'historique…</div></div>`;
  }
  if (historyDays.length === 0) {
    return `
      <div class="empty-state">
        <div class="ico">🗓</div>
        <div class="title">Aucun historique pour l'instant</div>
        <div>Chaque saisie est enregistrée automatiquement, journée par journée.</div>
      </div>
    `;
  }
  return `
    <div class="section-title"><span>Journées avec des saisies (${historyDays.length})</span></div>
    <div class="cards">
      ${historyDays.map(d => `
        <div class="card" data-history-day="${d}">
          <div class="cat-ico">🗓</div>
          <div class="card-main">
            <div class="card-title">${formatDateFr(d)}</div>
            <div class="card-sub">${d === todayStr() ? "Aujourd'hui — en cours" : 'Cliquer pour consulter le détail de ce jour'}</div>
          </div>
          <div class="card-right"><span class="chevron">›</span></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHistoryDayDetail() {
  if (historyDayRows === null) {
    return `<div class="loading-screen"><div class="spinner"></div><div>Chargement du ${formatDateFr(selectedDay)}…</div></div>`;
  }
  return `
    <button class="reset-btn" id="historyBackBtn" style="margin-bottom:14px;">← Retour à l'historique</button>
    <div class="section-title"><span>${formatDateFr(selectedDay)} — ${historyDayRows.length} saisie(s)</span></div>
    ${historyDayRows.length === 0 ? `
      <div class="empty-state"><div class="ico">🗓</div><div class="title">Aucune saisie ce jour-là</div></div>
    ` : `
      <div class="cards">
        ${historyDayRows.map(r => `
          <div class="card" style="cursor:default;">
            <div class="cat-ico">${CAT_META[r.categorie] ? CAT_META[r.categorie].icon : '•'}</div>
            <div class="card-main">
              <div class="card-title">
                <span class="card-code">${r.code || ''}</span>
                <span>${r.composant || r.description || ''}</span>
                ${r.etat ? `<span class="badge ${etatClass(r.etat)}">${r.etat}</span>` : ''}
              </div>
              <div class="card-sub">
                <span>${r.ligne || ''}</span>
                <span>Par ${escapeHtml(r.saisiPar)}</span>
                <span>${new Date(r.createdAt).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</span>
              </div>
              ${r.anomalie ? `<div class="card-anom">⚠ ${escapeHtml(r.anomalie)}</div>` : ''}
            </div>
            <div class="card-right"><span class="badge ${statutClass(r.statut)}">${r.statut || 'Non traité'}</span></div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

// -------------------------------------------------------------------------
// INIT
// -------------------------------------------------------------------------
requireAuth(async () => {
  await loadAllEdits();
  render();
  subscribeRealtime(() => renderTabContent());
});