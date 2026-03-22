// ═══════════════════════════════════════════════════════════════
// SMART BAR — CALENDAR POPUP 📅
// Google Calendar integration + booking + type select
// ═══════════════════════════════════════════════════════════════

const GOOGLE_API = 'https://crm.finox.ca/google';
let calGoogleTokens = null;
let calSelectedDate = new Date();
let calCurrentMonth = new Date();
let calSelectedTimeSlot = null;
let calSelectedMeetingType = '';
let calSelectedMeetingTypeId = null;
let calSelectedMeetingCategory = null;
let calSelectedMeetingDuration = 30;
let calClientName = '';
let calSelectedLocation = 'client';

// Helper pour les appels Google API avec auto-refresh du token
async function googleApiFetch(endpoint, options = {}) {
    const headers = options.headers || {};
    const userId = FINOX.getCurrentUser()?.id;
    if (userId) headers['X-User-Id'] = userId;
    if (calGoogleTokens?.access_token && !headers['Authorization']) {
        headers['Authorization'] = 'Bearer ' + calGoogleTokens.access_token;
    }
    const response = await fetch(GOOGLE_API + endpoint, { ...options, headers: { 'Content-Type': 'application/json', ...headers } });
    const data = await response.json();
    if (data.error && (data.error.includes('invalid authentication') || data.error.includes('Token expired'))) {
        console.log('[Google API] Token expiré, tentative de refresh...');
        const refreshResponse = await fetch(GOOGLE_API + '/refresh-token', { method: 'POST', headers: { 'X-User-Id': userId } });
        if (refreshResponse.ok) {
            const retryResponse = await fetch(GOOGLE_API + endpoint, { ...options, headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, ...headers } });
            return retryResponse.json();
        }
    }
    return data;
}

// Vérifier connexion Google via Supabase OAuth
async function checkCalendarGoogleConnection() {
    // Rafraîchir le token proactivement si nécessaire
    if (FINOX.ensureValidGoogleToken) {
        try { await FINOX.ensureValidGoogleToken(); } catch(e) {}
    }
    // Essayer sessionStorage d'abord (migré par config.js), puis localStorage en fallback
    const provider = sessionStorage.getItem('finox_provider') || localStorage.getItem('finox_provider');
    const providerToken = sessionStorage.getItem('finox_provider_token') || localStorage.getItem('finox_provider_token');
    const isGoogleToken = providerToken && providerToken.startsWith('ya29.');
    if ((provider === 'google' || isGoogleToken) && providerToken) {
        let userEmail = 'Connecté';
        try {
            const { data: { session } } = await FINOX.supabase.auth.getSession();
            if (session?.user?.email) userEmail = session.user.email;
        } catch(e) {
            try {
                userEmail = sessionStorage.getItem('finox_user_email') || localStorage.getItem('finox_user_email') || 'Connecté';
            } catch(e2) {}
        }
        calGoogleTokens = { access_token: providerToken, email: userEmail };
        return true;
    }
    // Fallback ancien format
    try {
        const stored = localStorage.getItem('finox_google_tokens');
        if (stored) {
            const tokens = JSON.parse(stored);
            if (tokens.expires_at && tokens.expires_at > Date.now()) {
                calGoogleTokens = tokens;
                return true;
            }
        }
    } catch(e) {}
    return false;
}

// Ouvrir/fermer popup calendrier
window.openCalendarPopup = async function() {
    try {
        const client = await FINOX.loadClientData(true);
        if (client) calClientName = ((client.first_name || '') + ' ' + (client.last_name || '')).trim();
    } catch(e) {}

    const connected = await checkCalendarGoogleConnection();
    const accountEl = document.getElementById('calPopupAccount');
    const statusEl = document.getElementById('calPopupStatus');
    if (connected) {
        accountEl.textContent = calGoogleTokens.email;
        statusEl.innerHTML = '<span style="display:flex;align-items:center;gap:6px;font-size:11px;color:#4CAF50;"><span class="status-dot"></span>Synchronisé</span>';
    } else {
        accountEl.textContent = 'Non connecté';
        statusEl.innerHTML = '<button class="mini-cal-today-btn" onclick="connectGoogleCalendar()" style="font-size:11px;padding:6px 12px;">Connecter</button>';
    }

    document.getElementById('calendarPopupOverlay').classList.add('show');
    calRenderMiniCalendar();
    calRenderTimeSlots();
    if (calGoogleTokens) calLoadScheduledMeetings();
};

window.closeCalendarPopup = function() {
    document.getElementById('calendarPopupOverlay').classList.remove('show');
};

// Mini calendrier
function calRenderMiniCalendar() {
    const g = document.getElementById('calPopupGrid');
    const y = calCurrentMonth.getFullYear(), m = calCurrentMonth.getMonth();
    const mn = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    document.getElementById('calPopupMonth').textContent = `${mn[m]} ${y}`;
    let h = ['D','L','M','M','J','V','S'].map(d => `<div class="mini-cal-header">${d}</div>`).join('');
    const fd = new Date(y, m, 1).getDay(), dm = new Date(y, m + 1, 0).getDate(), pd = new Date(y, m, 0).getDate(), t = new Date();
    for (let i = fd - 1; i >= 0; i--) h += `<div class="mini-cal-day other-month">${pd - i}</div>`;
    for (let d = 1; d <= dm; d++) {
        let cls = 'mini-cal-day';
        if (t.getDate() === d && t.getMonth() === m && t.getFullYear() === y) cls += ' today';
        if (calSelectedDate.getDate() === d && calSelectedDate.getMonth() === m && calSelectedDate.getFullYear() === y) cls += ' selected';
        h += `<div class="${cls}" onclick="calSelectDate(${y},${m},${d})">${d}</div>`;
    }
    const r = 7 - ((fd + dm) % 7);
    if (r < 7) for (let i = 1; i <= r; i++) h += `<div class="mini-cal-day other-month">${i}</div>`;
    g.innerHTML = h;
}

window.calSelectDate = function(y, m, d) {
    calSelectedDate = new Date(y, m, d);
    calRenderMiniCalendar();
    calRenderTimeSlots();
    if (calGoogleTokens) calLoadScheduledMeetings();
};

window.calPrevMonth = function() { calCurrentMonth.setMonth(calCurrentMonth.getMonth() - 1); calRenderMiniCalendar(); };
window.calNextMonth = function() { calCurrentMonth.setMonth(calCurrentMonth.getMonth() + 1); calRenderMiniCalendar(); };
window.calGoToToday = function() { calCurrentMonth = new Date(); calSelectedDate = new Date(); calRenderMiniCalendar(); calRenderTimeSlots(); if (calGoogleTokens) calLoadScheduledMeetings(); };

// Fetch events
async function calFetchEvents(startDate, endDate) {
    if (!calGoogleTokens) return [];
    try {
        const data = await googleApiFetch(`/calendar/events?timeMin=${startDate.toISOString()}&timeMax=${endDate.toISOString()}`);
        if (data.error) throw new Error(data.error);
        return data.events || [];
    } catch (e) { console.error('Erreur calendrier:', e); return []; }
}

// Render time slots
async function calRenderTimeSlots() {
    const container = document.getElementById('calPopupTimeSlots');
    const dn = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const mn = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    document.getElementById('calPopupDateTitle').textContent = `📅 ${dn[calSelectedDate.getDay()]} ${calSelectedDate.getDate()} ${mn[calSelectedDate.getMonth()]}`;
    let busySlots = {};
    if (calGoogleTokens) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">⏳ Chargement...</div>';
        const startOfDay = new Date(calSelectedDate); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(calSelectedDate); endOfDay.setHours(23,59,59,999);
        const events = await calFetchEvents(startOfDay, endOfDay);
        events.forEach(e => {
            if (!e.start || !String(e.start).includes('T')) return;
            if (e.transparency === 'transparent') return;
            const start = new Date(e.start), end = new Date(e.end);
            if (end - start > 12 * 60 * 60 * 1000) return;
            for (let t = start.getTime(); t < end.getTime(); t += 30 * 60 * 1000) {
                const d = new Date(t);
                const key = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                busySlots[key] = 'Occupé';
            }
        });
    }
    let h = '';
    for (let hr = 8; hr <= 21; hr++) {
        for (let min = 0; min < 60; min += 30) {
            const time = `${String(hr).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
            if (busySlots[time]) {
                h += `<div class="time-slot"><span class="time-slot-time">${time}</span><div class="time-slot-content busy">🔒 Occupé</div></div>`;
            } else {
                h += `<div class="time-slot"><span class="time-slot-time">${time}</span><div class="time-slot-content free" onclick="calSelectTimeSlot('${time}')">✅ Dispo</div></div>`;
            }
        }
    }
    container.innerHTML = h;
}

window.calSelectTimeSlot = function(time) {
    calSelectedTimeSlot = time;
    document.querySelectorAll('.time-slot-content').forEach(e => e.classList.remove('selected'));
    event.target.classList.add('selected');
    openTypeSelectModal();
};

// Type select modal
async function openTypeSelectModal() {
    const modal = document.getElementById('typeSelectModalOverlay');
    const dn = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const mn = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    const dateStr = `${dn[calSelectedDate.getDay()].charAt(0).toUpperCase() + dn[calSelectedDate.getDay()].slice(1)} ${calSelectedDate.getDate()} ${mn[calSelectedDate.getMonth()]} à ${calSelectedTimeSlot}`;
    document.getElementById('typeSelectDateTime').textContent = dateStr;
    document.getElementById('typeSelectClientName').textContent = calClientName || 'Client';

    try {
        const { data: types, error } = await FINOX.supabase
            .from('meeting_types')
            .select('*')
            .eq('is_active', true)
            .order('display_order', { ascending: true });

        if (error) throw error;

        const appels = (types || []).filter(t => t.category === 'appel');
        const rencontres = (types || []).filter(t => t.category === 'rencontre');

        document.getElementById('typeSelectAppels').innerHTML = appels.map(t =>
            `<div class="type-select-item appel" onclick="selectTypeFromModal('${t.name.replace(/'/g, "\\'")}', '${t.icon}', ${t.duration_minutes}, false, '${t.id}', '${t.category}')"><span class="tsi-icon">${t.icon}</span><span class="tsi-label">${t.name}</span><span class="tsi-duration">${t.duration_minutes}min</span></div>`
        ).join('') || '<div style="padding:10px;text-align:center;font-size:11px;color:var(--text-muted);">Aucun type</div>';

        document.getElementById('typeSelectRencontres').innerHTML = rencontres.map(t =>
            `<div class="type-select-item rencontre" onclick="selectTypeFromModal('${t.name.replace(/'/g, "\\'")}', '${t.icon}', ${t.duration_minutes}, true, '${t.id}', '${t.category}')"><span class="tsi-icon">${t.icon}</span><span class="tsi-label">${t.name}</span><span class="tsi-duration">${t.duration_minutes}min</span></div>`
        ).join('') || '<div style="padding:10px;text-align:center;font-size:11px;color:var(--text-muted);">Aucun type</div>';

    } catch(e) {
        console.error('Erreur chargement meeting_types:', e);
        document.getElementById('typeSelectAppels').innerHTML = `
            <div class="type-select-item appel" onclick="selectTypeFromModal('Appel comparative d\\'assurance vie', '❤️', 30, false, null, 'appel')"><span class="tsi-icon">❤️</span><span class="tsi-label">Assurance vie</span><span class="tsi-duration">30min</span></div>
            <div class="type-select-item appel" onclick="selectTypeFromModal('Appel Planifié', '📞', 5, false, null, 'appel')"><span class="tsi-icon">📞</span><span class="tsi-label">Appel Planifié</span><span class="tsi-duration">5min</span></div>
        `;
        document.getElementById('typeSelectRencontres').innerHTML = `
            <div class="type-select-item rencontre" onclick="selectTypeFromModal('Rencontre comparative d\\'assurance vie', '❤️', 30, true, null, 'rencontre')"><span class="tsi-icon">❤️</span><span class="tsi-label">Assurance vie</span><span class="tsi-duration">30min</span></div>
            <div class="type-select-item rencontre" onclick="selectTypeFromModal('Rencontre Épargne/placement/REER/CELI', '💰', 30, true, null, 'rencontre')"><span class="tsi-icon">💰</span><span class="tsi-label">Épargne/REER/CELI</span><span class="tsi-duration">30min</span></div>
        `;
    }

    modal.classList.add('show');
}

window.closeTypeSelectModal = function() {
    document.getElementById('typeSelectModalOverlay').classList.remove('show');
};

window.selectTypeFromModal = function(type, icon, duration, withMeet, typeId, category) {
    calSelectedMeetingType = type;
    calSelectedMeetingTypeId = typeId || null;
    calSelectedMeetingCategory = category || (type.toLowerCase().includes('appel') ? 'appel' : 'rencontre');
    calSelectedMeetingDuration = duration;
    closeTypeSelectModal();
    setTimeout(() => openConfirmationModal(icon, calSelectedMeetingCategory === 'appel', withMeet), 200);
};

function openConfirmationModal(icon, isAppel, shouldMeet) {
    const modal = document.getElementById('bookingModalOverlay');
    const dn = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const mn = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    const dateStr = `${dn[calSelectedDate.getDay()]} ${calSelectedDate.getDate()} ${mn[calSelectedDate.getMonth()]} ${calSelectedDate.getFullYear()} à ${calSelectedTimeSlot}`;
    document.getElementById('modalMeetingIcon').textContent = icon;
    document.getElementById('modalMeetingType').textContent = calSelectedMeetingType;
    document.getElementById('modalMeetingType').className = 'booking-modal-type ' + (isAppel ? 'appel' : 'rencontre');
    document.getElementById('modalClientName').textContent = calClientName || 'Client';
    document.getElementById('modalDateTime').textContent = dateStr;
    document.getElementById('modalDuration').textContent = calSelectedMeetingDuration + ' minutes';
    const meetCheckbox = document.getElementById('modalGoogleMeet');
    meetCheckbox.checked = shouldMeet;
    document.getElementById('modalNotes').value = '';
    // Section lieu: cachée par défaut, visible seulement si rencontre + Meet décoché
    const locationSection = document.getElementById('modalLocationSection');
    if (locationSection) {
        locationSection.style.display = (!isAppel && !shouldMeet) ? 'block' : 'none';
        calSelectedLocation = '';
        document.getElementById('locationBtnClient').classList.remove('active');
        document.getElementById('locationBtnBureau').classList.remove('active');
    }
    // Toggle lieu quand on coche/décoche Meet
    meetCheckbox.onchange = function() {
        if (locationSection) {
            const showLoc = !isAppel && !this.checked;
            locationSection.style.display = showLoc ? 'block' : 'none';
            if (!showLoc) {
                calSelectedLocation = '';
                document.getElementById('locationBtnClient').classList.remove('active');
                document.getElementById('locationBtnBureau').classList.remove('active');
            }
        }
    };
    modal.querySelector('.booking-modal-confirm').className = 'booking-modal-confirm ' + (isAppel ? 'appel' : '');
    modal.classList.add('show');
}

window.closeBookingModal = function() {
    document.getElementById('bookingModalOverlay').classList.remove('show');
};

window.selectLocation = function(loc) {
    calSelectedLocation = loc;
    document.getElementById('locationBtnClient').classList.toggle('active', loc === 'client');
    document.getElementById('locationBtnBureau').classList.toggle('active', loc === 'bureau');
};

window.confirmBookingFromModal = async function() {
    const addMeet = document.getElementById('modalGoogleMeet')?.checked || false;
    const notes = document.getElementById('modalNotes')?.value || '';
    const [hours, mins] = calSelectedTimeSlot.split(':');
    const startTime = new Date(calSelectedDate);
    startTime.setHours(parseInt(hours), parseInt(mins), 0, 0);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + calSelectedMeetingDuration);

    // Helper: format local ISO string (no 'Z' suffix = timezone-aware via server)
    function toLocalISO(d) {
        const offset = -d.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
        const mm = String(Math.abs(offset) % 60).padStart(2, '0');
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00${sign}${hh}:${mm}`;
    }

    let googleEventId = null, googleMeetLink = null;

    // Déterminer le lieu pour les rencontres en présentiel
    const client = await FINOX.loadClientData(true);
    let locationText = '';
    const isRencontre = calSelectedMeetingType.toLowerCase().includes('rencontre');
    if (isRencontre && !addMeet && calSelectedLocation) {
        if (calSelectedLocation === 'client' && client) {
            const parts = [client.street_address, client.city, client.province].filter(Boolean);
            locationText = parts.length > 0 ? parts.join(', ') : 'Chez le client';
        } else if (calSelectedLocation === 'bureau') {
            locationText = 'Au bureau';
        }
    }

    // 1. Créer événement Google Calendar
    if (calGoogleTokens) {
        try {
            const eventBody = {
                summary: `${calSelectedMeetingType} - ${calClientName}`,
                description: notes,
                start: toLocalISO(startTime),
                end: toLocalISO(endTime),
                attendees: client?.email ? [client.email] : [],
                addGoogleMeet: addMeet
            };
            if (locationText) eventBody.location = locationText;
            const data = await googleApiFetch('/calendar/events', {
                method: 'POST',
                body: JSON.stringify(eventBody)
            });
            if (data.error) throw new Error(data.error);
            googleEventId = data.eventId || data.id;
            googleMeetLink = data.hangoutLink || null;
            FINOX.showNotification('📅 RDV créé dans Google Calendar!', 'success');
        } catch (e) {
            console.error('Erreur Google Calendar:', e);
            FINOX.showNotification('Erreur création RDV Google', 'error');
        }
    }

    // 2. Enregistrer dans scheduled_meetings et déclencher workflows
    try {
        let locationType = 'phone';
        if (addMeet || googleMeetLink) locationType = 'virtual';
        if (isRencontre && !addMeet) locationType = 'in_person';

        const meetingPayload = {
            client_id: FINOX.CLIENT_ID,
            conseiller_id: FINOX.getCurrentUser()?.id,
            meeting_type_id: calSelectedMeetingTypeId,
            google_event_id: googleEventId,
            google_meet_link: googleMeetLink,
            title: `${calSelectedMeetingType} - ${calClientName}`,
            description: notes,
            scheduled_at: toLocalISO(startTime),
            duration_minutes: calSelectedMeetingDuration,
            location_type: locationType,
            location_details: googleMeetLink || locationText || ''
        };
        const workflowResponse = await fetch('/workflow/meeting/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(meetingPayload)
        });
        const workflowResult = await workflowResponse.json();
        if (workflowResult.success && workflowResult.workflows_triggered > 0) {
            FINOX.showNotification(`✅ RDV + ${workflowResult.workflows_triggered} workflow(s) déclenchés`, 'success');
        }
    } catch (e) {
        console.error('Erreur enregistrement meeting:', e);
    }

    // 3. Timeline — type correct selon la catégorie
    const timelineType = calSelectedMeetingCategory === 'appel' ? 'call_outbound' : 'meeting_virtual';
    FINOX.addTimelineEntry(timelineType, `RDV: ${calSelectedMeetingType}`, `${calSelectedDate.toLocaleDateString('fr-CA')} à ${calSelectedTimeSlot} (${calSelectedMeetingDuration}min)`);

    closeBookingModal();
    calSelectedTimeSlot = null;
    calRenderTimeSlots();
    calLoadScheduledMeetings();
};

// Charger les RDV de la journée
window.calLoadScheduledMeetings = async function() {
    const container = document.getElementById('calPopupMeetingsList');
    if (!calGoogleTokens) {
        container.innerHTML = '<div class="comm-empty-state" style="padding:15px;"><div class="comm-empty-text" style="font-size:11px;">Connectez Google</div></div>';
        return;
    }
    container.innerHTML = '<div style="padding:15px;text-align:center;font-size:11px;color:var(--text-muted);">⏳</div>';
    const dn = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
    const mn = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    document.getElementById('calPopupMeetingsTitle').textContent = `📆 RDV — ${dn[calSelectedDate.getDay()]} ${calSelectedDate.getDate()} ${mn[calSelectedDate.getMonth()]}`;
    try {
        const startOfDay = new Date(calSelectedDate); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(calSelectedDate); endOfDay.setHours(23,59,59,999);
        const events = await calFetchEvents(startOfDay, endOfDay);
        const dayEvents = events.filter(e => e.start && String(e.start).includes('T'));
        if (dayEvents.length === 0) {
            container.innerHTML = '<div class="comm-empty-state" style="padding:10px;"><div class="comm-empty-text" style="font-size:11px;">Aucun RDV cette journée</div></div>';
            return;
        }
        dayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
        let html = '';
        dayEvents.forEach(e => {
            const start = new Date(e.start);
            const end = e.end ? new Date(e.end) : null;
            const timeStr = start.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit' }) + (end ? ' – ' + end.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit' }) : '');
            const isClientEvent = (e.summary || '').toLowerCase().includes((calClientName || '').toLowerCase());
            const borderColor = isClientEvent ? '#34A853' : 'rgba(255,255,255,0.15)';
            const bgColor = isClientEvent ? 'rgba(52,168,83,0.1)' : 'rgba(255,255,255,0.03)';
            const icon = isClientEvent ? '🤝' : '📅';
            html += `<div style="padding:8px 10px;background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;margin-bottom:4px;"><div style="font-size:11px;font-weight:600;">${icon} ${e.summary || 'RDV'}</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${timeStr}</div></div>`;
        });
        container.innerHTML = html;
    } catch (e) { container.innerHTML = '<div class="comm-empty-state" style="padding:10px;"><div class="comm-empty-text" style="font-size:11px;">Erreur</div></div>'; }
};

window.connectGoogleCalendar = async function() {
    const connected = await checkCalendarGoogleConnection();
    if (connected) {
        document.getElementById('calPopupAccount').textContent = calGoogleTokens.email;
        document.getElementById('calPopupStatus').innerHTML = '<span style="display:flex;align-items:center;gap:6px;font-size:11px;color:#4CAF50;"><span class="status-dot"></span>Synchronisé</span>';
        FINOX.showNotification('🔗 Google déjà connecté!', 'success');
        calRenderTimeSlots();
        calLoadScheduledMeetings();
        return;
    }
    const confirmed = await FINOX.confirm('Pour connecter Google, vous devez vous connecter avec votre compte Google.\n\nVoulez-vous vous déconnecter et vous reconnecter avec Google?');
    if (confirmed) {
        localStorage.setItem('finox_redirect_after_login', window.location.href);
        window.location.href = '/index.html?connect=google';
    }
};
