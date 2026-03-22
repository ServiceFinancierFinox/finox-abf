// ═══════════════════════════════════════════════════════════════
// SMART BAR — EMAIL POPUP 📧
// Includes: list view, detail view, reply, compose, attachments
// ═══════════════════════════════════════════════════════════════

// ═══ GMAIL DIRECT SEND — bypass CF Workers (fix double UTF-8 encoding) ═══
// CF Workers' fetch() corrupts UTF-8 when proxying to Gmail API.
// Solution: build & encode email client-side, send direct to Gmail API.
const GmailDirect = {
    _senderCache: null,

    // Base64 charset
    _B64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',

    // Encode Uint8Array → base64 string
    _bytesToBase64(bytes) {
        const B = this._B64;
        let r = '';
        for (let i = 0; i < bytes.length; i += 3) {
            const b0 = bytes[i], b1 = bytes[i+1] || 0, b2 = bytes[i+2] || 0;
            r += B[b0 >> 2];
            r += B[((b0 & 3) << 4) | (b1 >> 4)];
            r += (i+1 < bytes.length) ? B[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
            r += (i+2 < bytes.length) ? B[b2 & 0x3f] : '=';
        }
        return r;
    },

    // MIME B-encode a string (UTF-8 → base64 encoded-word)
    mimeB(str) {
        return '=?UTF-8?B?' + this._bytesToBase64(new TextEncoder().encode(str)) + '?=';
    },

    // Encode string → base64 (UTF-8 content)
    textToBase64(str) {
        return this._bytesToBase64(new TextEncoder().encode(str));
    },

    // Check if string is pure ASCII
    isAscii(str) {
        for (let i = 0; i < str.length; i++) {
            if (str.charCodeAt(i) > 127) return false;
        }
        return true;
    },

    // MIME B-encode if non-ASCII, otherwise return as-is
    safeHeader(str) {
        if (!str || this.isAscii(str)) return str || '';
        return this.mimeB(str);
    },

    // Get sender email (cached)
    async getSender(token) {
        if (this._senderCache) return this._senderCache;
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('Could not get Gmail profile');
        const prof = await res.json();
        this._senderCache = prof.emailAddress;
        return this._senderCache;
    },

    // Build complete RFC 2822 email (guaranteed ASCII output)
    buildRawEmail({ from, to, subject, fullHtml, inReplyTo, attachments }) {
        const mimeSubject = this.mimeB(subject || '(Sans objet)');
        const fromName = this.safeHeader(from.split('@')[0]);
        const bodyB64 = this.textToBase64(fullHtml);
        const hasAtt = attachments && attachments.length > 0;
        const boundary = 'finox_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        const headers = [
            `From: ${fromName} <${from}>`,
            `To: ${to}`,
            `Subject: ${mimeSubject}`,
            'MIME-Version: 1.0'
        ];

        if (inReplyTo) {
            headers.push(`In-Reply-To: ${inReplyTo}`);
            headers.push(`References: ${inReplyTo}`);
        }

        let raw = '';
        if (hasAtt) {
            headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
            raw = headers.join('\r\n') + '\r\n\r\n';
            raw += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${bodyB64}\r\n`;
            for (const att of attachments) {
                const name = att.filename || att.name || 'file';
                const safeName = this.isAscii(name) ? name : this.mimeB(name);
                const mime = att.mimeType || att.type || 'application/octet-stream';
                const data = att.base64Data || att.data || '';
                raw += `--${boundary}\r\nContent-Type: ${mime}; name="${safeName}"\r\nContent-Disposition: attachment; filename="${safeName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data}\r\n`;
            }
            raw += `--${boundary}--`;
        } else {
            headers.push('Content-Type: text/html; charset=UTF-8');
            headers.push('Content-Transfer-Encoding: base64');
            raw = headers.join('\r\n') + '\r\n\r\n' + bodyB64;
        }

        return raw;
    },

    // Extract data:image URIs from HTML → CID references + inline attachments
    extractInlineImages(html) {
        const images = [];
        const cleaned = html.replace(
            /src="(data:image\/([^;]+);base64,([^"]+))"/g,
            (match, fullUri, imgType, b64Data) => {
                const cid = 'finox_img_' + images.length + '_' + Date.now();
                images.push({ cid, mimeType: 'image/' + imgType, base64Data: b64Data });
                return 'src="cid:' + cid + '"';
            }
        );
        return { cleaned, images };
    },

    // Build multipart/related email (HTML + inline images)
    buildRelatedEmail({ from, to, subject, fullHtml, inReplyTo, inlineImages, attachments }) {
        const mimeSubject = this.mimeB(subject || '(Sans objet)');
        const fromName = this.safeHeader(from.split('@')[0]);
        const bodyB64 = this.textToBase64(fullHtml);
        const hasAtt = attachments && attachments.length > 0;
        const relBoundary = 'finox_rel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const mixBoundary = 'finox_mix_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        const headers = [
            `From: ${fromName} <${from}>`,
            `To: ${to}`,
            `Subject: ${mimeSubject}`,
            'MIME-Version: 1.0'
        ];

        if (inReplyTo) {
            headers.push(`In-Reply-To: ${inReplyTo}`);
            headers.push(`References: ${inReplyTo}`);
        }

        // HTML part
        const htmlPart = `Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${bodyB64}`;

        // Inline image parts
        const imgParts = inlineImages.map(img =>
            `Content-Type: ${img.mimeType}\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${img.cid}>\r\nContent-Disposition: inline\r\n\r\n${img.base64Data}`
        );

        // Build multipart/related block
        let relatedBlock = `--${relBoundary}\r\n${htmlPart}\r\n`;
        for (const part of imgParts) {
            relatedBlock += `--${relBoundary}\r\n${part}\r\n`;
        }
        relatedBlock += `--${relBoundary}--`;

        let raw = '';
        if (hasAtt) {
            // Outer: multipart/mixed, inner: multipart/related
            headers.push(`Content-Type: multipart/mixed; boundary="${mixBoundary}"`);
            raw = headers.join('\r\n') + '\r\n\r\n';
            raw += `--${mixBoundary}\r\nContent-Type: multipart/related; boundary="${relBoundary}"\r\n\r\n${relatedBlock}\r\n`;
            for (const att of attachments) {
                const name = att.filename || att.name || 'file';
                const safeName = this.isAscii(name) ? name : this.mimeB(name);
                const mime = att.mimeType || att.type || 'application/octet-stream';
                const data = att.base64Data || att.data || '';
                raw += `--${mixBoundary}\r\nContent-Type: ${mime}; name="${safeName}"\r\nContent-Disposition: attachment; filename="${safeName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data}\r\n`;
            }
            raw += `--${mixBoundary}--`;
        } else {
            // Just multipart/related
            headers.push(`Content-Type: multipart/related; boundary="${relBoundary}"`);
            raw = headers.join('\r\n') + '\r\n\r\n' + relatedBlock;
        }

        return raw;
    },

    // Send email directly to Gmail API (bypasses CF Workers)
    async send({ token, to, subject, body, signature, inReplyTo, threadId, attachments }) {
        const from = await this.getSender(token);

        // Build HTML body
        let html = (body || '').replace(/\n/g, '<br>\n');
        let sigHtml = signature || '';

        // Extract data:image URIs from signature → CID inline attachments
        // (Large data URIs in base64 body cause Gmail to garble the Subject header)
        let inlineImages = [];
        if (sigHtml) {
            const extracted = this.extractInlineImages(sigHtml);
            sigHtml = extracted.cleaned;
            inlineImages = extracted.images;
        }

        if (sigHtml) html += '<br><br>' + sigHtml;
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;">${html}</body></html>`;

        let rawEmail;
        if (inlineImages.length > 0) {
            // Use multipart/related to keep inline images as CID attachments
            rawEmail = this.buildRelatedEmail({ from, to, subject, fullHtml, inReplyTo, inlineImages, attachments });
        } else {
            rawEmail = this.buildRawEmail({ from, to, subject, fullHtml, inReplyTo, attachments });
        }

        // base64url encode via btoa (rawEmail is 100% ASCII)
        const encoded = btoa(rawEmail).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const payload = { raw: encoded };
        if (threadId) payload.threadId = threadId;

        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error?.message || 'Gmail API error: ' + res.status);
        }
        return data;
    }
};

window.openEmailPopup = async function() {
    const overlay = document.getElementById('emailPopupOverlay');
    overlay.classList.add('show');

    let cd = FINOX.getClientData();
    if (!cd) { try { cd = await FINOX.loadClientData(); } catch(e) {} }

    // Reset to client contact
    emailSelectedContact = 'client';
    document.getElementById('emailPopupClient').textContent = getClientName();
    buildContactSelector('emailContactSelector', 'email', 'client');

    // Mettre à jour le lien "Ouvrir le dossier"
    const openFileBtn = document.getElementById('emailPopupOpenFile');
    if (openFileBtn && FINOX.CLIENT_ID) {
        openFileBtn.href = 'abf.html?client=' + FINOX.CLIENT_ID;
        openFileBtn.style.display = '';
    } else if (openFileBtn) {
        openFileBtn.style.display = 'none';
    }

    // Reset to list view
    document.getElementById('emailPopupList').style.display = 'block';
    document.getElementById('emailPopupDetail').classList.remove('show');
    emailPopupSelected = null;

    // Mark Email as read (clear badge)
    if (typeof markEmailRead === 'function') markEmailRead();

    // Load emails
    emailPopupLoaded = false;
    loadEmailPopupConv();
};

window.closeEmailPopup = function() {
    document.getElementById('emailPopupOverlay').classList.remove('show');
    emailPopupSelected = null;
};

async function loadEmailPopupConv() {
    const container = document.getElementById('emailPopupEmailList');
    const email = getSelectedEmailAddress();

    if (!email) {
        container.innerHTML = '<div class="sideload-empty"><div class="sideload-empty-icon">📭</div><div class="sideload-empty-text">Aucune adresse email pour ce client</div></div>';
        emailPopupLoaded = true;
        return;
    }

    const token = await getMsgGoogleToken();
    if (!token) {
        container.innerHTML = '<div class="sideload-error">Google non connecté. Connectez votre compte dans les paramètres.</div>';
        emailPopupLoaded = true;
        return;
    }

    container.innerHTML = '<div class="sideload-loading">⏳ Chargement des emails...</div>';

    try {
        const res = await fetch(GOOGLE_WORKER + '/gmail/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ contact_email: email, max_results: 15 })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error || '';
            if (errMsg.includes('Token expired') || errMsg.includes('reconnect Google') || res.status === 401) {
                container.innerHTML = '<div class="sideload-error">🔑 Session Google expirée.<br><small>Allez dans <b>Paramètres → Connexions</b> pour reconnecter.</small></div>';
                emailPopupLoaded = true;
                return;
            }
            throw new Error(errMsg || 'HTTP ' + res.status);
        }

        const data = await res.json();
        emailPopupMessages = data.messages || [];
        renderEmailPopupList();
        emailPopupLoaded = true;
    } catch (e) {
        console.error('[Email Popup] Load error:', e);
        container.innerHTML = '<div class="sideload-error">Erreur de chargement des emails</div>';
    }
}

function renderEmailPopupList() {
    const container = document.getElementById('emailPopupEmailList');
    if (emailPopupMessages.length === 0) {
        container.innerHTML = '<div class="sideload-empty"><div class="sideload-empty-icon">📧</div><div class="sideload-empty-text">Aucun email avec ce client</div></div>';
        return;
    }

    const escHtml = FINOX.escapeHtml || (t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; });
    let html = '';
    // Reverse: oldest first, newest at bottom (chat-style)
    const sorted = [...emailPopupMessages].reverse();
    sorted.forEach(em => {
        const isUnread = em.labelIds?.includes('UNREAD') || em.unread;
        const isSent = em.labelIds?.includes('SENT');
        const subj = em.subject || '(Pas de sujet)';
        const snippet = em.snippet || '';
        const from = isSent ? '→ Envoyé' : (em.from || '').replace(/<[^>]+>/g, '').trim();
        const time = formatMsgTime(em.internalDate ? new Date(parseInt(em.internalDate)) : em.timestamp);

        const markBtnLabel = isUnread ? '✓ Lu' : '📬 Non lu';
        const markAction = isUnread ? 'markEmailItemRead' : 'markEmailItemUnread';
        html += `<div class="msg-email-item ${isUnread ? 'unread' : ''}" onclick="selectEmailInPopup('${em.id}')">
            <button class="email-mark-btn" onclick="event.stopPropagation();${markAction}('${em.id}')" title="${markBtnLabel}">${markBtnLabel}</button>
            <div class="msg-email-header"><div class="msg-email-subject">${escHtml(subj)}</div><div class="msg-email-date">${time}</div></div>
            <div class="msg-email-from">${escHtml(from)}</div>
            <div class="msg-email-snippet">${escHtml(snippet)}</div>
        </div>`;
    });
    container.innerHTML = html;

    requestAnimationFrame(() => {
        const body = document.getElementById('emailPopupBody');
        if (body) body.scrollTop = body.scrollHeight;
    });
}

window.selectEmailInPopup = async function(emailId) {
    const em = emailPopupMessages.find(e => e.id === emailId);
    if (!em) return;
    emailPopupSelected = em;

    // Auto-mark as read when opening an unread email
    if (em.labelIds?.includes('UNREAD') || em.unread) {
        markEmailItemRead(emailId);
    }

    // Switch to detail view
    document.getElementById('emailPopupList').style.display = 'none';
    const detail = document.getElementById('emailPopupDetail');
    detail.classList.add('show');

    // Subject
    document.getElementById('emailPopupSubject').textContent = em.subject || '(Pas de sujet)';

    // Direction badge
    const isSent = em.labelIds?.includes('SENT');
    const dirBadge = document.getElementById('emailDetailDirection');
    dirBadge.textContent = isSent ? '📤 Envoyé' : '📥 Reçu';
    dirBadge.className = 'email-detail-direction ' + (isSent ? 'sent' : 'received');

    // From & Date
    const fromText = isSent ? 'Vous' : (em.from || '').replace(/<[^>]+>/g, '').trim();
    document.getElementById('emailDetailFrom').textContent = (isSent ? '→ ' : '← ') + fromText;
    const time = formatMsgTime(em.internalDate ? new Date(parseInt(em.internalDate)) : em.timestamp);
    document.getElementById('emailDetailDate').textContent = time;

    // Body area
    const bodyDiv = document.getElementById('emailDetailBody');
    const attachDiv = document.getElementById('emailDetailAttachments');
    bodyDiv.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">⏳ Chargement...</div>';
    attachDiv.innerHTML = '';

    // Fetch full email body if not loaded
    if (!em.body && !em.htmlBody && !em._bodyLoaded) {
        try {
            const token = await getMsgGoogleToken();
            if (token) {
                const res = await fetch(`${GOOGLE_WORKER}/gmail/message/${emailId}`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const fullEmail = await res.json();
                    em.body = fullEmail.body || fullEmail.bodyText || '';
                    em.bodyText = fullEmail.bodyText || '';
                    em.attachments = fullEmail.attachments || [];
                    em._bodyLoaded = true;
                }
            }
        } catch (e) {
            console.error('[Email Popup] Fetch body error:', e);
        }
    }

    // Render body as native HTML (dark-mode adapted)
    if (em.body) {
        let safeHtml = em.body
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\son\w+="[^"]*"/gi, '')
            .replace(/\son\w+='[^']*'/gi, '');
        bodyDiv.innerHTML = safeHtml;
    } else if (em.bodyText) {
        bodyDiv.textContent = em.bodyText;
    } else {
        bodyDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">Contenu non disponible</div>';
    }

    // Render attachments if any
    const escHtml = FINOX.escapeHtml || (t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; });
    if (em.attachments && em.attachments.length > 0) {
        attachDiv.innerHTML = em.attachments.map(att => {
            const icon = att.mimeType?.startsWith('image/') ? '🖼️' : att.mimeType?.includes('pdf') ? '📄' : '📎';
            return `<div class="email-detail-attachment"><span class="att-icon">${icon}</span>${escHtml(att.filename || 'Fichier')}<span style="opacity:0.5;font-size:10px;">${att.size ? Math.round(att.size/1024) + ' KB' : ''}</span></div>`;
        }).join('');
    }
};

window.emailPopupBackToList = function() {
    document.getElementById('emailPopupList').style.display = 'block';
    document.getElementById('emailPopupDetail').classList.remove('show');
    emailPopupSelected = null;
};

window.sendEmailFromPopup = async function() {
    const input = document.getElementById('emailReplyInput');
    const btn = document.getElementById('emailSendBtn');
    const text = input.value.trim();
    if (!text) return;

    btn.disabled = true; btn.textContent = 'Envoi...';

    try {
        const emailTo = getSelectedEmailAddress();
        const token = await getMsgGoogleToken();
        if (!emailTo || !token) throw new Error('Données manquantes');

        const signature = FINOX.getEmailSignature ? FINOX.getEmailSignature() : '';
        let subject = 'Message';
        let threadId = undefined;
        let inReplyTo = undefined;

        if (emailPopupSelected) {
            subject = (emailPopupSelected.subject || '').startsWith('Re:') ? emailPopupSelected.subject : 'Re: ' + (emailPopupSelected.subject || '');
            threadId = emailPopupSelected.threadId;
            inReplyTo = emailPopupSelected.id;
        }

        // ── DIRECT GMAIL API (bypass CF Workers UTF-8 corruption) ──
        await GmailDirect.send({
            token, to: emailTo, subject, body: text, signature,
            inReplyTo, threadId,
            attachments: replyAttachments.length > 0 ? replyAttachments : undefined
        });

        input.value = '';
        input.style.height = '';
        replyAttachments = [];
        renderReplyAttachments();
        const fileInput = document.getElementById('emailReplyFileInput');
        if (fileInput) fileInput.value = '';
        FINOX.showNotification('📧 Email envoyé!', 'success');
        loadEmailPopupConv();
        loadMsgBadges();
    } catch (e) {
        console.error('[Email Popup] Send error:', e);
        FINOX.showNotification('Erreur: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Envoyer';
    }
};

// Email Quick AI Reply
window.emailQuickAiReply = async function() {
    const btn = document.getElementById('emailAiBtn');
    btn.textContent = '⏳ AI...';

    try {
        const cd = FINOX.getClientData();
        const user = FINOX.getCurrentUser();

        const lastReceived = emailPopupSelected || emailPopupMessages.find(em => !em.labelIds?.includes('SENT'));
        if (!lastReceived) throw new Error('Aucun email reçu à répondre');

        const contactName = emailSelectedContact === 'conjoint' ? (cd?.conjoint_first_name || 'Conjoint') : getClientName();
        const contactPrenom = emailSelectedContact === 'conjoint' ? (cd?.conjoint_first_name || '') : (cd?.prenom || cd?.first_name || '');
        const context = {
            client_name: contactName,
            client_prenom: contactPrenom,
            client_type: cd?.type_contact || 'prospect',
            client_status: cd?.lead_status || cd?.statut_lead || cd?.statut || 'Nouveau Lead',
            email_subject: lastReceived.subject || '',
            email_snippet: lastReceived.snippet || '',
            email_from: lastReceived.from || '',
            advisor_name: user?.user_metadata?.full_name || user?.email || 'Dany Michaud'
        };

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
                channel: 'email',
                context: context
            })
        });
        const aiData = await aiRes.json();
        const reply = aiData.reply || aiData.response || aiData.text || '';

        if (reply) {
            const emailInput = document.getElementById('emailReplyInput');
            emailInput.value = reply;
            autoExpandTextarea(emailInput);
            emailInput.focus();
        } else {
            throw new Error('Pas de réponse AI');
        }
    } catch (e) {
        console.error('[Email AI Reply]', e);
        FINOX.showNotification('AI: ' + e.message, 'error');
    } finally {
        btn.textContent = '✨ AI Reply';
    }
};

// ==========================================
// EMAIL COMPOSE MODAL ✏️
// ==========================================
window.openEmailComposeFromPopup = function() {
    const overlay = document.getElementById('emailComposeOverlay');
    overlay.classList.add('show');

    document.getElementById('emailComposeTo2').value = getSelectedEmailAddress() || '';
    document.getElementById('emailComposeSubject2').value = '';
    document.getElementById('emailComposeBody2').innerHTML = '';
    composeAttachments2 = [];
    renderComposeAttachments2();

    // Load signature
    const sig = FINOX.getEmailSignature ? FINOX.getEmailSignature() : '';
    document.getElementById('emailComposeSignature2').innerHTML = sig || '';

    // Setup drag & drop
    setupComposeDragDrop2();
};

window.closeEmailCompose2 = function() {
    document.getElementById('emailComposeOverlay').classList.remove('show');
    composeAttachments2 = [];
};

function setupComposeDragDrop2() {
    const dropZone = document.getElementById('emailComposeAttachments2');
    if (!dropZone || dropZone._ddSetup) return;
    dropZone._ddSetup = true;

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files) handleComposeFiles2(e.dataTransfer.files);
    });
}

// ---- Reply Attachments (barre de réponse rapide) ----
window.handleReplyFiles = function(files) {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            replyAttachments.push({
                name: file.name,
                size: file.size,
                type: file.type,
                data: e.target.result.split(',')[1]
            });
            renderReplyAttachments();
        };
        reader.readAsDataURL(file);
    });
};

function renderReplyAttachments() {
    const container = document.getElementById('emailReplyAttachments');
    if (!container) return;

    if (replyAttachments.length === 0) {
        container.classList.remove('has-files');
        container.innerHTML = '';
        return;
    }

    container.classList.add('has-files');
    container.innerHTML = replyAttachments.map((att, i) => {
        const size = att.size < 1024 ? `${att.size}B` : att.size < 1048576 ? `${(att.size/1024).toFixed(1)}KB` : `${(att.size/1048576).toFixed(1)}MB`;
        return `<div class="email-reply-file">📎 ${att.name} <small>(${size})</small> <button class="email-reply-file-remove" onclick="removeReplyAttachment(${i})">✕</button></div>`;
    }).join('');
}

window.removeReplyAttachment = function(index) {
    replyAttachments.splice(index, 1);
    renderReplyAttachments();
};

// ---- Compose Attachments (modal Nouveau email) ----
window.handleComposeFiles2 = function(files) {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            composeAttachments2.push({
                name: file.name,
                size: file.size,
                type: file.type,
                data: e.target.result.split(',')[1]
            });
            renderComposeAttachments2();
        };
        reader.readAsDataURL(file);
    });
};

function renderComposeAttachments2() {
    const container = document.getElementById('emailComposeAttachments2');
    const hint = document.getElementById('emailComposeAttHint2');

    if (composeAttachments2.length === 0) {
        if (hint) hint.style.display = '';
        container.querySelectorAll('.email-compose-file').forEach(el => el.remove());
        return;
    }

    if (hint) hint.style.display = 'none';
    container.querySelectorAll('.email-compose-file').forEach(el => el.remove());

    composeAttachments2.forEach((att, i) => {
        const size = att.size < 1024 ? `${att.size}B` : att.size < 1048576 ? `${(att.size/1024).toFixed(1)}KB` : `${(att.size/1048576).toFixed(1)}MB`;
        const el = document.createElement('div');
        el.className = 'email-compose-file';
        el.innerHTML = `📎 ${att.name} <small>(${size})</small> <button class="email-compose-file-remove" onclick="removeComposeAttachment2(${i})">✕</button>`;
        container.appendChild(el);
    });
}

window.removeComposeAttachment2 = function(index) {
    composeAttachments2.splice(index, 1);
    renderComposeAttachments2();
};

window.sendComposedEmail2 = async function() {
    const btn = document.getElementById('emailComposeSendBtn2');
    const to = document.getElementById('emailComposeTo2').value.trim();
    const subject = document.getElementById('emailComposeSubject2').value.trim();
    const body = document.getElementById('emailComposeBody2').innerText.trim();

    if (!to) { FINOX.showNotification('Veuillez entrer un destinataire', 'error'); return; }
    if (!subject) { FINOX.showNotification('Veuillez entrer un objet', 'error'); return; }
    if (!body) { FINOX.showNotification('Veuillez rédiger un message', 'error'); return; }

    btn.disabled = true; btn.innerHTML = '⏳ Envoi...';

    try {
        const token = await getMsgGoogleToken();
        if (!token) throw new Error('Google non connecté');

        const signature = FINOX.getEmailSignature ? FINOX.getEmailSignature() : '';

        // ── DIRECT GMAIL API (bypass CF Workers UTF-8 corruption) ──
        await GmailDirect.send({
            token, to, subject, body, signature,
            attachments: composeAttachments2.length > 0 ? composeAttachments2 : undefined
        });

        FINOX.showNotification('📧 Email envoyé!', 'success');
        closeEmailCompose2();
        loadEmailPopupConv();
        loadMsgBadges();
    } catch (e) {
        console.error('[Compose Email] Send error:', e);
        FINOX.showNotification('Erreur: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.innerHTML = '📤 Envoyer';
    }
};

// AI Draft for compose
window.composeAiDraft2 = async function() {
    const subject = document.getElementById('emailComposeSubject2').value.trim();
    if (!subject) { FINOX.showNotification('Entrez un objet d\'abord', 'error'); return; }

    try {
        const cd = FINOX.getClientData();
        const user = FINOX.getCurrentUser();
        const aiRes = await fetch(AI_REPLY_WORKER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'compose_draft',
                channel: 'email',
                context: {
                    client_name: getClientName(),
                    subject: subject,
                    advisor_name: user?.user_metadata?.full_name || user?.email || ''
                },
                prompt: `Tu es un conseiller financier. Rédige un email professionnel en français sur le sujet: "${subject}" pour le client ${getClientName()}. Sois concis et professionnel.`
            })
        });
        const aiData = await aiRes.json();
        const draft = aiData.reply || aiData.response || aiData.text || '';
        if (draft) {
            document.getElementById('emailComposeBody2').innerText = draft;
        }
    } catch (e) {
        FINOX.showNotification('AI: ' + e.message, 'error');
    }
};

// ── Mark individual email as read/unread ──
window.markEmailItemRead = async function(emailId) {
    const em = emailPopupMessages.find(e => e.id === emailId);
    if (!em) return;
    // Remove UNREAD label locally
    if (em.labelIds) em.labelIds = em.labelIds.filter(l => l !== 'UNREAD');
    em.unread = false;
    renderEmailPopupList();
    // Mark in Gmail — direct API call (bypass CF worker for reliability)
    try {
        const tokens = FINOX.getGoogleTokens();
        if (tokens?.access_token) {
            const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
            });
            if (!res.ok) console.warn('[Email] Gmail mark-read failed:', res.status, await res.text().catch(() => ''));
            else console.log('[Email] Gmail mark-read OK:', emailId);
        } else {
            // Fallback to worker
            await FINOX.googleFetch('/gmail/mark-read', { method: 'POST', body: JSON.stringify({ message_ids: [emailId] }) });
        }
    } catch(e) { console.warn('[Email] mark-read error:', e.message); }
    if (typeof loadMsgBadges === 'function') loadMsgBadges();
};

window.markEmailItemUnread = async function(emailId) {
    const em = emailPopupMessages.find(e => e.id === emailId);
    if (!em) return;
    // Add UNREAD label locally
    if (!em.labelIds) em.labelIds = [];
    if (!em.labelIds.includes('UNREAD')) em.labelIds.push('UNREAD');
    em.unread = true;
    renderEmailPopupList();
    // Mark in Gmail — direct API call
    try {
        const tokens = FINOX.getGoogleTokens();
        if (tokens?.access_token) {
            await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ addLabelIds: ['UNREAD'] })
            });
        } else {
            await FINOX.googleFetch('/gmail/mark-unread', { method: 'POST', body: JSON.stringify({ message_ids: [emailId] }) });
        }
    } catch(e) { console.warn('[Email] mark-unread error:', e.message); }
    if (typeof loadMsgBadges === 'function') loadMsgBadges();
};
