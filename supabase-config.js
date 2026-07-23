// =========================================================================
// SUPABASE-CONFIG.JS — connexion à votre projet Supabase
// L'URL et la clé "anon" sont publiques par conception (faites pour être
// visibles dans le code d'un site web). Ne mettez JAMAIS la clé
// "service_role" ici.
// =========================================================================
const SUPABASE_URL = 'https://pzaodfomkrkgjrrtaner.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6YW9kZm9ta3JrZ2pycnRhbmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODc3ODAsImV4cCI6MjA5OTk2Mzc4MH0.z_xH-MyA8-bwXH2g2q9W2ZsJLiQ_-ePvMWDWHn-O98k';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);