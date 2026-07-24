// =========================================================================
// EXPORT-RELEVES.JS — export Excel de l'historique des relevés
// 3 modes : complet / groupé par jour / groupé par équipement
// Nécessite (chargés avant lui) : SheetJS (xlsx), supabase-config.js ;
// utilise fetchProfilNames, défini dans common.js (appelée seulement au
// moment du clic, donc l'ordre de chargement des scripts n'a pas d'importance)
// =========================================================================

const CAT_LABEL_EXPORT = { crible: 'Crible', bande: 'Bande', broyeur: 'Broyeur', pompe: 'Pompe' };
const EXPORT_HEADERS = [
  'Date', 'Heure', 'Catégorie', 'Code équipement', 'Ligne', 'Description', 'Composant',
  'État', 'Anomalie constatée', 'Action corrective', 'Responsable', 'Délai', 'Statut',
  'Commentaire', 'Saisi par'
];
const EXPORT_MODE_LABEL = { complet: 'complet', jour: 'par_jour', equipement: 'par_equipement' };

async function fetchExportRows() {
  const { data, error } = await supabaseClient
    .from('releves')
    .select('*, equipements(categorie, code, ligne, description, composant)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userIds = [...new Set((data || []).map(r => r.saisi_par).filter(Boolean))];
  const names = await fetchProfilNames(userIds);

  return (data || []).map(r => {
    const eq = r.equipements || {};
    const created = r.created_at ? new Date(r.created_at) : null;
    return {
      _createdAt: created,
      _cat: eq.categorie || '',
      _code: eq.code || '',
      _composant: eq.composant || eq.description || '',
      row: {
        'Date': created ? created.toLocaleDateString('fr-FR') : '',
        'Heure': created ? created.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
        'Catégorie': CAT_LABEL_EXPORT[eq.categorie] || eq.categorie || '',
        'Code équipement': eq.code || '',
        'Ligne': eq.ligne || '',
        'Description': eq.description || '',
        'Composant': eq.composant || '',
        'État': r.etat || '',
        'Anomalie constatée': r.anomalie || '',
        'Action corrective': r.action_corrective || '',
        'Responsable': r.responsable || '',
        'Délai': r.delai || '',
        'Statut': r.statut || '',
        'Commentaire': r.commentaire || '',
        'Saisi par': r.saisi_par ? (names[r.saisi_par] || '—') : '—'
      }
    };
  });
}

function buildSheetAoa(items, mode) {
  const aoa = [EXPORT_HEADERS];

  if (mode === 'complet') {
    // Déjà trié par date décroissante (ordre de la requête)
    items.forEach(it => aoa.push(EXPORT_HEADERS.map(h => it.row[h])));
    return aoa;
  }

  let sorted, keyFn, labelFn;

  if (mode === 'equipement') {
    // Groupé par équipement (catégorie + code + composant), chronologique à l'intérieur
    sorted = [...items].sort((a, b) => {
      const ka = `${a._cat}|${a._code}|${a._composant}`;
      const kb = `${b._cat}|${b._code}|${b._composant}`;
      if (ka !== kb) return ka.localeCompare(kb);
      return (a._createdAt || 0) - (b._createdAt || 0);
    });
    keyFn = it => `${it._cat}|${it._code}|${it._composant}`;
    labelFn = it => `${CAT_LABEL_EXPORT[it._cat] || it._cat} ${it._code} — ${it._composant || 'N/A'}`;
  } else {
    // 'jour' — groupé par journée, la plus récente en premier
    sorted = [...items].sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
    keyFn = it => it._createdAt ? it._createdAt.toISOString().slice(0, 10) : 'inconnue';
    labelFn = it => it._createdAt
      ? it._createdAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : 'Date inconnue';
  }

  let lastKey = null;
  sorted.forEach(it => {
    const k = keyFn(it);
    if (k !== lastKey) {
      if (lastKey !== null) aoa.push([]); // ligne vide entre les groupes
      aoa.push([`— ${labelFn(it)} —`]);
      lastKey = k;
    }
    aoa.push(EXPORT_HEADERS.map(h => it.row[h]));
  });

  return aoa;
}

async function exportReleves(mode) {
  mode = mode || 'complet';
  const btn = document.getElementById('btn-export');
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Export en cours…'; }

  try {
    const items = await fetchExportRows();

    if (items.length === 0) {
      alert('Aucun relevé à exporter pour le moment.');
      return;
    }

    const aoa = buildSheetAoa(items, mode);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 10 },
      { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 26 }, { wch: 24 },
      { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 32 }, { wch: 18 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relevés');

    const dateStr = new Date().toISOString().slice(0, 10);
    const suffix = EXPORT_MODE_LABEL[mode] || 'complet';
    XLSX.writeFile(wb, `export_releves_${suffix}_${dateStr}.xlsx`);
  } catch (err) {
    console.error('Erreur export :', err);
    alert("Erreur lors de l'export : " + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}