/**
 * ═══════════════════════════════════════════════════════════════
 * FINOX CRM - Configuration Partagée + Auth Centralisée v2.1
 * ═══════════════════════════════════════════════════════════════
 *
 * Ce fichier gère:
 * - Authentification OAuth (Google/Microsoft)
 * - Protection des pages (redirect si non connecté)
 * - Tokens Google pour APIs (Gmail, Calendar, Drive)
 * - Données client
 * - Utilitaires communs
 *
 * Chargé par: app.html, abf.html, et tous les modules
 *
 * SÉCURITÉ:
 * - La clé Supabase ANON est conçue pour être publique (protégée par RLS)
 * - Les tokens sensibles sont stockés en sessionStorage (pas localStorage)
 * - Mode production désactive les logs de debug
 */

if (window.FINOX) {
    // Config déjà chargé - skip
} else {

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    // Mode production - désactive les logs de debug
    const IS_PRODUCTION = ['crm.finox.ca', 'crm-finox.ca', 'abf.crm-finox.ca', 'finox-abf.pages.dev'].includes(window.location.hostname);

    // Logger conditionnel - ne log qu'en développement
    const log = {
        debug: (...args) => { if (!IS_PRODUCTION) console.log(...args); },
        warn: (...args) => { if (!IS_PRODUCTION) console.warn(...args); },
        error: (...args) => console.error(...args) // Toujours logger les erreurs
    };

    // Configuration Supabase
    // Note: La clé ANON est conçue pour être publique - la sécurité repose sur RLS
    const SUPABASE_URL = 'https://vtcnnqzxreuxupsbjufg.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Y25ucXp4cmV1eHVwc2JqdWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDU0NzUsImV4cCI6MjA4NDUyMTQ3NX0.3-rRe2N37ecgjlqtybNMi4WkRGOHoCgpx-P1pD1kxhI';
    const LOGIN_PAGE = '/index.html';
    const GOOGLE_API = 'https://crm.finox.ca/google';

    // Organisation (Multi-tenant future-proof)
    const ORG_ID = '7572c420-6c4d-4313-8284-7ba5a4351f2c';

    // Instance Supabase
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // État global avec WeakRef pour éviter les fuites mémoire
    let currentUser = null;
    let clientDataCache = null;
    let conseillerSettings = {};
    let _userProfile = null;

    // Timer pour cleanup automatique du cache
    let cacheCleanupTimer = null;

    // ═══════════════════════════════════════════════════════════════
    // STORAGE SÉCURISÉ - sessionStorage pour tokens sensibles
    // ═══════════════════════════════════════════════════════════════

    const secureStorage = {
        // Tokens sensibles -> sessionStorage (effacé à la fermeture du navigateur)
        setToken: (key, value) => {
            try {
                sessionStorage.setItem(key, value);
            } catch (err) {
                log.error('[Storage] Erreur setToken:', err.message);
            }
        },
        getToken: (key) => {
            try {
                return sessionStorage.getItem(key);
            } catch (err) {
                log.error('[Storage] Erreur getToken:', err.message);
                return null;
            }
        },
        removeToken: (key) => {
            try {
                sessionStorage.removeItem(key);
            } catch (err) {
                log.error('[Storage] Erreur removeToken:', err.message);
            }
        },
        // Données non-sensibles -> localStorage (persistant)
        set: (key, value) => {
            try {
                localStorage.setItem(key, value);
            } catch (err) {
                log.error('[Storage] Erreur set:', err.message);
            }
        },
        get: (key) => {
            try {
                return localStorage.getItem(key);
            } catch (err) {
                log.error('[Storage] Erreur get:', err.message);
                return null;
            }
        },
        remove: (key) => {
            try {
                localStorage.removeItem(key);
            } catch (err) {
                log.error('[Storage] Erreur remove:', err.message);
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // AUTHENTIFICATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Vérifie si l'utilisateur est connecté.
     * Si non connecté, redirige vers la page de login.
     */
    async function requireAuth() {
        log.debug('[Auth] Vérification...');

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 5000)
        );

        try {
            const { data, error } = await Promise.race([
                sb.auth.getSession(),
                timeoutPromise
            ]);

            if (error) {
                log.error('[Auth] Erreur getSession:', error.message);
                redirectToLogin();
                return null;
            }

            const session = data?.session;

            if (session?.user) {
                currentUser = session.user;

                if (session.provider_token) {
                    secureStorage.setToken('finox_provider_token', session.provider_token);
                    secureStorage.set('finox_provider', session.provider_token.startsWith('ya29.') ? 'google' : 'microsoft');
                    secureStorage.set('finox_user_email', session.user.email);
                }

                log.debug('[Auth] OK:', session.user.email);
                return session.user;
            } else {
                log.debug('[Auth] Pas de session');
                redirectToLogin();
                return null;
            }
        } catch (err) {
            log.error('[Auth] Erreur:', err.message);
            redirectToLogin();
            return null;
        }
    }

    function redirectToLogin() {
        log.debug('[Auth] Redirection vers login');
        secureStorage.set('finox_redirect_after_login', window.location.href);
        window.location.href = LOGIN_PAGE;
    }

    async function logout() {
        // Nettoyer tous les tokens
        secureStorage.removeToken('finox_provider_token');
        secureStorage.removeToken('finox_provider_refresh_token');
        secureStorage.remove('finox_provider');
        secureStorage.remove('finox_user_email');

        // Nettoyer le cache mémoire
        clearCache();

        await sb.auth.signOut();
        window.location.href = LOGIN_PAGE;
    }

    async function checkAuth() {
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (session?.user) {
                currentUser = session.user;
                return session.user;
            }
            return null;
        } catch (err) {
            log.error('[Auth] Erreur checkAuth:', err.message);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GOOGLE OAUTH - TOKENS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Migre les tokens de localStorage (index.html) vers sessionStorage (config.js).
     * Corrige le mismatch de storage entre le login et l'app.
     */
    function migrateTokensFromLocalStorage() {
        const localToken = localStorage.getItem('finox_provider_token');
        if (localToken && !sessionStorage.getItem('finox_provider_token')) {
            sessionStorage.setItem('finox_provider_token', localToken);
            const localProvider = localStorage.getItem('finox_provider');
            if (localProvider) sessionStorage.setItem('finox_provider', localProvider);
            // Migrate refresh token too
            const localRefresh = localStorage.getItem('finox_provider_refresh_token');
            if (localRefresh) sessionStorage.setItem('finox_provider_refresh_token', localRefresh);
            log.debug('[Auth] Tokens migrés de localStorage vers sessionStorage');
        }
    }

    // Run migration immediately on load
    migrateTokensFromLocalStorage();

    function getGoogleTokens() {
        const provider = secureStorage.get('finox_provider');
        const token = secureStorage.getToken('finox_provider_token');

        const isGoogleToken = token && token.startsWith('ya29.');

        if ((provider === 'google' || isGoogleToken) && token) {
            if (provider !== 'google' && isGoogleToken) {
                secureStorage.set('finox_provider', 'google');
            }

            return {
                access_token: token,
                email: secureStorage.get('finox_user_email') || currentUser?.email || 'Connecté'
            };
        }
        return null;
    }

    function isGoogleConnected() {
        return getGoogleTokens() !== null;
    }

    function isMicrosoftConnected() {
        const provider = secureStorage.get('finox_provider');
        const token = secureStorage.getToken('finox_provider_token');
        return provider === 'microsoft' && token && !token.startsWith('ya29.');
    }

    function getProvider() {
        return secureStorage.get('finox_provider');
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILISATEUR & CONSEILLER
    // ═══════════════════════════════════════════════════════════════

    function getCurrentUser() {
        return currentUser;
    }

    function setCurrentUser(user) {
        currentUser = user;
    }

    /**
     * Charge et cache le profil utilisateur (incluant le role).
     * A appeler une fois au demarrage apres requireAuth().
     */
    async function loadUserProfile() {
        if (_userProfile) return _userProfile;
        const user = getCurrentUser();
        if (!user) return null;

        try {
            const { data, error } = await sb
                .from('profiles')
                .select('id, organization_id, role, first_name, last_name, email, phone, titre, email_signature, signature_config, photo_url, numero_amf, booking_slug, booking_config, onboarding_completed')
                .eq('id', user.id)
                .single();

            if (error) throw error;
            _userProfile = data;
            return data;
        } catch (err) {
            log.error('[Config] Erreur loadUserProfile:', err.message);
            return null;
        }
    }

    function isAdmin() {
        return _userProfile?.role === 'admin';
    }

    function getEmailSignature() {
        const p = _userProfile;
        if (p?.email_signature) return p.email_signature;
        // Fallback: signature par défaut
        const name = `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || 'Conseiller';
        const titre = p?.titre || 'Conseiller en sécurité financière';
        const phone = p?.phone || '';
        const email = p?.email || '';
        return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;margin-top:20px;padding-top:15px;border-top:1px solid #eee;"><div style="margin-bottom:4px;"><strong style="color:#1a1a2e;">${name}</strong></div><div style="color:#666;margin-bottom:8px;">${titre}</div>${phone ? `<div style="margin-bottom:2px;">📞 ${phone}</div>` : ''}${email ? `<div>✉️ <a href="mailto:${email}" style="color:#C9A227;text-decoration:none;">${email}</a></div>` : ''}</div>`;
    }

    function getUserProfile() {
        return _userProfile;
    }

    /**
     * Invalide le cache du profil et recharge depuis Supabase.
     * Utile apres modification de la signature, du theme, etc.
     */
    function refreshUserProfile() {
        _userProfile = null;
        return loadUserProfile();
    }

    // Cache des IDs conseillers visibles (via délégations)
    let _visibleConseillerIds = null;

    /**
     * Retourne les IDs de tous les conseillers dont l'utilisateur peut voir les clients.
     * Inclut : lui-même + partenaires + conseillers gérés (adjoint_de)
     * Pour admin : retourne null (= pas de filtre, voit tout)
     */
    async function getVisibleConseillerIds() {
        if (isAdmin()) return null; // Admin voit tout
        if (_visibleConseillerIds) return _visibleConseillerIds;

        const user = getCurrentUser();
        if (!user) return [user?.id];

        try {
            // Récupérer les délégations actives où l'utilisateur est delegate
            const { data: delegations } = await sb
                .from('team_delegations')
                .select('conseiller_id')
                .eq('delegate_id', user.id)
                .eq('is_active', true);

            const ids = new Set([user.id]);
            if (delegations) {
                delegations.forEach(d => ids.add(d.conseiller_id));
            }

            _visibleConseillerIds = Array.from(ids);
            log.debug('[Config] Conseillers visibles:', _visibleConseillerIds.length);
            return _visibleConseillerIds;
        } catch (err) {
            log.error('[Config] Erreur getVisibleConseillerIds:', err.message);
            return [user.id]; // Fallback : seulement ses propres clients
        }
    }

    function resetVisibleConseillerIds() {
        _visibleConseillerIds = null;
    }

    function loadConseillerSettings() {
        const saved = secureStorage.get('finox_conseiller');
        if (saved) {
            try {
                conseillerSettings = JSON.parse(saved);
            } catch (parseErr) {
                log.warn('[Config] Erreur parsing conseiller settings:', parseErr.message);
                conseillerSettings = {};
            }
        }
        return conseillerSettings;
    }

    function getConseillerSettings() {
        return conseillerSettings;
    }

    function saveConseillerSettings(settings) {
        conseillerSettings = settings;
        secureStorage.set('finox_conseiller', JSON.stringify(settings));
    }

    // ═══════════════════════════════════════════════════════════════
    // CLIENT ID - Avec validation
    // ═══════════════════════════════════════════════════════════════

    function getClientId() {
        const params = new URLSearchParams(window.location.search);
        const clientId = params.get('client') || params.get('id');
        // Validation basique UUID
        if (clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
            return clientId;
        }
        return null;
    }

    function setClientId(id) {
        // Validation UUID avant de setter
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            log.error('[Config] Client ID invalide:', id);
            return;
        }
        const url = new URL(window.location.href);
        url.searchParams.set('client', id);
        window.history.pushState({}, '', url);
        window.FINOX.CLIENT_ID = id;
    }

    // ═══════════════════════════════════════════════════════════════
    // GESTION MÉMOIRE - Cleanup du cache + Module cleanup registry
    // ═══════════════════════════════════════════════════════════════

    // Registry pour les intervals/timeouts des modules (évite les fuites mémoire)
    let _moduleIntervals = [];
    let _moduleTimeouts = [];
    let _moduleCleanupCallbacks = [];

    /**
     * Enregistre un setInterval qui sera automatiquement nettoyé au changement de module.
     * Utiliser à la place de setInterval() dans les modules.
     */
    function registerInterval(fn, delay) {
        const id = setInterval(fn, delay);
        _moduleIntervals.push(id);
        return id;
    }

    /**
     * Enregistre un setTimeout qui sera automatiquement nettoyé au changement de module.
     */
    function registerTimeout(fn, delay) {
        const id = setTimeout(fn, delay);
        _moduleTimeouts.push(id);
        return id;
    }

    /**
     * Enregistre un callback de cleanup custom pour le module courant.
     */
    function registerCleanup(fn) {
        if (typeof fn === 'function') {
            _moduleCleanupCallbacks.push(fn);
        }
    }

    /**
     * Nettoie tous les intervals, timeouts et callbacks enregistrés par les modules.
     * Appelé automatiquement avant de charger un nouveau module.
     */
    function cleanupModuleResources() {
        // Clear all registered intervals
        _moduleIntervals.forEach(id => clearInterval(id));
        _moduleIntervals = [];

        // Clear all registered timeouts
        _moduleTimeouts.forEach(id => clearTimeout(id));
        _moduleTimeouts = [];

        // Run custom cleanup callbacks
        _moduleCleanupCallbacks.forEach(fn => {
            try { fn(); } catch (e) { log.error('[Cleanup] Erreur callback:', e.message); }
        });
        _moduleCleanupCallbacks = [];

        log.debug('[Cleanup] Ressources modules nettoyées');
    }

    function clearCache() {
        clientDataCache = null;
        currentUser = null;
        conseillerSettings = {};
        _userProfile = null;
        _visibleConseillerIds = null;
        _queryCache.clear();

        if (cacheCleanupTimer) {
            clearTimeout(cacheCleanupTimer);
            cacheCleanupTimer = null;
        }

        cleanupModuleResources();
        log.debug('[Cache] Nettoyé');
    }

    // Cleanup automatique après 30 min d'inactivité
    function scheduleCacheCleanup() {
        if (cacheCleanupTimer) {
            clearTimeout(cacheCleanupTimer);
        }
        cacheCleanupTimer = setTimeout(() => {
            log.debug('[Cache] Cleanup automatique après inactivité');
            clientDataCache = null;
        }, 30 * 60 * 1000);
    }

    // ═══════════════════════════════════════════════════════════════
    // QUERY CACHE - Évite les requêtes répétées entre modules
    // ═══════════════════════════════════════════════════════════════

    const _queryCache = new Map();
    const DEFAULT_CACHE_TTL = 30000; // 30 secondes

    /**
     * Exécute une requête Supabase avec cache.
     * Si le même cacheKey a été requis dans les dernières `ttl` ms, retourne le cache.
     * @param {string} cacheKey - Clé unique pour cette requête
     * @param {Function} queryFn - Fonction async qui retourne les données
     * @param {number} ttl - Durée de vie du cache en ms (défaut: 30s)
     * @returns {Promise<*>} - Données du cache ou de la requête
     */
    async function cachedQuery(cacheKey, queryFn, ttl = DEFAULT_CACHE_TTL) {
        const cached = _queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < ttl)) {
            log.debug('[Cache] Hit:', cacheKey);
            return cached.data;
        }

        const data = await queryFn();
        _queryCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Invalide une entrée du cache ou tout le cache.
     * @param {string} [cacheKey] - Clé à invalider. Si omis, vide tout le cache.
     */
    function invalidateCache(cacheKey) {
        if (cacheKey) {
            _queryCache.delete(cacheKey);
        } else {
            _queryCache.clear();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DONNÉES CLIENT
    // ═══════════════════════════════════════════════════════════════

    function mapClientData(client) {
        if (!client) return null;
        return {
            ...client,
            date_naissance: client.date_of_birth,
            sexe: client.sex,
            fumeur: client.smoker,
            conjoint_date_naissance: client.conjoint_dob,
            conjoint_sexe: client.conjoint_sex,
            conjoint_fumeur: client.conjoint_smoker,
            revenu_annuel: (parseFloat(client.revenu_emploi) || 0) + (parseFloat(client.revenu_autre) || 0),
            conjoint_revenu_annuel: (parseFloat(client.revenu_emploi_conjoint) || 0) + (parseFloat(client.revenu_autre_conjoint) || 0),
            besoin_vie_client: client.conf_montant_vie_client,
            besoin_vie_conjoint: client.conf_montant_vie_conjoint,
            besoin_invalidite_client: client.conf_montant_invalidite_client,
            besoin_invalidite_conjoint: client.conf_montant_invalidite_conjoint,
            saq_type_assurance: client.abf_data?.saq_type_assurance || '',
            saq_montant_vie: client.abf_data?.saq_montant_vie || '',
            saq_montant_invalidite: client.abf_data?.saq_montant_invalidite || '',
            saq_terme: client.abf_data?.saq_terme || ''
        };
    }

    async function loadClientData() {
        const clientId = getClientId();
        if (!clientId) {
            log.warn('[Client] Pas de CLIENT_ID valide');
            return null;
        }

        try {
            const { data, error } = await sb
                .from('clients')
                .select('*')
                .eq('id', clientId)
                .single();

            if (error) throw error;

            clientDataCache = mapClientData(data);
            scheduleCacheCleanup();
            return clientDataCache;
        } catch (err) {
            log.error('[Client] Erreur chargement:', err.message);
            return null;
        }
    }

    function getClientData() {
        return clientDataCache;
    }

    function updateClientDataCache(updates) {
        if (clientDataCache) {
            clientDataCache = { ...clientDataCache, ...updates };
            scheduleCacheCleanup();
        }
    }

    async function refreshClientData() {
        return await loadClientData();
    }

    async function saveClientData(dataToSave) {
        const clientId = getClientId();
        if (!clientId) return { success: false, error: 'Pas de CLIENT_ID' };

        try {
            const cleanData = { ...dataToSave };
            delete cleanData.id;
            delete cleanData.created_at;
            cleanData.updated_at = new Date().toISOString();

            const { error } = await sb
                .from('clients')
                .update(cleanData)
                .eq('id', clientId);

            if (error) throw error;

            updateClientDataCache(dataToSave);
            return { success: true };
        } catch (err) {
            log.error('[Client] Erreur sauvegarde:', err.message);
            return { success: false, error: err.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITAIRES DE FORMATAGE
    // ═══════════════════════════════════════════════════════════════

    // Parse un nombre formaté fr-CA (espaces insécables, virgule décimale, $ %)
    // Gère: "350 000,50 $", "1\u00A0234,56", "350000.50", "350,000.50"
    function parseNumber(v) {
        if (!v && v !== 0) return 0;
        if (typeof v === 'number') return isNaN(v) ? 0 : v;
        let s = String(v);
        s = s.replace(/[\s\u00A0\u202F]/g, '');   // espaces normaux + insécables + narrow no-break
        s = s.replace(/[$%]/g, '');                 // symboles monétaires
        // Virgule décimale: "1234,56" → "1234.56" (1-2 chiffres après virgule en fin de string)
        s = s.replace(/,(\d{1,2})$/, '.$1');
        s = s.replace(/,/g, '');                    // virgules milliers restantes
        return parseFloat(s) || 0;
    }

    function formatMoney(amount) {
        return new Intl.NumberFormat('fr-CA', {
            style: 'currency',
            currency: 'CAD',
            minimumFractionDigits: 0
        }).format(amount || 0);
    }

    // Formater un nombre avec espaces (sans $) — ex: 500000 → "500 000", 69.90 → "69,90"
    function formatNumber(n) {
        if (!n && n !== 0) return '';
        const num = typeof n === 'string' ? parseNumber(n) : n;
        if (!num && num !== 0) return '';
        // Préserver les décimales si elles existent (ex: 69.90), sinon pas de décimale (ex: 500000)
        const hasDecimals = num !== Math.floor(num);
        return num.toLocaleString('fr-CA', {
            minimumFractionDigits: hasDecimals ? 2 : 0,
            maximumFractionDigits: 2
        });
    }

    // Auto-format des inputs monétaires (.money-input)
    // - Au focus: montre le nombre brut pour édition facile
    // - Au blur: formate avec espaces (ex: "500 000")
    // Compatible avec oninput handlers existants (parseFloat/parseNumber)
    function setupMoneyInput(input) {
        if (!input || input._moneySetup) return;
        input._moneySetup = true;

        // Convertir type="number" en type="text" avec inputmode numérique
        if (input.type === 'number') {
            const step = input.step;
            input.type = 'text';
            input.setAttribute('inputmode', 'decimal');
            if (step) input.dataset.step = step;
        }

        // Formater la valeur initiale
        const initVal = parseNumber(input.value);
        if (initVal) input.value = formatNumber(initVal);

        input.addEventListener('focus', function () {
            const raw = parseNumber(this.value);
            this.value = raw || '';
            requestAnimationFrame(() => this.select());
        });

        input.addEventListener('blur', function () {
            const raw = parseNumber(this.value);
            this.value = raw ? formatNumber(raw) : '';
        });
    }

    // Initialiser tous les .money-input dans un container (ou document)
    function setupAllMoneyInputs(container) {
        (container || document).querySelectorAll('.money-input').forEach(setupMoneyInput);
    }

    // Parse une date en heure LOCALE (évite le décalage UTC-4/5 de Montréal)
    // "1976-06-14" → 14 juin local au lieu de 13 juin (bug UTC minuit)
    function parseLocalDate(dateStr) {
        if (!dateStr) return null;
        // Si c'est déjà un objet Date, le retourner
        if (dateStr instanceof Date) return dateStr;
        const s = String(dateStr);
        // Date-only "YYYY-MM-DD" → parser comme local
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [y, m, d] = s.split('-').map(Number);
            return new Date(y, m - 1, d);
        }
        // ISO datetime avec T → contient déjà l'heure, OK tel quel
        return new Date(s);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        return parseLocalDate(dateStr).toLocaleDateString('fr-CA');
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '-';
        const diff = Math.floor((new Date() - parseLocalDate(dateStr)) / 1000);
        if (diff < 60) return "À l'instant";
        if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
        return formatDate(dateStr);
    }

    function formatPhone(phone) {
        if (!phone) return '-';
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 10) {
            return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
        }
        if (cleaned.length === 11 && cleaned.startsWith('1')) {
            return `(${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7)}`;
        }
        return phone;
    }

    function setupPhoneInput(inputElement) {
        if (!inputElement) return;

        inputElement.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 10) value = value.slice(0, 10);

            if (value.length >= 6) {
                e.target.value = `(${value.slice(0,3)}) ${value.slice(3,6)}-${value.slice(6)}`;
            } else if (value.length >= 3) {
                e.target.value = `(${value.slice(0,3)}) ${value.slice(3)}`;
            } else if (value.length > 0) {
                e.target.value = `(${value}`;
            } else {
                e.target.value = '';
            }
        });

        if (inputElement.value) {
            const cleaned = inputElement.value.replace(/\D/g, '');
            if (cleaned.length === 10) {
                inputElement.value = `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
            }
        }
    }

    function setupAllPhoneInputs(container = document) {
        const phoneInputs = container.querySelectorAll('input[type="tel"], input[id*="phone"], input[id*="Phone"], input[id*="telephone"], input[id*="Telephone"]');
        phoneInputs.forEach(input => setupPhoneInput(input));
    }

    function setupDateInput(inputElement) {
        if (!inputElement) return;

        inputElement.setAttribute('min', '1900-01-01');
        inputElement.setAttribute('max', '2100-12-31');

        inputElement.addEventListener('input', function(e) {
            const value = e.target.value;
            if (value) {
                const parts = value.split('-');
                if (parts[0] && parts[0].length > 4) {
                    parts[0] = parts[0].slice(0, 4);
                    e.target.value = parts.join('-');
                }
            }
        });

        inputElement.addEventListener('change', function(e) {
            const value = e.target.value;
            if (value) {
                const parts = value.split('-');
                if (parts[0] && parts[0].length > 4) {
                    parts[0] = parts[0].slice(0, 4);
                    e.target.value = parts.join('-');
                }
            }
        });
    }

    function setupAllDateInputs(container = document) {
        const dateInputs = container.querySelectorAll('input[type="date"]');
        dateInputs.forEach(input => setupDateInput(input));
    }

    function calculateAge(birthDate) {
        if (!birthDate) return null;
        const today = new Date();
        const birth = parseLocalDate(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    }

    // ═══════════════════════════════════════════════════════════════
    // LABELS & CONFIG
    // ═══════════════════════════════════════════════════════════════

    const STATUT_LABELS = {
        proposition_soumise: 'Soumise',
        attente_conseiller: 'Attente',
        tarification: 'Tarification',
        exigence_assureur: 'Exigence assureur',
        exigence_finox: 'Exigence Finox',
        a_faire_signature: 'À signer',
        attente_signature: 'Attente signature',
        traiter_commission: 'Commission',
        en_vigueur: 'En vigueur',
        annule_ferme: 'Annulé'
    };

    function getStatutLabel(statut) {
        return STATUT_LABELS[statut] || statut;
    }

    function getLeadStatusConfig(status) {
        return LEAD_STATUS_CONFIG[status] || LEAD_STATUS_CONFIG['Nouveau Lead'];
    }

    // ═══════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════

    function showNotification(message, type = 'success') {
        document.querySelectorAll('.finox-notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = `finox-notification ${type}`;
        notification.style.zIndex = '99999';

        const iconMap = { success: 'check', warning: 'alert', error: 'x' };
        notification.innerHTML = `
            <span class="notif-icon">${iconMap[type] || 'info'}</span>
            <span class="notif-text">${message}</span>
        `;

        document.body.appendChild(notification);
        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // ═══════════════════════════════════════════════════════════════
    // MEET RECORD ALERT
    // ═══════════════════════════════════════════════════════════════
    function showRecordAlert() {
        // Remove existing
        document.querySelectorAll('.finox-record-alert').forEach(el => el.remove());

        const alert = document.createElement('div');
        alert.className = 'finox-record-alert';
        alert.innerHTML = `
            <div class="fra-icon">🔴</div>
            <div class="fra-content">
                <div class="fra-title">N'oublie pas d'enregistrer!</div>
                <div class="fra-text">Clique sur "Commencer à enregistrer" dans Google Meet pour activer le transcript automatique.</div>
            </div>
            <button class="fra-close" onclick="this.parentElement.remove()">✕</button>
        `;

        // Inject CSS if not already there
        if (!document.getElementById('finox-record-alert-css')) {
            const style = document.createElement('style');
            style.id = 'finox-record-alert-css';
            style.textContent = `
                .finox-record-alert {
                    position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-100px);
                    padding: 16px 24px; background: linear-gradient(135deg, #1a1a2e, #16213e);
                    border: 2px solid #ef4444; border-radius: 16px; display: flex; align-items: center; gap: 16px;
                    z-index: 99999; max-width: 500px; width: 90%;
                    box-shadow: 0 10px 40px rgba(239,68,68,0.3), 0 0 20px rgba(239,68,68,0.1);
                    animation: fraSlideIn 0.5s ease forwards, fraPulse 2s ease-in-out 3 0.5s;
                }
                @keyframes fraSlideIn { to { transform: translateX(-50%) translateY(0); } }
                @keyframes fraPulse { 0%,100% { border-color: #ef4444; } 50% { border-color: #f97316; box-shadow: 0 10px 40px rgba(249,115,22,0.4); } }
                .fra-icon { font-size: 32px; animation: fraIconPulse 1s ease-in-out infinite; }
                @keyframes fraIconPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
                .fra-content { flex: 1; }
                .fra-title { font-size: 16px; font-weight: 700; color: #ef4444; margin-bottom: 4px; }
                .fra-text { font-size: 13px; color: #aaa; line-height: 1.4; }
                .fra-close { background: none; border: none; color: #666; font-size: 18px; cursor: pointer; padding: 4px; }
                .fra-close:hover { color: #fff; }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(alert);

        // Auto-dismiss after 15 seconds
        setTimeout(() => {
            if (alert.parentElement) {
                alert.style.transition = 'all 0.3s ease';
                alert.style.opacity = '0';
                alert.style.transform = 'translateX(-50%) translateY(-100px)';
                setTimeout(() => alert.remove(), 300);
            }
        }, 15000);
    }

    // ═══════════════════════════════════════════════════════════════
    // CONFIRM / ALERT DIALOGS (remplace les natifs)
    // ═══════════════════════════════════════════════════════════════

    function _ensureDialogCSS() {
        if (document.getElementById('finox-dialog-css')) return;
        const style = document.createElement('style');
        style.id = 'finox-dialog-css';
        style.textContent = `
            .finox-dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 99999; opacity: 0; animation: fdFadeIn 0.2s forwards; }
            @keyframes fdFadeIn { to { opacity: 1; } }
            .finox-dialog { background: var(--bg-card, #1a1a2e); border: 1px solid var(--border-color, #333); border-radius: 20px; padding: 32px; max-width: 440px; width: 90%; text-align: center; transform: scale(0.9); animation: fdScaleIn 0.25s forwards; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
            @keyframes fdScaleIn { to { transform: scale(1); } }
            .finox-dialog-icon { font-size: 48px; margin-bottom: 16px; }
            .finox-dialog-title { font-size: 18px; font-weight: 700; color: var(--text-primary, #fff); margin-bottom: 10px; }
            .finox-dialog-msg { font-size: 14px; color: var(--text-secondary, #aaa); line-height: 1.6; margin-bottom: 28px; white-space: pre-line; }
            .finox-dialog-btns { display: flex; gap: 12px; justify-content: center; }
            .finox-dialog-btns button { padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; min-width: 120px; }
            .finox-dialog-btns .fd-cancel { background: var(--bg-hover, #2a2a3e); color: var(--text-secondary, #aaa); border: 1px solid var(--border-color, #333); }
            .finox-dialog-btns .fd-cancel:hover { color: var(--text-primary, #fff); border-color: var(--text-muted, #666); }
            .finox-dialog-btns .fd-confirm { background: linear-gradient(135deg, var(--gold, #c9a227), var(--gold-dark, #a8861a)); color: #000; }
            .finox-dialog-btns .fd-confirm:hover { transform: translateY(-2px); box-shadow: 0 6px 20px var(--gold-glow, rgba(201,162,39,0.3)); }
            .finox-dialog-btns .fd-danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
            .finox-dialog-btns .fd-danger:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(239,68,68,0.3); }
        `;
        document.head.appendChild(style);
    }

    function _createDialog(message, title, icon, buttons) {
        return new Promise(resolve => {
            _ensureDialogCSS();
            // Supprimer un dialog existant
            document.querySelectorAll('.finox-dialog-overlay').forEach(el => el.remove());

            const overlay = document.createElement('div');
            overlay.className = 'finox-dialog-overlay';

            const msgHtml = (message || '').replace(/\n/g, '<br>');

            overlay.innerHTML = `
                <div class="finox-dialog">
                    <div class="finox-dialog-icon">${icon}</div>
                    ${title ? `<div class="finox-dialog-title">${title}</div>` : ''}
                    <div class="finox-dialog-msg">${msgHtml}</div>
                    <div class="finox-dialog-btns">
                        ${buttons.map(b => `<button class="${b.cls}" data-val="${b.val}">${b.label}</button>`).join('')}
                    </div>
                </div>
            `;

            overlay.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.remove(), 200);
                    resolve(btn.dataset.val === 'true');
                });
            });

            // Fermer avec Escape = annuler
            const onKey = e => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', onKey);
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.remove(), 200);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', onKey);

            document.body.appendChild(overlay);
        });
    }

    function showConfirmDialog(message, title) {
        // Détecter si c'est une suppression pour utiliser le bouton rouge
        const isDelete = /supprimer|irréversible|définitivement/i.test(message || '') || /supprimer/i.test(title || '');
        return _createDialog(
            message,
            title || 'Confirmation',
            isDelete ? '⚠️' : '❓',
            [
                { label: 'Annuler', cls: 'fd-cancel', val: 'false' },
                { label: isDelete ? 'Supprimer' : 'Confirmer', cls: isDelete ? 'fd-danger' : 'fd-confirm', val: 'true' }
            ]
        );
    }

    function showAlertDialog(message, title) {
        return _createDialog(
            message,
            title || 'Information',
            'ℹ️',
            [{ label: 'OK', cls: 'fd-confirm', val: 'true' }]
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMELINE
    // ═══════════════════════════════════════════════════════════════

    async function addTimelineEntry(activityType, title, description = null) {
        const clientId = getClientId();
        if (!clientId) return;

        try {
            await sb.from('client_timeline').insert({
                client_id: clientId,
                activity_type: activityType,
                title: title,
                description: description,
                created_at: new Date().toISOString()
            });

            // Invalidate Pulse cache when activity is added
            invalidateCache(`pulse_${clientId}`);
            invalidateCache('pulse_all');
        } catch (err) {
            log.error('[Timeline] Erreur:', err.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GOOGLE CONNECTION - SAUVEGARDE EN BASE (CHIFFRÉ - PIPEDA)
    // ═══════════════════════════════════════════════════════════════

    async function saveGoogleConnection(userId, accessToken, refreshToken, userEmail, userName, userPicture) {
        try {
            const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

            const { error } = await sb.rpc('save_google_connection_secure', {
                p_user_id: userId,
                p_access_token: accessToken,
                p_refresh_token: refreshToken || '',
                p_expires_at: expiresAt,
                p_google_email: userEmail || null,
                p_google_name: userName || null,
                p_google_picture: userPicture || null
            });

            if (error) {
                log.error('[Google] Erreur sauvegarde connection:', error.message);
            } else {
                log.debug('[Google] Connection sauvegardée (chiffrée)');
            }
        } catch (err) {
            log.error('[Google] Erreur saveGoogleConnection:', err.message);
        }
    }

    async function updateGoogleToken(userId, accessToken) {
        try {
            const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

            const { error } = await sb.rpc('save_google_connection_secure', {
                p_user_id: userId,
                p_access_token: accessToken,
                p_refresh_token: '',
                p_expires_at: expiresAt,
                p_google_email: null,
                p_google_name: null,
                p_google_picture: null
            });

            if (error) {
                log.error('[Google] Erreur update token:', error.message);
            } else {
                log.debug('[Google] Token mis à jour (chiffré)');
            }
        } catch (err) {
            log.error('[Google] Erreur updateGoogleToken:', err.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // AUTH STATE LISTENER
    // ═══════════════════════════════════════════════════════════════

    sb.auth.onAuthStateChange(async (event, session) => {
        log.debug('[Auth] State:', event);

        if (session?.user) {
            currentUser = session.user;

            if (session.provider_token) {
                const isGoogle = session.provider_token.startsWith('ya29.');
                const provider = isGoogle ? 'google' : 'microsoft';

                secureStorage.setToken('finox_provider_token', session.provider_token);
                secureStorage.set('finox_provider', provider);
                secureStorage.set('finox_user_email', session.user.email);

                if (isGoogle) {
                    const refreshToken = session.provider_refresh_token || secureStorage.getToken('finox_provider_refresh_token');
                    if (session.provider_refresh_token) {
                        secureStorage.setToken('finox_provider_refresh_token', session.provider_refresh_token);
                    }

                    const userName = session.user.user_metadata?.full_name || session.user.user_metadata?.name;
                    const userPicture = session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture;

                    saveGoogleConnection(
                        session.user.id,
                        session.provider_token,
                        refreshToken,
                        session.user.email,
                        userName,
                        userPicture
                    );
                }
            }
        } else if (event === 'SIGNED_OUT') {
            clearCache();
            secureStorage.removeToken('finox_provider_token');
            secureStorage.removeToken('finox_provider_refresh_token');
            secureStorage.remove('finox_provider');
            secureStorage.remove('finox_user_email');
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // GOOGLE API FETCH — Centralisé avec auto-refresh
    // ═══════════════════════════════════════════════════════════════

    const GOOGLE_API_BASE = '/google';

    // Timestamp de la dernière fois qu'on a validé/rafraîchi le token
    let _lastTokenRefresh = 0;
    let _tokenRefreshPromise = null;

    /**
     * Assure que le Google access token est valide.
     * Appelle le serveur pour refresh si nécessaire.
     * Returns le token valide ou null.
     */
    async function ensureValidGoogleToken() {
        const token = secureStorage.getToken('finox_provider_token');
        if (!token || !token.startsWith('ya29.')) return null;

        const userId = currentUser?.id;
        if (!userId) return token;

        // Ne pas refresh plus d'une fois par 4 minutes
        const now = Date.now();
        if (now - _lastTokenRefresh < 4 * 60 * 1000) return token;

        // Si un refresh est déjà en cours, attendre
        if (_tokenRefreshPromise) return await _tokenRefreshPromise;

        _tokenRefreshPromise = (async () => {
            try {
                const resp = await fetch(GOOGLE_API_BASE + '/refresh-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId }
                });
                const data = await resp.json();
                if (resp.ok && data.access_token) {
                    secureStorage.setToken('finox_provider_token', data.access_token);
                    _lastTokenRefresh = Date.now();
                    log.debug('[Google] Token rafraîchi proactivement');
                    return data.access_token;
                }
                // Si refresh échoue, garder le token actuel (peut encore être valide)
                _lastTokenRefresh = Date.now();
                return secureStorage.getToken('finox_provider_token');
            } catch (e) {
                log.error('[Google] Erreur refresh proactif:', e.message);
                _lastTokenRefresh = Date.now();
                return secureStorage.getToken('finox_provider_token');
            } finally {
                _tokenRefreshPromise = null;
            }
        })();

        return await _tokenRefreshPromise;
    }

    /**
     * Appel Google API centralisé. Envoie toujours X-User-Id pour permettre
     * le refresh côté serveur si le Bearer token est expiré.
     * Si le serveur retourne une erreur token, tente un refresh puis retry.
     */
    async function googleFetch(endpoint, options = {}) {
        const userId = currentUser?.id;
        const token = secureStorage.getToken('finox_provider_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        // Toujours envoyer X-User-Id pour permettre le refresh serveur
        if (userId) headers['X-User-Id'] = userId;
        // Envoyer le Bearer token si disponible (accélère si encore valide)
        if (token && !headers['Authorization']) {
            headers['Authorization'] = 'Bearer ' + token;
        }

        const url = endpoint.startsWith('http') ? endpoint : GOOGLE_API_BASE + endpoint;
        let response, data;

        try {
            response = await fetch(url, { ...options, headers });
            data = await response.json();
        } catch (e) {
            throw new Error('Network error: ' + e.message);
        }

        // Vérifier si erreur de token
        const isTokenError = data.error && (
            String(data.error).includes('invalid authentication') ||
            String(data.error).includes('Token expired') ||
            String(data.error).includes('Invalid Credentials') ||
            String(data.error).includes('Token has been expired') ||
            response.status === 401
        );

        if (isTokenError && userId) {
            log.debug('[Google] Token expiré, tentative de refresh via serveur...');
            try {
                // Demander au serveur de rafraîchir le token
                const refreshResp = await fetch(GOOGLE_API_BASE + '/refresh-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId }
                });
                const refreshData = await refreshResp.json();

                if (refreshResp.ok && refreshData.access_token) {
                    // Mettre à jour le token local
                    secureStorage.setToken('finox_provider_token', refreshData.access_token);
                    log.debug('[Google] Token rafraîchi avec succès');

                    // Retry la requête originale avec le nouveau token
                    headers['Authorization'] = 'Bearer ' + refreshData.access_token;
                    const retryResp = await fetch(url, { ...options, headers });
                    return await retryResp.json();
                } else {
                    log.error('[Google] Refresh échoué:', refreshData.error || 'Unknown');
                }
            } catch (refreshErr) {
                log.error('[Google] Erreur refresh:', refreshErr.message);
            }
        }

        return data;
    }

    // ═══════════════════════════════════════════════════════════════
    // CLEANUP AU UNLOAD
    // ═══════════════════════════════════════════════════════════════

    window.addEventListener('beforeunload', () => {
        if (cacheCleanupTimer) {
            clearTimeout(cacheCleanupTimer);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // PULSE VITAL — Client Health Score Engine
    // ═══════════════════════════════════════════════════════════════

    const PULSE_ZONES = {
        optimal:   { min: 80, max: 100, color: '#22c55e', label: 'Excellent',  animDuration: '2s',  icon: '💚' },
        stable:    { min: 60, max: 79,  color: '#C9A227', label: 'Stable',     animDuration: '3s',  icon: '💛' },
        attention: { min: 35, max: 59,  color: '#f59e0b', label: 'Attention',  animDuration: '5s',  icon: '🧡' },
        critique:  { min: 0,  max: 34,  color: '#ef4444', label: 'Critique',   animDuration: '8s',  icon: '❤️‍🩹' }
    };

    // ══════════════════════════════════════════════════════════════
    // PROSPECT PULSE — Zones, statuts lead, pipeline, suggestions
    // ══════════════════════════════════════════════════════════════
    const PROSPECT_ZONES = {
        hot:    { min: 75, max: 100, color: '#ef4444', label: 'Lead CHAUD',  icon: '🔥', animDuration: '1.5s' },
        warm:   { min: 50, max: 74,  color: '#f59e0b', label: 'Lead TIÈDE',  icon: '🌤️', animDuration: '3s' },
        cool:   { min: 25, max: 49,  color: '#3b82f6', label: 'Lead FROID',  icon: '🌥️', animDuration: '5s' },
        frozen: { min: 0,  max: 24,  color: '#64748b', label: 'Lead GELÉ',   icon: '🧊', animDuration: '8s' }
    };

    const LEAD_STATUS_CONFIG = {
        'Nouveau Lead':             { icon: '🆕', color: '#607D8B', order: 1,  pipelinePos: 0 },
        'Lead non rejoint':         { icon: '📵', color: '#00BCD4', order: 2,  pipelinePos: 0 },
        'À rappeler':               { icon: '📞', color: '#9C27B0', order: 3,  pipelinePos: 0 },
        'Le lead analyse le tout':  { icon: '🤔', color: '#2196F3', order: 4,  pipelinePos: 1 },
        'Replanifier rencontre':    { icon: '🔄', color: '#26A69A', order: 5,  pipelinePos: 1 },
        'No Show':                  { icon: '👻', color: '#FF9800', order: 6,  pipelinePos: 1 },
        'Rencontre booker':         { icon: '📅', color: '#4CAF50', order: 7,  pipelinePos: 2 },
        'ABF':                      { icon: '📋', color: '#7C4DFF', order: 8,  pipelinePos: 3 },
        'Vente':                    { icon: '🎉', color: '#4CAF50', order: 9,  pipelinePos: 4 },
        'Mauvais numéro':           { icon: '❌', color: '#FF5722', order: 99, pipelinePos: -1 },
        'Lead mort':                { icon: '💀', color: '#f44336', order: 99, pipelinePos: -1 }
    };

    const LEAD_PIPELINE_STAGES = [
        { id: 'contact',  label: 'Contact',   icon: '📞', statuses: ['Nouveau Lead', 'Lead non rejoint', 'À rappeler'] },
        { id: 'suivi',    label: 'Suivi',      icon: '🔄', statuses: ['Le lead analyse le tout', 'Replanifier rencontre', 'No Show'] },
        { id: 'rdv',      label: 'Rencontre',  icon: '📅', statuses: ['Rencontre booker'] },
        { id: 'abf',      label: 'ABF',        icon: '📋', statuses: ['ABF'] },
        { id: 'vente',    label: 'Vente',      icon: '🎉', statuses: ['Vente'] }
    ];

    const LEAD_SUGGESTIONS = {
        'Nouveau Lead':             { next: '📞 Effectuer le premier appel',         tip: 'Appeler dans les 5 min — les workflows font le reste', action: 'call' },
        'Lead non rejoint':         { next: '📞 Tenter un appel direct',              tip: 'Les séquences auto gèrent les SMS/emails',              action: 'call' },
        'À rappeler':               { next: '📞 Rappeler selon le plan',              tip: 'Préparer les questions de découverte',                  action: 'call' },
        'Rencontre booker':         { next: '📋 Préparer la rencontre',                tip: 'Revoir le dossier et les besoins du client',            action: 'prep' },
        'No Show':                  { next: '📞 Rappeler et replanifier',             tip: 'Proposer un nouveau créneau rapidement',                action: 'call' },
        'Le lead analyse le tout':  { next: '⏳ Laisser mûrir puis relancer',         tip: 'Planifier un suivi dans 48-72h',                       action: 'wait' },
        'Replanifier rencontre':    { next: '📅 Fixer un nouveau RDV',                tip: 'Proposer 2-3 créneaux par appel',                      action: 'meeting' },
        'ABF':                      { next: '📊 Compléter l\'ABF',                    tip: 'Vérifier les sections manquantes',                     action: 'abf' },
        'Vente':                    { next: '✅ Dossier en cours',                     tip: 'Vérifier le suivi au pipeline',                        action: 'pipeline' },
        'Mauvais numéro':           { next: '🔍 Trouver un autre numéro',             tip: 'Vérifier sur LinkedIn/Facebook/411',                   action: 'search' },
        'Lead mort':                { next: '💤 Archiver ou réactiver dans 6 mois',   tip: 'Ajouter une note de raison du décès',                  action: 'note' }
    };

    // Suggestions spécifiques par type de contact (override les suggestions par défaut)
    const LEAD_SUGGESTIONS_BY_TYPE = {
        client: {
            'Vente':    { next: '🤝 Entretenir la relation',       tip: 'Planifier une révision annuelle',              action: 'review' },
            'ABF':      { next: '📊 Mettre à jour l\'ABF',          tip: 'Réviser les besoins depuis le dernier bilan',  action: 'abf' }
        },
        prospect: {
            'Vente':    { next: '📋 Compléter l\'ABF et soumettre', tip: 'Finaliser les propositions d\'assurance',      action: 'abf' }
        }
    };

    function getProspectZone(score) {
        if (score >= 75) return 'hot';
        if (score >= 50) return 'warm';
        if (score >= 25) return 'cool';
        return 'frozen';
    }

    const CONTACT_ACTIVITY_TYPES = ['call_outbound', 'call_inbound', 'sms_outbound', 'sms_inbound', 'email_outbound', 'email_inbound', 'email_inbound_ai', 'meeting_virtual', 'meeting_inperson'];
    const ACTIVE_OPP_STAGES = ['active', 'identified', 'qualified', 'action_planned', 'in_progress', 'proposal_sent'];

    function getPulseZone(score, type) {
        if (type === 'prospect') return getProspectZone(score);
        if (type === 'corpo') return getCorpoZone(score);
        if (score >= 80) return 'optimal';
        if (score >= 60) return 'stable';
        if (score >= 35) return 'attention';
        return 'critique';
    }

    function getPulseColor(score, type) {
        const zone = getPulseZone(score, type);
        const zones = type === 'prospect' ? PROSPECT_ZONES : type === 'corpo' ? CORPO_ZONES : PULSE_ZONES;
        return zones[zone].color;
    }

    function getPulseLabel(score, type) {
        const zone = getPulseZone(score, type);
        const zones = type === 'prospect' ? PROSPECT_ZONES : type === 'corpo' ? CORPO_ZONES : PULSE_ZONES;
        return zones[zone].label;
    }

    function renderPulseRing(score, size = 40, type) {
        const zone = getPulseZone(score, type);
        const zones = type === 'prospect' ? PROSPECT_ZONES : type === 'corpo' ? CORPO_ZONES : PULSE_ZONES;
        const config = zones[zone];
        const radius = 16;
        const circumference = 2 * Math.PI * radius;
        const fillLength = (score / 100) * circumference;
        const fontSize = size <= 32 ? '9px' : size <= 48 ? '11px' : '14px';
        const titleLabel = type === 'prospect' ? 'Température' : type === 'corpo' ? 'Dossier' : 'Pulse';

        return `<div class="pulse-ring pulse-zone-${zone}" style="width:${size}px;height:${size}px;" title="${titleLabel}: ${score}/100 — ${config.label}">
            <svg viewBox="0 0 36 36" style="width:100%;height:100%;">
                <circle cx="18" cy="18" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2.5"/>
                <circle cx="18" cy="18" r="${radius}" fill="none" stroke="${config.color}" stroke-width="2.5"
                    stroke-dasharray="${fillLength} ${circumference}" stroke-linecap="round"
                    transform="rotate(-90 18 18)" class="pulse-ring-fill"/>
            </svg>
            <span class="pulse-ring-score" style="color:${config.color};font-size:${fontSize}">${score}</span>
        </div>`;
    }

    /**
     * Calcule le Pulse Score d'un PROSPECT (température du lead / copilote conversion).
     * @param {string} clientId - UUID du prospect
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<{score: number, zone: string, diagnostics: Array, factors: Object, suggestions: Object}>}
     */
    async function calculateProspectPulseScore(clientId, forceRefresh = false) {
        if (!clientId) return null;

        // Check cache first (5 min TTL)
        if (!forceRefresh) {
            const cached = await cachedQuery(`pulse_${clientId}`, async () => {
                const { data } = await sb.from('client_pulse_scores')
                    .select('*')
                    .eq('client_id', clientId)
                    .maybeSingle();
                if (data && (Date.now() - new Date(data.calculated_at).getTime() < 3600000)) {
                    return data;
                }
                return null;
            }, 300000);

            if (cached) {
                // Handle both formats: direct result (from memory cache) or DB row
                if (cached.score !== undefined) {
                    return cached; // Already in final format (from _queryCache line 1401)
                }
                return {
                    score: cached.pulse_score,
                    zone: cached.pulse_zone,
                    diagnostics: cached.diagnostics || [],
                    factors: cached.factor_breakdown || {},
                    suggestions: LEAD_SUGGESTIONS[cached.factor_breakdown?.statut_lead] || LEAD_SUGGESTIONS['Nouveau Lead']
                };
            }
        }

        invalidateCache(`pulse_${clientId}`);

        const now = new Date();

        // Fetch data in parallel
        const [clientRes, timelineRes, meetingsRes, tasksRes] = await Promise.all([
            sb.from('clients')
                .select('statut_lead, abf_data, type_contact, created_at, updated_at')
                .eq('id', clientId)
                .single(),
            sb.from('client_timeline')
                .select('activity_type, created_at')
                .eq('client_id', clientId)
                .order('created_at', { ascending: false })
                .limit(50),
            sb.from('scheduled_meetings')
                .select('status, scheduled_at')
                .eq('client_id', clientId)
                .gte('scheduled_at', now.toISOString()),
            sb.from('tasks')
                .select('status, due_date')
                .eq('client_id', clientId)
                .eq('status', 'pending')
        ]);

        const client = clientRes.data || {};
        const timeline = timelineRes.data || [];
        const futureMeetings = (meetingsRes.data || []).filter(m => m.status !== 'cancelled');
        const pendingTasks = tasksRes.data || [];

        const statutLead = client.statut_lead || 'Nouveau Lead';
        const leadConfig = LEAD_STATUS_CONFIG[statutLead] || LEAD_STATUS_CONFIG['Nouveau Lead'];
        const pipelinePos = leadConfig.pipelinePos;

        let score = 40; // Base
        const factors = { statut_lead: statutLead };
        const diagnostics = [];

        // ── P1: Position pipeline (+5 to +25) ──
        if (pipelinePos === -1) {
            factors.pipeline_position = 0;
        } else {
            const posPoints = [5, 10, 15, 20, 25];
            factors.pipeline_position = posPoints[Math.min(pipelinePos, 4)] || 5;
            score += factors.pipeline_position;
            if (pipelinePos >= 3) {
                diagnostics.push({ type: 'positive', category: 'pipeline', message: `Avancé au stade ${statutLead}`, action: 'Continuer la progression', points: factors.pipeline_position });
            }
        }

        // ── P2: Vélocité progression (+5 to +15) ──
        const daysSinceUpdate = client.updated_at ? Math.floor((now - new Date(client.updated_at)) / 86400000) : 999;
        if (daysSinceUpdate <= 7) {
            factors.velocity = 15;
            diagnostics.push({ type: 'positive', category: 'velocity', message: 'Progression rapide (< 7 jours)', points: 15 });
        } else if (daysSinceUpdate <= 14) {
            factors.velocity = 10;
        } else if (daysSinceUpdate <= 30) {
            factors.velocity = 5;
        } else {
            factors.velocity = 0;
        }
        score += factors.velocity;

        // ── P3: Contact récent (+5 to +15) ──
        const lastContactDate = timeline.length > 0 ? new Date(timeline[0].created_at) : null;
        const daysSinceContact = lastContactDate ? Math.floor((now - lastContactDate) / 86400000) : 999;
        if (daysSinceContact <= 3) {
            factors.recent_contact = 15;
            diagnostics.push({ type: 'positive', category: 'contact', message: 'Contact récent (< 3 jours)', points: 15 });
        } else if (daysSinceContact <= 7) {
            factors.recent_contact = 10;
        } else if (daysSinceContact <= 14) {
            factors.recent_contact = 5;
        } else {
            factors.recent_contact = 0;
        }
        score += factors.recent_contact;

        // ── P4: RDV planifié (+10) ──
        if (futureMeetings.length > 0) {
            factors.meeting_scheduled = 10;
            score += 10;
            diagnostics.push({ type: 'positive', category: 'meeting', message: `${futureMeetings.length} RDV planifié(s)`, points: 10 });
        } else {
            factors.meeting_scheduled = 0;
        }

        // ── P5: SAQ complété (+10) ──
        const abfData = client.abf_data || {};
        const hasSAQ = abfData.saq_completed || abfData.saq || Object.keys(abfData).some(k => k.toLowerCase().includes('saq'));
        if (hasSAQ) {
            factors.saq_completed = 10;
            score += 10;
            diagnostics.push({ type: 'positive', category: 'saq', message: 'SAQ complété', points: 10 });
        } else {
            factors.saq_completed = 0;
            if (pipelinePos >= 2) {
                diagnostics.push({ type: 'warning', category: 'saq', message: 'SAQ non complété', action: 'Envoyer le SAQ au prospect', points: 0 });
            }
        }

        // ── P6: ABF avancé (+3 to +10) ──
        const abfSections = ['profil_client', 'situation_financiere', 'objectifs', 'tolerance_risque', 'assurances', 'placements', 'budget'];
        const completedSections = abfSections.filter(s => abfData[s] && Object.keys(abfData[s]).length > 0).length;
        const abfPct = abfSections.length > 0 ? completedSections / abfSections.length : 0;
        if (abfPct > 0.75) {
            factors.abf_progress = 10;
        } else if (abfPct > 0.5) {
            factors.abf_progress = 7;
        } else if (abfPct > 0.25) {
            factors.abf_progress = 3;
        } else {
            factors.abf_progress = 0;
        }
        score += factors.abf_progress;
        if (factors.abf_progress > 0) {
            diagnostics.push({ type: 'positive', category: 'abf', message: `ABF complété à ${Math.round(abfPct * 100)}%`, points: factors.abf_progress });
        }

        // ── P7: Notes/activité (+3 to +5) ──
        if (timeline.length >= 5) {
            factors.activity_notes = 5;
        } else if (timeline.length >= 3) {
            factors.activity_notes = 3;
        } else {
            factors.activity_notes = 0;
        }
        score += factors.activity_notes;

        // ══════ PÉNALITÉS ══════

        // ── N1: Stagnation statut (-5 to -25) ──
        const daysSinceStatusChange = daysSinceUpdate;
        if (daysSinceStatusChange > 30) {
            factors.stagnation = -25;
            diagnostics.push({ type: 'danger', category: 'stagnation', message: `Même statut depuis ${daysSinceStatusChange} jours`, action: 'Faire avancer le lead ou le qualifier mort', points: -25 });
        } else if (daysSinceStatusChange > 21) {
            factors.stagnation = -15;
            diagnostics.push({ type: 'danger', category: 'stagnation', message: `Même statut depuis ${daysSinceStatusChange} jours`, action: 'Relancer le prospect', points: -15 });
        } else if (daysSinceStatusChange > 14) {
            factors.stagnation = -10;
            diagnostics.push({ type: 'warning', category: 'stagnation', message: `Même statut depuis ${daysSinceStatusChange} jours`, action: 'Planifier un suivi', points: -10 });
        } else if (daysSinceStatusChange > 7) {
            factors.stagnation = -5;
        } else {
            factors.stagnation = 0;
        }
        score += factors.stagnation;

        // ── N2: No Show (-15) ──
        if (statutLead === 'No Show') {
            factors.no_show = -15;
            score -= 15;
            diagnostics.push({ type: 'danger', category: 'no_show', message: 'Le prospect n\'est pas venu au RDV', action: 'Rappeler et replanifier immédiatement', points: -15 });
        } else {
            factors.no_show = 0;
        }

        // ── N3: Inactivité (-10 to -20) ──
        if (daysSinceContact > 30) {
            factors.inactivity = -20;
            diagnostics.push({ type: 'danger', category: 'inactivity', message: `Aucun contact depuis ${daysSinceContact} jours`, action: 'Relancer immédiatement', points: -20 });
        } else if (daysSinceContact > 21) {
            factors.inactivity = -15;
            diagnostics.push({ type: 'warning', category: 'inactivity', message: `Aucun contact depuis ${daysSinceContact} jours`, action: 'Planifier un appel', points: -15 });
        } else if (daysSinceContact > 14) {
            factors.inactivity = -10;
        } else {
            factors.inactivity = 0;
        }
        score += factors.inactivity;

        // ── N4: Replanification sans nouveau RDV (-10) ──
        if (statutLead === 'Replanifier rencontre' && futureMeetings.length === 0) {
            factors.replan_no_rdv = -10;
            score -= 10;
            diagnostics.push({ type: 'warning', category: 'replan', message: 'Rencontre à replanifier mais aucun RDV prévu', action: 'Fixer un nouveau RDV', points: -10 });
        } else {
            factors.replan_no_rdv = 0;
        }

        // ── N5: Pas de prochaine action (-10) ──
        if (futureMeetings.length === 0 && pendingTasks.length === 0) {
            factors.no_next_action = -10;
            score -= 10;
            diagnostics.push({ type: 'warning', category: 'next_action', message: 'Aucune action planifiée', action: 'Créer un rappel ou un RDV', points: -10 });
        } else {
            factors.no_next_action = 0;
        }

        // ── N6: Dead-end status (-20 to -30) ──
        if (statutLead === 'Lead mort') {
            factors.dead_end = -30;
            score -= 30;
            diagnostics.push({ type: 'danger', category: 'dead_end', message: 'Lead marqué comme mort', action: 'Archiver ou réactiver dans 6 mois', points: -30 });
        } else if (statutLead === 'Mauvais numéro') {
            factors.dead_end = -20;
            score -= 20;
            diagnostics.push({ type: 'danger', category: 'dead_end', message: 'Mauvais numéro de téléphone', action: 'Trouver un autre moyen de contact', points: -20 });
        } else {
            factors.dead_end = 0;
        }

        // ── Clamp score ──
        score = Math.max(0, Math.min(100, score));
        const zone = getProspectZone(score);

        // Sort diagnostics
        const typeOrder = { danger: 0, warning: 1, positive: 2 };
        diagnostics.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

        // ── Upsert to DB ──
        try {
            await sb.from('client_pulse_scores').upsert({
                client_id: clientId,
                organization_id: ORG_ID,
                pulse_score: score,
                pulse_zone: zone,
                diagnostics: diagnostics,
                factor_breakdown: factors,
                last_contact_at: lastContactDate ? lastContactDate.toISOString() : null,
                next_renewal_at: null,
                days_since_contact: daysSinceContact === 999 ? null : daysSinceContact,
                active_products_count: 0,
                open_tasks_count: pendingTasks.length,
                open_opportunities_count: 0,
                calculated_at: now.toISOString(),
                updated_at: now.toISOString()
            }, { onConflict: 'client_id' });
        } catch (err) {
            log.error('[Pulse Prospect] Erreur upsert:', err.message);
        }

        const suggestions = LEAD_SUGGESTIONS[statutLead] || LEAD_SUGGESTIONS['Nouveau Lead'];
        const result = { score, zone, diagnostics, factors, suggestions };

        _queryCache.set(`pulse_${clientId}`, { data: result, timestamp: Date.now() });

        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // PULSE VITAL — CORPORATION
    // ═══════════════════════════════════════════════════════════════

    const CORPO_ZONES = {
        optimal:   { min: 75, max: 100, color: '#22c55e', label: 'Dossier COMPLET',   icon: '💚' },
        stable:    { min: 50, max: 74,  color: '#C9A227', label: 'Dossier EN COURS',  icon: '💛' },
        attention: { min: 25, max: 49,  color: '#f59e0b', label: 'Dossier INCOMPLET', icon: '🟠' },
        critique:  { min: 0,  max: 24,  color: '#ef4444', label: 'Dossier VIDE',      icon: '🔴' }
    };

    function getCorpoZone(score) {
        if (score >= 75) return 'optimal';
        if (score >= 50) return 'stable';
        if (score >= 25) return 'attention';
        return 'critique';
    }

    /**
     * Calcule le Pulse Score d'une corporation.
     * Évalue la complétude du dossier corpo : ABF sections, contacts rattachés, produits.
     */
    async function calculateCorpoPulseScore(clientId, forceRefresh = false) {
        if (!clientId) return null;

        // Check memory cache
        if (!forceRefresh) {
            const cacheKey = `pulse_${clientId}`;
            const cached = _queryCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp < 300000)) {
                if (cached.data?.score !== undefined) return cached.data;
            }
        }

        const now = new Date();

        try {
            // Parallel data fetches
            const [clientRes, relationshipsRes, assurancesRes, opportunitiesRes, tasksRes] = await Promise.all([
                sb.from('clients')
                    .select('abf_data, first_name, created_at, updated_at')
                    .eq('id', clientId)
                    .single(),
                sb.from('client_relationships')
                    .select('related_client_id, relationship_type, metadata')
                    .eq('client_id', clientId)
                    .eq('relationship_type', 'actionnaire'),
                sb.from('assurances_vendues')
                    .select('type_produit, statut, date_expiration, updated_at')
                    .eq('client_id', clientId),
                sb.from('client_opportunities')
                    .select('stage, next_action_date, target_date')
                    .eq('client_id', clientId),
                sb.from('tasks')
                    .select('status, due_date, completed_at')
                    .eq('client_id', clientId)
            ]);

            const client = clientRes.data || {};
            const abfData = client.abf_data || {};
            const relationships = relationshipsRes.data || [];
            const assurances = assurancesRes.data || [];
            const opportunities = opportunitiesRes.data || [];
            const tasks = tasksRes.data || [];

            let score = 20; // Base corpo
            const diagnostics = [];
            const factors = {};

            // ════════════════════════════════════════════
            // P1: Contacts rattachés (+5 à +20)
            // ════════════════════════════════════════════
            const linkedContacts = relationships.length;
            if (linkedContacts >= 3) {
                factors.linked_contacts = 20;
                diagnostics.push({ type: 'positive', category: 'contacts', message: `${linkedContacts} actionnaires rattachés`, points: 20 });
            } else if (linkedContacts === 2) {
                factors.linked_contacts = 14;
                diagnostics.push({ type: 'positive', category: 'contacts', message: `${linkedContacts} actionnaires rattachés`, points: 14 });
            } else if (linkedContacts === 1) {
                factors.linked_contacts = 8;
                diagnostics.push({ type: 'positive', category: 'contacts', message: `${linkedContacts} actionnaire rattaché`, points: 8 });
            } else {
                factors.linked_contacts = 0;
            }
            score += factors.linked_contacts;

            // ════════════════════════════════════════════
            // P2: ABF perso complétés par les contacts (+5 à +15)
            // ════════════════════════════════════════════
            if (linkedContacts > 0) {
                const linkedIds = relationships.map(r => r.related_client_id);
                const { data: linkedClients } = await sb.from('clients')
                    .select('id, abf_data')
                    .in('id', linkedIds);

                const withAbf = (linkedClients || []).filter(c => {
                    const abd = c.abf_data || {};
                    return abd && typeof abd === 'object' && Object.keys(abd).length > 3;
                }).length;

                const pctAbf = linkedContacts > 0 ? withAbf / linkedContacts : 0;
                if (pctAbf >= 1) {
                    factors.linked_abf = 15;
                    diagnostics.push({ type: 'positive', category: 'abf_perso', message: `${withAbf}/${linkedContacts} ABF personnels complétés (100%)`, points: 15 });
                } else if (pctAbf >= 0.5) {
                    factors.linked_abf = 10;
                    diagnostics.push({ type: 'warning', category: 'abf_perso', message: `${withAbf}/${linkedContacts} ABF personnels complétés (${Math.round(pctAbf * 100)}%)`, action: 'Compléter les ABF perso manquants', points: 10 });
                } else if (withAbf > 0) {
                    factors.linked_abf = 5;
                    diagnostics.push({ type: 'warning', category: 'abf_perso', message: `${withAbf}/${linkedContacts} ABF personnels complétés (${Math.round(pctAbf * 100)}%)`, action: 'Compléter les ABF perso manquants', points: 5 });
                } else {
                    factors.linked_abf = 0;
                }
            } else {
                factors.linked_abf = 0;
            }
            score += factors.linked_abf;

            // ════════════════════════════════════════════
            // P3: ABF Corpo complété (+15) — check sections
            // ════════════════════════════════════════════
            const corpoSections = [
                'section_corpo_profil_completed',
                'section_corpo_actionnaires_completed',
                'section_corpo_societe_completed',
                'section_corpo_finances_completed',
                'section_corpo_objectifs_completed',
                'section_corpo_personnes_completed',
                'section_corpo_assurances_completed',
                'section_corpo_analyses_completed'
            ];
            const completedSections = corpoSections.filter(s => abfData[s] === true).length;
            const sectionPct = corpoSections.length > 0 ? completedSections / corpoSections.length : 0;

            if (sectionPct >= 1) {
                factors.abf_corpo = 15;
                diagnostics.push({ type: 'positive', category: 'abf_corpo', message: `ABF corpo 100% complété (${completedSections}/8 sections)`, points: 15 });
            } else if (sectionPct >= 0.5) {
                factors.abf_corpo = 10;
                diagnostics.push({ type: 'warning', category: 'abf_corpo', message: `ABF corpo ${Math.round(sectionPct * 100)}% (${completedSections}/8 sections)`, action: 'Compléter les sections manquantes', points: 10 });
            } else if (completedSections > 0) {
                factors.abf_corpo = 5;
                diagnostics.push({ type: 'warning', category: 'abf_corpo', message: `ABF corpo ${Math.round(sectionPct * 100)}% (${completedSections}/8 sections)`, action: 'Compléter les sections manquantes', points: 5 });
            } else {
                factors.abf_corpo = 0;
            }
            score += factors.abf_corpo;

            // ════════════════════════════════════════════
            // P4: Produits corpo actifs (+3 à +10)
            // ════════════════════════════════════════════
            const activeProducts = assurances.filter(a => a.statut === 'en_vigueur');
            const prodCount = activeProducts.length;
            if (prodCount >= 3) {
                factors.corpo_products = 10;
                diagnostics.push({ type: 'positive', category: 'products', message: `${prodCount} produits corpo actifs`, points: 10 });
            } else if (prodCount === 2) {
                factors.corpo_products = 7;
                diagnostics.push({ type: 'positive', category: 'products', message: `${prodCount} produits corpo actifs`, points: 7 });
            } else if (prodCount === 1) {
                factors.corpo_products = 3;
                diagnostics.push({ type: 'positive', category: 'products', message: `${prodCount} produit corpo actif`, points: 3 });
            } else {
                factors.corpo_products = 0;
            }
            score += factors.corpo_products;

            // ════════════════════════════════════════════
            // P5: Opportunités corpo actives (+5)
            // ════════════════════════════════════════════
            const activeOpps = opportunities.filter(o => ACTIVE_OPP_STAGES.includes(o.stage));
            if (activeOpps.length > 0) {
                factors.corpo_opportunities = 5;
                diagnostics.push({ type: 'positive', category: 'opportunity', message: `${activeOpps.length} opportunité(s) corpo en cours`, points: 5 });
            } else {
                factors.corpo_opportunities = 0;
            }
            score += factors.corpo_opportunities;

            // ════════════════════════════════════════════
            // N1: Aucun contact rattaché (-20)
            // ════════════════════════════════════════════
            if (linkedContacts === 0) {
                factors.no_contacts = -20;
                score -= 20;
                diagnostics.push({ type: 'danger', category: 'contacts', message: 'Aucun actionnaire rattaché à la corporation', action: 'Lier au moins un contact actionnaire', points: -20 });
            } else {
                factors.no_contacts = 0;
            }

            // ════════════════════════════════════════════
            // N2: ABF perso manquants (-5 à -15)
            // ════════════════════════════════════════════
            if (linkedContacts > 0 && factors.linked_abf === 0) {
                factors.missing_abf_perso = -15;
                score -= 15;
                diagnostics.push({ type: 'danger', category: 'abf_perso', message: 'Aucun ABF personnel complété pour les actionnaires', action: 'Faire l\'analyse perso avant corpo', points: -15 });
            } else if (linkedContacts > 0 && factors.linked_abf <= 5) {
                factors.missing_abf_perso = -5;
                score -= 5;
                diagnostics.push({ type: 'warning', category: 'abf_perso', message: 'ABF personnels encore incomplets', action: 'Prioriser les ABF personnels', points: -5 });
            } else {
                factors.missing_abf_perso = 0;
            }

            // ════════════════════════════════════════════
            // N3: Renouvellements corpo à risque (-5 à -15)
            // ════════════════════════════════════════════
            const sixtyDaysFromNow = new Date(now.getTime() + 60 * 86400000);
            const renewalsSoon = activeProducts.filter(a =>
                a.date_expiration && new Date(a.date_expiration) <= sixtyDaysFromNow && new Date(a.date_expiration) > now
            );
            if (renewalsSoon.length > 0) {
                const hasRenewalOpp = opportunities.some(o => ACTIVE_OPP_STAGES.includes(o.stage));
                if (!hasRenewalOpp) {
                    factors.renewal_risk = -15;
                    score -= 15;
                    const nearest = renewalsSoon.sort((a, b) => new Date(a.date_expiration) - new Date(b.date_expiration))[0];
                    const daysTo = Math.floor((new Date(nearest.date_expiration) - now) / 86400000);
                    diagnostics.push({ type: 'danger', category: 'renewal', message: `Renouvellement corpo dans ${daysTo} jours — aucun suivi`, action: 'Créer une opportunité de renouvellement', points: -15 });
                } else {
                    factors.renewal_risk = 0;
                }
            } else {
                factors.renewal_risk = 0;
            }

            // ════════════════════════════════════════════
            // N4: Produit corpo annulé (-5 à -10)
            // ════════════════════════════════════════════
            const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
            const cancelledProducts = assurances.filter(a =>
                a.statut === 'annule_ferme' && a.updated_at && new Date(a.updated_at) > ninetyDaysAgo
            );
            if (cancelledProducts.length > 0) {
                factors.cancelled_products = -10;
                score -= 10;
                diagnostics.push({ type: 'danger', category: 'products', message: `${cancelledProducts.length} produit(s) corpo annulé(s) récemment`, action: 'Évaluer les raisons et proposer un remplacement', points: -10 });
            } else {
                factors.cancelled_products = 0;
            }

            // ── Clamp score ──
            score = Math.max(0, Math.min(100, score));
            const zone = getCorpoZone(score);

            // Sort diagnostics
            const typeOrder = { danger: 0, warning: 1, positive: 2 };
            diagnostics.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

            // ── Upsert to DB ──
            try {
                await sb.from('client_pulse_scores').upsert({
                    client_id: clientId,
                    organization_id: ORG_ID,
                    pulse_score: score,
                    pulse_zone: zone,
                    diagnostics,
                    factor_breakdown: factors,
                    last_contact_at: null,
                    next_renewal_at: renewalsSoon.length > 0 ? renewalsSoon.sort((a, b) => new Date(a.date_expiration) - new Date(b.date_expiration))[0].date_expiration : null,
                    days_since_contact: null,
                    active_products_count: prodCount,
                    open_tasks_count: tasks.filter(t => ['pending', 'in_progress'].includes(t.status)).length,
                    open_opportunities_count: activeOpps.length,
                    calculated_at: now.toISOString(),
                    updated_at: now.toISOString()
                }, { onConflict: 'client_id' });
            } catch (err) {
                log.error('[Pulse Corpo] Erreur upsert:', err.message);
            }

            const result = { score, zone, diagnostics, factors, completedSections, totalSections: corpoSections.length, linkedContacts, prodCount };

            _queryCache.set(`pulse_${clientId}`, { data: result, timestamp: Date.now() });

            return result;

        } catch (error) {
            log.error('[Pulse Corpo] Error:', error.message);
            return { score: 20, zone: 'critique', diagnostics: [{ type: 'danger', category: 'error', message: 'Erreur lors du calcul', points: 0 }], factors: {} };
        }
    }

    /**
     * Calcule le Pulse Score d'un client à partir de toutes les données existantes.
     * Route automatiquement vers calculateProspectPulseScore pour les prospects.
     * @param {string} clientId - UUID du client
     * @param {boolean} [forceRefresh=false] - Force le recalcul même si le cache est frais
     * @returns {Promise<{score: number, zone: string, diagnostics: Array, factors: Object}>}
     */
    async function calculatePulseScore(clientId, forceRefresh = false) {
        if (!clientId) return null;

        // Detect type_contact to route scoring
        const { data: typeCheck } = await sb.from('clients')
            .select('type_contact')
            .eq('id', clientId)
            .single();
        const typeContact = (typeCheck?.type_contact || 'prospect').toLowerCase();
        if (typeContact === 'prospect' || typeContact === 'inactif') {
            return calculateProspectPulseScore(clientId, forceRefresh);
        }
        if (typeContact === 'corpo') {
            return calculateCorpoPulseScore(clientId, forceRefresh);
        }

        // ── Client scoring (existing logic below) ──

        // Check cache first (5 min TTL)
        if (!forceRefresh) {
            const cached = await cachedQuery(`pulse_${clientId}`, async () => {
                const { data } = await sb.from('client_pulse_scores')
                    .select('*')
                    .eq('client_id', clientId)
                    .maybeSingle();
                if (data && (Date.now() - new Date(data.calculated_at).getTime() < 3600000)) {
                    return data; // Fresh enough (< 1h)
                }
                return null;
            }, 300000); // 5 min cache

            if (cached) {
                // Handle both formats: direct result (from memory cache) or DB row
                if (cached.score !== undefined) {
                    return cached; // Already in final format (from _queryCache line 1775)
                }
                return {
                    score: cached.pulse_score,
                    zone: cached.pulse_zone,
                    diagnostics: cached.diagnostics || [],
                    factors: cached.factor_breakdown || {}
                };
            }
        }

        // Invalidate cache to force recalc
        invalidateCache(`pulse_${clientId}`);

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

        // Fetch all data in parallel
        const [
            timelineRes,
            meetingsRes,
            opportunitiesRes,
            tasksRes,
            assurancesRes,
            placementsRes,
            clientRes
        ] = await Promise.all([
            sb.from('client_timeline')
                .select('activity_type, created_at')
                .eq('client_id', clientId)
                .in('activity_type', CONTACT_ACTIVITY_TYPES)
                .order('created_at', { ascending: false })
                .limit(50),
            sb.from('scheduled_meetings')
                .select('status, scheduled_at')
                .eq('client_id', clientId)
                .gte('scheduled_at', sixtyDaysAgo.toISOString()),
            sb.from('client_opportunities')
                .select('stage, next_action_date, target_date, category')
                .eq('client_id', clientId),
            sb.from('tasks')
                .select('status, due_date, completed_at')
                .eq('client_id', clientId),
            sb.from('assurances_vendues')
                .select('type_produit, statut, date_expiration, updated_at')
                .eq('client_id', clientId),
            sb.from('placements')
                .select('id, statut')
                .eq('client_id', clientId),
            sb.from('clients')
                .select('abf_data, conf_montant_vie_client, conf_montant_invalidite_client')
                .eq('id', clientId)
                .single()
        ]);

        const timeline = timelineRes.data || [];
        const meetings = meetingsRes.data || [];
        const opportunities = opportunitiesRes.data || [];
        const tasks = tasksRes.data || [];
        const assurances = assurancesRes.data || [];
        const placements = placementsRes.data || [];
        const client = clientRes.data || {};

        let score = 50;
        const diagnostics = [];
        const factors = {};

        // ── P1: Contact récent ──
        const lastContact = timeline.length > 0 ? new Date(timeline[0].created_at) : null;
        const daysSinceContact = lastContact ? Math.floor((now - lastContact) / 86400000) : 999;

        if (daysSinceContact <= 14) {
            score += 20;
            factors.contact_recency = +20;
            diagnostics.push({ type: 'positive', category: 'contact', message: `Dernier contact il y a ${daysSinceContact} jour(s)`, points: 20 });
        } else if (daysSinceContact <= 30) {
            score += 10;
            factors.contact_recency = +10;
            diagnostics.push({ type: 'positive', category: 'contact', message: `Dernier contact il y a ${daysSinceContact} jours`, points: 10 });
        } else if (daysSinceContact <= 60) {
            score += 5;
            factors.contact_recency = +5;
            diagnostics.push({ type: 'warning', category: 'contact', message: `Dernier contact il y a ${daysSinceContact} jours`, action: 'Planifier un suivi', points: 5 });
        } else {
            factors.contact_recency = 0;
        }

        // ── P2: Rendez-vous futur planifié ──
        const futureScheduled = meetings.filter(m => m.status === 'scheduled' && new Date(m.scheduled_at) > now);
        if (futureScheduled.length > 0) {
            score += 10;
            factors.future_meeting = +10;
            const nextDate = new Date(futureScheduled.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0].scheduled_at);
            diagnostics.push({ type: 'positive', category: 'meeting', message: `Prochain rendez-vous le ${nextDate.toLocaleDateString('fr-CA')}`, points: 10 });
        } else {
            factors.future_meeting = 0;
        }

        // ── P3: Produits actifs (assurances en vigueur) ──
        const activeInsurances = assurances.filter(a => a.statut === 'en_vigueur');
        const activeCount = activeInsurances.length;
        if (activeCount >= 3) {
            score += 10;
            factors.active_products = +10;
            diagnostics.push({ type: 'positive', category: 'product', message: `${activeCount} produits d'assurance actifs`, points: 10 });
        } else if (activeCount === 2) {
            score += 7;
            factors.active_products = +7;
            diagnostics.push({ type: 'positive', category: 'product', message: `${activeCount} produits d'assurance actifs`, points: 7 });
        } else if (activeCount === 1) {
            score += 3;
            factors.active_products = +3;
            diagnostics.push({ type: 'positive', category: 'product', message: `${activeCount} produit d'assurance actif`, points: 3 });
        } else {
            factors.active_products = 0;
        }

        // ── P4: Placements sous gestion ──
        const activePlacements = placements.filter(p => p.statut === 'actif');
        if (activePlacements.length > 0) {
            score += 5;
            factors.placements = +5;
            diagnostics.push({ type: 'positive', category: 'product', message: `${activePlacements.length} placement(s) actif(s)`, points: 5 });
        } else {
            factors.placements = 0;
        }

        // ── P5: Opportunités actives en cours ──
        const activeOpps = opportunities.filter(o => ACTIVE_OPP_STAGES.includes(o.stage));
        if (activeOpps.length > 0) {
            score += 5;
            factors.active_opportunities = +5;
            diagnostics.push({ type: 'positive', category: 'opportunity', message: `${activeOpps.length} opportunité(s) en cours`, points: 5 });
        } else {
            factors.active_opportunities = 0;
        }

        // ── P6: Opportunités à venir (volume) ──
        const futureOpps = opportunities.filter(o => o.target_date && new Date(o.target_date) > now && ACTIVE_OPP_STAGES.includes(o.stage));
        if (futureOpps.length >= 2) {
            score += 5;
            factors.future_opportunities = +5;
            diagnostics.push({ type: 'positive', category: 'opportunity', message: `${futureOpps.length} opportunités planifiées à venir`, points: 5 });
        } else if (futureOpps.length === 1) {
            score += 3;
            factors.future_opportunities = +3;
            diagnostics.push({ type: 'positive', category: 'opportunity', message: `1 opportunité planifiée à venir`, points: 3 });
        } else {
            factors.future_opportunities = 0;
        }

        // ── P7: Tâches complétées à temps ──
        const recentTasks = tasks.filter(t => t.completed_at && new Date(t.completed_at) > thirtyDaysAgo);
        const totalRecentTasks = tasks.filter(t => t.due_date && new Date(t.due_date) > thirtyDaysAgo).length;
        if (totalRecentTasks > 0) {
            const ratio = recentTasks.length / totalRecentTasks;
            if (ratio >= 0.75) {
                score += 5;
                factors.task_completion = +5;
                diagnostics.push({ type: 'positive', category: 'task', message: `${Math.round(ratio * 100)}% des tâches complétées (30j)`, points: 5 });
            } else if (ratio >= 0.50) {
                score += 3;
                factors.task_completion = +3;
                diagnostics.push({ type: 'warning', category: 'task', message: `${Math.round(ratio * 100)}% des tâches complétées (30j)`, action: 'Compléter les tâches en retard', points: 3 });
            } else {
                factors.task_completion = 0;
            }
        } else {
            factors.task_completion = 0;
        }

        // ── P8: ABF complété ──
        const abfData = client.abf_data;
        const abfCompleted = abfData && typeof abfData === 'object' && Object.keys(abfData).length > 3;
        if (abfCompleted) {
            score += 5;
            factors.abf_completed = +5;
            diagnostics.push({ type: 'positive', category: 'abf', message: 'Analyse des besoins financiers complétée', points: 5 });
        } else {
            factors.abf_completed = 0;
            diagnostics.push({ type: 'warning', category: 'abf', message: 'ABF incomplet ou non rempli', action: 'Compléter l\'analyse des besoins', points: 0 });
        }

        // ── P9: Référencement actif ──
        const wonReferrals = opportunities.filter(o => o.category === 'referral' && o.stage === 'won');
        if (wonReferrals.length > 0) {
            score += 5;
            factors.referral_active = +5;
            diagnostics.push({ type: 'positive', category: 'referral', message: `${wonReferrals.length} référence(s) complétée(s)`, points: 5 });
        } else {
            factors.referral_active = 0;
        }

        // ── N1: Jours sans contact (pénalité) ──
        if (daysSinceContact > 90) {
            score -= 30;
            factors.stale_contact = -30;
            diagnostics.push({ type: 'danger', category: 'contact', message: `Aucun contact depuis ${daysSinceContact} jours`, action: 'Appeler ou écrire immédiatement', points: -30 });
        } else if (daysSinceContact > 60) {
            score -= 20;
            factors.stale_contact = -20;
            diagnostics.push({ type: 'danger', category: 'contact', message: `Aucun contact depuis ${daysSinceContact} jours`, action: 'Planifier un appel cette semaine', points: -20 });
        } else if (daysSinceContact > 30) {
            score -= 10;
            factors.stale_contact = -10;
            diagnostics.push({ type: 'warning', category: 'contact', message: `Aucun contact depuis ${daysSinceContact} jours`, action: 'Prévoir un suivi bientôt', points: -10 });
        } else {
            factors.stale_contact = 0;
        }

        // ── N2: Renouvellement sans action ──
        const sixtyDaysFromNow = new Date(now.getTime() + 60 * 86400000);
        const renewalsSoon = activeInsurances.filter(a =>
            a.date_expiration && new Date(a.date_expiration) <= sixtyDaysFromNow && new Date(a.date_expiration) > now
        );
        if (renewalsSoon.length > 0) {
            // Check if there's an active opportunity or recent contact about it
            const hasRenewalOpp = opportunities.some(o =>
                ['renouv_auto', 'renouv_habitation', 'renouv_hypothecaire', 'renewal_review'].includes(o.category) &&
                ACTIVE_OPP_STAGES.includes(o.stage)
            );
            const hasRecentContact = daysSinceContact <= 30;

            if (!hasRenewalOpp && !hasRecentContact) {
                score -= 15;
                factors.renewal_risk = -15;
                const nearestDate = renewalsSoon.sort((a, b) => new Date(a.date_expiration) - new Date(b.date_expiration))[0];
                const daysToRenewal = Math.floor((new Date(nearestDate.date_expiration) - now) / 86400000);
                diagnostics.push({ type: 'danger', category: 'renewal', message: `Renouvellement dans ${daysToRenewal} jours — aucun suivi en cours`, action: 'Créer une opportunité de renouvellement', points: -15 });
            } else {
                factors.renewal_risk = 0;
            }
        } else {
            factors.renewal_risk = 0;
        }

        // ── N3: Lacunes de couverture ──
        const needsVie = (client.conf_montant_vie_client || 0) > 0;
        const needsInv = (client.conf_montant_invalidite_client || 0) > 0;
        const hasVie = activeInsurances.some(a => ['vie', 'vie_temporaire', 'vie_permanente', 'vie_universelle', 'vie_entiere'].includes(a.type_produit));
        const hasInv = activeInsurances.some(a => ['invalidite', 'invalidite_courte', 'invalidite_longue'].includes(a.type_produit));

        let coverageGap = false;
        if (needsVie && !hasVie) coverageGap = true;
        if (needsInv && !hasInv) coverageGap = true;

        if (coverageGap) {
            score -= 10;
            factors.coverage_gap = -10;
            const gaps = [];
            if (needsVie && !hasVie) gaps.push('Vie');
            if (needsInv && !hasInv) gaps.push('Invalidité');
            diagnostics.push({ type: 'warning', category: 'coverage', message: `Lacune de couverture: ${gaps.join(', ')}`, action: 'Proposer les produits manquants', points: -10 });
        } else {
            factors.coverage_gap = 0;
        }

        // ── N4: Tâches en retard ──
        const overdueTasks = tasks.filter(t =>
            ['pending', 'in_progress'].includes(t.status) &&
            t.due_date && new Date(t.due_date) < now
        );
        if (overdueTasks.length > 0) {
            score -= 10;
            factors.overdue_tasks = -10;
            diagnostics.push({ type: 'danger', category: 'task', message: `${overdueTasks.length} tâche(s) en retard`, action: 'Compléter les tâches en souffrance', points: -10 });
        } else {
            factors.overdue_tasks = 0;
        }

        // ── N5: Opportunités stale ──
        const staleOpps = opportunities.filter(o =>
            ACTIVE_OPP_STAGES.includes(o.stage) &&
            o.next_action_date && new Date(o.next_action_date) < now
        );
        if (staleOpps.length > 0) {
            score -= 5;
            factors.stale_opportunities = -5;
            diagnostics.push({ type: 'warning', category: 'opportunity', message: `${staleOpps.length} opportunité(s) avec action en retard`, action: 'Mettre à jour les prochaines actions', points: -5 });
        } else {
            factors.stale_opportunities = 0;
        }

        // ── N6: Polices annulées récemment ──
        const recentlyCancelled = assurances.filter(a =>
            a.statut === 'annule_ferme' &&
            a.updated_at && new Date(a.updated_at) > ninetyDaysAgo
        );
        if (recentlyCancelled.length > 0) {
            score -= 10;
            factors.cancelled_policies = -10;
            diagnostics.push({ type: 'danger', category: 'product', message: `${recentlyCancelled.length} police(s) annulée(s) récemment`, action: 'Évaluer les raisons et proposer un remplacement', points: -10 });
        } else {
            factors.cancelled_policies = 0;
        }

        // ── Clamp score ──
        score = Math.max(0, Math.min(100, score));
        const zone = getPulseZone(score);

        // Sort diagnostics: dangers first, then warnings, then positives
        const typeOrder = { danger: 0, warning: 1, positive: 2 };
        diagnostics.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

        // ── Upsert to DB ──
        try {
            await sb.from('client_pulse_scores').upsert({
                client_id: clientId,
                organization_id: ORG_ID,
                pulse_score: score,
                pulse_zone: zone,
                diagnostics: diagnostics,
                factor_breakdown: factors,
                last_contact_at: lastContact ? lastContact.toISOString() : null,
                next_renewal_at: renewalsSoon.length > 0 ? renewalsSoon.sort((a, b) => new Date(a.date_expiration) - new Date(b.date_expiration))[0].date_expiration : null,
                days_since_contact: daysSinceContact === 999 ? null : daysSinceContact,
                active_products_count: activeCount + activePlacements.length,
                open_tasks_count: overdueTasks.length,
                open_opportunities_count: activeOpps.length,
                calculated_at: now.toISOString(),
                updated_at: now.toISOString()
            }, { onConflict: 'client_id' });
        } catch (err) {
            log.error('[Pulse] Erreur upsert:', err.message);
        }

        const result = { score, zone, diagnostics, factors };

        // Update local cache
        _queryCache.set(`pulse_${clientId}`, { data: result, timestamp: Date.now() });

        return result;
    }

    /**
     * Charge les scores pulse pour tous les clients d'une org (vue globale).
     * Utilise le cache DB (client_pulse_scores) sans recalculer.
     */
    async function loadAllPulseScores() {
        return await cachedQuery('pulse_all', async () => {
            const { data, error } = await sb.from('client_pulse_scores')
                .select('*, clients!inner(id, first_name, last_name, email, phone, type_contact, conseiller_id)')
                .eq('organization_id', ORG_ID)
                .in('clients.type_contact', ['client', 'prospect', 'corpo', 'inactif'])
                .order('pulse_score', { ascending: true });
            if (error) { log.error('[Pulse] Erreur loadAll:', error.message); return []; }
            return data || [];
        }, 120000); // 2 min cache
    }

    /**
     * Recalcule le pulse pour tous les contacts avec Pulse Vital (batch).
     */
    async function batchRecalculatePulse(progressCallback) {
        const { data: clients } = await sb.from('clients')
            .select('id')
            .eq('organization_id', ORG_ID)
            .in('type_contact', ['client', 'prospect', 'corpo', 'inactif']);

        if (!clients || clients.length === 0) return { total: 0, done: 0 };

        let done = 0;
        for (const c of clients) {
            await calculatePulseScore(c.id, true);
            done++;
            if (progressCallback) progressCallback(done, clients.length);
        }

        invalidateCache('pulse_all');
        return { total: clients.length, done };
    }

    // Inject Pulse CSS globally
    (function injectPulseCSS() {
        if (document.getElementById('finox-pulse-css')) return;
        const style = document.createElement('style');
        style.id = 'finox-pulse-css';
        style.textContent = `
            .pulse-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
            .pulse-ring-score { position: absolute; font-weight: 700; font-family: 'Inter', sans-serif; }
            .pulse-ring-fill { transition: stroke-dasharray 0.6s ease; }

            .pulse-zone-optimal .pulse-ring-fill { animation: pulse-beat 2s ease-in-out infinite; --pulse-glow: rgba(34,197,94,0.4); }
            .pulse-zone-stable .pulse-ring-fill { animation: pulse-beat 3s ease-in-out infinite; --pulse-glow: rgba(201,162,39,0.4); }
            .pulse-zone-attention .pulse-ring-fill { animation: pulse-beat 5s ease-in-out infinite; --pulse-glow: rgba(245,158,11,0.4); }
            .pulse-zone-critique .pulse-ring-fill { animation: pulse-flatline 8s ease-in-out infinite; --pulse-glow: rgba(239,68,68,0.4); }

            @keyframes pulse-beat {
                0%, 100% { opacity: 1; filter: drop-shadow(0 0 2px var(--pulse-glow)); }
                50% { opacity: 0.5; filter: drop-shadow(0 0 8px var(--pulse-glow)); }
            }
            @keyframes pulse-flatline {
                0%, 100% { opacity: 1; }
                30%, 70% { opacity: 0.3; }
                50% { opacity: 0.15; filter: drop-shadow(0 0 12px var(--pulse-glow)); }
            }

            .pulse-diagnostic { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 10px; margin-bottom: 6px; font-size: 13px; line-height: 1.4; }
            .pulse-diagnostic.danger { background: rgba(239,68,68,0.1); border-left: 3px solid #ef4444; }
            .pulse-diagnostic.warning { background: rgba(245,158,11,0.1); border-left: 3px solid #f59e0b; }
            .pulse-diagnostic.positive { background: rgba(34,197,94,0.08); border-left: 3px solid #22c55e; }
            .pulse-diagnostic-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
            .pulse-diagnostic-content { flex: 1; }
            .pulse-diagnostic-msg { color: var(--text-primary, #fff); font-weight: 500; }
            .pulse-diagnostic-action { color: var(--text-secondary, #aaa); font-size: 12px; margin-top: 2px; font-style: italic; }
            .pulse-diagnostic-points { font-size: 11px; font-weight: 700; flex-shrink: 0; padding: 2px 8px; border-radius: 20px; }
            .pulse-diagnostic.danger .pulse-diagnostic-points { background: rgba(239,68,68,0.2); color: #ef4444; }
            .pulse-diagnostic.warning .pulse-diagnostic-points { background: rgba(245,158,11,0.2); color: #f59e0b; }
            .pulse-diagnostic.positive .pulse-diagnostic-points { background: rgba(34,197,94,0.15); color: #22c55e; }
        `;
        document.head.appendChild(style);
    })();

    /**
     * Rend le HTML d'un diagnostic individuel.
     */
    function renderPulseDiagnostic(diag) {
        const icons = { danger: '🔴', warning: '🟡', positive: '🟢' };
        const pointsText = diag.points > 0 ? `+${diag.points}` : `${diag.points}`;
        return `<div class="pulse-diagnostic ${diag.type}">
            <span class="pulse-diagnostic-icon">${icons[diag.type] || '⚪'}</span>
            <div class="pulse-diagnostic-content">
                <div class="pulse-diagnostic-msg">${diag.message}</div>
                ${diag.action ? `<div class="pulse-diagnostic-action">→ ${diag.action}</div>` : ''}
            </div>
            ${diag.points !== 0 ? `<span class="pulse-diagnostic-points">${pointsText}</span>` : ''}
        </div>`;
    }

    /**
     * Génère des suggestions actionnables pour améliorer le score pulse.
     * Analyse le factor_breakdown et retourne les actions non-atteintes triées par impact.
     * @param {Object} pulse - { score, zone, diagnostics, factors }
     * @returns {Array} - [{ icon, title, description, impact, action, actionType }]
     */
    function generatePulseSuggestions(pulse) {
        if (!pulse || !pulse.factors) return [];
        const f = pulse.factors;
        const suggestions = [];

        // ── Actions pour GAGNER des points manquants ──

        // Contact récent (max +20)
        if ((f.contact_recency || 0) < 20) {
            const gained = f.contact_recency || 0;
            const potential = 20 - gained;
            suggestions.push({
                icon: '📞',
                title: 'Contacter le client',
                description: 'Un appel, courriel ou rencontre dans les 14 prochains jours donne le maximum de points.',
                impact: potential,
                action: 'Planifier un appel',
                actionType: 'contact'
            });
        }

        // Rendez-vous futur (max +10)
        if ((f.future_meeting || 0) === 0) {
            suggestions.push({
                icon: '📅',
                title: 'Planifier un rendez-vous',
                description: 'Un rendez-vous à venir démontre une relation active avec le client.',
                impact: 10,
                action: 'Créer un rendez-vous',
                actionType: 'meeting'
            });
        }

        // Produits actifs (max +10)
        if ((f.active_products || 0) < 10) {
            const current = f.active_products || 0;
            const needed = current < 3 ? (current === 0 ? '1er' : 'un autre') : '';
            if (needed) {
                suggestions.push({
                    icon: '🛡️',
                    title: 'Ajouter un produit d\'assurance',
                    description: `Plus de produits actifs = meilleur score. Évaluer si ${needed} produit pourrait bénéficier au client.`,
                    impact: current === 0 ? 3 : (current <= 3 ? 7 - current : 10 - current),
                    action: 'Voir les opportunités',
                    actionType: 'opportunity'
                });
            }
        }

        // Placements (max +5)
        if ((f.placements || 0) === 0) {
            suggestions.push({
                icon: '📈',
                title: 'Proposer un placement',
                description: 'Un placement actif sous gestion renforce le lien et la confiance du client.',
                impact: 5,
                action: 'Explorer les placements',
                actionType: 'placement'
            });
        }

        // Opportunités actives (max +5)
        if ((f.active_opportunities || 0) === 0) {
            suggestions.push({
                icon: '🎯',
                title: 'Créer une opportunité',
                description: 'Identifier un nouveau besoin ou une occasion de vente pour ce client.',
                impact: 5,
                action: 'Nouvelle opportunité',
                actionType: 'opportunity'
            });
        }

        // Opportunités futures (max +5)
        if ((f.future_opportunities || 0) < 5) {
            const current = f.future_opportunities || 0;
            if (current < 3) {
                suggestions.push({
                    icon: '🗓️',
                    title: 'Planifier des opportunités futures',
                    description: '2+ opportunités avec dates cibles futures maximisent ce facteur.',
                    impact: 5 - current,
                    action: 'Planifier des opportunités',
                    actionType: 'opportunity'
                });
            }
        }

        // ABF complété (max +5)
        if ((f.abf_completed || 0) === 0) {
            suggestions.push({
                icon: '📋',
                title: 'Compléter l\'ABF',
                description: 'L\'analyse des besoins financiers aide à mieux servir le client et débloque +5 points.',
                impact: 5,
                action: 'Ouvrir l\'ABF',
                actionType: 'abf'
            });
        }

        // Tâches complétées (max +5)
        if ((f.task_completion || 0) < 5) {
            const current = f.task_completion || 0;
            suggestions.push({
                icon: '✅',
                title: 'Compléter les tâches en cours',
                description: 'Un taux de complétion > 75% sur 30 jours donne le bonus maximum.',
                impact: 5 - current,
                action: 'Voir les tâches',
                actionType: 'task'
            });
        }

        // Référencement (max +5)
        if ((f.referral_active || 0) === 0) {
            suggestions.push({
                icon: '🤝',
                title: 'Obtenir une référence',
                description: 'Un client satisfait qui réfère est un excellent signe de santé. Demander une référence.',
                impact: 5,
                action: 'Créer opportunité référence',
                actionType: 'referral'
            });
        }

        // ── Actions pour ÉLIMINER des pénalités ──

        if ((f.stale_contact || 0) < 0) {
            // Already covered by "Contacter le client" above, but reinforce
            const penalty = Math.abs(f.stale_contact);
            const existing = suggestions.find(s => s.actionType === 'contact');
            if (existing) {
                existing.impact += penalty;
                existing.description = `⚠️ Pénalité active de -${penalty} pts. Un contact rapide élimine la pénalité ET donne jusqu'à +20 pts.`;
            }
        }

        if ((f.overdue_tasks || 0) < 0) {
            const existing = suggestions.find(s => s.actionType === 'task');
            if (existing) {
                existing.impact += 10;
                existing.description = '⚠️ Tâches en retard = -10 pts. Les compléter élimine la pénalité ET peut donner +5 pts bonus.';
            } else {
                suggestions.push({
                    icon: '⏰',
                    title: 'Résoudre les tâches en retard',
                    description: 'Les tâches en souffrance pénalisent le score de -10 points.',
                    impact: 10,
                    action: 'Voir les tâches',
                    actionType: 'task'
                });
            }
        }

        if ((f.stale_opportunities || 0) < 0) {
            suggestions.push({
                icon: '🔄',
                title: 'Mettre à jour les opportunités',
                description: 'Des opportunités avec action en retard pénalisent de -5 pts. Mettre à jour les dates.',
                impact: 5,
                action: 'Voir les opportunités',
                actionType: 'stale_opp'
            });
        }

        if ((f.renewal_risk || 0) < 0) {
            suggestions.push({
                icon: '🔔',
                title: 'Gérer le renouvellement à venir',
                description: 'Un renouvellement approche sans suivi = -15 pts. Contacter le client ou créer une opportunité.',
                impact: 15,
                action: 'Créer opportunité renouvellement',
                actionType: 'renewal'
            });
        }

        if ((f.coverage_gap || 0) < 0) {
            suggestions.push({
                icon: '🩺',
                title: 'Combler les lacunes de couverture',
                description: 'Le client a des besoins identifiés sans produit correspondant. Proposer les produits manquants.',
                impact: 10,
                action: 'Voir les opportunités',
                actionType: 'coverage'
            });
        }

        if ((f.cancelled_policies || 0) < 0) {
            suggestions.push({
                icon: '📝',
                title: 'Suivre la police annulée',
                description: 'Une annulation récente pénalise de -10 pts. Évaluer les raisons et proposer un remplacement.',
                impact: 10,
                action: 'Contacter le client',
                actionType: 'cancelled'
            });
        }

        // Sort by impact descending
        suggestions.sort((a, b) => b.impact - a.impact);

        return suggestions;
    }

    // ═══════════════════════════════════════════════════════════════
    // EXPORT GLOBAL
    // ═══════════════════════════════════════════════════════════════

    window.FINOX = {
        // Supabase
        supabase: sb,

        // Organisation
        ORG_ID: ORG_ID,

        // Auth
        requireAuth,
        checkAuth,
        logout,
        getCurrentUser,
        setCurrentUser,

        // OAuth / Google
        getGoogleTokens,
        isGoogleConnected,
        isMicrosoftConnected,
        getProvider,
        GOOGLE_API,

        // Profil & Role
        loadUserProfile,
        refreshUserProfile,
        isAdmin,
        getUserProfile,
        getEmailSignature,
        getVisibleConseillerIds,
        resetVisibleConseillerIds,

        // Conseiller
        loadConseillerSettings,
        getConseillerSettings,
        saveConseillerSettings,

        // Client ID
        CLIENT_ID: getClientId(),
        getClientId,
        setClientId,

        // Client Data
        loadClientData,
        getClientData,
        updateClientDataCache,
        refreshClientData,
        saveClientData,
        mapClientData,

        // Cache & cleanup management
        clearCache,
        cleanupModuleResources,
        registerInterval,
        registerTimeout,
        registerCleanup,
        cachedQuery,
        invalidateCache,

        // Formatage
        parseNumber,
        formatMoney,
        formatCurrency: formatMoney,
        formatNumber,
        setupMoneyInput,
        setupAllMoneyInputs,
        parseLocalDate,
        formatDate,
        formatTimeAgo,
        formatPhone,
        setupPhoneInput,
        setupAllPhoneInputs,
        setupDateInput,
        setupAllDateInputs,
        calculateAge,

        // Labels
        getStatutLabel,
        getLeadStatusConfig,
        STATUT_LABELS,
        LEAD_STATUS_CONFIG,

        // UI
        showNotification,
        showRecordAlert,
        confirm: showConfirmDialog,
        alert: showAlertDialog,
        escapeHtml: function(text) {
            if (!text && text !== 0) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        },

        // Google API
        googleFetch,
        ensureValidGoogleToken,

        // Timeline
        addTimelineEntry,

        // Pulse Vital
        calculatePulseScore,
        calculateProspectPulseScore,
        loadAllPulseScores,
        batchRecalculatePulse,
        getPulseZone,
        getPulseColor,
        getPulseLabel,
        getProspectZone,
        renderPulseRing,
        renderPulseDiagnostic,
        generatePulseSuggestions,
        PULSE_ZONES,
        PROSPECT_ZONES,
        CORPO_ZONES,
        calculateCorpoPulseScore,
        getCorpoZone,
        LEAD_STATUS_CONFIG,
        LEAD_PIPELINE_STAGES,
        LEAD_SUGGESTIONS,
        LEAD_SUGGESTIONS_BY_TYPE,

        // Debug (only in dev)
        _debug: IS_PRODUCTION ? null : { log, secureStorage }
    };

    log.debug('[Config] Chargé - CLIENT_ID:', window.FINOX.CLIENT_ID);

})();
}

// ═══════════════════════════════════════════════════════════════
// FINOX DATE PICKER — Custom calendar UI (global, toutes pages)
// ═══════════════════════════════════════════════════════════════
(function() {
    'use strict';
    const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const MOIS_COURT = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    const JOURS = ['Lu','Ma','Me','Je','Ve','Sa','Di'];
    let overlay, curYear, curMonth, selectedDate, targetInput, activeWrap;

    function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

    function fmtDisplay(val) {
        if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return '';
        const p = val.split('-');
        return parseInt(p[2]) + ' ' + MOIS_COURT[parseInt(p[1])-1] + ' ' + p[0];
    }

    var pickerMode = 'days'; // 'days' | 'months' | 'years'

    function createOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'finox-dp-overlay';
        overlay.innerHTML = '<div class="finox-dp">' +
            '<div class="finox-dp-nav">' +
                '<button type="button" class="finox-dp-nav-btn" id="fdpPrev">\u25C0</button>' +
                '<span class="finox-dp-month-label" id="fdpLabel"></span>' +
                '<button type="button" class="finox-dp-nav-btn" id="fdpNext">\u25B6</button>' +
            '</div>' +
            '<div class="finox-dp-weekdays" id="fdpWeekdays">' + JOURS.map(function(j){ return '<div class="finox-dp-wd">' + j + '</div>'; }).join('') + '</div>' +
            '<div class="finox-dp-days" id="fdpDays"></div>' +
            '<div class="finox-dp-footer">' +
                '<button type="button" class="finox-dp-footer-btn clear" id="fdpClear">Effacer</button>' +
                '<button type="button" class="finox-dp-footer-btn today-btn" id="fdpToday">Aujourd\'hui</button>' +
                '<button type="button" class="finox-dp-footer-btn confirm" id="fdpOk">OK</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        document.getElementById('fdpPrev').addEventListener('click', function() {
            if (pickerMode === 'days') { curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; } renderCal(); }
            else if (pickerMode === 'months') { curYear--; renderMonthPicker(); }
            else if (pickerMode === 'years') { curYear -= 12; renderYearPicker(); }
        });
        document.getElementById('fdpNext').addEventListener('click', function() {
            if (pickerMode === 'days') { curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; } renderCal(); }
            else if (pickerMode === 'months') { curYear++; renderMonthPicker(); }
            else if (pickerMode === 'years') { curYear += 12; renderYearPicker(); }
        });
        document.getElementById('fdpLabel').addEventListener('click', function() {
            if (pickerMode === 'days') { pickerMode = 'months'; renderMonthPicker(); }
            else if (pickerMode === 'months') { pickerMode = 'years'; renderYearPicker(); }
            else { pickerMode = 'days'; renderCal(); }
        });
        document.getElementById('fdpClear').addEventListener('click', function() { selectedDate = null; apply(); close(); });
        document.getElementById('fdpToday').addEventListener('click', function() { var t = new Date(); selectedDate = fmt(t); curYear = t.getFullYear(); curMonth = t.getMonth(); pickerMode = 'days'; renderCal(); });
        document.getElementById('fdpOk').addEventListener('click', function() { apply(); close(); });
    }

    function renderMonthPicker() {
        document.getElementById('fdpLabel').textContent = curYear;
        document.getElementById('fdpWeekdays').style.display = 'none';
        var container = document.getElementById('fdpDays');
        container.style.gridTemplateColumns = 'repeat(3, 1fr)';
        var html = '';
        var today = new Date();
        for (var m = 0; m < 12; m++) {
            var isCurrent = (m === curMonth && pickerMode !== 'years');
            var isToday = (m === today.getMonth() && curYear === today.getFullYear());
            var cls = 'finox-dp-pick-cell' + (isCurrent ? ' selected' : '') + (isToday ? ' today' : '');
            var shortName = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'][m];
            html += '<div class="' + cls + '" data-month="' + m + '">' + shortName + '</div>';
        }
        container.innerHTML = html;
        container.querySelectorAll('.finox-dp-pick-cell').forEach(function(el) {
            el.addEventListener('click', function() {
                curMonth = parseInt(el.dataset.month);
                pickerMode = 'days';
                renderCal();
            });
        });
    }

    function renderYearPicker() {
        var startYear = curYear - (curYear % 12);
        document.getElementById('fdpLabel').textContent = startYear + ' — ' + (startYear + 11);
        document.getElementById('fdpWeekdays').style.display = 'none';
        var container = document.getElementById('fdpDays');
        container.style.gridTemplateColumns = 'repeat(3, 1fr)';
        var today = new Date();
        var html = '';
        for (var y = startYear; y < startYear + 12; y++) {
            var isCurrent = (y === curYear);
            var isToday = (y === today.getFullYear());
            var cls = 'finox-dp-pick-cell' + (isCurrent ? ' selected' : '') + (isToday ? ' today' : '');
            html += '<div class="' + cls + '" data-year="' + y + '">' + y + '</div>';
        }
        container.innerHTML = html;
        container.querySelectorAll('.finox-dp-pick-cell').forEach(function(el) {
            el.addEventListener('click', function() {
                curYear = parseInt(el.dataset.year);
                pickerMode = 'months';
                renderMonthPicker();
            });
        });
    }

    function renderCal() {
        pickerMode = 'days';
        document.getElementById('fdpWeekdays').style.display = '';
        document.getElementById('fdpDays').style.gridTemplateColumns = 'repeat(7, 1fr)';
        document.getElementById('fdpLabel').textContent = MOIS[curMonth] + ' ' + curYear;
        var first = new Date(curYear, curMonth, 1);
        var startDay = first.getDay() - 1; if (startDay < 0) startDay = 6;
        var daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
        var daysInPrev = new Date(curYear, curMonth, 0).getDate();
        var todayStr = fmt(new Date());
        var html = '';
        for (var i = startDay - 1; i >= 0; i--) {
            html += '<div class="finox-dp-day other-month">' + (daysInPrev - i) + '</div>';
        }
        for (var d = 1; d <= daysInMonth; d++) {
            var ds = curYear + '-' + String(curMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
            var cls = (ds === todayStr ? ' today' : '') + (ds === selectedDate ? ' selected' : '');
            html += '<div class="finox-dp-day' + cls + '" data-date="' + ds + '">' + d + '</div>';
        }
        var totalCells = startDay + daysInMonth;
        var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (var d2 = 1; d2 <= remaining; d2++) {
            html += '<div class="finox-dp-day other-month">' + d2 + '</div>';
        }
        var container = document.getElementById('fdpDays');
        container.innerHTML = html;
        container.querySelectorAll('.finox-dp-day:not(.other-month)').forEach(function(el) {
            el.addEventListener('click', function() { selectedDate = el.dataset.date; renderCal(); });
        });
    }

    function apply() {
        if (targetInput) {
            // Use native setter to bypass any overrides
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            nativeSet.call(targetInput, selectedDate || '');
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (activeWrap) {
            var ti = activeWrap.querySelector('.fdw-input');
            if (ti) {
                ti.value = toMasked(selectedDate) || '';
            }
        }
    }

    function open(input, wrap) {
        createOverlay();
        targetInput = input;
        activeWrap = wrap || null;
        var val = input ? input.value : '';
        if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
            var p = val.split('-');
            curYear = parseInt(p[0]); curMonth = parseInt(p[1]) - 1;
            selectedDate = val;
        } else {
            var t = new Date(); curYear = t.getFullYear(); curMonth = t.getMonth();
            selectedDate = null;
        }
        renderCal();
        requestAnimationFrame(function() { overlay.classList.add('active'); });
    }

    function close() {
        if (overlay) overlay.classList.remove('active');
        if (activeWrap) activeWrap.classList.remove('focused');
        targetInput = null; activeWrap = null;
    }

    function parseUserDate(str) {
        if (!str) return null;
        str = str.trim();
        // YYYY-MM-DD
        var m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return m[1] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[3]).padStart(2,'0');
        // DD/MM/YYYY or DD-MM-YYYY
        m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (m) return m[3] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0');
        // "8 juin 2020" style
        m = str.match(/^(\d{1,2})\s+(\w+\.?)\s+(\d{4})$/i);
        if (m) {
            var mo = MOIS_COURT.findIndex(function(x) { return x.replace('.','').toLowerCase() === m[2].replace('.','').toLowerCase(); });
            if (mo < 0) mo = MOIS.findIndex(function(x) { return x.toLowerCase() === m[2].toLowerCase(); });
            if (mo >= 0) return m[3] + '-' + String(mo+1).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0');
        }
        return null;
    }

    function toMasked(isoVal) {
        if (!isoVal || !/^\d{4}-\d{2}-\d{2}$/.test(isoVal)) return '';
        var p = isoVal.split('-');
        return p[2] + ' / ' + p[1] + ' / ' + p[0];
    }

    function fromMasked(str) {
        if (!str) return null;
        var digits = str.replace(/\D/g, '');
        if (digits.length !== 8) return null;
        var d = digits.substring(0,2), m = digits.substring(2,4), y = digits.substring(4,8);
        var di = parseInt(d), mi = parseInt(m), yi = parseInt(y);
        if (mi < 1 || mi > 12 || di < 1 || di > 31 || yi < 1900 || yi > 2100) return null;
        return y + '-' + m + '-' + d;
    }

    function applyMask(textInput) {
        var raw = textInput.value.replace(/\D/g, '');
        if (raw.length > 8) raw = raw.substring(0, 8);
        var masked = '';
        for (var i = 0; i < raw.length; i++) {
            if (i === 2 || i === 4) masked += ' / ';
            masked += raw[i];
        }
        textInput.value = masked;
        // Always place cursor at end
        var len = masked.length;
        textInput.setSelectionRange(len, len);
    }

    function syncHiddenInput(input, isoVal) {
        var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSet.call(input, isoVal || '');
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function wrapDateInput(input) {
        if (input.getAttribute('data-fdp')) return;
        input.setAttribute('data-fdp', '1');
        var wrap = document.createElement('div');
        wrap.className = 'finox-date-wrap';
        var masked = toMasked(input.value);
        wrap.innerHTML = '<input type="text" class="fdw-input" placeholder="jj / mm / aaaa" value="' + masked + '" autocomplete="off" spellcheck="false" maxlength="14"><span class="fdw-icon">\uD83D\uDCC5</span>';
        input.parentNode.insertBefore(wrap, input.nextSibling);
        var textInput = wrap.querySelector('.fdw-input');
        var icon = wrap.querySelector('.fdw-icon');
        // Click icon → open calendar
        icon.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            wrap.classList.add('focused');
            open(input, wrap);
        });
        // Click on wrap bg → focus text input
        wrap.addEventListener('click', function(e) {
            if (e.target === wrap) textInput.focus();
        });
        // Auto-mask on input
        textInput.addEventListener('input', function() {
            applyMask(textInput);
            // If complete, auto-sync
            var iso = fromMasked(textInput.value);
            if (iso) syncHiddenInput(input, iso);
        });
        // Focus state
        textInput.addEventListener('focus', function() { wrap.classList.add('focused'); });
        textInput.addEventListener('blur', function() {
            wrap.classList.remove('focused');
            var iso = fromMasked(textInput.value);
            if (iso) {
                syncHiddenInput(input, iso);
                textInput.value = toMasked(iso);
            } else if (textInput.value.replace(/\D/g, '').length === 0) {
                syncHiddenInput(input, '');
            }
        });
        // Enter → validate
        textInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); textInput.blur(); }
        });
        // Sync wrapper when value changes programmatically (calendar pick)
        input.addEventListener('change', function() {
            textInput.value = toMasked(input.value);
        });
    }

    function wrapAllDateInputs(root) {
        var inputs = (root || document).querySelectorAll('input[type="date"]:not([data-fdp])');
        inputs.forEach(wrapDateInput);
    }

    // MutationObserver to catch dynamically added date inputs
    var wrapTimer = null;
    var obs = new MutationObserver(function(mutations) {
        var shouldScan = false;
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length) { shouldScan = true; break; }
        }
        if (shouldScan) {
            clearTimeout(wrapTimer);
            wrapTimer = setTimeout(function() { wrapAllDateInputs(); }, 150);
        }
    });

    function init() {
        wrapAllDateInputs();
        obs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.FINOX_DATEPICKER = { open: open, close: close, wrapAllDateInputs: wrapAllDateInputs, fmtDisplay: fmtDisplay };
})();
