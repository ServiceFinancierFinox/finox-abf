// ═══════════════════════════════════════════════════════════════
// SMART BAR — FINOX AI POPUP 🤖
// ═══════════════════════════════════════════════════════════════

const FINOXAI_QUERIES = {
    dossier_summary: {
        label: '📊 Résumé du dossier',
        prompt: `Fais un résumé concis et actionnable du dossier client. Inclus:\n- 📊 Situation actuelle (type, statut, engagement récent)\n- 🎯 Prochaine action recommandée\n- ⚠️ Points d'attention\n- 💡 Opportunités identifiées\nFormat en texte lisible avec emojis. Sois concis (max 200 mots).`
    },
    next_step: {
        label: '🎯 Prochaine étape',
        prompt: `Analyse le dossier client et recommande LA prochaine étape concrète à exécuter. Considère:\n- Le statut actuel dans le pipeline\n- L'historique de communication récent\n- Le niveau d'engagement du client\nDonne UNE action précise avec un script/approche suggéré. Max 150 mots.`
    },
    objections: {
        label: '⚠️ Objections anticipées',
        prompt: `Basé sur le profil et l'historique du client, anticipe les 3 objections les plus probables. Pour chaque:\n1. L'objection probable\n2. Pourquoi elle risque de surgir\n3. Réponse suggérée (méthode AIO: Acknowledge-Isolate-Overcome)\nFormat structuré avec numéros. Max 250 mots.`
    },
    sales_opportunities: {
        label: '💡 Opportunités de vente',
        prompt: `Identifie les opportunités de vente croisée et de montée en gamme pour ce client. Analyse:\n- Produits actuels vs besoins potentiels\n- Événements de vie probables (âge, situation)\n- Lacunes dans la couverture\nListe 3-5 opportunités concrètes avec priorité. Max 200 mots.`
    },
    coverage_gaps: {
        label: '📉 Lacunes de couverture',
        prompt: `Analyse le profil du client et identifie les lacunes potentielles de couverture d'assurance. Considère:\n- Assurance vie, invalidité, maladie grave, hypothèque\n- Situation familiale et professionnelle\n- Risques non couverts\nPriorise par urgence. Max 200 mots.`
    },
    followup_strategy: {
        label: '🔄 Stratégie de relance',
        prompt: `Propose une stratégie de relance personnalisée pour ce client. Inclus:\n- Canal recommandé (SMS, email, appel)\n- Timing optimal\n- Message/approche suggéré\n- Fréquence de suivi\nAdapte au statut actuel et à l'historique de comm. Max 200 mots.`
    },
    comm_history: {
        label: '📋 Historique comm.',
        prompt: `Fais une synthèse de l'historique de communication avec ce client. Résume:\n- Volume et fréquence des échanges (SMS, emails, appels)\n- Tonalité générale des échanges\n- Dernière interaction et son résultat\n- Tendance d'engagement (croissant, stable, décroissant)\nFormat chronologique inverse. Max 200 mots.`
    },
    closing_strategy: {
        label: '🏆 Stratégie de closing',
        prompt: `Propose une stratégie de closing adaptée à ce client. Analyse:\n- Signaux d'achat détectés\n- Obstacles restants\n- Approche recommandée (urgence, exclusivité, social proof, etc.)\n- Script de closing suggéré\nSois direct et actionnable. Max 200 mots.`
    }
};

window.openFinoxAiPopup = async function() {
    const overlay = document.getElementById('finoxAiPopupOverlay');
    overlay.classList.add('show');

    let cd = FINOX.getClientData();
    if (!cd) { try { cd = await FINOX.loadClientData(); } catch(e) {} }
    document.getElementById('finoxAiPopupClient').textContent = getClientName();

    // Reset to queries view
    finoxAiBackToQueries();
};

window.closeFinoxAiPopup = function() {
    document.getElementById('finoxAiPopupOverlay').classList.remove('show');
};

async function collectFinoxAiContext() {
    const cd = FINOX.getClientData();
    if (!cd) return {};

    const user = FINOX.getCurrentUser();
    const phone = cd.phone || cd.phone_mobile;
    const email = cd.email;
    let recentSms = [], recentEmails = [];

    try {
        if (phone && user) {
            const res = await fetch(RC_WORKER + '/sms/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_phone: phone, max_results: 5, user_id: user.id })
            });
            const data = await res.json();
            recentSms = (data.messages || []).map(m => ({
                direction: m.direction,
                text: m.subject || m.text || '',
                time: m.creationTime
            }));
        }
    } catch(e) {}

    try {
        if (email) {
            const token = await getMsgGoogleToken();
            if (token) {
                const res = await fetch(GOOGLE_WORKER + '/gmail/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ contact_email: email, max_results: 3 })
                });
                const data = await res.json();
                recentEmails = (data.messages || []).map(em => ({
                    subject: em.subject,
                    from: em.from,
                    snippet: em.snippet,
                    sent: em.labelIds?.includes('SENT')
                }));
            }
        }
    } catch(e) {}

    return {
        client_name: getClientName(),
        client_first_name: getClientFirstName(),
        client_type: cd.type_contact || 'client',
        client_status: cd.lead_status || cd.statut || '',
        client_email: cd.email || '',
        client_phone: phone || '',
        client_data: {
            type: cd.type_contact,
            status: cd.lead_status || cd.statut,
            email: cd.email,
            phone: phone,
            city: cd.city,
            province: cd.province
        },
        advisor_name: user?.user_metadata?.full_name || user?.email || '',
        recent_sms: recentSms,
        recent_emails: recentEmails
    };
}

// Main query handler — toutes les 8 requêtes passent ici
window.finoxAiQuery = async function(queryType) {
    const queryDef = FINOXAI_QUERIES[queryType];
    if (!queryDef) return;

    // Disable chips during loading
    document.querySelectorAll('.finoxai-query-chip').forEach(c => c.classList.add('loading'));

    // Switch to response view
    const grid = document.getElementById('finoxAiQueriesGrid');
    const responseArea = document.getElementById('finoxAiResponseArea');
    const responseBody = document.getElementById('finoxAiResponseBody');
    const responseMeta = document.getElementById('finoxAiResponseMeta');
    const responseTitle = document.getElementById('finoxAiResponseTitle');

    grid.style.display = 'none';
    responseArea.classList.add('active');
    responseTitle.textContent = queryDef.label;
    responseBody.innerHTML = '<span style="color:var(--text-muted)">⏳ Finox AI analyse le dossier...</span>';
    responseMeta.textContent = '';

    const startTime = Date.now();

    try {
        const context = await collectFinoxAiContext();

        const aiRes = await fetch(AI_HEAVY_WORKER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'dossier_summary',
                context: context,
                prompt: queryDef.prompt
            })
        });

        const aiData = await aiRes.json();
        const responseText = aiData.reply || aiData.response || aiData.text || 'Réponse non disponible';
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        responseBody.textContent = responseText;
        responseMeta.textContent = `Claude Sonnet · ${elapsed}s · ${new Date().toLocaleTimeString('fr-CA', {hour:'2-digit', minute:'2-digit'})}`;

        // Auto-log to timeline
        await finoxAiLogToTimeline(queryType, queryDef.label, responseText);

    } catch (e) {
        console.error('[Finox AI]', e);
        responseBody.innerHTML = `<span style="color:#f44336">Erreur: ${e.message}</span>`;
    } finally {
        document.querySelectorAll('.finoxai-query-chip').forEach(c => c.classList.remove('loading'));
    }
};

// Back to queries grid
window.finoxAiBackToQueries = function() {
    document.getElementById('finoxAiQueriesGrid').style.display = 'grid';
    document.getElementById('finoxAiResponseArea').classList.remove('active');
};

// Auto-save AI response to client timeline
async function finoxAiLogToTimeline(queryType, queryLabel, responseText) {
    try {
        const user = FINOX.getCurrentUser();
        // Strip emoji prefix from label for clean title
        const cleanLabel = queryLabel.replace(/^[^\w\s]+\s*/, '');
        await FINOX.supabase.from('client_timeline').insert({
            client_id: FINOX.CLIENT_ID,
            activity_type: 'ai_analysis',
            title: 'Finox AI — ' + cleanLabel,
            description: responseText,
            external_source: 'finox_ai',
            metadata: {
                query_type: queryType,
                model: 'claude-sonnet',
                source: 'finox_ai_popup'
            },
            created_by: user?.id || null
        });
        console.log('[Finox AI] Logged to timeline:', cleanLabel);
    } catch (e) {
        console.error('[Finox AI] Timeline log error:', e);
    }
}
