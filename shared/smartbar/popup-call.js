// ═══════════════════════════════════════════════════════════════
// SMART BAR — CALL TRACKER 📞
// tel: protocol (RC Desktop) + Call Control (hold/unhold/hangup)
// L'appel est lance via tel: (comme avant), mais quand RC est
// connecte, on detecte l'appel via Presence API et on active les
// boutons Hold / Hangup via Call Control API.
// ═══════════════════════════════════════════════════════════════

// ── Core state ──
let callPresenceInterval = null;
let callTimerInterval = null;
let callStartTime = null;
let callIsActive = false;
let callClientPhone = null;
let callMode = 'tel';               // 'tel' or 'tel_enhanced' (with call control)

// ── Call Control state ──
let callTelephonySessionId = null;
let callPartyId = null;
let callIsOnHold = false;
let callRcConnected = false;         // RC integration active?

// ── Presence polling rate-limit state ──
let callPresenceFailCount = 0;
let callPresenceCurrentInterval = 10000;  // Start at 10s (was 3s)
const CALL_PRESENCE_BASE_INTERVAL = 10000;   // 10s base
const CALL_PRESENCE_MAX_INTERVAL = 60000;    // 60s max backoff
const CALL_PRESENCE_MAX_FAILS = 5;           // Stop after 5 consecutive fails
const CALL_PRESENCE_MAX_DURATION = 30 * 60 * 1000; // 30 min max polling
let callPresenceStartedAt = null;

// ═══════════════════════════════════════════════════════════════
// ENTRY POINT — startDirectCall()
// ═══════════════════════════════════════════════════════════════

function startDirectCall() {
    const cd = FINOX.getClientData();
    if (!cd) { FINOX.showNotification('Donnees client non disponibles', 'error'); return; }

    const clientPhone = cd.phone || cd.phone_mobile;
    if (!clientPhone) { FINOX.showNotification('Aucun numero de telephone pour ce client', 'error'); return; }

    // Check if conjoint has a phone number
    const conjointPhone = cd.conjoint_phone || null;
    const hasConjoint = cd.has_conjoint && cd.conjoint_first_name && conjointPhone;

    if (hasConjoint) {
        showCallContactPicker(cd, clientPhone, conjointPhone);
    } else {
        initiateCall(clientPhone);
    }
}

// ═══════════════════════════════════════════════════════════════
// CONTACT PICKER (client / conjoint)
// ═══════════════════════════════════════════════════════════════

function showCallContactPicker(cd, clientPhone, conjointPhone) {
    let overlay = document.getElementById('callContactPickerOverlay');
    if (overlay) overlay.remove();

    const esc = FINOX.escapeHtml || (s => s);
    const clientName = esc(cd.first_name || 'Client');
    const conjName = esc(cd.conjoint_first_name || 'Conjoint');
    const cPhone = esc(clientPhone);
    const jPhone = esc(conjointPhone);

    overlay = document.createElement('div');
    overlay.id = 'callContactPickerOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e) { if (e.target === overlay) closeCallContactPicker(); };

    overlay.innerHTML = `
        <div style="background:var(--bg-card,#1e1e1e);border:1px solid var(--border-color);border-radius:16px;padding:24px;width:320px;max-width:90vw;text-align:center;" onclick="event.stopPropagation()">
            <div style="font-size:28px;margin-bottom:12px;">📞</div>
            <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Qui souhaitez-vous appeler?</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;">Selectionnez le contact</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <button onclick="pickCallContact('client')" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(232,180,77,0.08);border:1.5px solid var(--border-color);border-radius:12px;cursor:pointer;transition:all 0.2s;text-align:left;" onmouseover="this.style.borderColor='var(--gold)';this.style.background='rgba(232,180,77,0.15)'" onmouseout="this.style.borderColor='var(--border-color)';this.style.background='rgba(232,180,77,0.08)'">
                    <span style="font-size:24px;">👤</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${clientName}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${cPhone}</div>
                    </div>
                    <span style="font-size:18px;">📞</span>
                </button>
                <button onclick="pickCallContact('conjoint')" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(232,180,77,0.08);border:1.5px solid var(--border-color);border-radius:12px;cursor:pointer;transition:all 0.2s;text-align:left;" onmouseover="this.style.borderColor='var(--gold)';this.style.background='rgba(232,180,77,0.15)'" onmouseout="this.style.borderColor='var(--border-color)';this.style.background='rgba(232,180,77,0.08)'">
                    <span style="font-size:24px;">👥</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${conjName}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${jPhone}</div>
                    </div>
                    <span style="font-size:18px;">📞</span>
                </button>
            </div>
            <button onclick="closeCallContactPicker()" style="margin-top:16px;padding:8px 20px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:var(--text-muted);font-size:12px;cursor:pointer;">Annuler</button>
        </div>
    `;

    document.body.appendChild(overlay);
}

function closeCallContactPicker() {
    const overlay = document.getElementById('callContactPickerOverlay');
    if (overlay) overlay.remove();
}

function pickCallContact(who) {
    const cd = FINOX.getClientData();
    closeCallContactPicker();

    let phone;
    if (who === 'conjoint') {
        phone = cd.conjoint_phone || null;
    } else {
        phone = cd.phone || cd.phone_mobile;
    }

    if (!phone) { FINOX.showNotification('Aucun numero disponible', 'error'); return; }
    initiateCall(phone);
}

// ═══════════════════════════════════════════════════════════════
// INITIATE CALL — Toujours tel: + Call Control si RC connecte
// ═══════════════════════════════════════════════════════════════

async function initiateCall(phone) {
    callClientPhone = phone;
    callRcConnected = false;

    // Check if RingCentral is connected (for call control: hold/hangup)
    try {
        const user = FINOX.getCurrentUser();
        if (user) {
            const res = await fetch(RC_WORKER + '/connection/status', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'X-User-Id': user.id }
            });
            const data = await res.json();
            if (data.connected) {
                callRcConnected = true;
            }
        }
    } catch (e) {
        console.warn('[Call] RC status check failed:', e.message);
    }

    // Always use tel: protocol (RC Desktop handles it)
    launchTelCall(phone);
}

// ═══════════════════════════════════════════════════════════════
// TEL: PROTOCOL — Launch call via RC Desktop App
// ═══════════════════════════════════════════════════════════════

function launchTelCall(phone) {
    callMode = callRcConnected ? 'tel_enhanced' : 'tel';

    let telNumber = phone.replace(/[\s\-\(\)\.]/g, '');
    if (!telNumber.startsWith('+')) {
        if (telNumber.startsWith('1')) telNumber = '+' + telNumber;
        else telNumber = '+1' + telNumber;
    }

    // Open tel: link — RC Desktop App picks up the call
    window.open('tel:' + telNumber, '_self');

    // Show tracker
    showCallTracker('📞 Appel...');
    callIsActive = true;
    callStartTime = Date.now();
    startCallTimer();

    // If RC is connected, start enhanced presence polling (for call control)
    if (callRcConnected) {
        console.log('[Call] RC connected — enhanced mode: tel: + Call Control');
        startPresencePolling();
    } else {
        console.log('[Call] RC not connected — basic tel: mode');
        // Basic mode: just timer, no call control
        // Auto-hide tracker after 5 min if no manual close
        setTimeout(() => { if (callIsActive && callMode === 'tel') onCallEnded(); }, 300000);
    }
}

// ═══════════════════════════════════════════════════════════════
// PRESENCE POLLING — Detect active call + extract session IDs
// ═══════════════════════════════════════════════════════════════

function startPresencePolling() {
    stopPresencePolling();
    callPresenceFailCount = 0;
    callPresenceCurrentInterval = CALL_PRESENCE_BASE_INTERVAL;
    callPresenceStartedAt = Date.now();
    // First check after 2s (give RC Desktop time to initiate)
    setTimeout(() => {
        checkPresence();
        scheduleNextPresenceCheck();
    }, 2000);
}

function scheduleNextPresenceCheck() {
    if (callPresenceInterval) clearTimeout(callPresenceInterval);
    if (!callIsActive) return;
    // Hard stop: max polling duration reached
    if (callPresenceStartedAt && (Date.now() - callPresenceStartedAt > CALL_PRESENCE_MAX_DURATION)) {
        console.warn('[Call] Presence polling stopped — max duration (30min) reached');
        stopPresencePolling();
        return;
    }
    callPresenceInterval = setTimeout(() => {
        checkPresence();
        scheduleNextPresenceCheck();
    }, callPresenceCurrentInterval);
}

function stopPresencePolling() {
    if (callPresenceInterval) { clearTimeout(callPresenceInterval); callPresenceInterval = null; }
    callPresenceFailCount = 0;
    callPresenceCurrentInterval = CALL_PRESENCE_BASE_INTERVAL;
}

async function checkPresence() {
    if (!callIsActive) return;
    // Hard stop: max duration
    if (callPresenceStartedAt && (Date.now() - callPresenceStartedAt > CALL_PRESENCE_MAX_DURATION)) {
        console.warn('[Call] Presence polling stopped — max duration reached');
        stopPresencePolling();
        return;
    }
    try {
        const user = FINOX.getCurrentUser();
        if (!user) return;

        const res = await fetch(RC_WORKER + '/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.id })
        });
        const data = await res.json();
        if (!data.success) {
            callPresenceFailCount++;
            // Exponential backoff on failure
            callPresenceCurrentInterval = Math.min(
                callPresenceCurrentInterval * 2,
                CALL_PRESENCE_MAX_INTERVAL
            );
            console.warn(`[Call] Presence fail #${callPresenceFailCount}, next check in ${callPresenceCurrentInterval / 1000}s`);
            if (callPresenceFailCount >= CALL_PRESENCE_MAX_FAILS) {
                console.error('[Call] Presence polling stopped — too many failures');
                stopPresencePolling();
            }
            return;
        }

        // Success — reset fail count and interval
        callPresenceFailCount = 0;
        callPresenceCurrentInterval = CALL_PRESENCE_BASE_INTERVAL;

        const ts = data.telephonyStatus;
        const activeCall = (data.activeCalls && data.activeCalls.length > 0) ? data.activeCalls[0] : null;

        // Extract telephonySessionId and partyId for call control
        if (activeCall) {
            if (activeCall.telephonySessionId && activeCall.partyId) {
                callTelephonySessionId = activeCall.telephonySessionId;
                callPartyId = activeCall.partyId;
                showCallControls(true);
            }

            // Track hold state from presence
            if (activeCall.telephonyStatus === 'OnHold' || ts === 'OnHold') {
                if (!callIsOnHold) {
                    callIsOnHold = true;
                    updateHoldButton(true);
                    updateCallStatus('⏸️ En attente', 'on-hold');
                }
            } else if (callIsOnHold && (ts === 'CallConnected' || activeCall.telephonyStatus === 'CallConnected')) {
                callIsOnHold = false;
                updateHoldButton(false);
                updateCallStatus('🟢 En cours', 'connected');
            }
        }

        if (ts === 'Ringing') {
            updateCallStatus('🔔 Sonne...', 'ringing');
        } else if (ts === 'CallConnected' && !callIsOnHold) {
            updateCallStatus('🟢 En cours', 'connected');
        } else if (ts === 'OnHold') {
            // Already handled above
        } else if (ts === 'NoCall' && callIsActive && callStartTime && (Date.now() - callStartTime > 8000)) {
            // Call ended — NoCall detected after at least 8s
            onCallEnded();
        }
    } catch (e) {
        callPresenceFailCount++;
        callPresenceCurrentInterval = Math.min(
            callPresenceCurrentInterval * 2,
            CALL_PRESENCE_MAX_INTERVAL
        );
        console.warn(`[Call] Presence check failed (#${callPresenceFailCount}, next in ${callPresenceCurrentInterval / 1000}s):`, e);
        if (callPresenceFailCount >= CALL_PRESENCE_MAX_FAILS) {
            console.error('[Call] Presence polling stopped — too many consecutive failures');
            stopPresencePolling();
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// CALL CONTROL — Hold / Unhold / Hangup
// ═══════════════════════════════════════════════════════════════

async function toggleCallHold() {
    if (!callTelephonySessionId || !callPartyId) {
        FINOX.showNotification('Session d\'appel non disponible', 'error');
        return;
    }

    const holdBtn = document.getElementById('sbHoldBtn');
    if (holdBtn) holdBtn.disabled = true;

    const action = callIsOnHold ? 'unhold' : 'hold';

    try {
        const user = FINOX.getCurrentUser();
        if (!user) return;

        const res = await fetch(RC_WORKER + '/call-control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: action,
                telephony_session_id: callTelephonySessionId,
                party_id: callPartyId,
                user_id: user.id
            })
        });

        const data = await res.json();

        if (data.code === 'RC_SCOPE_MISSING') {
            FINOX.showNotification('⚠️ Scopes CallControl manquants. Reconnectez RingCentral dans Parametres.', 'warning');
            return;
        }

        if (data.code === 'CALL_NOT_FOUND') {
            FINOX.showNotification('L\'appel n\'existe plus', 'info');
            onCallEnded();
            return;
        }

        if (!data.success) {
            throw new Error(data.error || 'Call control failed');
        }

        // Toggle state
        callIsOnHold = !callIsOnHold;
        updateHoldButton(callIsOnHold);

        if (callIsOnHold) {
            updateCallStatus('⏸️ En attente', 'on-hold');
        } else {
            updateCallStatus('🟢 En cours', 'connected');
        }

    } catch (e) {
        console.error('[Call] Call control error:', e);
        FINOX.showNotification('Erreur: ' + e.message, 'error');
    } finally {
        if (holdBtn) holdBtn.disabled = false;
    }
}

async function hangupCall() {
    // If we have a telephony session, use call control to hangup
    if (callTelephonySessionId && callPartyId) {
        const hangupBtn = document.getElementById('sbHangupBtn');
        if (hangupBtn) hangupBtn.disabled = true;

        try {
            const user = FINOX.getCurrentUser();
            if (!user) return;

            const res = await fetch(RC_WORKER + '/call-control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'hangup',
                    telephony_session_id: callTelephonySessionId,
                    party_id: callPartyId,
                    user_id: user.id
                })
            });

            const data = await res.json();

            if (!data.success && data.code !== 'CALL_NOT_FOUND') {
                throw new Error(data.error || 'Hangup failed');
            }

            console.log('[Call] Hangup successful');
            onCallEnded();

        } catch (e) {
            console.error('[Call] Hangup error:', e);
            FINOX.showNotification('Erreur lors du raccrochage: ' + e.message, 'error');
            if (hangupBtn) hangupBtn.disabled = false;
        }
    } else {
        // No session info, just end tracking
        onCallEnded();
    }
}

// ═══════════════════════════════════════════════════════════════
// CALL ENDED — Cleanup + timeline audit
// ═══════════════════════════════════════════════════════════════

let _callEndId = 0; // Pour annuler le auto-hide si un nouvel appel démarre

async function onCallEnded() {
    callIsActive = false;
    stopPresencePolling();
    stopCallTimer();

    const endedCallId = ++_callEndId;
    const durationSec = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const endedPhone = callClientPhone;
    const endedMode = callMode;
    const endedRcConnected = callRcConnected;

    // Reset state IMMÉDIATEMENT pour permettre un nouvel appel tout de suite
    callStartTime = null;
    callTelephonySessionId = null;
    callPartyId = null;
    callIsOnHold = false;
    callMode = 'tel';
    callRcConnected = false;

    // Update tracker to "ended" state
    updateCallStatus('✅ Termine', 'ended');
    showCallControls(false);

    // Fetch call log + timeline en arrière-plan (ne bloque pas le prochain appel)
    (async () => {
        let callRecord = null;
        if (endedRcConnected) {
            await new Promise(r => setTimeout(r, 3000));
            // Si un nouvel appel a démarré entre-temps, ne pas écraser l'UI
            if (_callEndId !== endedCallId) return;

            try {
                const user = FINOX.getCurrentUser();
                if (user && endedPhone) {
                    const res = await fetch(RC_WORKER + '/call-log', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            user_id: user.id,
                            contact_phone: endedPhone,
                            max_results: 1,
                            date_from: new Date(Date.now() - 10 * 60 * 1000).toISOString()
                        })
                    });
                    const data = await res.json();
                    if (data.success && data.records && data.records.length > 0) {
                        callRecord = data.records[0];
                    }
                }
            } catch (e) {
                console.warn('[Call] Call log fetch failed:', e);
            }
        }

        const finalDuration = callRecord ? callRecord.duration : durationSec;
        const finalResult = callRecord ? callRecord.result : 'Unknown';
        const durationText = formatCallDuration(finalDuration);
        const resultText = translateCallResult(finalResult);
        const timeText = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

        // N'écraser l'UI que si aucun nouvel appel n'a démarré
        if (_callEndId === endedCallId) {
            const sbStatusSum = document.getElementById('sbCallStatus');
            if (sbStatusSum) sbStatusSum.textContent = `✅ ${durationText}`;
            const sbTimerSum = document.getElementById('sbCallTimer');
            if (sbTimerSum) sbTimerSum.textContent = resultText;
        }

        // Timeline audit (toujours, même si nouvel appel en cours)
        try {
            const user = FINOX.getCurrentUser();
            const cd = FINOX.getClientData();
            if (user && cd) {
                const externalId = callRecord ? 'rc_call_' + callRecord.id : 'rc_call_' + Date.now();

                const { data: existing } = await FINOX.supabase
                    .from('client_timeline')
                    .select('id')
                    .eq('external_id', externalId)
                    .maybeSingle();

                if (!existing) {
                    await FINOX.supabase.from('client_timeline').insert({
                        client_id: FINOX.CLIENT_ID,
                        activity_type: 'call_outbound',
                        title: `Appel sortant — ${durationText}`,
                        description: `Duree: ${durationText} | Resultat: ${resultText} | Heure: ${timeText}`,
                        phone_number: endedPhone,
                        call_duration_seconds: finalDuration,
                        external_id: externalId,
                        external_source: 'ringcentral',
                        metadata: {
                            direction: callRecord?.direction || 'Outbound',
                            result: finalResult,
                            rc_call_id: callRecord?.id || null,
                            rc_session_id: callRecord?.sessionId || null,
                            call_mode: endedMode
                        },
                        created_by: user.id
                    });
                    console.log('✅ Appel enregistre dans timeline');
                }
            }
        } catch (e) {
            console.warn('[Call] Timeline insert failed:', e);
        }

        // Auto-hide tracker après 4s (seulement si pas de nouvel appel)
        setTimeout(() => {
            if (_callEndId !== endedCallId) return; // Nouvel appel en cours, ne pas masquer
            const sbt = document.getElementById('sbCallTracker');
            if (sbt && !callIsActive) sbt.classList.remove('active');
            const sbCb = document.getElementById('sbCallBtn');
            if (sbCb && !callIsActive) sbCb.style.background = '';
        }, 4000);
    })();
}

function endCallTracking() {
    onCallEnded();
}

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════

function showCallTracker(statusText) {
    const sbTracker = document.getElementById('sbCallTracker');
    if (sbTracker) sbTracker.classList.add('active');

    const sbStatus = document.getElementById('sbCallStatus');
    if (sbStatus) { sbStatus.textContent = statusText; sbStatus.className = 'sb-call-status'; }

    const sbTimer = document.getElementById('sbCallTimer');
    if (sbTimer) sbTimer.textContent = '00:00';

    // Highlight call button
    const sbCallBtn = document.getElementById('sbCallBtn');
    if (sbCallBtn) sbCallBtn.style.background = 'rgba(124,77,255,0.25)';

    // Ensure controls are hidden initially
    showCallControls(false);
}

function updateCallStatus(text, cssClass) {
    const el = document.getElementById('sbCallStatus');
    if (el) {
        el.textContent = text;
        el.className = 'sb-call-status' + (cssClass ? ' ' + cssClass : '');
    }
}

function updateCallStatusClass(cssClass) {
    const el = document.getElementById('sbCallStatus');
    if (el) el.className = 'sb-call-status' + (cssClass ? ' ' + cssClass : '');
}

function showCallControls(show) {
    const controls = document.getElementById('sbCallControls');
    if (controls) controls.style.display = show ? 'flex' : 'none';
}

function updateHoldButton(isOnHold) {
    const holdBtn = document.getElementById('sbHoldBtn');
    if (!holdBtn) return;

    if (isOnHold) {
        holdBtn.innerHTML = '▶️';
        holdBtn.title = 'Reprendre';
        holdBtn.classList.add('on-hold');
    } else {
        holdBtn.innerHTML = '⏸️';
        holdBtn.title = 'Mettre en attente';
        holdBtn.classList.remove('on-hold');
    }
}

// ═══════════════════════════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════════════════════════

function startCallTimer() {
    stopCallTimer();
    callTimerInterval = setInterval(() => {
        if (!callStartTime) return;
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const el = document.getElementById('sbCallTimer');
        if (el) el.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopCallTimer() {
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
}

// ═══════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════

function formatCallDuration(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}min ${secs}s`;
}

function translateCallResult(result) {
    const map = {
        'Accepted': 'Accepte', 'Connected': 'Connecte', 'Missed': 'Manque',
        'Voicemail': 'Messagerie', 'Rejected': 'Refuse', 'No Answer': 'Sans reponse',
        'Busy': 'Occupe', 'Hang Up': 'Raccroche', 'Reply': 'Repondu',
        'Unknown': 'Inconnu', 'Call connected': 'Connecte', 'Call Failed': 'Echoue'
    };
    return map[result] || result || 'Inconnu';
}
