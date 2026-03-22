// ═══════════════════════════════════════════════════════════════
// SMART BAR — SMS POPUP 💬
// ═══════════════════════════════════════════════════════════════

window.openSmsPopup = async function() {
    const overlay = document.getElementById('smsPopupOverlay');
    overlay.classList.add('show');

    let cd = FINOX.getClientData();
    if (!cd) { try { cd = await FINOX.loadClientData(); } catch(e) {} }

    // Reset to client contact
    smsSelectedContact = 'client';
    document.getElementById('smsPopupClient').textContent = getClientName();
    buildContactSelector('smsContactSelector', 'sms', 'client');

    // Mark SMS as read (clear badge)
    if (typeof markSmsRead === 'function') markSmsRead();

    // Load conversation
    smsPopupLoaded = false;
    loadSmsPopupConv();

    setTimeout(() => document.getElementById('smsReplyInput')?.focus(), 200);
};

window.closeSmsPopup = function() {
    document.getElementById('smsPopupOverlay').classList.remove('show');
    // Close panels
    document.getElementById('smsTemplatesPanel')?.classList.remove('show');
    document.getElementById('smsEmojiPanel')?.classList.remove('show');
};

async function loadSmsPopupConv() {
    const container = document.getElementById('smsPopupConv');
    const phone = getSelectedSmsPhone();

    if (!phone) {
        container.innerHTML = '<div class="sideload-empty"><div class="sideload-empty-icon">📵</div><div class="sideload-empty-text">Aucun numéro de téléphone</div></div>';
        smsPopupLoaded = true;
        return;
    }

    const user = FINOX.getCurrentUser();
    if (!user) { container.innerHTML = '<div class="sideload-error">Non authentifié</div>'; return; }

    container.innerHTML = '<div class="sideload-loading">⏳ Chargement des SMS...</div>';

    try {
        const res = await fetch(RC_WORKER + '/sms/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_phone: phone, max_results: 30, user_id: user.id })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        if (data.code === 'RC_NOT_CONNECTED') {
            container.innerHTML = '<div class="sideload-error">RingCentral non connecté. Connectez votre compte dans les paramètres.</div>';
            smsPopupLoaded = true;
            return;
        }
        if (data.code === 'RC_TOKEN_EXPIRED') {
            container.innerHTML = '<div class="sideload-error">Session RingCentral expirée. Reconnectez votre compte.</div>';
            smsPopupLoaded = true;
            return;
        }

        const msgs = data.messages || [];
        if (msgs.length === 0) {
            container.innerHTML = '<div class="sideload-empty"><div class="sideload-empty-icon">💬</div><div class="sideload-empty-text">Aucun SMS avec ce client</div></div>';
            smsPopupLoaded = true;
            return;
        }

        const escHtml = FINOX.escapeHtml || (t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; });
        let html = '';
        msgs.forEach(msg => {
            const dir = (msg.direction || '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
            const text = msg.subject || msg.text || '';
            const time = formatMsgTime(msg.creationTime || msg.timestamp);
            html += `<div class="msg-bubble-wrap ${dir}"><div class="msg-bubble">${escHtml(text)}</div><div class="msg-bubble-time">${time}</div></div>`;
        });
        container.innerHTML = html;
        smsPopupLoaded = true;

        // Scroll to bottom
        const body = document.getElementById('smsPopupBody');
        if (body) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    } catch (e) {
        console.error('[SMS Popup] Load error:', e);
        container.innerHTML = '<div class="sideload-error">Erreur de chargement des SMS</div>';
    }
}

window.sendSmsFromPopup = async function() {
    const input = document.getElementById('smsReplyInput');
    const btn = document.getElementById('smsSendBtn');
    const text = input.value.trim();
    if (!text) return;

    const phone = getSelectedSmsPhone();
    if (!phone) { FINOX.showNotification('Aucun numéro de téléphone', 'error'); return; }

    btn.disabled = true; btn.textContent = 'Envoi...';

    try {
        const user = FINOX.getCurrentUser();
        if (!user) throw new Error('Non authentifié');
        const res = await fetch(RC_WORKER + '/sms/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: phone, text: text, user_id: user.id })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        input.value = '';
        input.style.height = '';
        FINOX.showNotification('📱 SMS envoyé!', 'success');
        loadSmsPopupConv();
        loadMsgBadges();
    } catch (e) {
        console.error('[SMS Popup] Send error:', e);
        FINOX.showNotification('Erreur: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Envoyer';
    }
};

// SMS Templates
window.toggleSmsTemplates = function() {
    const panel = document.getElementById('smsTemplatesPanel');
    panel.classList.toggle('show');
    document.getElementById('smsEmojiPanel')?.classList.remove('show');
};

window.insertSmsTemplate = function(type) {
    const firstName = getClientFirstName();
    const templates = {
        accueil: `Bonjour ${firstName}, merci de nous avoir contacté! Comment puis-je vous aider?`,
        suivi: `Bonjour ${firstName}, je fais un suivi concernant notre dernière conversation. Avez-vous des questions?`,
        rappel: `Bonjour ${firstName}, un petit rappel pour notre rendez-vous prévu. Au plaisir!`,
        merci: `Merci ${firstName} pour votre confiance! N'hésitez pas si vous avez besoin de quoi que ce soit.`
    };
    const input = document.getElementById('smsReplyInput');
    input.value = templates[type] || '';
    input.focus();
    document.getElementById('smsTemplatesPanel')?.classList.remove('show');
};

// SMS Emoji picker
const SMS_EMOJIS = ['😀','😊','👋','🙏','👍','❤️','🎉','✅','📞','📅','⏰','💼','🏠','📊','💰','🔑','📝','✨','🚀','💪','😎','🤝','👏','💯','⭐','🎯','📌','💡','🔥','😄'];

window.toggleSmsEmojiPicker = function() {
    const panel = document.getElementById('smsEmojiPanel');
    panel.classList.toggle('show');
    document.getElementById('smsTemplatesPanel')?.classList.remove('show');

    // Populate grid if empty
    const grid = document.getElementById('smsEmojiGrid');
    if (grid && !grid.children.length) {
        grid.innerHTML = SMS_EMOJIS.map(e => `<button class="sms-emoji-btn" onclick="insertSmsEmoji('${e}')">${e}</button>`).join('');
    }
};

window.insertSmsEmoji = function(emoji) {
    const input = document.getElementById('smsReplyInput');
    input.value += emoji;
    input.focus();
};

// SMS Quick AI Reply
window.smsQuickAiReply = async function() {
    const btn = document.getElementById('smsAiBtn');
    btn.classList.add('loading');
    btn.textContent = '⏳ AI...';

    try {
        const cd = FINOX.getClientData();
        const phone = getSelectedSmsPhone();
        const user = FINOX.getCurrentUser();
        if (!phone || !user) throw new Error('Données manquantes');

        // Get latest SMS messages for context
        const res = await fetch(RC_WORKER + '/sms/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_phone: phone, max_results: 10, user_id: user.id })
        });
        const data = await res.json();
        const msgs = data.messages || [];

        // Find last inbound message
        const lastInbound = [...msgs].reverse().find(m => (m.direction || '').toLowerCase() === 'inbound');
        if (!lastInbound) throw new Error('Aucun SMS reçu à répondre');

        // Build rich context
        const contactName = smsSelectedContact === 'conjoint' ? (cd?.conjoint_first_name || 'Conjoint') : getClientName();
        const contactPrenom = smsSelectedContact === 'conjoint' ? (cd?.conjoint_first_name || '') : (cd?.prenom || cd?.first_name || '');
        const context = {
            client_name: contactName,
            client_prenom: contactPrenom,
            client_type: cd?.type_contact || 'prospect',
            client_status: cd?.lead_status || cd?.statut_lead || cd?.statut || 'Nouveau Lead',
            last_message: lastInbound.subject || lastInbound.text || '',
            recent_messages: msgs.slice(-10).map(m => ({
                direction: m.direction,
                text: m.subject || m.text || '',
                time: m.creationTime
            })),
            advisor_name: user?.user_metadata?.full_name || user?.email || 'Dany Michaud'
        };

        // Headers avec Google Token pour calendrier si dispo
        const headers = { 'Content-Type': 'application/json' };
        const googleTokens = FINOX.getGoogleTokens ? FINOX.getGoogleTokens() : null;
        if (googleTokens?.access_token) {
            headers['X-Google-Token'] = googleTokens.access_token;
        }

        const aiRes = await fetch(AI_REPLY_WORKER, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                action: 'quick_reply',
                channel: 'sms',
                context: context
            })
        });
        const aiData = await aiRes.json();
        const reply = aiData.reply || aiData.response || aiData.text || '';

        if (reply) {
            const smsInput = document.getElementById('smsReplyInput');
            smsInput.value = reply;
            autoExpandTextarea(smsInput);
            smsInput.focus();
        } else {
            throw new Error('Pas de réponse AI');
        }
    } catch (e) {
        console.error('[SMS AI Reply]', e);
        FINOX.showNotification('AI: ' + e.message, 'error');
    } finally {
        btn.classList.remove('loading');
        btn.textContent = '✨ AI Reply';
    }
};
