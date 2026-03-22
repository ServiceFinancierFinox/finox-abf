// ═══════════════════════════════════════════════════════════════
// SPEED DIALER — Appels en série depuis la liste clients
// Panneau flottant avec file d'attente, auto-avance entre les
// appels, bouton "Ouvrir dossier" pour travailler pendant l'appel,
// timeline logging, stats de session.
// Prefix: sd* pour éviter collisions avec popup-call.js
// ═══════════════════════════════════════════════════════════════

const SD_RC_WORKER = 'https://crm.finox.ca/ringcentral';

// ── States ──
const SD_STATES = { IDLE:'idle', CALLING:'calling', BETWEEN:'between', PAUSED:'paused', DONE:'done' };

const SD_RESULTS = [
    { value:'answered',       label:'Répondu',          icon:'✅' },
    { value:'no_answer',      label:'Pas de réponse',   icon:'📵' },
    { value:'voicemail',      label:'Messagerie',       icon:'📫' },
    { value:'callback',       label:'Rappeler',         icon:'🔄' },
    { value:'not_interested', label:'Pas intéressé',    icon:'❌' }
];

// ── Session state ──
let sdState = SD_STATES.IDLE;
let sdQueue = [];
let sdCurrentIndex = -1;
let sdCallStartTime = null;
let sdCallTimerInterval = null;
let sdPresenceInterval = null;
let sdCallIsActive = false;
let sdRcConnected = false;
let sdTelephonySessionId = null;
let sdPartyId = null;
let sdCurrentCallDuration = 0;
let sdPresenceFailCount = 0;
let sdPresenceCurrentInterval = 10000;   // Start at 10s (was 3s)
const SD_PRESENCE_BASE_INTERVAL = 10000;    // 10s base
const SD_PRESENCE_MAX_INTERVAL = 60000;     // 60s max backoff
const SD_PRESENCE_MAX_FAILS = 5;            // Stop after 5 consecutive fails
const SD_PRESENCE_MAX_DURATION = 30 * 60 * 1000; // 30 min max
let sdPresenceStartedAt = null;

let sdStats = { totalCalls:0, answeredCalls:0, totalDurationSec:0, startTime:null, results:{} };

// ═══════════════════════════════════════════════════════════════
// CSS INJECTION
// ═══════════════════════════════════════════════════════════════
function sdInjectStyles() {
    if (document.getElementById('sdStyles')) return;
    const style = document.createElement('style');
    style.id = 'sdStyles';
    style.textContent = `
.sd-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(4px); z-index:1100; align-items:center; justify-content:center; padding:20px; }
.sd-overlay.show { display:flex; }
.sd-panel { background:var(--bg-card); border:1px solid var(--border-color); border-radius:16px; width:100%; max-width:520px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.5); animation:sdFadeIn .3s ease; }
@keyframes sdFadeIn { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }

.sd-header { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border-color); background:rgba(124,77,255,0.08); }
.sd-header-left {}
.sd-header-title { font-size:15px; font-weight:700; color:#a78bfa; display:flex; align-items:center; gap:8px; }
.sd-header-progress { font-size:11px; color:var(--text-muted); margin-top:2px; }
.sd-header-actions { display:flex; gap:6px; }
.sd-ctrl-btn { background:rgba(255,255,255,0.06); border:1px solid var(--border-color); border-radius:8px; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; transition:all .2s; color:var(--text-secondary); }
.sd-ctrl-btn:hover { background:rgba(255,255,255,0.12); border-color:rgba(255,255,255,0.2); }

.sd-current { padding:24px 20px; text-align:center; border-bottom:1px solid var(--border-color); }
.sd-current-name { font-size:18px; font-weight:700; color:var(--text-primary); }
.sd-current-phone { font-size:13px; color:var(--text-muted); margin-top:4px; }
.sd-current-status { font-size:13px; margin-top:10px; color:var(--text-secondary); }
.sd-current-status.calling { color:#a78bfa; }
.sd-current-status.ringing { color:#f59e0b; }
.sd-current-status.connected { color:#22c55e; }
.sd-current-status.ended { color:var(--text-muted); }
.sd-current-timer { font-size:32px; font-weight:700; font-family:'SF Mono',ui-monospace,monospace; color:#fff; margin-top:6px; letter-spacing:2px; }
.sd-call-actions { display:flex; gap:8px; justify-content:center; margin-top:12px; flex-wrap:wrap; }
.sd-end-call-btn { display:inline-block; padding:8px 20px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#f87171; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600; transition:all .2s; }
.sd-end-call-btn:hover { background:rgba(239,68,68,0.25); }
.sd-open-file-btn { display:inline-block; padding:8px 16px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.3); color:#60a5fa; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600; transition:all .2s; text-decoration:none; }
.sd-open-file-btn:hover { background:rgba(59,130,246,0.25); }
.sd-waiting { padding:32px 20px; text-align:center; }
.sd-waiting-text { font-size:14px; color:var(--text-muted); }


.sd-queue { flex:1; overflow-y:auto; padding:8px 16px; max-height:200px; }
.sd-queue-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px; font-size:12px; margin-bottom:2px; transition:background .15s; }
.sd-queue-item.current { background:rgba(124,77,255,0.12); border:1px solid rgba(124,77,255,0.25); }
.sd-queue-item.completed { opacity:.5; }
.sd-queue-item.skipped { opacity:.35; }
.sd-queue-item.no-phone { opacity:.25; }
.sd-queue-num { width:20px; text-align:center; color:var(--text-muted); font-size:11px; flex-shrink:0; }
.sd-queue-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary); }
.sd-queue-phone { color:var(--text-muted); font-size:11px; flex-shrink:0; }
.sd-queue-result { flex-shrink:0; }
.sd-queue-skip { background:none; border:none; cursor:pointer; font-size:12px; opacity:.5; transition:opacity .2s; padding:2px; }
.sd-queue-skip:hover { opacity:1; }

.sd-footer { padding:12px 20px; border-top:1px solid var(--border-color); background:rgba(0,0,0,0.15); }
.sd-stats { display:flex; gap:16px; justify-content:center; }
.sd-stat { text-align:center; }
.sd-stat-num { font-size:16px; font-weight:700; color:var(--gold); }
.sd-stat-label { font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; }

.sd-summary { padding:28px 20px; text-align:center; }
.sd-summary-icon { font-size:36px; margin-bottom:8px; }
.sd-summary-title { font-size:18px; font-weight:700; color:var(--text-primary); }
.sd-summary-sub { font-size:13px; color:var(--text-muted); margin-top:6px; }
.sd-summary-results { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:16px; }
.sd-summary-chip { background:rgba(255,255,255,0.05); padding:4px 10px; border-radius:6px; font-size:12px; color:var(--text-secondary); }
`;
    document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════
// HTML INJECTION
// ═══════════════════════════════════════════════════════════════
function sdInjectHTML() {
    if (document.getElementById('sdOverlay')) return;
    const container = document.createElement('div');
    container.id = 'sdContainer';
    container.innerHTML = `
    <div class="sd-overlay" id="sdOverlay">
        <div class="sd-panel" onclick="event.stopPropagation()">
            <div class="sd-header">
                <div class="sd-header-left">
                    <div class="sd-header-title">📞 Speed Dialer</div>
                    <div class="sd-header-progress" id="sdProgress">Prêt</div>
                </div>
                <div class="sd-header-actions">
                    <button class="sd-ctrl-btn" id="sdPauseBtn" onclick="sdTogglePause()" title="Pause">⏸️</button>
                    <button class="sd-ctrl-btn" onclick="sdStop()" title="Arrêter">⏹️</button>
                    <button class="sd-ctrl-btn" onclick="sdClose()" title="Fermer">✕</button>
                </div>
            </div>
            <div id="sdCurrentArea">
                <div class="sd-waiting">
                    <div class="sd-waiting-text">Préparation...</div>
                </div>
            </div>
            <div class="sd-queue" id="sdQueue"></div>
            <div class="sd-footer">
                <div class="sd-stats">
                    <div class="sd-stat"><div class="sd-stat-num" id="sdStatCalls">0</div><div class="sd-stat-label">Complétés</div></div>
                    <div class="sd-stat"><div class="sd-stat-num" id="sdStatDuration">0:00</div><div class="sd-stat-label">Durée</div></div>
                    <div class="sd-stat"><div class="sd-stat-num" id="sdStatRemaining">0</div><div class="sd-stat-label">Restants</div></div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(container);
}

// ═══════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════
async function openSpeedDialer(clientsArray) {
    sdInjectStyles();
    sdInjectHTML();

    // Prepare queue
    sdQueue = clientsArray.map((c, i) => ({
        ...c,
        _sdIndex: i,
        _sdPhone: c.phone || c.phone_mobile || null,
        _sdStatus: (c.phone || c.phone_mobile) ? 'pending' : 'no_phone',
        _sdResult: null,
        _sdNotes: '',
        _sdDuration: 0
    }));

    const withPhone = sdQueue.filter(c => c._sdStatus === 'pending').length;
    if (withPhone === 0) {
        FINOX.showNotification('Aucun client sélectionné n\'a de numéro de téléphone', 'error');
        return;
    }

    // Check RC connection
    sdRcConnected = false;
    try {
        const user = FINOX.getCurrentUser();
        if (user) {
            const res = await fetch(SD_RC_WORKER + '/connection/status', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'X-User-Id': user.id }
            });
            const data = await res.json();
            sdRcConnected = data.connected === true;
        }
    } catch (e) {
        console.warn('[SD] RC status check failed:', e.message);
    }

    if (!sdRcConnected) {
        FINOX.showNotification('⚠️ RingCentral non connecté — mode manuel (cliquer Terminer après chaque appel)', 'warning');
    }

    // Reset
    sdStats = { totalCalls:0, answeredCalls:0, totalDurationSec:0, startTime:Date.now(), results:{} };
    sdCurrentIndex = -1;
    sdState = SD_STATES.IDLE;
    sdPresenceFailCount = 0;

    // Show panel
    document.getElementById('sdOverlay').classList.add('show');

    sdRenderQueue();
    sdUpdateStats();

    // Auto-start first call after 1s
    setTimeout(() => sdNextCall(), 1000);
}

// ═══════════════════════════════════════════════════════════════
// CALL FLOW
// ═══════════════════════════════════════════════════════════════
function sdNextCall() {
    if (sdState === SD_STATES.PAUSED) return;

    let nextIndex = -1;
    for (let i = sdCurrentIndex + 1; i < sdQueue.length; i++) {
        if (sdQueue[i]._sdStatus === 'pending') { nextIndex = i; break; }
    }

    if (nextIndex === -1) {
        sdState = SD_STATES.DONE;
        sdShowSummary();
        return;
    }

    sdCurrentIndex = nextIndex;
    sdQueue[nextIndex]._sdStatus = 'calling';
    sdInitiateCall(sdQueue[nextIndex]);
}

function sdInitiateCall(client) {
    const phone = client._sdPhone;
    if (!phone) { sdMarkSkip(client, 'no_phone'); sdNextCall(); return; }

    sdCallIsActive = true;
    sdCallStartTime = Date.now();
    sdState = SD_STATES.CALLING;
    sdPresenceFailCount = 0;

    const name = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
    const fmtPhone = (typeof FINOX.formatPhone === 'function') ? FINOX.formatPhone(phone) : phone;

    // Update UI — show call area with action buttons
    const area = document.getElementById('sdCurrentArea');
    const clientUrl = `/abf?client=${client.id}`;
    area.innerHTML = `
        <div class="sd-current">
            <div class="sd-current-name">${sdEsc(name)}</div>
            <div class="sd-current-phone">${sdEsc(fmtPhone)}</div>
            <div class="sd-current-status calling" id="sdCallStatus">📞 Appel en cours...</div>
            <div class="sd-current-timer" id="sdCallTimer">00:00</div>
            <div class="sd-call-actions">
                <a class="sd-open-file-btn" href="${clientUrl}" target="_blank" title="Ouvrir le dossier dans un nouvel onglet">📂 Ouvrir dossier ↗</a>
                <button class="sd-end-call-btn" onclick="sdOnCallEnded()">Terminer & Suivant ➔</button>
            </div>
        </div>`;

    // Format tel: number
    let telNumber = phone.replace(/[\s\-\(\)\.]/g, '');
    if (!telNumber.startsWith('+')) {
        telNumber = telNumber.startsWith('1') ? '+' + telNumber : '+1' + telNumber;
    }

    // Launch call via tel: protocol
    window.open('tel:' + telNumber, '_self');

    // Start timer
    sdStartTimer();

    // Start presence polling if RC connected
    if (sdRcConnected) {
        sdStartPresencePolling();
    } else {
        // Manual mode: NO auto-end — user must click "Terminer & Suivant"
        // (was 5 min timeout but it cuts active calls short)
        console.log('[SD] Manual mode — waiting for user to click Terminer & Suivant');
    }

    sdRenderQueue();
    sdUpdateProgress();
}

// ═══════════════════════════════════════════════════════════════
// PRESENCE POLLING
// ═══════════════════════════════════════════════════════════════
function sdStartPresencePolling() {
    sdStopPresencePolling();
    sdPresenceFailCount = 0;
    sdPresenceCurrentInterval = SD_PRESENCE_BASE_INTERVAL;
    sdPresenceStartedAt = Date.now();
    setTimeout(() => {
        sdCheckPresence();
        sdScheduleNextPresenceCheck();
    }, 2000);
}

function sdScheduleNextPresenceCheck() {
    if (sdPresenceInterval) clearTimeout(sdPresenceInterval);
    if (!sdCallIsActive) return;
    // Hard stop: max polling duration
    if (sdPresenceStartedAt && (Date.now() - sdPresenceStartedAt > SD_PRESENCE_MAX_DURATION)) {
        console.warn('[SD] Presence polling stopped — max duration (30min) reached');
        sdStopPresencePolling();
        return;
    }
    sdPresenceInterval = setTimeout(() => {
        sdCheckPresence();
        sdScheduleNextPresenceCheck();
    }, sdPresenceCurrentInterval);
}

function sdStopPresencePolling() {
    if (sdPresenceInterval) { clearTimeout(sdPresenceInterval); sdPresenceInterval = null; }
    sdPresenceFailCount = 0;
    sdPresenceCurrentInterval = SD_PRESENCE_BASE_INTERVAL;
}

async function sdCheckPresence() {
    if (!sdCallIsActive) return;
    // Hard stop: max duration
    if (sdPresenceStartedAt && (Date.now() - sdPresenceStartedAt > SD_PRESENCE_MAX_DURATION)) {
        console.warn('[SD] Presence polling stopped — max duration reached');
        sdStopPresencePolling();
        return;
    }
    try {
        const user = FINOX.getCurrentUser();
        if (!user) return;

        const res = await fetch(SD_RC_WORKER + '/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.id })
        });
        const data = await res.json();
        if (!data.success) {
            sdPresenceFailCount++;
            sdPresenceCurrentInterval = Math.min(sdPresenceCurrentInterval * 2, SD_PRESENCE_MAX_INTERVAL);
            console.warn(`[SD] Presence fail #${sdPresenceFailCount}, next in ${sdPresenceCurrentInterval / 1000}s`);
            if (sdPresenceFailCount >= SD_PRESENCE_MAX_FAILS) {
                console.error('[SD] Presence polling stopped — too many failures');
                sdStopPresencePolling();
                sdShowManualEndButton();
            }
            return;
        }

        // Success — reset
        sdPresenceFailCount = 0;
        sdPresenceCurrentInterval = SD_PRESENCE_BASE_INTERVAL;

        const ts = data.telephonyStatus;
        const activeCall = data.activeCalls?.[0];

        if (activeCall) {
            sdTelephonySessionId = activeCall.telephonySessionId || null;
            sdPartyId = activeCall.partyId || null;
        }

        const statusEl = document.getElementById('sdCallStatus');
        if (!statusEl) return;

        if (ts === 'Ringing') {
            statusEl.textContent = '🔔 Sonne...';
            statusEl.className = 'sd-current-status ringing';
        } else if (ts === 'CallConnected') {
            statusEl.textContent = '🟢 En cours';
            statusEl.className = 'sd-current-status connected';
        } else if (ts === 'NoCall' && sdCallIsActive && sdCallStartTime && (Date.now() - sdCallStartTime > 15000)) {
            // Only auto-end if call is truly done (NoCall for 15s+ to avoid false positives)
            console.log('[SD] NoCall detected after', Math.round((Date.now() - sdCallStartTime)/1000), 's — ending call');
            sdOnCallEnded();
        }
    } catch (e) {
        sdPresenceFailCount++;
        sdPresenceCurrentInterval = Math.min(sdPresenceCurrentInterval * 2, SD_PRESENCE_MAX_INTERVAL);
        console.warn(`[SD] Presence check failed (#${sdPresenceFailCount}, next in ${sdPresenceCurrentInterval / 1000}s):`, e.message);
        if (sdPresenceFailCount >= SD_PRESENCE_MAX_FAILS) {
            console.error('[SD] Presence polling stopped — too many consecutive failures');
            sdStopPresencePolling();
            sdShowManualEndButton();
        }
    }
}

function sdShowManualEndButton() {
    const area = document.getElementById('sdCurrentArea');
    const existing = area?.querySelector('.sd-end-call-btn');
    if (!existing) {
        const btn = document.createElement('button');
        btn.className = 'sd-end-call-btn';
        btn.textContent = 'Terminer l\'appel';
        btn.onclick = () => sdOnCallEnded();
        area?.querySelector('.sd-current')?.appendChild(btn);
    }
}

// ═══════════════════════════════════════════════════════════════
// CALL END → AUTO-ADVANCE TO NEXT
// ═══════════════════════════════════════════════════════════════
async function sdOnCallEnded() {
    if (!sdCallIsActive) return;
    sdCallIsActive = false;
    sdStopPresencePolling();
    sdStopTimer();

    // ── Raccrocher l'appel RingCentral via Call Control API ──
    if (sdRcConnected && sdTelephonySessionId && sdPartyId) {
        try {
            const user = FINOX.getCurrentUser();
            if (user) {
                const res = await fetch(SD_RC_WORKER + '/call-control', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-User-Id': user.id },
                    body: JSON.stringify({
                        action: 'hangup',
                        telephony_session_id: sdTelephonySessionId,
                        party_id: sdPartyId
                    })
                });
                const data = await res.json();
                if (data.success) {
                    console.log('[SD] Hangup successful');
                } else {
                    console.warn('[SD] Hangup failed:', data.error);
                }
            }
        } catch (e) {
            console.warn('[SD] Hangup error:', e.message);
        }
        sdTelephonySessionId = null;
        sdPartyId = null;
    }

    const durationSec = sdCallStartTime ? Math.floor((Date.now() - sdCallStartTime) / 1000) : 0;
    sdCurrentCallDuration = durationSec;
    sdStats.totalDurationSec += durationSec;

    const client = sdQueue[sdCurrentIndex];
    if (client) {
        client._sdDuration = durationSec;
        client._sdStatus = 'completed';
    }

    sdStats.totalCalls++;

    // Log to timeline (async, don't block)
    if (client) sdLogToTimeline(client, 'called', '', durationSec);

    // UI: brief "Terminé" then auto-advance
    const statusEl = document.getElementById('sdCallStatus');
    if (statusEl) { statusEl.textContent = `✅ Terminé — ${sdFmtDur(durationSec)}`; statusEl.className = 'sd-current-status ended'; }
    document.querySelector('.sd-call-actions')?.remove();

    sdRenderQueue();
    sdUpdateStats();

    // Auto-advance to next call after 3s (gives RC time to fully disconnect)
    setTimeout(() => {
        // Double-check the call is truly ended before advancing
        if (!sdCallIsActive) sdNextCall();
    }, 3000);
}


// ═══════════════════════════════════════════════════════════════
// TIMELINE LOGGING
// ═══════════════════════════════════════════════════════════════
async function sdLogToTimeline(client, result, notes, durationSec) {
    try {
        const user = FINOX.getCurrentUser();
        if (!user || !client?.id) return;

        const durationText = sdFmtDur(durationSec);
        const resultObj = SD_RESULTS.find(r => r.value === result);
        const resultLabel = resultObj ? `${resultObj.icon} ${resultObj.label}` : result;
        const timeText = new Date().toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit' });
        const externalId = 'sd_call_' + client.id + '_' + Date.now();

        await FINOX.supabase.from('client_timeline').insert({
            client_id: client.id,
            activity_type: 'call_outbound',
            title: `Appel sortant (Speed Dial) — ${durationText}`,
            description: `Résultat: ${resultLabel} | Durée: ${durationText} | Heure: ${timeText}${notes ? ' | Notes: ' + notes : ''}`,
            phone_number: client._sdPhone,
            call_duration_seconds: durationSec,
            external_id: externalId,
            external_source: 'ringcentral',
            metadata: {
                direction: 'Outbound',
                result: result,
                call_mode: 'speed_dialer',
                speed_dialer_session: sdStats.startTime,
                notes: notes || null
            },
            created_by: user.id
        });
        console.log(`✅ [SD] Timeline: ${client.first_name} ${client.last_name} → ${resultLabel}`);
    } catch (e) {
        console.warn('[SD] Timeline insert failed:', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// CONTROLS: PAUSE / STOP / CLOSE
// ═══════════════════════════════════════════════════════════════
function sdTogglePause() {
    if (sdState === SD_STATES.DONE) return;

    if (sdState === SD_STATES.PAUSED) {
        // Resume
        sdState = SD_STATES.CALLING;
        document.getElementById('sdPauseBtn').innerHTML = '⏸️';
        document.getElementById('sdPauseBtn').title = 'Pause';
        const statusEl = document.getElementById('sdCallStatus');
        if (statusEl) statusEl.textContent = '▶️ Repris';
        // If not currently in a call, auto-advance to next
        if (!sdCallIsActive) {
            setTimeout(() => sdNextCall(), 1000);
        }
    } else {
        sdState = SD_STATES.PAUSED;
        document.getElementById('sdPauseBtn').innerHTML = '▶️';
        document.getElementById('sdPauseBtn').title = 'Reprendre';
        sdStopPresencePolling();
        const statusEl = document.getElementById('sdCallStatus');
        if (statusEl) statusEl.textContent = '⏸️ En pause';
    }
}

function sdStop() {
    sdCallIsActive = false;
    sdStopPresencePolling();
    sdStopTimer();
    sdState = SD_STATES.DONE;
    sdShowSummary();
}

function sdClose() {
    if (sdState === SD_STATES.CALLING && sdCallIsActive) {
        if (!confirm('Un appel est possiblement en cours. Fermer quand même?')) return;
    }
    sdCallIsActive = false;
    sdStopPresencePolling();
    sdStopTimer();
    sdState = SD_STATES.IDLE;
    const overlay = document.getElementById('sdOverlay');
    if (overlay) overlay.classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
function sdShowSummary() {
    const sessionDur = sdStats.startTime ? Math.floor((Date.now() - sdStats.startTime) / 1000) : 0;
    const area = document.getElementById('sdCurrentArea');

    area.innerHTML = `
        <div class="sd-summary">
            <div class="sd-summary-icon">✅</div>
            <div class="sd-summary-title">Session terminée</div>
            <div class="sd-summary-sub">${sdStats.totalCalls} appel(s) en ${sdFmtDur(sessionDur)}</div>
        </div>`;

    sdUpdateStats();
    sdRenderQueue();
}

// ═══════════════════════════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════════════════════════
function sdStartTimer() {
    sdStopTimer();
    sdCallTimerInterval = setInterval(() => {
        if (!sdCallStartTime) return;
        const elapsed = Math.floor((Date.now() - sdCallStartTime) / 1000);
        const el = document.getElementById('sdCallTimer');
        if (el) el.textContent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
    }, 1000);
}

function sdStopTimer() {
    if (sdCallTimerInterval) { clearInterval(sdCallTimerInterval); sdCallTimerInterval = null; }
}

function sdFmtDur(sec) {
    if (!sec || sec <= 0) return '0s';
    const m = Math.floor(sec / 60), s = sec % 60;
    return m === 0 ? `${s}s` : `${m}min ${s}s`;
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING
// ═══════════════════════════════════════════════════════════════
function sdRenderQueue() {
    const container = document.getElementById('sdQueue');
    if (!container) return;

    container.innerHTML = sdQueue.map((c, i) => {
        const isCurrent = i === sdCurrentIndex && (sdState === SD_STATES.CALLING || sdState === SD_STATES.BETWEEN);
        const cls = c._sdStatus === 'completed' ? 'completed'
            : c._sdStatus === 'skipped' ? 'skipped'
            : c._sdStatus === 'no_phone' ? 'no-phone'
            : isCurrent ? 'current' : '';
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';
        const phone = c._sdPhone ? ((typeof FINOX.formatPhone === 'function') ? FINOX.formatPhone(c._sdPhone) : c._sdPhone) : 'Pas de tél.';
        const rIcon = c._sdResult ? (SD_RESULTS.find(r => r.value === c._sdResult)?.icon || '') : (c._sdStatus === 'no_phone' ? '⚠️' : '');
        const canSkip = c._sdStatus === 'pending' && !isCurrent && sdState !== SD_STATES.DONE;

        return `<div class="sd-queue-item ${cls}">
            <span class="sd-queue-num">${i + 1}</span>
            <span class="sd-queue-name">${sdEsc(name)}</span>
            <span class="sd-queue-phone">${sdEsc(phone)}</span>
            ${rIcon ? `<span class="sd-queue-result">${rIcon}</span>` : ''}
            ${canSkip ? `<button class="sd-queue-skip" onclick="sdSkipQueueItem(${i})" title="Passer">⏭️</button>` : ''}
        </div>`;
    }).join('');
}

function sdSkipQueueItem(index) {
    if (sdQueue[index]?._sdStatus !== 'pending') return;
    sdQueue[index]._sdStatus = 'skipped';
    sdRenderQueue();
    sdUpdateStats();
}

function sdUpdateProgress() {
    const total = sdQueue.length;
    const current = sdCurrentIndex + 1;
    const el = document.getElementById('sdProgress');
    if (el) el.textContent = `Appel ${current}/${total}`;
}

function sdUpdateStats() {
    const el = id => document.getElementById(id);
    if (el('sdStatCalls')) el('sdStatCalls').textContent = sdStats.totalCalls;
    if (el('sdStatDuration')) el('sdStatDuration').textContent = sdFmtDur(sdStats.totalDurationSec);
    const remaining = sdQueue.filter(c => c._sdStatus === 'pending').length;
    if (el('sdStatRemaining')) el('sdStatRemaining').textContent = remaining;
}

function sdMarkSkip(client, reason) {
    client._sdStatus = reason || 'skipped';
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function sdEsc(str) {
    if (typeof FINOX.escapeHtml === 'function') return FINOX.escapeHtml(str);
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

// ── Escape handler ──
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('sdOverlay')?.classList.contains('show')) {
        if (sdState === SD_STATES.CALLING && sdCallIsActive) {
            sdTogglePause();
        } else {
            sdClose();
        }
    }
});

// ── Expose globals ──
window.openSpeedDialer = openSpeedDialer;
window.sdTogglePause = sdTogglePause;
window.sdStop = sdStop;
window.sdClose = sdClose;
window.sdOnCallEnded = sdOnCallEnded;
window.sdSkipQueueItem = sdSkipQueueItem;
