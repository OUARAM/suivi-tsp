// =========================================================================
// AUTH.JS — écran de connexion / inscription, partagé par toutes les pages
// Inscription libre : un compte créé automatiquement en "Technicien / zone Toutes"
// =========================================================================

let authMode = 'signin'; // signin | signup
let authError = '';
let authLoading = false;
let currentSession = null;
let currentProfile = null; // { nom, role, zone }

// escapeHtml minimal (auth.js se charge avant common.js, donc on ne dépend pas de lui ici)
function authEscapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// -------------------------------------------------------------------------
// GARDE D'AUTHENTIFICATION — appelée par chaque page avant d'initialiser l'app
// -------------------------------------------------------------------------
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Délai dépassé (${label})`)), ms))
  ]);
}

function renderFatalError(err) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand" style="justify-content:center;margin-bottom:10px;">
          <div class="brand-mark" style="background:linear-gradient(155deg,#B33A2E,#7A251C);">⚠</div>
        </div>
        <h1 style="text-align:center;color:var(--alert-red);">Connexion impossible</h1>
        <div class="auth-error" style="margin-top:14px;">${authEscapeHtml(err && err.message ? err.message : String(err))}</div>
        <div class="auth-note">
          Vérifiez votre connexion internet, ou qu'un pare-feu/antivirus ne bloque pas l'accès à <b>*.supabase.co</b>.
          Ouvrez la console (F12) et l'onglet Network pour plus de détails.
        </div>
        <button class="auth-submit" onclick="location.reload()" style="margin-top:14px;">Réessayer</button>
      </div>
    </div>
  `;
}

async function requireAuth(onAuthenticated) {
  try {
    const { data, error } = await withTimeout(supabaseClient.auth.getSession(), 10000, 'connexion à Supabase');
    if (error) throw error;
    currentSession = data.session;
  } catch (err) {
    console.error('Erreur requireAuth :', err);
    renderFatalError(err);
    return;
  }

  if (!currentSession) {
    renderAuthScreen();
    return;
  }

  try {
    await withTimeout(loadCurrentProfile(), 10000, 'chargement du profil');
    await withTimeout(onAuthenticated(), 15000, 'chargement des données');
  } catch (err) {
    console.error('Erreur au chargement :', err);
    renderFatalError(err);
    return;
  }

  // Si l'utilisateur se déconnecte dans un autre onglet, on revient à l'écran de connexion.
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });
}

async function loadCurrentProfile() {
  const { data, error } = await supabaseClient
    .from('profils')
    .select('nom, role, zone')
    .eq('id', currentSession.user.id)
    .maybeSingle();
  if (!error && data) {
    currentProfile = data;
    currentUser = data.nom || currentSession.user.email;
  } else {
    currentUser = currentSession.user.email;
  }
}

async function signOutApp() {
  await supabaseClient.auth.signOut();
  location.reload();
}

// -------------------------------------------------------------------------
// ÉCRAN DE CONNEXION / INSCRIPTION
// -------------------------------------------------------------------------
function renderAuthScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand" style="justify-content:center;margin-bottom:6px;">
          <img src="logo-atelier-tsp.png" alt="Atelier TSP" style="height:100px;width:auto;">
        </div>
        <h1 style="text-align:center;">Suivi Journalier des Équipements</h1>
        <div class="sub" style="text-align:center;margin-bottom:20px;">Atelier TSP — Groupe OCP</div>

        <div class="auth-tabs">
          <button class="auth-tab ${authMode==='signin'?'active':''}" data-mode="signin">Se connecter</button>
          <button class="auth-tab ${authMode==='signup'?'active':''}" data-mode="signup">Créer un compte</button>
        </div>

        <form id="authForm" class="auth-form">
          ${authMode === 'signup' ? `
            <div class="field">
              <label>Nom complet</label>
              <input type="text" id="authNom" placeholder="Votre nom" required>
            </div>
          ` : ''}
          <div class="field">
            <label>Email</label>
            <input type="email" id="authEmail" placeholder="vous@ocp.ma" required>
          </div>
          <div class="field">
            <label>Mot de passe</label>
            <input type="password" id="authPassword" placeholder="••••••••" minlength="6" required>
          </div>
          ${authError ? `<div class="auth-error">${authEscapeHtml(authError)}</div>` : ''}
          <button type="submit" class="auth-submit" ${authLoading ? 'disabled' : ''}>
            ${authLoading ? 'Veuillez patienter…' : (authMode === 'signin' ? 'Se connecter' : 'Créer mon compte')}
          </button>
        </form>

        ${authMode === 'signup' ? `
          <div class="auth-note">Votre compte est créé automatiquement avec le rôle Technicien et l'accès à tous les équipements. Un administrateur pourra ajuster vos droits plus tard.</div>
        ` : ''}

        <a href="qrcode.html" style="display:block;text-align:center;margin-top:18px;font-size:12px;color:var(--muted);text-decoration:none;">📱 Code QR de l'application</a>
      </div>
    </div>
  `;
  attachAuthHandlers();
}

function attachAuthHandlers() {
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      authMode = btn.dataset.mode;
      authError = '';
      renderAuthScreen();
    });
  });

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    // On lit les valeurs saisies AVANT tout ré-affichage du formulaire,
    // sinon renderAuthScreen() régénère des champs vides et on perd la saisie.
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const nom = authMode === 'signup' ? document.getElementById('authNom').value.trim() : '';

    authError = '';
    authLoading = true;
    renderAuthScreen();

    if (authMode === 'signup') {
      const { data, error } = await supabaseClient.auth.signUp({
        email, password, options: { data: { nom } }
      });
      authLoading = false;
      if (error) {
        authError = translateAuthError(error.message);
        renderAuthScreen();
        return;
      }
      // Email déjà utilisé : Supabase renvoie un "user" avec identities vide, sans erreur explicite.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        authError = "Un compte existe déjà avec cet email. Connectez-vous ci-dessous.";
        authMode = 'signin';
        renderAuthScreen();
        return;
      }
      if (data.session) {
        location.reload();
      } else {
        authError = "Compte créé. Si la confirmation par email est activée sur le projet, vérifiez votre boîte mail avant de vous connecter.";
        authMode = 'signin';
        renderAuthScreen();
      }
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      authLoading = false;
      if (error) {
        authError = translateAuthError(error.message);
        renderAuthScreen();
        return;
      }
      location.reload();
    }
  });
}

function translateAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return "Email ou mot de passe incorrect.";
  if (/user already registered/i.test(msg)) return "Un compte existe déjà avec cet email. Connectez-vous ci-dessous.";
  if (/password should be/i.test(msg)) return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/email/i.test(msg) && /invalid/i.test(msg)) return "Adresse email invalide.";
  return msg;
}