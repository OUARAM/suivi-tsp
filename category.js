// =========================================================================
// CATEGORY.JS — page générique par catégorie d'équipement, Supabase
// La page HTML doit définir : <body data-category="crible|bande|broyeur|pompe">
// =========================================================================

const CATEGORY = document.body.dataset.category;
const CAT_INFO = CAT_META[CATEGORY];

function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderNav(CATEGORY)}
    ${renderCategoryHeader()}
    <div id="catBody">${renderCatBody(CATEGORY)}</div>
  `;
  attachNavHandlers();
  attachFormHandlers(refreshBody);
  openGroupFromHash();
}

function refreshBody() {
  document.getElementById('catBody').innerHTML = renderCatBody(CATEGORY);
  attachFormHandlers(refreshBody);
  const headerCount = document.getElementById('catAnomCount');
  if (headerCount) {
    const n = buildCategoryRecords(CATEGORY).filter(isAnomaly).length;
    headerCount.textContent = n;
    headerCount.style.display = n > 0 ? 'inline-flex' : 'none';
  }
  const nav = document.querySelector('.nav-bar');
  if (nav) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderNav(CATEGORY);
    nav.outerHTML = wrapper.querySelector('.nav-bar').outerHTML;
  }
}

function renderCategoryHeader() {
  const count = buildCategoryRecords(CATEGORY).filter(isAnomaly).length;
  const totalCount = buildCategoryRecords(CATEGORY).length;
  return `
    <div class="section-title" style="margin-top:4px;">
      <span>${CAT_INFO.icon} ${CAT_INFO.label} — ${totalCount} élément(s) suivis
        <span id="catAnomCount" class="tab-badge" style="${count>0?'':'display:none;'}margin-left:6px;">${count}</span>
      </span>
    </div>
  `;
}

// -------------------------------------------------------------------------
// INIT
// -------------------------------------------------------------------------
requireAuth(async () => {
  await loadAllEdits();
  render();
  subscribeRealtime(() => refreshBody());
});