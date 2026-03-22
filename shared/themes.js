/**
 * ===================================================================
 * FINOX CRM - Systeme de Themes
 * ===================================================================
 * Gere 4 themes: dark, light, blue, orange
 * Charge le theme depuis localStorage (instantane) puis Supabase (persistant)
 *
 * Usage:
 *   FINOX_THEME.apply('blue')     // Applique instantanement
 *   FINOX_THEME.save('blue')      // Sauvegarde + applique
 *   FINOX_THEME.current()         // Retourne le theme actif
 */

window.FINOX_THEME = (function() {

    const STORAGE_KEY = 'finox_theme';

    // ==========================================
    //  PALETTES
    // ==========================================
    const themes = {
        dark: {
            label: 'Sombre',
            icon: '\uD83C\uDF19',
            vars: {
                '--bg-primary': '#0a0a0a',
                '--bg-secondary': '#111111',
                '--bg-card': '#1a1a1a',
                '--bg-hover': '#252525',
                '--bg-input': '#141414',
                '--finox-dark': '#1a1a1a',
                '--finox-gray': '#2b2b2b',
                '--finox-light-gray': '#1e1e1e',
                '--gold': '#C9A227',
                '--gold-light': '#E3B830',
                '--gold-dark': '#A68A1F',
                '--gold-glow': 'rgba(201, 162, 39, 0.15)',
                '--text-primary': '#ffffff',
                '--text-secondary': '#a0a0a0',
                '--text-muted': '#666666',
                '--border-color': '#2a2a2a',
                '--border-gold': 'rgba(201, 162, 39, 0.3)',
                '--success': '#22c55e',
                '--warning': '#f59e0b',
                '--danger': '#ef4444',
                '--info': '#3b82f6',
                '--purple': '#a855f7',
                '--cyan': '#00BCD4'
            }
        },

        light: {
            label: 'Clair',
            icon: '\u2601\uFE0F',
            vars: {
                '--bg-primary': '#f5f5f7',
                '--bg-secondary': '#eeeef0',
                '--bg-card': '#ffffff',
                '--bg-hover': '#e8e8ec',
                '--bg-input': '#f8f8fa',
                '--finox-dark': '#ffffff',
                '--finox-gray': '#eeeef0',
                '--finox-light-gray': '#f5f5f7',
                '--gold': '#6366f1',
                '--gold-light': '#818cf8',
                '--gold-dark': '#4f46e5',
                '--gold-glow': 'rgba(99, 102, 241, 0.1)',
                '--text-primary': '#1e1e2e',
                '--text-secondary': '#52525b',
                '--text-muted': '#a1a1aa',
                '--border-color': '#e4e4e7',
                '--border-gold': 'rgba(99, 102, 241, 0.25)',
                '--success': '#16a34a',
                '--warning': '#d97706',
                '--danger': '#dc2626',
                '--info': '#2563eb',
                '--purple': '#9333ea',
                '--cyan': '#0891b2'
            }
        },

        blue: {
            label: 'Bleu',
            icon: '\uD83D\uDD35',
            vars: {
                '--bg-primary': '#0a1628',
                '--bg-secondary': '#0e1d33',
                '--bg-card': '#132238',
                '--bg-hover': '#1a2d4a',
                '--bg-input': '#0c182e',
                '--finox-dark': '#132238',
                '--finox-gray': '#1a2d4a',
                '--finox-light-gray': '#0e1d33',
                '--gold': '#4A9EFF',
                '--gold-light': '#6BB3FF',
                '--gold-dark': '#2B7FE0',
                '--gold-glow': 'rgba(74, 158, 255, 0.15)',
                '--text-primary': '#e0e8f0',
                '--text-secondary': '#8ba3bf',
                '--text-muted': '#5a7a9a',
                '--border-color': '#1e3a5f',
                '--border-gold': 'rgba(74, 158, 255, 0.3)',
                '--success': '#22c55e',
                '--warning': '#f59e0b',
                '--danger': '#ef4444',
                '--info': '#60a5fa',
                '--purple': '#a78bfa',
                '--cyan': '#22d3ee'
            }
        },

        orange: {
            label: 'Orange',
            icon: '\uD83C\uDF4A',
            vars: {
                '--bg-primary': '#faf5f0',
                '--bg-secondary': '#f0e8df',
                '--bg-card': '#ffffff',
                '--bg-hover': '#efe5d8',
                '--bg-input': '#faf8f5',
                '--finox-dark': '#fff8f0',
                '--finox-gray': '#f5ebe0',
                '--finox-light-gray': '#faf0e6',
                '--gold': '#E07C24',
                '--gold-light': '#F09040',
                '--gold-dark': '#C06818',
                '--gold-glow': 'rgba(224, 124, 36, 0.12)',
                '--text-primary': '#2a2015',
                '--text-secondary': '#6b5a48',
                '--text-muted': '#9a8a78',
                '--border-color': '#e0d5c8',
                '--border-gold': 'rgba(224, 124, 36, 0.25)',
                '--success': '#16a34a',
                '--warning': '#d97706',
                '--danger': '#dc2626',
                '--info': '#2563eb',
                '--purple': '#9333ea',
                '--cyan': '#0891b2'
            }
        }
    };

    // ==========================================
    //  FONCTIONS PRINCIPALES
    // ==========================================

    /**
     * Applique un theme instantanement (CSS variables sur :root)
     */
    function apply(themeName) {
        const theme = themes[themeName];
        if (!theme) {
            console.warn('[FINOX_THEME] Theme inconnu:', themeName);
            return;
        }

        const root = document.documentElement;
        Object.entries(theme.vars).forEach(([prop, value]) => {
            root.style.setProperty(prop, value);
        });

        // Stocker en localStorage pour chargement instantane au prochain load
        try { localStorage.setItem(STORAGE_KEY, themeName); } catch(e) {}

        console.log('[FINOX_THEME] Applique:', themeName);
    }

    /**
     * Sauvegarde le theme dans Supabase + applique
     */
    async function save(themeName) {
        if (!themes[themeName]) return;

        // Appliquer immediatement
        apply(themeName);

        // Sauvegarder en DB
        try {
            if (window.FINOX && FINOX.supabase && FINOX.getCurrentUser) {
                const user = FINOX.getCurrentUser();
                if (user) {
                    const { error } = await FINOX.supabase
                        .from('profiles')
                        .update({ theme: themeName, updated_at: new Date().toISOString() })
                        .eq('id', user.id);

                    if (error) throw error;
                    console.log('[FINOX_THEME] Sauvegarde DB:', themeName);

                    if (FINOX.showNotification) {
                        FINOX.showNotification('Theme change: ' + themes[themeName].label, 'success');
                    }
                }
            }
        } catch (err) {
            console.error('[FINOX_THEME] Erreur sauvegarde:', err);
        }
    }

    /**
     * Charge le theme: localStorage d'abord (instantane), puis DB (correction si different)
     */
    async function load() {
        // 1. localStorage pour un chargement instantane (pas de flash blanc)
        let themeName = 'dark';
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && themes[stored]) {
                themeName = stored;
            }
        } catch(e) {}

        apply(themeName);

        // 2. DB quand Supabase est dispo (corrige si l'user a change sur un autre appareil)
        try {
            if (window.FINOX && FINOX.supabase && FINOX.getCurrentUser) {
                const user = FINOX.getCurrentUser();
                if (user) {
                    const { data, error } = await FINOX.supabase
                        .from('profiles')
                        .select('theme')
                        .eq('id', user.id)
                        .single();

                    if (!error && data && data.theme && themes[data.theme]) {
                        if (data.theme !== themeName) {
                            apply(data.theme);
                            console.log('[FINOX_THEME] Sync DB -> localStorage:', data.theme);
                        }
                    }
                }
            }
        } catch (err) {
            // Silencieux — on garde le theme localStorage
        }
    }

    /**
     * Retourne le theme actif
     */
    function current() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'dark';
        } catch(e) {
            return 'dark';
        }
    }

    /**
     * Retourne toutes les infos des themes (pour le selecteur UI)
     */
    // Couleur representative de chaque theme pour le selecteur
    const swatchColors = {
        dark: '#C9A227',
        light: '#6366f1',
        blue: '#4A9EFF',
        orange: '#E07C24'
    };

    function getAll() {
        return Object.entries(themes).map(([key, val]) => ({
            id: key,
            label: val.label,
            icon: val.icon,
            preview: {
                bg: val.vars['--bg-primary'],
                card: val.vars['--bg-card'],
                accent: val.vars['--gold'],
                text: val.vars['--text-primary'],
                swatch: swatchColors[key] || val.vars['--gold']
            }
        }));
    }

    // ==========================================
    //  AUTO-INIT : charger le theme immediatement
    // ==========================================
    // On applique depuis localStorage TOUT DE SUITE pour eviter le flash
    (function autoInit() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && themes[stored]) {
                const root = document.documentElement;
                Object.entries(themes[stored].vars).forEach(([prop, value]) => {
                    root.style.setProperty(prop, value);
                });
            }
        } catch(e) {}
    })();

    // ==========================================
    //  API PUBLIQUE
    // ==========================================
    return {
        apply,
        save,
        load,
        current,
        getAll,
        themes
    };

})();
