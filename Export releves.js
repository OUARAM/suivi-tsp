// =========================================================================
// EXPORT-RELEVES.JS — export Excel de l'historique complet des relevés
// Nécessite (chargés avant lui) : SheetJS (xlsx), supabase-config.js,
// auth.js (pour fetchProfilNames — en réalité définie dans common.js,
// voir ordre de chargement dans les pages HTML)
// =========================================================================

const CAT_LABEL_EXPORT = { crible: 'Crible', bande: 'Bande', broyeur: 'Broyeur', pompe: 'Pompe' };

async function exportReleves() {
  const btn = document.getElementById('btn-export');
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Export en cours…'; }

  try {
    // Toutes les lignes de la table releves (jamais écrasée), jointes à
    // equipements pour avoir des libellés lisibles plutôt que des UUID.
    const { data, error } = await supabaseClient
      .from('releves')
      .select('*, equipements(categorie, code, ligne, description, composant)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((data || []).map(r => r.saisi_par).filter(Boolean))];
    const names = await fetchProfilNames(userIds);

    const rows = (data || []).map(r => {
      const eq = r.equipements || {};
      const created = r.created_at ? new Date(r.created_at) : null;
      return {
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
      };
    });

    if (rows.length === 0) {
      alert('Aucun relevé à exporter pour le moment.');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 10 },
      { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 26 }, { wch: 24 },
      { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 32 }, { wch: 18 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relevés');

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `export_releves_${dateStr}.xlsx`);
  } catch (err) {
    console.error('Erreur export :', err);
    alert("Erreur lors de l'export : " + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}