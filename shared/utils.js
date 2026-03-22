/**
 * ═══════════════════════════════════════════════════════════════
 * FINOX CRM - Utilitaires JavaScript Réutilisables
 * ═══════════════════════════════════════════════════════════════
 * Fonctions utilitaires partagées entre les modules
 */

(function(window) {
    'use strict';

    // ══════════════════════════════════════════
    // MODULE: TABS
    // Système d'onglets générique
    // ══════════════════════════════════════════
    const Tabs = {
        /**
         * Initialise un système d'onglets
         * @param {string} containerSelector - Sélecteur du conteneur
         * @param {Object} options - Options de configuration
         */
        init(containerSelector, options = {}) {
            const {
                tabSelector = '.tab',
                contentSelector = '.tab-content',
                activeClass = 'active',
                dataAttr = 'tab',
                onSwitch = null
            } = options;

            const container = document.querySelector(containerSelector);
            if (!container) return;

            container.querySelectorAll(tabSelector).forEach(tab => {
                tab.addEventListener('click', () => {
                    // Désactiver tous les onglets
                    container.querySelectorAll(tabSelector).forEach(t => t.classList.remove(activeClass));
                    tab.classList.add(activeClass);

                    // Afficher le contenu correspondant
                    const tabId = tab.dataset[dataAttr];
                    document.querySelectorAll(contentSelector).forEach(c => c.classList.remove(activeClass));
                    const content = document.getElementById(`tab-${tabId}`);
                    if (content) content.classList.add(activeClass);

                    // Callback
                    if (typeof onSwitch === 'function') {
                        onSwitch(tabId, tab);
                    }
                });
            });
        }
    };

    // ══════════════════════════════════════════
    // MODULE: MODAL
    // Gestionnaire de modales
    // ══════════════════════════════════════════
    const Modal = {
        /**
         * Ouvre une modale
         * @param {string} modalId - ID de la modale
         */
        open(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('show');
                document.body.style.overflow = 'hidden';
            }
        },

        /**
         * Ferme une modale
         * @param {string} modalId - ID de la modale
         */
        close(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.remove('show');
                document.body.style.overflow = '';
            }
        },

        /**
         * Ferme toutes les modales
         */
        closeAll() {
            document.querySelectorAll('.modal-overlay.show').forEach(modal => {
                modal.classList.remove('show');
            });
            document.body.style.overflow = '';
        },

        /**
         * Initialise les fermetures par overlay click et touche Escape
         */
        initCloseHandlers() {
            // Fermer en cliquant sur l'overlay
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay')) {
                    e.target.classList.remove('show');
                    document.body.style.overflow = '';
                }
            });

            // Fermer avec Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeAll();
                }
            });
        }
    };

    // ══════════════════════════════════════════
    // MODULE: FORM
    // Utilitaires pour les formulaires
    // ══════════════════════════════════════════
    const Form = {
        /**
         * Récupère toutes les valeurs d'un formulaire
         * @param {string|HTMLElement} formOrSelector - Formulaire ou sélecteur
         * @returns {Object} - Objet avec les valeurs
         */
        getValues(formOrSelector) {
            const form = typeof formOrSelector === 'string'
                ? document.querySelector(formOrSelector)
                : formOrSelector;

            if (!form) return {};

            const data = {};
            form.querySelectorAll('input, select, textarea').forEach(el => {
                if (el.name || el.id) {
                    const key = el.name || el.id;
                    if (el.type === 'checkbox') {
                        data[key] = el.checked;
                    } else if (el.type === 'radio') {
                        if (el.checked) data[key] = el.value;
                    } else {
                        data[key] = el.value;
                    }
                }
            });
            return data;
        },

        /**
         * Remplit un formulaire avec des données
         * @param {string|HTMLElement} formOrSelector - Formulaire ou sélecteur
         * @param {Object} data - Données à remplir
         */
        setValues(formOrSelector, data) {
            const form = typeof formOrSelector === 'string'
                ? document.querySelector(formOrSelector)
                : formOrSelector;

            if (!form || !data) return;

            Object.entries(data).forEach(([key, value]) => {
                const el = form.querySelector(`[name="${key}"], #${key}`);
                if (!el) return;

                if (el.type === 'checkbox') {
                    el.checked = Boolean(value);
                } else if (el.type === 'radio') {
                    const radio = form.querySelector(`[name="${key}"][value="${value}"]`);
                    if (radio) radio.checked = true;
                } else {
                    el.value = value || '';
                }
            });
        },

        /**
         * Réinitialise un formulaire
         * @param {string|HTMLElement} formOrSelector - Formulaire ou sélecteur
         */
        reset(formOrSelector) {
            const form = typeof formOrSelector === 'string'
                ? document.querySelector(formOrSelector)
                : formOrSelector;

            if (form) form.reset();
        },

        /**
         * Suit les changements dans un formulaire
         * @param {string|HTMLElement} formOrSelector - Formulaire ou sélecteur
         * @param {Function} callback - Fonction appelée lors d'un changement
         */
        trackChanges(formOrSelector, callback) {
            const form = typeof formOrSelector === 'string'
                ? document.querySelector(formOrSelector)
                : formOrSelector;

            if (!form) return;

            form.querySelectorAll('input, select, textarea').forEach(el => {
                el.addEventListener('input', () => callback(el));
                el.addEventListener('change', () => callback(el));
            });
        }
    };

    // ══════════════════════════════════════════
    // MODULE: DATE
    // Utilitaires de formatage de dates
    // ══════════════════════════════════════════
    const DateUtils = {
        /**
         * Formate une date relative (il y a X temps)
         * @param {string|Date} date - Date à formater
         * @returns {string} - Texte formaté
         */
        timeAgo(date) {
            const now = new Date();
            const past = new Date(date);
            const diffMs = now - past;
            const diffSecs = Math.floor(diffMs / 1000);
            const diffMins = Math.floor(diffSecs / 60);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffSecs < 60) return 'À l\'instant';
            if (diffMins < 60) return `Il y a ${diffMins} min`;
            if (diffHours < 24) return `Il y a ${diffHours}h`;
            if (diffDays < 7) return `Il y a ${diffDays}j`;

            return past.toLocaleDateString('fr-CA', {
                day: 'numeric',
                month: 'short'
            });
        },

        /**
         * Formate une date en format français
         * @param {string|Date} date - Date à formater
         * @param {Object} options - Options Intl.DateTimeFormat
         * @returns {string} - Date formatée
         */
        format(date, options = {}) {
            const defaultOptions = {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            };
            return new Date(date).toLocaleDateString('fr-CA', { ...defaultOptions, ...options });
        },

        /**
         * Formate une date et heure
         * @param {string|Date} date - Date à formater
         * @returns {string} - Date et heure formatées
         */
        formatDateTime(date) {
            return new Date(date).toLocaleString('fr-CA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    };

    // ══════════════════════════════════════════
    // MODULE: STORAGE
    // Gestion du localStorage avec JSON
    // ══════════════════════════════════════════
    const Storage = {
        /**
         * Récupère une valeur du localStorage
         * @param {string} key - Clé
         * @param {*} defaultValue - Valeur par défaut
         * @returns {*} - Valeur stockée ou défaut
         */
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },

        /**
         * Stocke une valeur dans le localStorage
         * @param {string} key - Clé
         * @param {*} value - Valeur à stocker
         */
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error('Storage.set error:', e);
            }
        },

        /**
         * Supprime une valeur du localStorage
         * @param {string} key - Clé
         */
        remove(key) {
            localStorage.removeItem(key);
        }
    };

    // ══════════════════════════════════════════
    // MODULE: DOM
    // Utilitaires de manipulation DOM
    // ══════════════════════════════════════════
    const DOM = {
        /**
         * Sélecteur court
         * @param {string} selector - Sélecteur CSS
         * @param {HTMLElement} parent - Parent optionnel
         * @returns {HTMLElement|null}
         */
        $(selector, parent = document) {
            return parent.querySelector(selector);
        },

        /**
         * Sélecteur multiple
         * @param {string} selector - Sélecteur CSS
         * @param {HTMLElement} parent - Parent optionnel
         * @returns {NodeList}
         */
        $$(selector, parent = document) {
            return parent.querySelectorAll(selector);
        },

        /**
         * Crée un élément avec des attributs
         * @param {string} tag - Nom de la balise
         * @param {Object} attrs - Attributs
         * @param {string|HTMLElement} content - Contenu
         * @returns {HTMLElement}
         */
        create(tag, attrs = {}, content = '') {
            const el = document.createElement(tag);
            Object.entries(attrs).forEach(([key, value]) => {
                if (key === 'className') {
                    el.className = value;
                } else if (key === 'style' && typeof value === 'object') {
                    Object.assign(el.style, value);
                } else if (key.startsWith('on') && typeof value === 'function') {
                    el.addEventListener(key.slice(2).toLowerCase(), value);
                } else {
                    el.setAttribute(key, value);
                }
            });
            if (typeof content === 'string') {
                el.innerHTML = content;
            } else if (content instanceof HTMLElement) {
                el.appendChild(content);
            }
            return el;
        },

        /**
         * Affiche un élément
         * @param {string|HTMLElement} el - Élément ou sélecteur
         */
        show(el) {
            const element = typeof el === 'string' ? document.querySelector(el) : el;
            if (element) element.style.display = '';
        },

        /**
         * Cache un élément
         * @param {string|HTMLElement} el - Élément ou sélecteur
         */
        hide(el) {
            const element = typeof el === 'string' ? document.querySelector(el) : el;
            if (element) element.style.display = 'none';
        },

        /**
         * Toggle la visibilité
         * @param {string|HTMLElement} el - Élément ou sélecteur
         */
        toggle(el) {
            const element = typeof el === 'string' ? document.querySelector(el) : el;
            if (element) {
                element.style.display = element.style.display === 'none' ? '' : 'none';
            }
        }
    };

    // ══════════════════════════════════════════
    // MODULE: DEBOUNCE/THROTTLE
    // ══════════════════════════════════════════
    /**
     * Debounce une fonction
     * @param {Function} func - Fonction à debouncer
     * @param {number} wait - Délai en ms
     * @returns {Function}
     */
    function debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Throttle une fonction
     * @param {Function} func - Fonction à throttler
     * @param {number} limit - Limite en ms
     * @returns {Function}
     */
    function throttle(func, limit = 300) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ══════════════════════════════════════════
    // MODULE: API
    // Utilitaires pour les appels API
    // ══════════════════════════════════════════
    const API = {
        /**
         * Fetch wrapper avec gestion d'erreurs
         * @param {string} url - URL
         * @param {Object} options - Options fetch
         * @returns {Promise<Object>}
         */
        async fetch(url, options = {}) {
            try {
                const response = await fetch(url, {
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    },
                    ...options
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error('API fetch error:', error);
                throw error;
            }
        },

        /**
         * GET request
         * @param {string} url - URL
         * @returns {Promise<Object>}
         */
        get(url) {
            return this.fetch(url);
        },

        /**
         * POST request
         * @param {string} url - URL
         * @param {Object} data - Données
         * @returns {Promise<Object>}
         */
        post(url, data) {
            return this.fetch(url, {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
    };

    // ══════════════════════════════════════════
    // EXPORTS
    // ══════════════════════════════════════════
    window.FINOX_Utils = {
        Tabs,
        Modal,
        Form,
        DateUtils,
        Storage,
        DOM,
        API,
        debounce,
        throttle
    };

    // Note: Les raccourcis $ et $$ ne sont PAS exposés globalement
    // pour éviter les conflits avec d'autres librairies.
    // Utiliser FINOX_Utils.DOM.$ et FINOX_Utils.DOM.$$ à la place.

})(window);
