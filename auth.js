// =========================================================================
// AUTH.JS — écran de connexion / inscription, partagé par toutes les pages
// Inscription libre : un compte créé automatiquement en "Technicien / zone Toutes"
// =========================================================================

let authMode = 'signin'; // signin | signup | forgot
let authError = '';
let authInfo = '';       // message de succès (ex: lien envoyé)
let authLoading = false;
let currentSession = null;
let currentProfile = null; // { nom, role, zone }
let inPasswordRecovery = false; // true quand l'utilisateur arrive via le lien de réinitialisation

// escapeHtml minimal (auth.js se charge avant common.js, donc on ne dépend pas de lui ici)
function authEscapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// -------------------------------------------------------------------------
// RÉCUPÉRATION DE MOT DE PASSE — détection du lien reçu par email
// Supabase place le token dans l'URL (#access_token=...&type=recovery) et
// déclenche l'événement PASSWORD_RECOVERY dès que le client le détecte.
// On enregistre cette écoute tout de suite, avant même requireAuth().
// -------------------------------------------------------------------------
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    inPasswordRecovery = true;
    currentSession = session;
    authError = '';
    authInfo = '';
    renderNewPasswordScreen();
  }
});

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

  // Si on vient de cliquer sur un lien "mot de passe oublié", on reste sur
  // l'écran de saisie du nouveau mot de passe tant qu'il n'a pas été défini.
  if (inPasswordRecovery) {
    renderNewPasswordScreen();
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
  if (authMode === 'forgot') {
    renderForgotPasswordScreen();
    return;
  }

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
          ${authMode === 'signin' ? `
            <div style="text-align:right;margin-top:-6px;">
              <a href="#" id="forgotPasswordLink" style="font-size:12.5px;color:var(--muted);text-decoration:none;">Mot de passe oublié ?</a>
            </div>
          ` : ''}
          ${authError ? `<div class="auth-error">${authEscapeHtml(authError)}</div>` : ''}
          ${authInfo ? `<div class="auth-note" style="color:var(--ocp-forest);">${authEscapeHtml(authInfo)}</div>` : ''}
          <button type="submit" class="auth-submit" ${authLoading ? 'disabled' : ''}>
            ${authLoading ? 'Veuillez patienter…' : (authMode === 'signin' ? 'Se connecter' : 'Créer mon compte')}
          </button>
        </form>

        <a href="qrcode.html" style="display:block;text-align:center;margin-top:18px;font-size:12px;color:var(--muted);text-decoration:none;">📱 Code QR de l'application</a>
      </div>
    </div>
  `;
  attachAuthHandlers();
}

// -------------------------------------------------------------------------
// ÉCRAN "MOT DE PASSE OUBLIÉ" — saisie de l'email, envoi du lien
// -------------------------------------------------------------------------
function renderForgotPasswordScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand" style="justify-content:center;margin-bottom:6px;">
          <img src="logo-atelier-tsp.png" alt="Atelier TSP" style="height:100px;width:auto;">
        </div>
        <h1 style="text-align:center;">Mot de passe oublié</h1>
        <div class="sub" style="text-align:center;margin-bottom:20px;">
          Saisissez votre email, nous vous enverrons un lien de réinitialisation.
        </div>

        <form id="forgotForm" class="auth-form">
          <div class="field">
            <label>Email</label>
            <input type="email" id="forgotEmail" placeholder="vous@ocp.ma" required>
          </div>
          ${authError ? `<div class="auth-error">${authEscapeHtml(authError)}</div>` : ''}
          ${authInfo ? `<div class="auth-note" style="color:var(--ocp-forest);">${authEscapeHtml(authInfo)}</div>` : ''}
          <button type="submit" class="auth-submit" ${authLoading ? 'disabled' : ''}>
            ${authLoading ? 'Envoi en cours…' : 'Envoyer le lien de réinitialisation'}
          </button>
        </form>

        <a href="#" id="backToSigninLink" style="display:block;text-align:center;margin-top:18px;font-size:12.5px;color:var(--muted);text-decoration:none;">← Retour à la connexion</a>
      </div>
    </div>
  `;
  attachForgotHandlers();
}

function attachForgotHandlers() {
  document.getElementById('backToSigninLink').addEventListener('click', (e) => {
    e.preventDefault();
    authMode = 'signin';
    authError = '';
    authInfo = '';
    renderAuthScreen();
  });

  document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();

    authError = '';
    authInfo = '';
    authLoading = true;
    renderForgotPasswordScreen();

    // L'utilisateur sera renvoyé vers index.html avec un token de récupération
    // dans l'URL ; auth.js détecte alors l'événement PASSWORD_RECOVERY.
    const redirectTo = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    authLoading = false;

    // On affiche toujours le même message, que l'email existe ou non
    // (évite de révéler si une adresse est enregistrée dans le système).
    if (error) {
      console.error('Erreur resetPasswordForEmail :', error);
    }
    authInfo = "Si cet email est associé à un compte, un lien de réinitialisation vient d'être envoyé. Vérifiez votre boîte mail (et vos spams).";
    renderForgotPasswordScreen();
  });
}

// -------------------------------------------------------------------------
// ÉCRAN "NOUVEAU MOT DE PASSE" — affiché après clic sur le lien reçu par email
// -------------------------------------------------------------------------
function renderNewPasswordScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand" style="justify-content:center;margin-bottom:6px;">
          <img src="logo-atelier-tsp.png" alt="Atelier TSP" style="height:100px;width:auto;">
        </div>
        <h1 style="text-align:center;">Nouveau mot de passe</h1>
        <div class="sub" style="text-align:center;margin-bottom:20px;">Choisissez un nouveau mot de passe pour votre compte</div>

        <form id="newPasswordForm" class="auth-form">
          <div class="field">
            <label>Nouveau mot de passe</label>
            <input type="password" id="newPassword" placeholder="••••••••" minlength="6" required>
          </div>
          <div class="field">
            <label>Confirmer le mot de passe</label>
            <input type="password" id="newPasswordConfirm" placeholder="••••••••" minlength="6" required>
          </div>
          ${authError ? `<div class="auth-error">${authEscapeHtml(authError)}</div>` : ''}
          <button type="submit" class="auth-submit" ${authLoading ? 'disabled' : ''}>
            ${authLoading ? 'Veuillez patienter…' : 'Mettre à jour le mot de passe'}
          </button>
        </form>
      </div>
    </div>
  `;
  attachNewPasswordHandlers();
}

function attachNewPasswordHandlers() {
  document.getElementById('newPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('newPassword').value;
    const confirmPwd = document.getElementById('newPasswordConfirm').value;

    authError = '';

    if (password !== confirmPwd) {
      authError = "Les deux mots de passe ne correspondent pas.";
      renderNewPasswordScreen();
      return;
    }
    if (password.length < 6) {
      authError = "Le mot de passe doit contenir au moins 6 caractères.";
      renderNewPasswordScreen();
      return;
    }

    authLoading = true;
    renderNewPasswordScreen();

    const { error } = await supabaseClient.auth.updateUser({ password });
    authLoading = false;

    if (error) {
      authError = translateAuthError(error.message);
      renderNewPasswordScreen();
      return;
    }

    inPasswordRecovery = false;
    // On force une reconnexion propre pour repartir sur un état sain
    await supabaseClient.auth.signOut();
    authMode = 'signin';
    authError = '';
    authInfo = "Mot de passe mis à jour avec succès. Connectez-vous avec votre nouveau mot de passe.";
    location.reload();
  });
}

function attachAuthHandlers() {
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      authMode = btn.dataset.mode;
      authError = '';
      authInfo = '';
      renderAuthScreen();
    });
  });

  const forgotLink = document.getElementById('forgotPasswordLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      authMode = 'forgot';
      authError = '';
      authInfo = '';
      renderAuthScreen();
    });
  }

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