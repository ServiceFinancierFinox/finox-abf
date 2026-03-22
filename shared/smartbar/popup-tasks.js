// ═══════════════════════════════════════════════════════════════
// SMART BAR — TASKS POPUP 📋
// Adapted from modules/abf-taches.html for sideload popup
// ═══════════════════════════════════════════════════════════════

let tpTasks = [];
let tpMembers = [];
let tpCurrentFilter = 'active';
let tpUserProfile = null;
let tpLoaded = false;

window.openTachesPopup = async function() {
    const overlay = document.getElementById('tachesPopupOverlay');
    overlay.classList.add('show');

    let cd = FINOX.getClientData();
    if (!cd) { try { cd = await FINOX.loadClientData(); } catch(e) {} }
    document.getElementById('tachesPopupClient').textContent = getClientName();

    // Load tasks if not loaded
    if (!tpLoaded) {
        loadTachesPopup();
    }
};

window.closeTachesPopup = function() {
    document.getElementById('tachesPopupOverlay').classList.remove('show');
};

async function loadTachesPopup() {
    const clientId = FINOX.CLIENT_ID || FINOX.getClientId();
    if (!clientId) {
        document.getElementById('tachesPopupList').innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><div style="font-size:24px;margin-bottom:8px;">⚠️</div>Aucun client sélectionné</div>';
        return;
    }

    const user = FINOX.getCurrentUser();
    if (!user) return;

    document.getElementById('tachesPopupList').innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><div class="spinner" style="margin:0 auto 12px;"></div>Chargement...</div>';

    try {
        const { data: profile } = await FINOX.supabase
            .from('profiles')
            .select('organization_id, role, first_name, last_name')
            .eq('id', user.id)
            .single();

        if (!profile) return;
        tpUserProfile = { ...profile, id: user.id };

        // Load tasks for this client + team members in parallel
        const [tasksRes, membersRes] = await Promise.all([
            FINOX.supabase
                .from('tasks')
                .select('*')
                .eq('client_id', clientId)
                .eq('organization_id', profile.organization_id)
                .order('created_at', { ascending: false }),
            FINOX.supabase
                .from('profiles')
                .select('id, first_name, last_name, role')
                .eq('organization_id', profile.organization_id)
        ]);

        tpTasks = tasksRes.data || [];
        tpMembers = (membersRes.data || []).filter(m => m.id !== user.id);

        tpPopulateAssignDropdown();
        tpUpdateStats();
        renderTachesPopup();
        tpLoaded = true;

    } catch (e) {
        console.error('Erreur chargement tâches popup:', e);
        document.getElementById('tachesPopupList').innerHTML = '<div style="text-align:center;padding:30px;color:#f44336;">Erreur de chargement</div>';
    }
}

function tpPopulateAssignDropdown() {
    const select = document.getElementById('tpTaskAssign');
    if (!select) return;
    select.innerHTML = '<option value="">Moi-même</option>' +
        tpMembers.map(m => {
            const name = `${m.first_name || ''} ${m.last_name || ''}`.trim();
            return `<option value="${m.id}">${tpEsc(name)} (${m.role || ''})</option>`;
        }).join('');
}

function tpUpdateStats() {
    const pending = tpTasks.filter(t => t.status === 'pending').length;
    const inProgress = tpTasks.filter(t => t.status === 'in_progress').length;
    const completed = tpTasks.filter(t => t.status === 'completed').length;

    const el1 = document.getElementById('tpStatPending');
    const el2 = document.getElementById('tpStatProgress');
    const el3 = document.getElementById('tpStatDone');
    if (el1) el1.textContent = pending;
    if (el2) el2.textContent = inProgress;
    if (el3) el3.textContent = completed;
}

window.tachesPopupFilter = function(f) {
    tpCurrentFilter = f;
    document.querySelectorAll('.tp-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === f);
    });
    renderTachesPopup();
};

function tpGetFiltered() {
    let list;
    switch (tpCurrentFilter) {
        case 'active':
            list = tpTasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
            break;
        case 'completed':
            list = tpTasks.filter(t => t.status === 'completed');
            break;
        default:
            list = [...tpTasks];
    }

    // Sort: in_progress first, then urgent, then by date
    list.sort((a, b) => {
        const so = { in_progress: 0, pending: 1, completed: 2, dismissed: 3 };
        const po = { urgent: 0, high: 1, normal: 2, low: 3 };
        if (so[a.status] !== so[b.status]) return so[a.status] - so[b.status];
        if (po[a.priority] !== po[b.priority]) return po[a.priority] - po[b.priority];
        return new Date(b.created_at) - new Date(a.created_at);
    });

    return list;
}

function renderTachesPopup() {
    const container = document.getElementById('tachesPopupList');
    const tasks = tpGetFiltered();

    if (tasks.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:30px;color:var(--text-muted);">
                <div style="font-size:24px;margin-bottom:8px;">✅</div>
                <div style="font-size:14px;font-weight:600;margin-bottom:4px;">Aucune tâche</div>
                <div style="font-size:12px;">
                    ${tpCurrentFilter === 'active' ? 'Aucune tâche active pour ce client' :
                      tpCurrentFilter === 'completed' ? 'Aucune tâche complétée' :
                      'Aucune tâche pour ce client'}
                </div>
            </div>`;
        return;
    }

    // Member lookup
    const memberMap = {};
    if (tpUserProfile) {
        memberMap[tpUserProfile.id] = `${tpUserProfile.first_name || ''} ${tpUserProfile.last_name || ''}`.trim() || 'Moi';
    }
    tpMembers.forEach(m => {
        memberMap[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    });

    const sourceLabels = {
        email_watcher: '🤖 AI Email',
        manual: '✏️ Manuel',
        workflow: '⚡ Workflow',
        ai: '🧠 AI'
    };
    const priorityLabels = { urgent: 'Urgente', high: 'Haute', normal: 'Normal', low: 'Basse' };

    container.innerHTML = tasks.map(t => {
        const isActive = t.status === 'pending' || t.status === 'in_progress';
        const assignedName = t.assigned_to && memberMap[t.assigned_to] ? memberMap[t.assigned_to] : '';
        const timeAgo = tpTimeAgo(t.created_at);

        return `
            <div class="tp-card priority-${t.priority} status-${t.status}">
                <div class="tp-card-body">
                    <div class="tp-card-title">${tpEsc(t.title)}</div>
                    <div class="tp-card-meta">
                        <span class="tp-meta-tag priority-${t.priority}">${priorityLabels[t.priority] || t.priority}</span>
                        <span class="tp-meta-tag source-${t.source}">${sourceLabels[t.source] || t.source}</span>
                        <span class="tp-meta-time">🕐 ${timeAgo}</span>
                        ${assignedName ? `<span class="tp-meta-time">👤 ${tpEsc(assignedName)}</span>` : ''}
                        ${t.due_date ? `<span class="tp-meta-time">📅 ${new Date(t.due_date).toLocaleDateString('fr-CA')}</span>` : ''}
                    </div>
                </div>
                <div class="tp-card-actions">
                    ${isActive ? `
                        ${t.status === 'pending' ?
                            `<button class="tp-action-btn start" onclick="tachesPopupSetStatus('${t.id}', 'in_progress')" title="Démarrer">▶</button>` : ''
                        }
                        <button class="tp-action-btn done" onclick="tachesPopupSetStatus('${t.id}', 'completed')" title="Compléter">✓</button>
                        <button class="tp-action-btn dismiss" onclick="tachesPopupSetStatus('${t.id}', 'dismissed')" title="Rejeter">✕</button>
                    ` : `
                        ${t.status === 'completed' ? '<span class="tp-status-badge done">✓ Fait</span>' : ''}
                        ${t.status === 'dismissed' ? '<span class="tp-status-badge dismissed">Rejeté</span>' : ''}
                    `}
                </div>
            </div>`;
    }).join('');
}

// ── ACTIONS ──

window.tachesPopupSetStatus = async function(taskId, newStatus) {
    try {
        const updates = { status: newStatus, updated_at: new Date().toISOString() };
        if (newStatus === 'completed') updates.completed_at = updates.updated_at;

        const { error } = await FINOX.supabase
            .from('tasks')
            .update(updates)
            .eq('id', taskId);

        if (error) throw error;

        const task = tpTasks.find(t => t.id === taskId);
        if (task) {
            task.status = newStatus;
            if (newStatus === 'completed') task.completed_at = updates.completed_at;
        }

        tpUpdateStats();
        renderTachesPopup();

        // Invalidate pulse cache
        const cid = FINOX.CLIENT_ID || FINOX.getClientId();
        if (cid) { FINOX.invalidateCache('pulse_' + cid); FINOX.invalidateCache('pulse_all'); }

        // Update smart bar badge
        if (typeof loadMsgBadges === 'function') loadMsgBadges();

        const msgs = { in_progress: 'Tâche démarrée', completed: 'Tâche complétée', dismissed: 'Tâche rejetée' };
        FINOX.showNotification(msgs[newStatus] || 'Mis à jour', 'success');

    } catch (err) {
        console.error('Erreur MAJ tâche:', err);
        FINOX.showNotification('Erreur', 'error');
    }
};

window.tachesPopupToggleAdd = function() {
    const form = document.getElementById('tachesPopupAddForm');
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) {
        document.getElementById('tpTaskTitle').focus();
    }
};

window.tachesPopupAddTask = async function() {
    const title = document.getElementById('tpTaskTitle').value.trim();
    const priority = document.getElementById('tpTaskPriority').value;
    const assignTo = document.getElementById('tpTaskAssign').value || null;

    if (!title) {
        FINOX.showNotification('Titre requis', 'error');
        return;
    }

    const clientId = FINOX.CLIENT_ID || FINOX.getClientId();
    if (!clientId) {
        FINOX.showNotification('Aucun client sélectionné', 'error');
        return;
    }

    try {
        const user = FINOX.getCurrentUser();

        const { data, error } = await FINOX.supabase
            .from('tasks')
            .insert({
                organization_id: tpUserProfile.organization_id,
                assigned_to: assignTo || user.id,
                created_by: user.id,
                client_id: clientId,
                title: title,
                source: 'manual',
                priority: priority
            })
            .select('*')
            .single();

        if (error) throw error;

        tpTasks.unshift(data);
        document.getElementById('tpTaskTitle').value = '';
        tpUpdateStats();
        renderTachesPopup();

        // Invalidate pulse cache
        const cid2 = FINOX.CLIENT_ID || FINOX.getClientId();
        if (cid2) { FINOX.invalidateCache('pulse_' + cid2); FINOX.invalidateCache('pulse_all'); }

        // Update smart bar badge
        if (typeof loadMsgBadges === 'function') loadMsgBadges();

        FINOX.showNotification('Tâche créée', 'success');

    } catch (err) {
        console.error('Erreur création tâche:', err);
        FINOX.showNotification('Erreur', 'error');
    }
};

// ── HELPERS ──

function tpTimeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (min < 1) return "À l'instant";
    if (min < 60) return `${min}min`;
    if (hrs < 24) return `${hrs}h`;
    if (days < 7) return `${days}j`;
    return new Date(dateStr).toLocaleDateString('fr-CA');
}

function tpEsc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
