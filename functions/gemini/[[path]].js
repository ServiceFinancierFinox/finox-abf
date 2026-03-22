/**
 * FINOX Gemini AI Pages Function
 * Assistant AI contextuel pour le CRM - Approche VIP + Méthode AIO
 * Utilise Google Gemini Flash 2.0 pour les réponses rapides SMS/Email/Manni
 *
 * Endpoints:
 * - POST /gemini/generate         - Générer des réponses SMS/Email contextuelles (format Claude)
 * - POST /gemini/quick_reply      - Quick reply SMS/Email (format simplifié sideload)
 * - POST /gemini/compose_draft    - Rédiger un brouillon email
 * - POST /gemini/generate_suggestions - Finox AI: 3 suggestions de réponse
 * - POST /gemini/dossier_summary  - Résumé complet du dossier client
 * - POST /gemini/summary          - Résumé exécutif VIP (format Claude)
 * - POST /gemini/objection        - Gérer une objection avec méthode AIO
 * - POST /gemini/letter           - Générer une lettre explicative (conformité AMF)
 * - POST /gemini/analyze          - Parser les infos du portail assureur
 * - GET  /gemini/health           - Health check
 *
 * Variables d'environnement requises:
 * - GEMINI_API_KEY: Clé API Google Gemini
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Google-Token',
    'Content-Type': 'application/json'
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS - Approche VIP + Méthode AIO
// ═══════════════════════════════════════════════════════════════════════════

const VIP_SYSTEM_PROMPT = `Tu es l'assistant AI de Dany Michaud, conseiller en services financiers chez Finox au Québec.

🎯 TON APPROCHE: SERVICE VIP PERSONNALISÉ
- Chaque client est traité comme un VIP, peu importe le montant
- Tu crées une relation de confiance et de proximité
- Tu es proactif, attentionné et toujours disponible
- Tu anticipes les besoins avant qu'ils soient exprimés
- Tu utilises le prénom du client naturellement

💬 TON TON DE COMMUNICATION:
- Chaleureux mais professionnel
- Empathique et à l'écoute
- Confiant sans être arrogant
- Direct mais jamais pressant
- Utilise des emojis avec parcimonie (1-2 max par message SMS)

📋 MÉTHODE AIO POUR LES OBJECTIONS (Acknowledge-Isolate-Overcome):
Quand tu détectes une objection ou hésitation:

1. ACKNOWLEDGE (Valider): Reconnaître l'émotion/préoccupation du client
2. ISOLATE (Isoler): Poser UNE question pour identifier la vraie cause
3. OVERCOME (Surmonter): Répondre de façon ciblée + proposer une micro-action

🔍 LES 4 CAUSES CACHÉES DERRIÈRE TOUTE OBJECTION:
- CONFIANCE: Doute sur toi ou l'assureur
- BESOIN: Priorité floue, urgence pas claire
- BUDGET: Capacité financière ou perception de valeur
- ENGAGEMENT: Peur de décider, besoin de contrôle

❓ QUESTIONS DIAGNOSTIC UNIVERSELLES:
- "C'est plutôt le prix, le besoin, ou autre chose?"
- "Sur une échelle de 0 à 10, où êtes-vous à l'aise d'avancer?"
- "Qu'est-ce qui manque pour que ce soit un oui?"

📌 RÉPONSES AUX OBJECTIONS COURANTES:

"Je dois y réfléchir":
→ A: "Je comprends, c'est une décision importante."
→ I: "C'est plutôt une question de budget ou d'importance de la protection?"
→ O: "Si on ajuste le montant, seriez-vous prêt à avancer aujourd'hui?"

"C'est trop cher":
→ A: "Votre budget est important, je respecte ça."
→ I: "C'est hors budget, ou vous cherchez à comparer?"
→ O (hors budget): "On peut ajuster la couverture. Même une petite protection vaut mieux que rien."
→ O (comparaison): "J'ai accès à plusieurs assureurs, on compare ensemble maintenant."

"Je dois en parler à mon conjoint":
→ A: "C'est normal, une décision comme celle-ci se prend à deux."
→ I: "D'habitude, c'est plutôt une question de budget ou de validation mutuelle?"
→ O: "On peut soumettre sans finaliser. Vous discutez ensemble et confirmez après."

"Je veux comparer d'autres offres":
→ A: "C'est logique de comparer, vous seriez imprudent de ne pas le faire."
→ I: "Vous comparez plutôt le prix, les garanties, ou le service?"
→ O: "J'ai accès à plusieurs assureurs. On peut comparer maintenant, ensemble."

"J'ai déjà trouvé ailleurs":
→ A: "Bravo d'avoir pris le temps de vous protéger."
→ I: "Vous avez déjà signé, ou c'est encore au stade de soumission?"
→ O: "Je peux valider objectivement votre offre. Si c'est le meilleur, je vous le confirme."

⚠️ RÈGLES D'OR:
- Une objection ≠ un refus (c'est une demande de clarté)
- Ne JAMAIS critiquer la concurrence
- Toujours proposer une MICRO-ACTION pour avancer
- Créer l'urgence sans pression: "Si quelque chose arrivait demain, votre famille serait-elle protégée?"
- Recadrage prix: "Combien de temps pour économiser 100 000$? L'assurance vous protège immédiatement."

🏢 SIGNATURE:
Dany Michaud
Services Financiers Finox
📞 438-256-2838`;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    // Handle both /gemini and /gemini/ and /gemini/action
    const cleanPath = url.pathname.replace(/^\/gemini\/?/, '');
    const pathParts = cleanPath.split('/').filter(Boolean);
    const action = pathParts[0]; // undefined si juste /gemini

    try {
        if (action === 'health') {
            return jsonResponse({
                status: 'ok',
                service: 'FINOX Gemini AI Assistant - VIP Mode',
                features: ['generate', 'quick_reply', 'compose_draft', 'generate_suggestions', 'dossier_summary', 'summary', 'objection', 'letter', 'analyze', 'calendar'],
                model: 'gemini-2.5-flash',
                hasApiKey: !!env.GEMINI_API_KEY,
                timestamp: new Date().toISOString()
            });
        }

        // Debug test endpoint — appel minimal à Gemini pour vérifier la clé
        if (action === 'test') {
            const testKey = env.GEMINI_API_KEY;
            if (!testKey) {
                return jsonResponse({ error: 'GEMINI_API_KEY manquante dans env', envKeys: Object.keys(env).filter(k => !k.includes('SECRET')) });
            }
            try {
                const testUrl = `${GEMINI_API_URL}?key=${testKey}`;
                const testRes = await fetch(testUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'Dis juste "OK" en un mot.' }] }],
                        generationConfig: { maxOutputTokens: 10 }
                    })
                });
                const testData = await testRes.json();
                return jsonResponse({
                    status: testRes.ok ? 'ok' : 'error',
                    httpStatus: testRes.status,
                    response: testData,
                    keyPrefix: testKey.substring(0, 8) + '...'
                });
            } catch (e) {
                return jsonResponse({ error: 'Test failed: ' + e.message });
            }
        }

        const GEMINI_API_KEY = env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return jsonResponse({ error: 'GEMINI_API_KEY non configurée' }, 500);
        }

        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        const body = await request.json();
        const googleToken = request.headers.get('X-Google-Token');

        // ────────────────────────────────────────────────────────────
        // SMART ROUTING: le frontend envoie soit via URL path (/gemini/generate)
        // soit via body.action (/gemini avec {action: 'quick_reply'})
        // On supporte les deux pour compatibilité
        // ────────────────────────────────────────────────────────────
        const resolvedAction = action || body.action;

        switch (resolvedAction) {
            // === Sideload popup endpoints (format simplifié) ===
            case 'quick_reply':
                return await handleQuickReply(body, GEMINI_API_KEY, googleToken);
            case 'compose_draft':
                return await handleComposeDraft(body, GEMINI_API_KEY);
            case 'generate_suggestions':
                return await handleGenerateSuggestions(body, GEMINI_API_KEY);
            case 'dossier_summary':
                return await handleDossierSummary(body, GEMINI_API_KEY);

            // === Claude-compatible endpoints (format complet) ===
            case 'generate':
                return await handleGenerate(body, GEMINI_API_KEY, googleToken);
            case 'summary':
                return await handleSummary(body, GEMINI_API_KEY);
            case 'objection':
                return await handleObjection(body, GEMINI_API_KEY, googleToken);
            case 'letter':
                return await handleLetter(body, GEMINI_API_KEY);
            case 'analyze':
                return await handleAnalyze(body, GEMINI_API_KEY);
            case 'transcribe':
                return await handleTranscribe(body, GEMINI_API_KEY);

            default:
                return jsonResponse({ error: 'Unknown action: ' + resolvedAction }, 400);
        }

    } catch (error) {
        console.error('[Gemini API] Error:', error.message, error.stack);
        return jsonResponse({
            error: error.message,
            reply: '',
            response: '',
            text: ''
        }, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDELOAD POPUP HANDLERS (format simplifié utilisé par abf.html)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quick Reply — SMS ou Email (VERSION ENRICHIE)
 * Utilise le contexte complet du client + calendrier pour des réponses actionnables
 * Input:  { action, channel, context: { client_name, client_prenom, client_type, client_status, last_message, recent_messages, ... } }
 * Output: { reply: "texte" }
 */
async function handleQuickReply(body, apiKey, googleToken) {
    const { channel = 'sms', context = {} } = body;

    // Récupérer les disponibilités calendrier si token Google fourni
    let availability = null;
    if (googleToken) {
        availability = await getCalendarAvailability(googleToken);
    }

    // Détecter les signaux dans le dernier message
    const lastMsg = (context.last_message || '').toLowerCase();
    const wantsAppointment = /rencontre|rdv|rendez-vous|dispo|disponible|quand|voir|appeler|rappel|meeting|call/.test(lastMsg);
    const hasObjection = /réfléchir|cher|budget|conjoint|comparer|ailleurs|pas sûr|hésit|intéress|plus tard/.test(lastMsg);
    const isPositive = /oui|ok|parfait|super|d'accord|intéress|quand|comment|combien/.test(lastMsg);

    // Construire l'historique de conversation
    let conversationHistory = '';
    if (context.recent_messages?.length) {
        conversationHistory = 'CONVERSATION RÉCENTE:\n' + context.recent_messages.map(m => {
            const dir = (m.direction || '').toLowerCase() === 'inbound' ? `${context.client_prenom || 'Client'} →` : 'Dany →';
            return `  ${dir} "${(m.text || '').substring(0, 200)}"`;
        }).join('\n');
    }

    // Prompt condensé pour Quick Reply — pas besoin du VIP_SYSTEM_PROMPT complet
    const clientPrenom = context.client_prenom || context.client_name || 'Client';
    const isSms = channel !== 'email';

    const systemPrompt = `Tu es l'assistant AI de Dany Michaud, conseiller financier chez Finox (Québec).
Ton = chaleureux, professionnel, proactif. Tutoiement naturel. 1-2 emojis max.

CLIENT: ${clientPrenom} | ${context.client_type || 'prospect'} | ${context.client_status || 'Nouveau Lead'}
${context.advisor_name ? `Conseiller: ${context.advisor_name}` : ''}
${!isSms && context.email_subject ? `Sujet email: ${context.email_subject}` : ''}

${conversationHistory}

DERNIER MESSAGE: "${context.last_message || context.email_snippet || ''}"

${availability ? formatAvailabilityForPrompt(availability) : ''}

RÈGLES:
- RÉPONDS au contenu EXACT du message, jamais générique
${wantsAppointment ? `- CLIENT VEUT UN RDV → Propose 2-3 créneaux ${availability ? 'de la liste ci-dessus' : 'concrets (ex: "Demain 14h ou jeudi 10h?")'}` : ''}
${hasObjection ? '- OBJECTION DÉTECTÉE → Valider + isoler la cause + micro-action (méthode AIO)' : ''}
${isPositive ? '- CLIENT POSITIF → Action concrète immédiate (RDV, appel, soumission)' : ''}
- Toujours finir par une QUESTION ou MICRO-ACTION pour avancer
- Utilise le prénom "${clientPrenom}"
- ${isSms ? 'FORMAT SMS: 2-4 phrases, naturel, prêt à envoyer' : 'FORMAT EMAIL: salutation + corps concis + signature Dany Michaud, Finox'}
- JAMAIS de réponse qui ne fait qu'accuser réception

EXEMPLES:
❌ "Salut! Félicitations! Excellente idée pour le REEE." (n'avance à rien)
✅ "Félicitations pour le bébé! 👶 Super idée le REEE, on peut maximiser les subventions dès maintenant. Je suis dispo demain 14h ou jeudi 10h, ça te convient?"

❌ "Merci pour votre message, je reviens vers vous."
✅ "Parfait ${clientPrenom}! Je te prépare une soumission. Petit appel de 10min? Je suis libre demain 10h ou mercredi 15h 📞"

Réponds UNIQUEMENT avec le texte du message prêt à envoyer.`;

    const userPrompt = `Réponds au dernier ${channel === 'email' ? 'email' : 'SMS'} du client. Son message: "${context.last_message || context.email_snippet || ''}"`;

    const maxTokens = channel === 'email' ? 1500 : 1024;
    const reply = await callGemini(systemPrompt, userPrompt, apiKey, maxTokens);

    return jsonResponse({ reply: reply.trim(), response: reply.trim(), text: reply.trim() });
}

/**
 * Compose Draft — Rédiger un brouillon email
 * Input:  { action, channel, context: { client_name, subject, advisor_name }, prompt }
 * Output: { reply: "texte" }
 */
async function handleComposeDraft(body, apiKey) {
    const { context = {}, prompt } = body;

    const systemPrompt = `${VIP_SYSTEM_PROMPT}

MISSION: Rédiger un brouillon email professionnel.

CONTEXTE:
- Client: ${context.client_name || 'Client'}
- Sujet: ${context.subject || 'Sans sujet'}
${context.advisor_name ? `- Conseiller: ${context.advisor_name}` : ''}

INSTRUCTIONS:
- Rédige un email professionnel, clair et chaleureux
- Structure: salutation, corps, conclusion, signature
- Ton VIP personnalisé
- En français
- Réponds UNIQUEMENT avec le texte de l'email, sans JSON`;

    const userPrompt = prompt || `Rédige un email pour le client ${context.client_name} sur le sujet: "${context.subject}"`;

    const reply = await callGemini(systemPrompt, userPrompt, apiKey, 1500);

    return jsonResponse({ reply: reply.trim(), response: reply.trim(), text: reply.trim() });
}

/**
 * Generate Suggestions — Finox AI: 3 tons différents
 * Input:  { action, context: { client_name, client_type, client_status, recent_sms, recent_emails, ... }, prompt }
 * Output: { reply: "[{tone,text},...]" }
 */
async function handleGenerateSuggestions(body, apiKey) {
    const { context = {}, prompt } = body;

    const systemPrompt = `${VIP_SYSTEM_PROMPT}

Tu es Finox AI, l'assistant AI personnel de Dany Michaud.

CONTEXTE CLIENT:
- Nom: ${context.client_name || 'Client'}
- Type: ${context.client_type || 'prospect'}
- Statut: ${context.client_status || 'Nouveau'}
${context.objective ? `- Objectif: ${context.objective}` : ''}

INSTRUCTIONS:
- Génère exactement 3 suggestions de réponse
- Chaque suggestion a un ton différent
- Si tu détectes une objection, applique AIO
- Réponds UNIQUEMENT en JSON array valide, sans texte autour

FORMAT EXACT:
[{"tone":"friendly","text":"..."},{"tone":"professional","text":"..."},{"tone":"short","text":"..."}]

- friendly: amical et chaleureux, tutoiement, 2-3 phrases
- professional: formel, vouvoiement, structuré, 2-3 phrases
- short: court et direct, 1 phrase max`;

    const userPrompt = prompt || `Génère 3 suggestions pour le client ${context.client_name}.`;

    const reply = await callGemini(systemPrompt, userPrompt, apiKey, 1500, 'application/json');

    return jsonResponse({ reply: reply.trim(), response: reply.trim(), text: reply.trim() });
}

/**
 * Dossier Summary — Résumé concis du dossier client
 * Input:  { action, context: { client_name, client_type, client_status, client_data, recent_sms, recent_emails, ... }, prompt }
 * Output: { reply: "résumé texte" }
 */
async function handleDossierSummary(body, apiKey) {
    const { context = {}, prompt } = body;

    const clientData = context.client_data || {};

    const systemPrompt = `Tu es l'assistant expert de Dany Michaud, conseiller Finox.

MISSION: Résumé concis et actionnable du dossier client.

CLIENT:
- Nom: ${context.client_name || 'Client'}
- Type: ${clientData.type || context.client_type || 'prospect'}
- Statut: ${clientData.status || context.client_status || 'Nouveau'}
${clientData.email ? `- Email: ${clientData.email}` : ''}
${clientData.phone ? `- Téléphone: ${clientData.phone}` : ''}
${clientData.city ? `- Ville: ${clientData.city}` : ''}

HISTORIQUE RÉCENT:
${context.recent_sms?.length ? `SMS (${context.recent_sms.length} récents): ${context.recent_sms.slice(0, 5).map(m => `${m.direction === 'inbound' ? '📥' : '📤'} "${(m.text || '').substring(0, 80)}"`).join(' | ')}` : 'Aucun SMS récent'}
${context.recent_emails?.length ? `Emails (${context.recent_emails.length} récents): ${context.recent_emails.slice(0, 3).map(e => `"${e.subject}"`).join(', ')}` : 'Aucun email récent'}
${context.total_calls ? `Appels: ${context.total_calls} total` : ''}

FORMAT:
- 📊 Situation: [2-3 lignes]
- 🎯 Prochaine action: [1 ligne actionnable]
- ⚠️ Points d'attention: [si applicable]
- 💡 Opportunités: [si applicable]

Réponds en français, format texte lisible (pas de JSON).`;

    const userPrompt = prompt || 'Fais un résumé concis du dossier client.';

    const reply = await callGemini(systemPrompt, userPrompt, apiKey, 1500);

    return jsonResponse({ reply: reply.trim(), response: reply.trim(), text: reply.trim() });
}

// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR - Récupérer les disponibilités
// ═══════════════════════════════════════════════════════════════════════════

async function getCalendarAvailability(googleToken, daysAhead = 7) {
    if (!googleToken) return null;

    try {
        const now = new Date();
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

        const response = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/primary/freebusy?` +
            `timeMin=${now.toISOString()}&timeMax=${future.toISOString()}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${googleToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    timeMin: now.toISOString(),
                    timeMax: future.toISOString(),
                    items: [{ id: 'primary' }]
                })
            }
        );

        if (!response.ok) {
            return await getCalendarEvents(googleToken, daysAhead);
        }

        const data = await response.json();
        const busySlots = data.calendars?.primary?.busy || [];

        return findAvailableSlots(busySlots, daysAhead);

    } catch (error) {
        console.error('[Calendar] Error:', error);
        return await getCalendarEvents(googleToken, daysAhead);
    }
}

async function getCalendarEvents(googleToken, daysAhead = 7) {
    try {
        const now = new Date();
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

        const response = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/primary/events?` +
            `timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&singleEvents=true&orderBy=startTime`,
            {
                headers: {
                    'Authorization': `Bearer ${googleToken}`
                }
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const events = data.items || [];

        const busySlots = events
            .filter(e => e.start?.dateTime)
            .map(e => ({
                start: e.start.dateTime,
                end: e.end.dateTime
            }));

        return findAvailableSlots(busySlots, daysAhead);

    } catch (error) {
        console.error('[Calendar Events] Error:', error);
        return null;
    }
}

function findAvailableSlots(busySlots, daysAhead) {
    const slots = [];
    const now = new Date();

    for (let d = 0; d < daysAhead && slots.length < 6; d++) {
        const date = new Date(now);
        date.setDate(date.getDate() + d);

        if (date.getDay() === 0 || date.getDay() === 6) continue;

        const dayStr = date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
        const possibleHours = [9, 10, 11, 14, 15, 16];

        for (const hour of possibleHours) {
            if (slots.length >= 6) break;

            const slotStart = new Date(date);
            slotStart.setHours(hour, 0, 0, 0);

            if (slotStart <= now) continue;

            const slotEnd = new Date(slotStart);
            slotEnd.setHours(hour + 1);

            const isBusy = busySlots.some(busy => {
                const busyStart = new Date(busy.start);
                const busyEnd = new Date(busy.end);
                return slotStart < busyEnd && slotEnd > busyStart;
            });

            if (!isBusy) {
                slots.push({
                    date: dayStr,
                    time: `${hour}h`,
                    datetime: slotStart.toISOString()
                });
            }
        }
    }

    return slots;
}

function formatAvailabilityForPrompt(slots) {
    if (!slots || slots.length === 0) {
        return "Disponibilités non accessibles - proposer de vérifier ensemble les disponibilités";
    }

    let text = "DISPONIBILITÉS DU CONSEILLER (prochains jours):\n";
    const byDate = {};

    slots.forEach(s => {
        if (!byDate[s.date]) byDate[s.date] = [];
        byDate[s.date].push(s.time);
    });

    Object.entries(byDate).forEach(([date, times]) => {
        text += `• ${date}: ${times.join(', ')}\n`;
    });

    return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE - Réponses SMS/Email contextuelles (format Claude-compatible)
// ═══════════════════════════════════════════════════════════════════════════

async function handleGenerate(body, apiKey, googleToken) {
    const { client, sms, emails, calls, objectif, channel = 'sms', inline_mode = false } = body;

    if (!client) {
        return jsonResponse({ error: 'Client data required' }, 400);
    }

    let availability = null;
    if (googleToken) {
        availability = await getCalendarAvailability(googleToken);
    }

    const lastMessage = sms?.inbound?.[sms.inbound.length - 1]?.text?.toLowerCase() || '';
    const isReschedule = /annul|reporter|déplacer|replanifier|pas dispo|empêchement|report/.test(lastMessage);

    const systemPrompt = `${VIP_SYSTEM_PROMPT}

CONTEXTE DU CLIENT:
- Prénom: ${client.prenom || 'Client'}
- Nom: ${client.nom || ''}
- Type: ${client.type_contact || 'prospect'}
- Statut du lead: ${client.statut_lead || 'Nouveau Lead'}
- Objectif actuel: ${objectif || 'Avancer dans le processus de vente'}

${availability ? formatAvailabilityForPrompt(availability) : ''}

HISTORIQUE DES COMMUNICATIONS:
${formatSmsHistory(sms)}
${formatEmailHistory(emails)}
${formatCallsHistory(calls)}

INSTRUCTIONS SPÉCIFIQUES:
${isReschedule ? `
⚠️ LE CLIENT SOUHAITE ANNULER OU REPORTER - UTILISE LES DISPONIBILITÉS CI-DESSUS
- Reste positif et compréhensif
- Propose 2-3 créneaux spécifiques de ta liste de disponibilités
- Ne mets aucune pression
- Confirme que c'est facile de replanifier
` : ''}
${inline_mode ? `
MODE RÉPONSE DIRECTE:
Tu réponds DIRECTEMENT au dernier message ${channel === 'email' ? 'email' : 'SMS'} du client.
Génère des RÉPLIQUES DIRECTES basées sur le contenu exact de son message.
Ne génère PAS de messages génériques ou d'approche commerciale.
Lis les échanges récents ci-dessus et réponds de manière contextuelle.
` : ''}

GÉNÈRE 3 SUGGESTIONS DE RÉPONSE ${channel === 'email' ? 'EMAIL' : 'SMS'}:
1. "friendly": Ton amical, tutoiement, chaleureux (${channel === 'sms' ? 'max 280 caractères' : 'email structuré'})
2. "professional": Vouvoiement, formel mais chaleureux
3. "short": Bref et efficace (${channel === 'sms' ? 'max 160 caractères' : 'email concis'})

RÉPONDS EN JSON UNIQUEMENT:
{
  "suggestions": [
    { "type": "friendly", "text": "..." },
    { "type": "professional", "text": "..." },
    { "type": "short", "text": "..." }
  ],
  "intent_detected": "description de l'intention détectée",
  "objection_detected": "type d'objection si applicable (confiance/besoin/budget/engagement) ou null",
  "recommended_action": "prochaine action suggérée",
  "availability_used": ${availability ? 'true' : 'false'}
}`;

    const userPrompt = `Génère 3 suggestions de ${channel === 'email' ? 'réponse email' : 'réponse SMS'} pour ce client.
${isReschedule ? 'Le client veut reporter/annuler - propose des disponibilités concrètes.' : ''}
Applique l'approche VIP et la méthode AIO si tu détectes une objection.`;

    const response = await callGemini(systemPrompt, userPrompt, apiKey, 2500, 'application/json');

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (availability) {
                parsed.calendar_slots = availability;
            }
            return jsonResponse(parsed);
        }
    } catch (e) {
        console.error('[Gemini] JSON parse error:', e);
    }

    return jsonResponse({
        suggestions: [
            { type: 'friendly', text: `Bonjour ${client.prenom || ''}! 😊 Comment puis-je t'aider aujourd'hui?` },
            { type: 'professional', text: `Bonjour ${client.prenom || ''},\n\nJe me tiens à votre disposition.\n\nCordialement,\nDany Michaud\nFinox` },
            { type: 'short', text: `Bonjour ${client.prenom || ''}! Une question?` }
        ],
        intent_detected: 'Non détecté',
        recommended_action: 'Faire un suivi'
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// OBJECTION - Gérer une objection spécifique avec méthode AIO
// ═══════════════════════════════════════════════════════════════════════════

async function handleObjection(body, apiKey, googleToken) {
    const { client, objection_text, objection_type, context, channel = 'sms' } = body;

    if (!client || !objection_text) {
        return jsonResponse({ error: 'Client and objection_text required' }, 400);
    }

    let availability = null;
    if (googleToken) {
        availability = await getCalendarAvailability(googleToken);
    }

    const systemPrompt = `${VIP_SYSTEM_PROMPT}

🎯 MISSION: Répondre à cette objection avec la méthode AIO

CLIENT:
- Prénom: ${client.prenom || 'Client'}
- Statut: ${client.statut_lead || 'Prospect'}

OBJECTION REÇUE: "${objection_text}"
${objection_type ? `TYPE IDENTIFIÉ: ${objection_type}` : ''}

${context ? `CONTEXTE ADDITIONNEL: ${context}` : ''}

${availability ? formatAvailabilityForPrompt(availability) : ''}

GÉNÈRE UNE RÉPONSE AIO EN 3 PARTIES + SUGGESTIONS:

RÉPONDS EN JSON:
{
  "aio_response": {
    "acknowledge": "Phrase de validation de l'émotion/préoccupation",
    "isolate": "Question pour identifier la vraie cause",
    "overcome": "Réponse ciblée + micro-action proposée"
  },
  "root_cause": "confiance|besoin|budget|engagement",
  "suggestions": [
    { "type": "friendly", "text": "Message complet intégrant AIO - ton amical" },
    { "type": "professional", "text": "Message complet intégrant AIO - vouvoiement" },
    { "type": "short", "text": "Version courte percutante" }
  ],
  "follow_up_question": "Question de suivi suggérée si le client ne répond pas",
  "urgency_hook": "Phrase de recadrage pour créer l'urgence sans pression"
}`;

    const response = await callGemini(systemPrompt, `Traite cette objection: "${objection_text}"`, apiKey, 2500, 'application/json');

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return jsonResponse(JSON.parse(jsonMatch[0]));
        }
    } catch (e) {
        console.error('[Gemini] JSON parse error:', e);
    }

    return jsonResponse({
        error: 'Impossible de générer une réponse structurée',
        raw_response: response
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY - Résumé global du dossier client (approche VIP)
// ═══════════════════════════════════════════════════════════════════════════

async function handleSummary(body, apiKey) {
    const { client, abf_data, assurances, timeline, sms, emails } = body;

    if (!client) {
        return jsonResponse({ error: 'Client data required' }, 400);
    }

    const systemPrompt = `Tu es l'assistant expert de Dany Michaud, conseiller Finox.

Génère un RÉSUMÉ EXÉCUTIF VIP du dossier pour préparer la prochaine interaction.

OBJECTIFS:
1. Comprendre rapidement la situation du client
2. Identifier les besoins et opportunités
3. Anticiper les objections possibles
4. Préparer des talking points personnalisés

FORMAT ATTENDU (Markdown):
## 👤 Profil Client
[Résumé en 2-3 lignes]

## 📊 Situation Actuelle
- Points clés

## 🎯 Besoins Identifiés
- Liste priorisée

## 🛡️ Couvertures Actuelles
- Ce qui est en place (ou "Aucune protection actuellement")

## ⚠️ Lacunes & Opportunités
- Gaps de couverture
- Opportunités de vente

## 🚀 Actions Recommandées
1. Action prioritaire
2. Suivi à faire

## 💬 Talking Points VIP
- Points personnalisés pour la prochaine conversation
- Objections anticipées et réponses préparées

## 📌 Points d'Attention
- Signaux à surveiller`;

    const userPrompt = `DOSSIER CLIENT:

INFORMATIONS:
${JSON.stringify(client, null, 2)}

${abf_data ? `ABF:\n${JSON.stringify(abf_data, null, 2)}` : 'Aucune ABF'}

${assurances?.length ? `ASSURANCES:\n${JSON.stringify(assurances, null, 2)}` : 'Aucune assurance'}

${timeline?.length ? `TIMELINE (10 dernières):\n${timeline.slice(0, 10).map(t => `- ${t.activity_type}: ${t.title}`).join('\n')}` : ''}

COMMUNICATIONS: ${sms?.total || 0} SMS, ${emails?.total || 0} emails

Génère le résumé exécutif VIP.`;

    const response = await callGemini(systemPrompt, userPrompt, apiKey, 3500);

    return jsonResponse({
        summary: response,
        generated_at: new Date().toISOString()
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// LETTER - Lettre explicative conformité AMF
// ═══════════════════════════════════════════════════════════════════════════

async function handleLetter(body, apiKey) {
    const { prompt, systemPrompt: customSystemPrompt } = body;

    if (!prompt) {
        return jsonResponse({ error: 'Prompt required' }, 400);
    }

    const defaultSystemPrompt = `Tu es un expert en conformité AMF et assurance au Québec.
Tu rédiges des lettres explicatives professionnelles pour les clients.
Tes lettres doivent être claires, complètes et conformes aux exigences de l'AMF.
Utilise un ton professionnel mais accessible.`;

    const response = await callGemini(
        customSystemPrompt || defaultSystemPrompt,
        prompt,
        apiKey,
        4000
    );

    return jsonResponse({
        content: [{ text: response }]
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYZE - Parser les infos du portail assureur (Inbox AI)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIBE - Transcrire un fichier audio avec Gemini
// ═══════════════════════════════════════════════════════════════════════════

async function handleTranscribe(body, apiKey) {
    const { audio_base64, mime_type, filename } = body;

    if (!audio_base64) {
        return jsonResponse({ error: 'audio_base64 requis' }, 400);
    }

    const mimeType = mime_type || 'audio/mpeg';

    const systemPrompt = `Tu es un expert en transcription audio en français québécois.

🎯 MISSION: Transcris INTÉGRALEMENT l'audio fourni en texte, du début à la fin.

📋 RÈGLES:
- Transcris ABSOLUMENT TOUT ce qui est dit, mot pour mot, du début à la toute fin de l'audio
- NE T'ARRÊTE PAS après quelques minutes — continue jusqu'à la FIN COMPLÈTE de l'enregistrement
- Identifie les différents interlocuteurs (Conseiller, Client, Conjoint, etc.) et préfixe chaque intervention
- Format: "Conseiller: ..." puis "Client: ..." etc.
- Garde les expressions québécoises telles quelles (tsé, faque, pis, etc.)
- Transcris les chiffres en format numérique (300 000 $, 36,49 $/mois)
- Si un mot est inaudible, mets [inaudible]
- Ajoute des paragraphes pour la lisibilité
- N'ajoute PAS de résumé ou d'analyse — juste la transcription brute
- IMPORTANT: La transcription doit couvrir 100% de l'audio, pas seulement les premières minutes`;

    try {
        // Step 1: Upload file to Gemini File API
        console.log('[Gemini Transcribe] Uploading file via File API...');
        const binaryData = Uint8Array.from(atob(audio_base64), c => c.charCodeAt(0));

        const uploadResp = await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': mimeType,
                    'X-Goog-Upload-Protocol': 'raw',
                    'X-Goog-Upload-Command': 'upload, finalize',
                    'X-Goog-Upload-Header-Content-Type': mimeType,
                    'X-Goog-Upload-Offset': '0'
                },
                body: binaryData
            }
        );

        if (!uploadResp.ok) {
            const uploadError = await uploadResp.text();
            console.error('[Gemini Transcribe] Upload error:', uploadResp.status, uploadError);
            throw new Error(`File upload error: ${uploadResp.status}`);
        }

        const uploadData = await uploadResp.json();
        const fileUri = uploadData.file?.uri;
        const fileName = uploadData.file?.name;

        if (!fileUri) {
            throw new Error('File upload failed — no URI returned');
        }

        console.log('[Gemini Transcribe] File uploaded:', fileName, fileUri);

        // Step 2: Wait for file processing (poll status)
        let fileReady = false;
        for (let i = 0; i < 30; i++) {
            const statusResp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`
            );
            if (statusResp.ok) {
                const statusData = await statusResp.json();
                if (statusData.state === 'ACTIVE') {
                    fileReady = true;
                    break;
                }
                console.log('[Gemini Transcribe] File state:', statusData.state, '— waiting...');
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!fileReady) {
            throw new Error('File processing timeout — try a smaller file');
        }

        // Step 3: Generate transcription using file reference
        console.log('[Gemini Transcribe] Generating transcription...');
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                file_data: {
                                    mime_type: mimeType,
                                    file_uri: fileUri
                                }
                            },
                            {
                                text: 'Transcris intégralement cet audio en français, du DÉBUT à la FIN COMPLÈTE. Identifie les interlocuteurs. Transcription mot pour mot complète, pas de résumé, ne t\'arrête pas avant la fin de l\'audio.'
                            }
                        ]
                    }],
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    generationConfig: {
                        maxOutputTokens: 65000,
                        temperature: 0.1
                    }
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Gemini Transcribe] API error:', response.status, errorText);
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!transcript) {
            throw new Error('Aucune transcription générée');
        }

        // Step 4: Cleanup — delete uploaded file
        try {
            await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`, { method: 'DELETE' });
        } catch (e) { /* ignore cleanup errors */ }

        console.log('[Gemini Transcribe] Done —', transcript.length, 'chars');

        return jsonResponse({
            content: [{ text: transcript }],
            transcript: transcript
        });

    } catch (error) {
        console.error('[Gemini Transcribe] Error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}

async function handleAnalyze(body, apiKey) {
    const { text, type = 'portal_lead', org_id } = body;

    if (!text || text.trim().length < 10) {
        return jsonResponse({ error: 'Text content required (minimum 10 characters)' }, 400);
    }

    const systemPrompt = `Tu es un assistant expert en extraction de données pour un CRM d'assurance au Québec.

🎯 MISSION: Extraire les informations d'un lead/client à partir de texte brut copié depuis:
- Portails assureurs (iA, Desjardins, Manuvie, Empire, Beneva, Canada Vie, etc.)
- Emails de leads
- Notes manuscrites
- Formulaires de contact

📋 INFORMATIONS À EXTRAIRE:
1. NOM COMPLET (prénom + nom de famille)
2. TÉLÉPHONE (format: 514-555-1234)
3. EMAIL
4. PRODUIT D'INTÉRÊT (vie, invalidité, maladie grave, hypothèque, etc.)
5. MONTANT DE COUVERTURE
6. PRIME SUGGÉRÉE (si mentionnée)
7. NOTES IMPORTANTES
8. ASSUREUR SOURCE (si identifiable)
9. NUMÉRO DE DOSSIER/CONTRAT (si mentionné)

🔍 RÈGLES D'EXTRACTION:
- Sois flexible avec les formats de nom (Tremblay, Jean = Jean Tremblay)
- Nettoie les numéros de téléphone (garde seulement les chiffres + tirets)
- Identifie le type de produit même si formulé différemment
- Si une info n'est pas trouvée, mets null (pas de string vide)
- Le prénom et nom doivent être séparés si possible

⚠️ IMPORTANT:
- Ne devine PAS les informations manquantes
- Si tu n'es pas sûr, mets null
- Confidence: 0.0 à 1.0 selon la qualité de l'extraction

RÉPONDS UNIQUEMENT EN JSON VALIDE:
{
  "success": true,
  "data": {
    "firstName": "string ou null",
    "lastName": "string ou null",
    "fullName": "string complet",
    "phone": "string formaté ou null",
    "email": "string ou null",
    "product": "string ou null",
    "productType": "vie|invalidite|maladie_grave|hypotheque|collective|autre",
    "coverageAmount": "string ou null",
    "premium": "string ou null",
    "insurerSource": "string ou null",
    "contractNumber": "string ou null",
    "notes": "string ou null",
    "confidence": 0.0,
    "extractedFields": ["liste des champs trouvés"],
    "suggestedAction": "create_lead|update_existing|need_more_info"
  }
}`;

    const userPrompt = `TEXTE À ANALYSER:
---
${text}
---

Extrais toutes les informations pertinentes pour créer ou mettre à jour un dossier client.`;

    try {
        const response = await callGemini(systemPrompt, userPrompt, apiKey, 1500, 'application/json');

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return jsonResponse(parsed);
        }

        return jsonResponse({
            success: false,
            error: 'Could not parse AI response',
            raw: response
        });

    } catch (error) {
        console.error('[Analyze] Error:', error);
        return jsonResponse({
            success: false,
            error: error.message
        }, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GEMINI API CALLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Appeler Gemini Flash 2.0
 * Gemini n'a pas de "system" séparé comme Claude — on le met dans le premier message
 * avec role: "user" suivi du prompt réel, ou on utilise systemInstruction
 */
async function callGemini(systemPrompt, userPrompt, apiKey, maxTokens = 2000, responseMimeType = null) {
    const geminiUrl = `${GEMINI_API_URL}?key=${apiKey}`;

    // Combiner system + user dans un seul prompt (format prouvé par email-watcher)
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    const requestBody = {
        contents: [{
            parts: [{ text: combinedPrompt }]
        }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: maxTokens,
            topP: 0.95,
            topK: 40
        }
    };

    // Si on attend du JSON, forcer le responseMimeType
    if (responseMimeType) {
        requestBody.generationConfig.responseMimeType = responseMimeType;
    }

    console.log(`[Gemini] Calling API, prompt length: ${combinedPrompt.length}, maxTokens: ${maxTokens}`);

    const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Gemini] API error ${response.status}:`, errorText.substring(0, 500));
        throw new Error(`Gemini API error: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    if (data.error) {
        console.error('[Gemini] Response error:', data.error);
        throw new Error(data.error.message || 'Gemini API error');
    }

    // Extraire le texte de la réponse Gemini
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const finishReason = data.candidates?.[0]?.finishReason;

    if (!text) {
        console.error('[Gemini] Empty response, finishReason:', finishReason, JSON.stringify(data).substring(0, 300));
        if (finishReason === 'SAFETY') {
            throw new Error('Réponse bloquée par les filtres de sécurité Gemini');
        }
        throw new Error('Réponse vide de Gemini (finishReason: ' + (finishReason || 'unknown') + ')');
    }

    // Détecter les réponses tronquées par le token limit
    if (finishReason === 'MAX_TOKENS') {
        console.warn(`[Gemini] ⚠️ Response TRUNCATED (MAX_TOKENS hit), response length: ${text.length}, maxTokens was: ${maxTokens}`);
    }

    console.log(`[Gemini] Success, response length: ${text.length}, finishReason: ${finishReason}`);
    return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatSmsHistory(sms) {
    if (!sms) return 'Aucun SMS';

    let result = `SMS (${sms.total || 0} total):\n`;

    if (sms.inbound?.length) {
        result += 'Derniers messages REÇUS du client:\n';
        sms.inbound.forEach(m => {
            result += `  → "${m.text}" (${formatDate(m.date)})\n`;
        });
    }

    if (sms.outbound?.length) {
        result += 'Derniers messages ENVOYÉS:\n';
        sms.outbound.forEach(m => {
            result += `  ← "${m.text?.substring(0, 100)}..." (${formatDate(m.date)})\n`;
        });
    }

    return result;
}

function formatEmailHistory(emails) {
    if (!emails || !emails.total) return 'Aucun email';

    let result = `Emails (${emails.total} total):\n`;
    if (emails.lastExchanges?.length) {
        result += 'Derniers échanges:\n';
        emails.lastExchanges.forEach(e => {
            const dir = e.direction === 'inbound' ? 'Client →' : 'Vous →';
            result += `  ${dir} [${e.subject}]: "${e.snippet}" (${formatDate(e.date)})\n`;
        });
    } else if (emails.lastSubjects?.length) {
        result += 'Derniers sujets:\n';
        emails.lastSubjects.forEach(s => {
            result += `  - ${s}\n`;
        });
    }

    return result;
}

function formatCallsHistory(calls) {
    if (!calls) return 'Aucun appel/rencontre';

    let result = `Appels/Rencontres (${calls.total || 0} total):\n`;

    if (calls.summaries?.length) {
        calls.summaries.forEach(c => {
            result += `  - ${c.type}: ${c.title}\n`;
            if (c.description) {
                result += `    → ${c.description.substring(0, 150)}...\n`;
            }
        });
    }

    return result;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        return new Date(dateStr).toLocaleDateString('fr-CA', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: CORS_HEADERS
    });
}
