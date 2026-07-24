// =========================================================================
// COMMON.JS — logique et composants partagés, connectés à Supabase
// (nécessite supabase-config.js, auth.js et data.js chargés avant lui)
// =========================================================================

const PAGE_META = {
  dashboard: { file: 'index.html',    label: 'Tableau de bord', icon: '🚨' },
  crible:    { file: 'cribles.html',  label: 'Cribles',         icon: '▦' },
  bande:     { file: 'bandes.html',   label: 'Bandes',          icon: '▬' },
  broyeur:   { file: 'broyeurs.html', label: 'Broyeurs',        icon: '◆' },
  pompe:     { file: 'pompes.html',   label: 'Pompes',          icon: '●' }
};

const CAT_META = {
  crible:  { label: 'Cribles',   icon: '▦', file: 'cribles.html'  },
  bande:   { label: 'Bandes',    icon: '▬', file: 'bandes.html'   },
  broyeur: { label: 'Broyeurs',  icon: '◆', file: 'broyeurs.html' },
  pompe:   { label: 'Pompes',    icon: '●', file: 'pompes.html'   }
};

const ETAT_SEVERITY = {
  'Hors service': 5, 'En panne': 4, 'Dégradé': 3, "À l'arrêt": 2, 'À surveiller': 1, 'Bon état': 0
};
const ETAT_CLASS = {
  'Hors service': 'etat-hs', 'En panne': 'etat-panne', 'Dégradé': 'etat-degrade',
  "À l'arrêt": 'etat-arret', 'À surveiller': 'etat-surveiller', 'Bon état': 'etat-bon'
};
function etatClass(e){ return e ? (ETAT_CLASS[e] || 'etat-none') : 'etat-none'; }
function statutClass(s){
  if (s === 'Ouvert') return 'statut-ouvert';
  if (s === 'En cours') return 'statut-cours';
  if (s === 'Clôturé') return 'statut-cloture';
  return 'statut-none';
}

// -------------------------------------------------------------------------
// STATE
// -------------------------------------------------------------------------
let edits = { crible: {}, bande: {}, broyeur: {}, pompe: {} };
let openGroups = {};
const saveTimers = {};

// Correspondance entre nos identifiants locaux (crible-HB153-SUP…) et les
// UUID réels de la table Supabase "equipements".
let EQUIP_UUID = { crible: {}, bande: {}, broyeur: {}, pompe: {} };
let UUID_TO_LOCAL = {}; // uuid -> { cat, id }
let PROFILE_NAMES = {}; // uuid utilisateur -> nom

// -------------------------------------------------------------------------
// CHARGEMENT DEPUIS SUPABASE
// -------------------------------------------------------------------------
async function buildEquipMap() {
  const { data, error } = await supabaseClient.from('equipements').select('*');
  if (error) { console.error('Erreur chargement équipements :', error); return; }
  data.forEach(row => {
    let key;
    if (row.categorie === 'crible')  key = `${row.code}::${row.cle_composant}`;
    else if (row.categorie === 'bande') key = `${row.code}::${row.cle_composant}`;
    else if (row.categorie === 'broyeur') key = `${row.code}`;
    else if (row.categorie === 'pompe') key = `${row.code}::${row.ordre}`;
    EQUIP_UUID[row.categorie][key] = row.id;
    UUID_TO_LOCAL[row.id] = { cat: row.categorie, key };
  });
}

function localKey(cat, id) {
  // id est de la forme "crible-HB153-SUP", "bande-BT01-Moteur", "broyeur-B01", "pompe-P01-4"
  const rest = id.slice(cat.length + 1);
  const parts = rest.split('-');
  if (cat === 'broyeur') return rest;
  // pour crible/bande/pompe : dernier segment = discriminant, le reste = code
  const disc = parts[parts.length - 1];
  const code = parts.slice(0, -1).join('-');
  return `${code}::${disc}`;
}

function equipUuid(cat, id) {
  const key = localKey(cat, id);
  return EQUIP_UUID[cat][key];
}

function buildLocalIdIndex() {
  BASE.cribles.forEach(c => {
    c.composants.forEach(comp => {
      const uuid = EQUIP_UUID.crible[`${c.code}::${comp.cle}`];
      if (uuid) LOCAL_ID_BY_UUID[uuid] = `crible-${c.code}-${comp.cle}`;
    });
  });
  BASE.bandes.forEach(b => {
    b.composants.forEach(comp => {
      const uuid = EQUIP_UUID.bande[`${b.code}::${comp.cle}`];
      if (uuid) LOCAL_ID_BY_UUID[uuid] = `bande-${b.code}-${comp.cle}`;
    });
  });
  BASE.broyeurs.forEach(e => {
    const uuid = EQUIP_UUID.broyeur[`${e.code}`];
    if (uuid) LOCAL_ID_BY_UUID[uuid] = `broyeur-${e.code}`;
  });
  BASE.pompes.forEach((e, i) => {
    const uuid = EQUIP_UUID.pompe[`${e.code}::${i}`];
    if (uuid) LOCAL_ID_BY_UUID[uuid] = `pompe-${e.code}-${i}`;
  });
}

async function loadAllEdits() {
  await buildEquipMap();
  buildLocalIdIndex();

  const { data, error } = await supabaseClient.from('dernier_releve').select('*');
  edits = { crible: {}, bande: {}, broyeur: {}, pompe: {} };
  if (error) { console.error('Erreur chargement relevés :', error); return; }

  const userIds = [...new Set((data || []).map(r => r.saisi_par).filter(Boolean))];
  PROFILE_NAMES = await fetchProfilNames(userIds);

  (data || []).forEach(row => {
    const loc = UUID_TO_LOCAL[row.equipement_id];
    if (!loc) return;
    // reconstruire l'id local exact à partir de la catégorie + du référentiel BASE
    const id = findLocalIdForUuid(loc.cat, row.equipement_id);
    if (!id) return;
    edits[loc.cat][id] = {
      etat: row.etat, anomalie: row.anomalie, action: row.action_corrective,
      responsable: row.responsable, delai: row.delai, statut: row.statut || '-',
      commentaire: row.commentaire,
      updatedBy: row.saisi_par ? (PROFILE_NAMES[row.saisi_par] || '—') : null,
      updatedAt: row.created_at
    };
  });
}

// Cache id-local <-> uuid dans les deux sens pour un accès direct
let LOCAL_ID_BY_UUID = {};
function findLocalIdForUuid(cat, uuid) {
  return LOCAL_ID_BY_UUID[uuid];
}

async function fetchProfilNames(ids) {
  if (!ids.length) return {};
  const { data } = await supabaseClient.from('profils').select('id, nom').in('id', ids);
  const map = {};
  (data || []).forEach(p => { map[p.id] = p.nom; });
  return map;
}

function flashSaved() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1400);
}

function debouncedPersistRecord(cat, id) {
  const key = cat + '|' + id;
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => persistRecord(cat, id), 700);
}

async function persistRecord(cat, id) {
  const uuid = equipUuid(cat, id);
  if (!uuid) { console.error('Équipement introuvable dans Supabase pour', cat, id); return; }
  const rec = edits[cat][id] || {};
  const { error } = await supabaseClient.from('releves').insert({
    equipement_id: uuid,
    etat: rec.etat || null,
    anomalie: rec.anomalie || null,
    action_corrective: rec.action || null,
    responsable: rec.responsable || null,
    delai: rec.delai || null,
    statut: (rec.statut && rec.statut !== '-') ? rec.statut : null,
    commentaire: rec.commentaire || null,
    saisi_par: currentSession.user.id
  });
  if (error) { console.error('Erreur enregistrement :', error); return; }
  flashSaved();
}

// -------------------------------------------------------------------------
// RECORDS (identique à la version précédente)
// -------------------------------------------------------------------------
function getRecord(cat, id, base, src) {
  src = src || edits;
  const ov = (src[cat] && src[cat][id]) || {};
  return Object.assign({}, base, ov, { _id: id, _cat: cat });
}

function setField(cat, id, field, value) {
  if (!edits[cat][id]) edits[cat][id] = {};
  edits[cat][id][field] = value;
  edits[cat][id].updatedBy = currentUser || null;
  edits[cat][id].updatedAt = new Date().toISOString();
  debouncedPersistRecord(cat, id);
}

function buildAllRecords(src) {
  src = src || edits;
  const out = [];
  BASE.cribles.forEach(c => {
    c.composants.forEach(comp => {
      const id = `crible-${c.code}-${comp.cle}`;
      LOCAL_ID_BY_UUID[EQUIP_UUID.crible[`${c.code}::${comp.cle}`]] = id;
      const base = Object.assign({}, comp, { code: c.code, ligne: c.ligne, crible: c.crible });
      out.push(getRecord('crible', id, base, src));
    });
  });
  BASE.bandes.forEach(b => {
    b.composants.forEach(comp => {
      const id = `bande-${b.code}-${comp.cle}`;
      LOCAL_ID_BY_UUID[EQUIP_UUID.bande[`${b.code}::${comp.cle}`]] = id;
      const base = Object.assign({}, comp, { code: b.code, ligne: b.ligne, description: b.description });
      out.push(getRecord('bande', id, base, src));
    });
  });
  BASE.broyeurs.forEach(e => {
    const id = `broyeur-${e.code}`;
    LOCAL_ID_BY_UUID[EQUIP_UUID.broyeur[`${e.code}`]] = id;
    out.push(getRecord('broyeur', id, e, src));
  });
  BASE.pompes.forEach((e, i) => {
    const id = `pompe-${e.code}-${i}`;
    LOCAL_ID_BY_UUID[EQUIP_UUID.pompe[`${e.code}::${i}`]] = id;
    out.push(getRecord('pompe', id, e, src));
  });
  return out;
}

function buildCategoryRecords(cat, src) {
  return buildAllRecords(src).filter(r => r._cat === cat);
}

function isAnomaly(rec) {
  const etat = rec.etat;
  const hasEtatIssue = etat && etat !== 'Bon état';
  const hasAnomalieText = rec.anomalie && rec.anomalie.trim().length > 0;
  const isOpen = rec.statut === 'Ouvert' || rec.statut === 'En cours';
  return hasEtatIssue || hasAnomalieText || isOpen;
}

function recordSeverity(rec) {
  let s = ETAT_SEVERITY[rec.etat] || 0;
  if (rec.statut === 'Ouvert') s = Math.max(s, 3);
  return s;
}

function recordLabel(rec) {
  if (rec._cat === 'crible') return `${rec.crible} — ${rec.composant}`;
  if (rec._cat === 'bande') return `${rec.composant}`;
  return rec.description || rec.code;
}

// -------------------------------------------------------------------------
// NAVIGATION
// -------------------------------------------------------------------------
function renderNav(active) {
  const all = buildAllRecords();
  const anomCount = all.filter(isAnomaly).length;
  const items = ['dashboard', 'crible', 'bande', 'broyeur', 'pompe'].map(key => {
    const m = PAGE_META[key];
    const count = key === 'dashboard' ? anomCount : buildCategoryRecords(key).filter(isAnomaly).length;
    return `
      <a class="nav-link ${active === key ? 'active' : ''}" href="${m.file}">
        ${m.icon} ${m.label}
        ${count > 0 ? `<span class="tab-badge">${count}</span>` : ''}
      </a>`;
  }).join('');

  const today = new Date();
  const dateStr = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">TSP</div>
        <div>
          <h1>Suivi Journalier des Équipements</h1>
          <div class="sub">Atelier TSP — Cribles · Bandes · Broyeurs · Pompes</div>
        </div>
      </div>
      <div class="topbar-right">
        <div class="date-pill">👤 <b>${escapeHtml(currentUser || '')}</b></div>
        <div class="date-pill">📅 <b>${dateStr}</b></div>
        <button class="reset-btn" id="btn-export">📥 Exporter</button>
        <button class="reset-btn" id="logoutBtn">Déconnexion</button>
      </div>
    </div>
    <nav class="nav-bar">${items}</nav>
  `;
}

function attachNavHandlers() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', signOutApp);

  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) exportBtn.addEventListener('click', exportReleves);
}

// -------------------------------------------------------------------------
// CARTE D'ANOMALIE
// -------------------------------------------------------------------------
function renderAnomalyCard(r, readOnly) {
  const sev = recordSeverity(r);
  const meta = CAT_META[r._cat];
  const target = readOnly ? '' : `${meta.file}#${r._cat}-${r.code}`;
  return `
    <div class="card sev-${sev}" ${target ? `data-href="${target}"` : ''} style="${readOnly ? 'cursor:default;' : ''}">
      <div class="cat-ico">${meta.icon}</div>
      <div class="card-main">
        <div class="card-title">
          <span class="card-code">${r.code}</span>
          <span>${recordLabel(r)}</span>
          ${r.etat ? `<span class="badge ${etatClass(r.etat)}">${r.etat}</span>` : ''}
        </div>
        <div class="card-sub">
          <span>${meta.label}</span>
          ${r.ligne ? `<span>Ligne ${r.ligne}</span>` : ''}
          ${r.responsable ? `<span>Resp. ${r.responsable}</span>` : ''}
          ${r.delai ? `<span>Délai ${r.delai}</span>` : ''}
        </div>
        ${r.anomalie ? `<div class="card-anom">⚠ ${escapeHtml(r.anomalie)}</div>` : ''}
      </div>
      <div class="card-right">
        <span class="badge ${statutClass(r.statut)}">${r.statut && r.statut !== '-' ? r.statut : 'Non traité'}</span>
        <span class="chevron">›</span>
      </div>
    </div>
  `;
}

function attachAnomalyCardHandlers() {
  document.querySelectorAll('.card[data-href]').forEach(card => {
    card.addEventListener('click', () => { window.location.href = card.dataset.href; });
  });
}

// -------------------------------------------------------------------------
// FORMULAIRES DE SAISIE
// -------------------------------------------------------------------------
function fieldOptions(list, current) {
  return list.map(v => `<option value="${escapeAttr(v)}" ${current===v?'selected':''}>${v}</option>`).join('');
}

function lastUpdatedNote(rec) {
  if (!rec.updatedBy && !rec.updatedAt) return '';
  const when = rec.updatedAt ? new Date(rec.updatedAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
  return `<div class="field full" style="font-size:11px;color:var(--muted);">Dernière saisie : ${rec.updatedBy ? escapeHtml(rec.updatedBy) : 'anonyme'}${when ? ' — ' + when : ''}</div>`;
}

function renderCribles() {
  return `<div class="equip-group-list">
    ${BASE.cribles.map(c => {
      const groupId = `crible-${c.code}`;
      const isOpen = !!openGroups[groupId];
      const anyAnomaly = c.composants.some(comp => isAnomaly(getRecord('crible', `crible-${c.code}-${comp.cle}`, Object.assign({}, comp, {code:c.code, ligne:c.ligne, crible:c.crible}))));
      return `
      <div class="equip-group">
        <div class="equip-head" data-group="${groupId}">
          <div class="equip-head-left">
            <div class="cat-ico">▦</div>
            <div>
              <div class="equip-head-title">${c.code} — ${c.crible} <span style="color:var(--muted);font-weight:500;">(${c.ligne})</span></div>
              <div class="equip-head-sub">${c.composants.length} composants suivis ${anyAnomaly ? ' · <span style="color:var(--alert-red)">⚠ anomalie signalée</span>' : ''}</div>
            </div>
          </div>
          <span class="chevron">${isOpen ? '▾' : '›'}</span>
        </div>
        <div class="equip-body ${isOpen ? 'open' : ''}">
          ${c.composants.map(comp => {
            const id = `crible-${c.code}-${comp.cle}`;
            const base = Object.assign({}, comp, {code:c.code, ligne:c.ligne, crible:c.crible});
            const rec = getRecord('crible', id, base);
            const anomList = REF.crible.anomalies_by_key[comp.cle] || REF.crible.anomalies_by_key['Crible_Moteur'];
            return `
            <div class="row-form">
              <div class="composant-label">${comp.composant} <span style="color:var(--muted);font-weight:500;">(${comp.categorie})</span></div>
              <div class="field">
                <label>État</label>
                <select data-id="${id}" data-cat="crible" data-field="etat">
                  <option value="">—</option>
                  ${fieldOptions(REF.etats_generic, rec.etat)}
                </select>
              </div>
              <div class="field">
                <label>Anomalie constatée</label>
                <select data-id="${id}" data-cat="crible" data-field="anomalie">
                  <option value="">—</option>
                  ${fieldOptions(anomList, rec.anomalie)}
                </select>
              </div>
              <div class="field">
                <label>Action corrective</label>
                <select data-id="${id}" data-cat="crible" data-field="action">
                  <option value="">—</option>
                  ${fieldOptions(REF.crible.actions, rec.action)}
                </select>
              </div>
              <div class="field">
                <label>Responsable</label>
                <input type="text" data-id="${id}" data-cat="crible" data-field="responsable" value="${escapeAttr(rec.responsable||'')}">
              </div>
              <div class="field">
                <label>Délai</label>
                <input type="date" data-id="${id}" data-cat="crible" data-field="delai" value="${escapeAttr(rec.delai||'')}">
              </div>
              <div class="field">
                <label>Statut</label>
                <select data-id="${id}" data-cat="crible" data-field="statut">
                  <option value="-">—</option>
                  <option value="Ouvert" ${rec.statut==='Ouvert'?'selected':''}>Ouvert</option>
                  <option value="En cours" ${rec.statut==='En cours'?'selected':''}>En cours</option>
                  <option value="Clôturé" ${rec.statut==='Clôturé'?'selected':''}>Clôturé</option>
                </select>
              </div>
              <div class="field full">
                <label>Commentaire</label>
                <textarea data-id="${id}" data-cat="crible" data-field="commentaire" placeholder="Observations…">${escapeHtml(rec.commentaire||'')}</textarea>
              </div>
              ${lastUpdatedNote(rec)}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderBandes() {
  return `<div class="equip-group-list">
    ${BASE.bandes.map(b => {
      const groupId = `bande-${b.code}`;
      const isOpen = !!openGroups[groupId];
      const anyAnomaly = b.composants.some(comp => isAnomaly(getRecord('bande', `bande-${b.code}-${comp.cle}`, Object.assign({}, comp, {code:b.code, ligne:b.ligne}))));
      return `
      <div class="equip-group">
        <div class="equip-head" data-group="${groupId}">
          <div class="equip-head-left">
            <div class="cat-ico">▬</div>
            <div>
              <div class="equip-head-title">${b.code} — ${b.description} <span style="color:var(--muted);font-weight:500;">(${b.ligne})</span></div>
              <div class="equip-head-sub">${b.composants.length} composants suivis ${anyAnomaly ? ' · <span style="color:var(--alert-red)">⚠ anomalie signalée</span>' : ''}</div>
            </div>
          </div>
          <span class="chevron">${isOpen ? '▾' : '›'}</span>
        </div>
        <div class="equip-body ${isOpen ? 'open' : ''}">
          ${b.composants.map(comp => {
            const id = `bande-${b.code}-${comp.cle}`;
            const base = Object.assign({}, comp, {code:b.code, ligne:b.ligne});
            const rec = getRecord('bande', id, base);
            const anomList = REF.bande.anomalies_by_key[comp.cle] || REF.bande.anomalies_by_key['Moteur'];
            return `
            <div class="row-form">
              <div class="composant-label">${comp.composant} <span style="color:var(--muted);font-weight:500;">(${comp.categorie})</span></div>
              <div class="field">
                <label>État</label>
                <select data-id="${id}" data-cat="bande" data-field="etat">
                  <option value="">—</option>
                  ${fieldOptions(REF.etats_generic, rec.etat)}
                </select>
              </div>
              <div class="field">
                <label>Anomalie constatée</label>
                <select data-id="${id}" data-cat="bande" data-field="anomalie">
                  <option value="">—</option>
                  ${fieldOptions(anomList, rec.anomalie)}
                </select>
              </div>
              <div class="field">
                <label>Action corrective</label>
                <select data-id="${id}" data-cat="bande" data-field="action">
                  <option value="">—</option>
                  ${fieldOptions(REF.bande.actions, rec.action)}
                </select>
              </div>
              <div class="field">
                <label>Responsable</label>
                <input type="text" data-id="${id}" data-cat="bande" data-field="responsable" value="${escapeAttr(rec.responsable||'')}">
              </div>
              <div class="field">
                <label>Délai</label>
                <input type="date" data-id="${id}" data-cat="bande" data-field="delai" value="${escapeAttr(rec.delai||'')}">
              </div>
              <div class="field">
                <label>Statut</label>
                <select data-id="${id}" data-cat="bande" data-field="statut">
                  <option value="-">—</option>
                  <option value="Ouvert" ${rec.statut==='Ouvert'?'selected':''}>Ouvert</option>
                  <option value="En cours" ${rec.statut==='En cours'?'selected':''}>En cours</option>
                  <option value="Clôturé" ${rec.statut==='Clôturé'?'selected':''}>Clôturé</option>
                </select>
              </div>
              <div class="field full">
                <label>Commentaire</label>
                <textarea data-id="${id}" data-cat="bande" data-field="commentaire" placeholder="Observations…">${escapeHtml(rec.commentaire||'')}</textarea>
              </div>
              ${lastUpdatedNote(rec)}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderSimpleList(cat, items, ref) {
  return `<div class="equip-group-list">
    ${items.map((e) => {
      const id = cat === 'pompe' ? `pompe-${e.code}-${e.__idx}` : `${cat}-${e.code}`;
      const rec = getRecord(cat, id, e);
      const groupId = id;
      const isOpen = !!openGroups[groupId];
      const anom = isAnomaly(rec);
      const icon = CAT_META[cat].icon;
      return `
      <div class="equip-group">
        <div class="equip-head" data-group="${groupId}">
          <div class="equip-head-left">
            <div class="cat-ico">${icon}</div>
            <div>
              <div class="equip-head-title">${e.code} — ${e.description} <span style="color:var(--muted);font-weight:500;">(${e.ligne})</span></div>
              <div class="equip-head-sub">${anom ? '<span style="color:var(--alert-red)">⚠ anomalie signalée</span>' : 'Aucune anomalie'}</div>
            </div>
          </div>
          <span class="chevron">${isOpen ? '▾' : '›'}</span>
        </div>
        <div class="equip-body ${isOpen ? 'open' : ''}">
          <div class="row-form">
            <div class="field">
              <label>État</label>
              <select data-id="${id}" data-cat="${cat}" data-field="etat">
                <option value="">—</option>
                ${fieldOptions(REF.etats_generic, rec.etat)}
              </select>
            </div>
            <div class="field">
              <label>Anomalie constatée</label>
              <select data-id="${id}" data-cat="${cat}" data-field="anomalie">
                <option value="">—</option>
                ${fieldOptions(ref.anomalies, rec.anomalie)}
              </select>
            </div>
            <div class="field">
              <label>Action corrective</label>
              <select data-id="${id}" data-cat="${cat}" data-field="action">
                <option value="">—</option>
                ${fieldOptions(ref.actions, rec.action)}
              </select>
            </div>
            <div class="field">
              <label>Responsable</label>
              <input type="text" data-id="${id}" data-cat="${cat}" data-field="responsable" value="${escapeAttr(rec.responsable||'')}">
            </div>
            <div class="field">
              <label>Délai</label>
              <input type="date" data-id="${id}" data-cat="${cat}" data-field="delai" value="${escapeAttr(rec.delai||'')}">
            </div>
            <div class="field">
              <label>Statut</label>
              <select data-id="${id}" data-cat="${cat}" data-field="statut">
                <option value="-">—</option>
                <option value="Ouvert" ${rec.statut==='Ouvert'?'selected':''}>Ouvert</option>
                <option value="En cours" ${rec.statut==='En cours'?'selected':''}>En cours</option>
                <option value="Clôturé" ${rec.statut==='Clôturé'?'selected':''}>Clôturé</option>
              </select>
            </div>
            <div class="field full">
              <label>Commentaire</label>
              <textarea data-id="${id}" data-cat="${cat}" data-field="commentaire" placeholder="Observations…">${escapeHtml(rec.commentaire||'')}</textarea>
            </div>
            ${lastUpdatedNote(rec)}
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderCatBody(cat) {
  if (cat === 'crible') return renderCribles();
  if (cat === 'bande') return renderBandes();
  if (cat === 'broyeur') return renderSimpleList('broyeur', BASE.broyeurs, REF.broyeur);
  if (cat === 'pompe') return renderSimpleList('pompe', BASE.pompes.map((p,i)=>({...p, __idx:i})), REF.pompe);
}

// -------------------------------------------------------------------------
// HANDLERS DES FORMULAIRES
// -------------------------------------------------------------------------
function attachFormHandlers(onFieldCriticalChange) {
  document.querySelectorAll('.equip-head').forEach(head => {
    head.addEventListener('click', () => {
      const id = head.dataset.group;
      openGroups[id] = !openGroups[id];
      if (onFieldCriticalChange) onFieldCriticalChange();
    });
  });

  document.querySelectorAll('[data-field]').forEach(input => {
    const evt = (input.tagName === 'SELECT') ? 'change' : 'input';
    input.addEventListener(evt, (e) => {
      const { id, cat, field } = e.target.dataset;
      setField(cat, id, field, e.target.value);
      if ((field === 'etat' || field === 'anomalie' || field === 'statut') && onFieldCriticalChange) {
        onFieldCriticalChange();
      }
    });
  });
}

function openGroupFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return;
  openGroups[hash] = true;
  setTimeout(() => {
    const target = document.querySelector(`[data-group="${hash}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}

// -------------------------------------------------------------------------
// TEMPS RÉEL — se met à jour automatiquement quand quelqu'un d'autre saisit
// -------------------------------------------------------------------------
function subscribeRealtime(onChange) {
  supabaseClient
    .channel('releves-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'releves' }, async () => {
      await loadAllEdits();
      onChange();
    })
    .subscribe();
}

// -------------------------------------------------------------------------
// UTILS
// -------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str) { return escapeHtml(str); }