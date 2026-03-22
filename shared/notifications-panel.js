/**
 * ═══════════════════════════════════════════════════════════════
 * FINOX OS — Notifications Panel
 * ═══════════════════════════════════════════════════════════════
 * Centre de notifications: leads, SMS, emails entrants
 * Panneau latéral droit avec bulle flottante 🔔
 */
window.NotifPanel = (function () {
    'use strict';

    // State
    let notifications = [];  // { id, clientId, clientName, initials, type, title, preview, time, read }
    let currentFilter = 'all';
    let panelOpen = false;
    let pinned = false;

    // ─────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function timeAgo(date) {
        if (!date) return '';
        const d = new Date(date);
        const now = new Date();
        const diff = Math.floor((now - d) / 1000);
        if (diff < 60) return 'À l\'instant';
        if (diff < 3600) return `${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} j`;
        return d.toLocaleDateString('fr-CA');
    }

    function getInitials(name) {
        const parts = (name || '?').split(' ');
        return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
    }

    // ─────────────────────────────────────────
    // PERSISTENCE (localStorage)
    // ─────────────────────────────────────────
    function getReadSet() {
        try { return new Set(JSON.parse(localStorage.getItem('finox_notif_read') || '[]')); } catch { return new Set(); }
    }
    function saveReadSet(set) {
        localStorage.setItem('finox_notif_read', JSON.stringify([...set].slice(-500)));
    }
    function getArchivedSet() {
        try { return new Set(JSON.parse(localStorage.getItem('finox_notif_archived') || '[]')); } catch { return new Set(); }
    }
    function saveArchivedSet(set) {
        localStorage.setItem('finox_notif_archived', JSON.stringify([...set].slice(-500)));
    }
    function isRead(notifId) { return getReadSet().has(notifId); }
    function markRead(notifId) {
        const set = getReadSet();
        set.add(notifId);
        saveReadSet(set);
        const n = notifications.find(n => n.id === notifId);
        if (n) n.read = true;
        render();
        updateBadge();
    }
    function markUnread(notifId) {
        const set = getReadSet();
        set.delete(notifId);
        saveReadSet(set);
        const n = notifications.find(n => n.id === notifId);
        if (n) n.read = false;
        render();
        updateBadge();
    }
    function markAllRead() {
        const set = getReadSet();
        notifications.forEach(n => { set.add(n.id); n.read = true; });
        saveReadSet(set);
        render();
        updateBadge();
    }
    function archiveAll() {
        // Mark all as read + clear the list
        const set = getReadSet();
        notifications.forEach(n => set.add(n.id));
        saveReadSet(set);
        // Save archived IDs so they don't reappear on reload
        const archivedSet = getArchivedSet();
        notifications.forEach(n => archivedSet.add(n.id));
        saveArchivedSet(archivedSet);
        notifications = [];
        render();
        updateBadge();
    }

    // ─────────────────────────────────────────
    // INJECT HTML
    // ─────────────────────────────────────────
    function injectHTML() {
        if (document.getElementById('notifBubble')) return;

        const bubble = document.createElement('button');
        bubble.id = 'notifBubble';
        bubble.className = 'notif-bubble';
        bubble.onclick = togglePanel;
        bubble.innerHTML = '🔔<span class="notif-bubble-badge hidden" id="notifBadge">0</span>';
        document.body.appendChild(bubble);

        const overlay = document.createElement('div');
        overlay.id = 'notifOverlay';
        overlay.className = 'notif-overlay';
        overlay.onclick = closePanel;
        document.body.appendChild(overlay);

        const panel = document.createElement('div');
        panel.id = 'notifPanel';
        panel.className = 'notif-panel';
        panel.innerHTML = `
            <div class="notif-header">
                <div class="notif-header-left">
                    <h3>🔔 Notifications</h3>
                    <span class="notif-header-count zero" id="notifHeaderCount">0</span>
                </div>
                <div class="notif-header-actions">
                    <button class="notif-header-btn" id="notifPinBtn" onclick="NotifPanel.togglePin()" title="Épingler">📌</button>
                    <button class="notif-header-btn" onclick="NotifPanel.archiveAll()" title="Archiver tout">🗑️</button>
                    <button class="notif-header-btn" onclick="NotifPanel.markAllRead()" title="Tout marquer lu">✓✓</button>
                    <button class="notif-header-btn" onclick="NotifPanel.closePanel()" title="Fermer">✕</button>
                </div>
            </div>
            <div class="notif-filters">
                <button class="notif-filter-btn active" data-filter="all" onclick="NotifPanel.filterBy('all')">Tous</button>
                <button class="notif-filter-btn" data-filter="lead" onclick="NotifPanel.filterBy('lead')">🎯 Leads</button>
                <button class="notif-filter-btn" data-filter="sms" onclick="NotifPanel.filterBy('sms')">💬 SMS</button>
                <button class="notif-filter-btn" data-filter="email" onclick="NotifPanel.filterBy('email')">📧 Emails</button>
            </div>
            <div class="notif-list" id="notifList"></div>
            <div class="notif-mark-all" id="notifMarkAll" style="display:none;">
                <button class="notif-mark-all-btn" onclick="NotifPanel.markAllRead()">Tout marquer comme lu</button>
            </div>
        `;
        document.body.appendChild(panel);
    }

    // ─────────────────────────────────────────
    // TOGGLE / OPEN / CLOSE
    // ─────────────────────────────────────────
    function togglePanel() {
        panelOpen ? closePanel() : openPanel();
    }
    function openPanel() {
        panelOpen = true;
        document.getElementById('notifPanel')?.classList.add('show');
        if (!pinned) document.getElementById('notifOverlay')?.classList.add('show');
        document.getElementById('notifBubble')?.classList.add('open');
        render();
    }
    function closePanel() {
        // Unpin if pinned
        if (pinned) {
            pinned = false;
            const btn = document.getElementById('notifPinBtn');
            const mainContent = document.querySelector('.app-container, .main-content, #appContent, main, .abf-container');
            if (btn) btn.style.color = '';
            if (mainContent) mainContent.style.marginRight = '';
            document.getElementById('notifPanel')?.classList.remove('pinned');
            localStorage.setItem('finox_notif_pinned', '0');
        }
        panelOpen = false;
        document.getElementById('notifPanel')?.classList.remove('show');
        document.getElementById('notifOverlay')?.classList.remove('show');
        document.getElementById('notifBubble')?.classList.remove('open');
    }
    function togglePin() {
        pinned = !pinned;
        const btn = document.getElementById('notifPinBtn');
        const overlay = document.getElementById('notifOverlay');
        const mainContent = document.querySelector('.app-container, .main-content, #appContent, main, .abf-container');
        if (pinned) {
            if (btn) btn.style.color = '#3b82f6';
            overlay?.classList.remove('show');
            if (mainContent) mainContent.style.marginRight = '390px';
            document.getElementById('notifPanel')?.classList.add('pinned');
        } else {
            if (btn) btn.style.color = '';
            if (mainContent) mainContent.style.marginRight = '';
            document.getElementById('notifPanel')?.classList.remove('pinned');
        }
        localStorage.setItem('finox_notif_pinned', pinned ? '1' : '0');
    }

    // ─────────────────────────────────────────
    // FILTER
    // ─────────────────────────────────────────
    function filterBy(type) {
        currentFilter = type;
        document.querySelectorAll('.notif-filter-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.filter === type)
        );
        render();
    }

    // ─────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────
    function render() {
        const list = document.getElementById('notifList');
        if (!list) return;

        const filtered = currentFilter === 'all'
            ? notifications
            : notifications.filter(n => n.type === currentFilter);

        if (filtered.length === 0) {
            list.innerHTML = `
                <div class="notif-empty">
                    <div class="notif-empty-icon">🔔</div>
                    <div class="notif-empty-text">${currentFilter === 'all' ? 'Aucune notification' : 'Aucune notification de ce type'}</div>
                </div>
            `;
            document.getElementById('notifMarkAll').style.display = 'none';
            return;
        }

        list.innerHTML = filtered.map(n => {
            const typeClass = n.type || 'email';
            const typeLabel = n.type === 'lead' ? 'Nouveau lead' : n.type === 'sms' ? 'SMS' : 'Email';
            const typeIcon = n.type === 'lead' ? '🎯' : n.type === 'sms' ? '💬' : '📧';

            return `
                <div class="notif-item ${n.read ? '' : 'unread'}" onclick="NotifPanel.openNotif('${n.id}', '${n.clientId}')">
                    <div class="notif-item-avatar ${typeClass}">${escapeHtml(n.initials)}</div>
                    <div class="notif-item-content">
                        <div class="notif-item-top">
                            <span class="notif-item-name">${escapeHtml(n.clientName)}</span>
                            <span class="notif-item-time">${timeAgo(n.time)}</span>
                        </div>
                        <div class="notif-item-preview">${typeIcon} ${escapeHtml(n.preview)}</div>
                        <span class="notif-item-type ${typeClass}">${typeLabel}</span>
                    </div>
                    <div class="notif-item-actions">
                        ${n.read
                            ? `<button class="notif-action-btn" onclick="event.stopPropagation();NotifPanel.markUnread('${n.id}')" title="Marquer non lu">📬</button>`
                            : `<button class="notif-action-btn" onclick="event.stopPropagation();NotifPanel.markRead('${n.id}')" title="Marquer lu">✓</button>`
                        }
                    </div>
                </div>
            `;
        }).join('');

        const hasUnread = filtered.some(n => !n.read);
        document.getElementById('notifMarkAll').style.display = hasUnread ? 'flex' : 'none';
    }

    // ─────────────────────────────────────────
    // OPEN NOTIFICATION → Navigate to client
    // ─────────────────────────────────────────
    function openNotif(notifId, clientId) {
        markRead(notifId);
        closePanel();

        // If on app.html, use viewClient. Otherwise navigate.
        if (typeof viewClient === 'function') {
            viewClient(clientId);
        } else {
            window.location.href = 'abf.html?client=' + clientId;
        }
    }

    // ─────────────────────────────────────────
    // UPDATE BADGE
    // ─────────────────────────────────────────
    function updateBadge(count) {
        if (count === undefined) {
            count = notifications.filter(n => !n.read).length;
        }
        const badge = document.getElementById('notifBadge');
        const headerCount = document.getElementById('notifHeaderCount');
        const bubble = document.getElementById('notifBubble');

        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
        if (headerCount) {
            headerCount.textContent = count;
            headerCount.classList.toggle('zero', count === 0);
        }
        if (bubble) {
            bubble.classList.toggle('has-new', count > 0);
        }
    }

    // ─────────────────────────────────────────
    // ADD NOTIFICATION (called by Realtime)
    // ─────────────────────────────────────────
    function addNotification(entry) {
        if (!entry) return;

        // Determine type
        let type = 'email';
        if (entry.activity_type === 'sms_inbound') type = 'sms';
        else if (entry.type === 'lead' || entry.activity_type === 'new_lead') type = 'lead';

        const id = entry.id || entry.client_id + '_' + Date.now();
        const clientId = entry.client_id || entry.clientId || entry.id;

        // Avoid duplicates & archived
        if (notifications.find(n => n.id === id)) return;
        if (getArchivedSet().has(id)) return;

        const clientName = entry.clientName || entry.client_name ||
            (entry.first_name ? `${entry.first_name} ${entry.last_name || ''}`.trim() : 'Client');

        const preview = entry.title || entry.description || entry.preview || '';

        const notif = {
            id,
            clientId,
            clientName,
            initials: getInitials(clientName),
            type,
            title: entry.title || '',
            preview: preview.substring(0, 100),
            time: entry.created_at || new Date().toISOString(),
            read: isRead(id)
        };

        // Add to top
        notifications.unshift(notif);

        // Keep max 100
        if (notifications.length > 100) notifications = notifications.slice(0, 100);

        if (panelOpen) render();
        updateBadge();
    }

    // ─────────────────────────────────────────
    // LOAD NOTIFICATIONS FROM DB
    // ─────────────────────────────────────────
    async function loadNotifications() {
        try {
            if (!window.FINOX?.supabase) return;

            // Load recent messages from client_timeline (last 7 days)
            const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await FINOX.supabase
                .from('client_timeline')
                .select('id, client_id, activity_type, title, description, created_at')
                .in('activity_type', ['email_inbound', 'email_inbound_ai', 'sms_inbound'])
                .gt('created_at', since)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error || !data) return;

            // Get client names
            const clientIds = [...new Set(data.map(d => d.client_id))];
            let clientMap = {};
            if (clientIds.length > 0) {
                const { data: clients } = await FINOX.supabase
                    .from('clients')
                    .select('id, first_name, last_name')
                    .in('id', clientIds);
                if (clients) {
                    clients.forEach(c => {
                        clientMap[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Client';
                    });
                }
            }

            const readSet = getReadSet();
            const archivedSet = getArchivedSet();

            notifications = data.filter(d => !archivedSet.has(d.id)).map(d => {
                const type = d.activity_type === 'sms_inbound' ? 'sms' : 'email';
                const name = clientMap[d.client_id] || 'Client';
                return {
                    id: d.id,
                    clientId: d.client_id,
                    clientName: name,
                    initials: getInitials(name),
                    type,
                    title: d.title || '',
                    preview: (d.title || d.description || '').substring(0, 100),
                    time: d.created_at,
                    read: true // Initial load = all read; only Realtime inserts are unread
                };
            });

            // Mark all loaded as read in localStorage
            notifications.forEach(n => readSet.add(n.id));
            saveReadSet(readSet);

            render();
            updateBadge();
            console.log(`[NotifPanel] Loaded ${notifications.length} notifications (${notifications.filter(n => !n.read).length} unread)`);
        } catch (e) {
            console.warn('[NotifPanel] Load error:', e.message);
        }
    }

    // ─────────────────────────────────────────
    // ADD NEW LEAD NOTIFICATION
    // ─────────────────────────────────────────
    function addLeadNotification(lead) {
        if (!lead) return;
        const name = lead.type_contact === 'corpo'
            ? (lead.first_name || 'Entreprise')
            : `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Nouveau lead';

        addNotification({
            id: 'lead_' + lead.id,
            client_id: lead.id,
            clientName: name,
            activity_type: 'new_lead',
            type: 'lead',
            title: `🎯 ${name}`,
            preview: lead.type_contact === 'corpo' ? 'Nouvelle entreprise' : 'Nouveau prospect',
            created_at: lead.created_at || new Date().toISOString()
        });
    }

    // ─────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────
    function init() {
        injectHTML();
        // Restore pinned state from localStorage
        if (localStorage.getItem('finox_notif_pinned') === '1') {
            openPanel();
            togglePin();
        }
        // Load after a short delay to let auth settle
        setTimeout(() => loadNotifications(), 3000);
        console.log('[NotifPanel] Initialized');
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }

    // ─────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────
    return {
        togglePanel,
        openPanel,
        closePanel,
        togglePin,
        filterBy,
        markRead,
        markUnread,
        markAllRead,
        archiveAll,
        addNotification,
        addLeadNotification,
        loadNotifications,
        updateBadge,
        openNotif
    };
})();
