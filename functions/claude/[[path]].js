/**
 * FINOX Claude AI Pages Function
 * Assistant AI contextuel pour le CRM - Approche VIP + Méthode AIO
 *
 * Endpoints:
 * - POST /claude/generate - Générer des réponses SMS/Email contextuelles
 * - POST /claude/summary - Générer un résumé du dossier client
 * - POST /claude/objection - Gérer une objection avec méthode AIO
 * - POST /claude/letter - Générer une lettre explicative (conformité AMF)
 * - GET  /claude/health - Health check
 *
 * Variables d'environnement requises:
 * - CLAUDE_API_KEY: Clé API Anthropic
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Google-Token',
    'Content-Type': 'application/json'
};

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// ═══════════════════════════════════════════════════════════════════════════
// NOTES AMF — Prompt conforme au template officiel Finox
// ═══════════════════════════════════════════════════════════════════════════

const AMF_NOTES_SYSTEM_PROMPT = `Tu génères des notes au dossier en français, professionnelles et conformes aux attentes d'un inspecteur de l'AMF (Autorité des marchés financiers du Québec), à partir d'un transcript d'appel ou de rencontre client.

FORMATAGE CRITIQUE — À RESPECTER ABSOLUMENT:
- TEXTE BRUT seulement. AUCUN Markdown. Jamais de ** ni de ## ni de __ ni de backticks.
- Pour les titres de section, utilise des majuscules simples sur une ligne séparée (ex: INTRODUCTION, SITUATION PERSONNELLE, etc.)
- Sépare chaque section par une ligne vide
- Rédige en PARAGRAPHES fluides et agréables à lire (pas de bullet points, pas de listes à tirets)

STYLE:
- Professionnel mais lisible — la note doit être agréable à parcourir, pas un mur de texte robotique
- Langage clair, neutre et factuel
- Phrases bien construites, vocabulaire varié
- Évite toute promotion : pas de "produit intéressant", "bon prix", "meilleur produit"
- Tout ce qui est dit doit démontrer : les besoins du client, l'analyse du conseiller, la compréhension et décision du client

STRUCTURE (TOUJOURS DANS CET ORDRE — chaque section commence par son titre en MAJUSCULES sur sa propre ligne):

INTRODUCTION
Date, type de rencontre, participants, objectif de l'échange. Ce paragraphe résume l'essentiel de la rencontre en 2-3 phrases.

SITUATION PERSONNELLE ET FINANCIÈRE
Âge, emploi, statut familial, dettes/actifs connus. Contexte déclencheur.

BESOINS EXPRIMÉS PAR LE CLIENT
Ce que le client cherche à protéger, sécuriser, éviter. Budget mentionné si applicable.

ANALYSE DU CONSEILLER
Ce qui a été analysé, éléments pris en compte, besoin théorique estimé.

OPTIONS PRÉSENTÉES
Produits ou structures expliquées, avantages/limites selon le profil. Aucune préférence personnelle.

RECOMMANDATION PROPOSÉE
Ce qui est recommandé et pourquoi (justifier par faits et besoins).

DÉCISION DU CLIENT
Ce que le client retient ou refuse. Justification si choix différent de la recommandation. Mention que le client comprend et accepte.

PROCHAINES ÉTAPES
Ce qui reste à faire (questionnaire, documents, soumission, suivi).

Si des ANTÉCÉDENTS MÉDICAUX sont discutés dans le transcript, ajouter une section:
ANTÉCÉDENTS MÉDICAUX DÉCLARÉS
Détails pertinents pour l'assurabilité.

MOTS INTERDITS → REMPLACER PAR:
- "meilleur produit" → "produit présenté"
- "ça vaut vraiment la peine" → "option expliquée au client"
- "j'ai conseillé fortement" → "il a été recommandé de..."
- "le client a été convaincu" → "le client a confirmé sa compréhension"
- "assurance trop chère" → "non retenue en raison du budget"

RÈGLES ABSOLUES:
- ZÉRO Markdown. Pas de ** ni ## ni __ — c'est du texte brut pour affichage dans un CRM.
- N'invente AUCUNE information absente du transcript
- Si incertaine: "[à confirmer]"
- Montants exacts du transcript uniquement
- Noms de compagnies exacts
- Si une section n'est pas couverte, l'omettre
- Note les détails médicaux si mentionnés`;

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
    // Handle both /claude and /claude/ and /claude/action
    const cleanPath = url.pathname.replace(/^\/claude\/?/, '');
    const pathParts = cleanPath.split('/').filter(Boolean);
    const action = pathParts[0]; // undefined si juste /claude

    try {
        if (action === 'health') {
            return jsonResponse({
                status: 'ok',
                service: 'FINOX Claude AI Assistant - VIP Mode',
                features: ['generate', 'summary', 'objection', 'letter', 'analyze', 'calendar'],
                model: CLAUDE_MODEL,
                timestamp: new Date().toISOString()
            });
        }

        const CLAUDE_API_KEY = env.CLAUDE_API_KEY;
        if (!CLAUDE_API_KEY) {
            return jsonResponse({ error: 'CLAUDE_API_KEY non configurée' }, 500);
        }

        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        const body = await request.json();
        const googleToken = request.headers.get('X-Google-Token');

        // Support both URL path routing (/claude/generate) and body action ({action: 'generate'})
        const resolvedAction = action || body.action;

        switch (resolvedAction) {
            case 'generate':
                return await handleGenerate(body, CLAUDE_API_KEY, googleToken);
            case 'summary':
                return await handleSummary(body, CLAUDE_API_KEY);
            case 'dossier_summary':
                return await handleDossierSummary(body, CLAUDE_API_KEY);
            case 'objection':
                return await handleObjection(body, CLAUDE_API_KEY, googleToken);
            case 'letter':
                return await handleLetter(body, CLAUDE_API_KEY);
            case 'analyze':
                return await handleAnalyze(body, CLAUDE_API_KEY);
            case 'soumission':
                return await handleSoumission(body, CLAUDE_API_KEY);
            case 'notes_amf':
                return await handleNotesAMF(body, CLAUDE_API_KEY);
            case 'clean_transcript':
                return await handleCleanTranscript(body, CLAUDE_API_KEY);
            default:
                return jsonResponse({ error: 'Unknown action: ' + resolvedAction }, 400);
        }

    } catch (error) {
        console.error('[Claude API] Error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
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
            // Fallback: essayer de récupérer les événements directement
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

        // Convertir les événements en busy slots
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

    // Heures de travail: 9h à 17h
    const workStart = 9;
    const workEnd = 17;

    for (let d = 0; d < daysAhead && slots.length < 6; d++) {
        const date = new Date(now);
        date.setDate(date.getDate() + d);

        // Skip weekends
        if (date.getDay() === 0 || date.getDay() === 6) continue;

        const dayStr = date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

        // Créneaux possibles: 9h, 10h, 11h, 14h, 15h, 16h
        const possibleHours = [9, 10, 11, 14, 15, 16];

        for (const hour of possibleHours) {
            if (slots.length >= 6) break;

            const slotStart = new Date(date);
            slotStart.setHours(hour, 0, 0, 0);

            // Skip si dans le passé
            if (slotStart <= now) continue;

            const slotEnd = new Date(slotStart);
            slotEnd.setHours(hour + 1);

            // Vérifier si le créneau est libre
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
// GENERATE - Réponses SMS/Email contextuelles avec calendrier
// ═══════════════════════════════════════════════════════════════════════════

async function handleGenerate(body, apiKey, googleToken) {
    const { client, sms, emails, calls, objectif, channel = 'sms', inline_mode = false } = body;

    if (!client) {
        return jsonResponse({ error: 'Client data required' }, 400);
    }

    // Récupérer les disponibilités si token Google fourni
    let availability = null;
    if (googleToken) {
        availability = await getCalendarAvailability(googleToken);
    }

    // Détecter si c'est une situation d'annulation/report
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
Applique l\'approche VIP et la méthode AIO si tu détectes une objection.`;

    const response = await callClaude(systemPrompt, userPrompt, apiKey, 2500);

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            // Ajouter les disponibilités brutes si disponibles
            if (availability) {
                parsed.calendar_slots = availability;
            }
            return jsonResponse(parsed);
        }
    } catch (e) {
        console.error('[Claude] JSON parse error:', e);
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

    const response = await callClaude(systemPrompt, `Traite cette objection: "${objection_text}"`, apiKey, 2500);

    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return jsonResponse(JSON.parse(jsonMatch[0]));
        }
    } catch (e) {
        console.error('[Claude] JSON parse error:', e);
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

    const response = await callClaude(systemPrompt, userPrompt, apiKey, 3500);

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

    const response = await callClaude(
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
    "confidence": 0.0-1.0,
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
        const response = await callClaude(systemPrompt, userPrompt, apiKey, 1500);

        // Essayer de parser le JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return jsonResponse(parsed);
        }

        // Fallback si pas de JSON valide
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
// DOSSIER SUMMARY - Format sideload (Manni AI popup)
// ═══════════════════════════════════════════════════════════════════════════

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

    const response = await callClaude(systemPrompt, userPrompt, apiKey, 1500);

    return jsonResponse({
        reply: response.trim(),
        response: response.trim(),
        text: response.trim()
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SOUMISSION - Générer un courriel de soumission à partir d'un transcript
// ═══════════════════════════════════════════════════════════════════════════

async function handleSoumission(body, apiKey) {
    const { transcript, clientInfo, conseillerName } = body;

    if (!transcript || transcript.trim().length < 50) {
        return jsonResponse({ error: 'Transcript requis (minimum 50 caractères)' }, 400);
    }

    const systemPrompt = `Tu es un conseiller en sécurité financière au Québec. Tu rédiges des courriels de soumission d'assurance professionnels et chaleureux à envoyer aux clients après une rencontre.

🎯 MISSION: À partir du transcript de la rencontre et des informations du client, rédige un courriel de soumission complet et détaillé.

⛔ RÈGLE ABSOLUE DE FORMATAGE:
- N'utilise JAMAIS de Markdown. Pas de **, pas de ##, pas de __, pas de \`backticks\`, pas de [liens](url).
- Le courriel sera copié-collé directement dans un email. Il doit être en TEXTE BRUT avec emojis seulement.
- Pour mettre en valeur un titre de section, utilise des emojis et des majuscules (ex: "🟢 Option #1 – Assurance vie temporaire 25 ans")
- Pour les sous-titres, utilise des emojis (ex: "👩 Marie (20 avril 1998, non-fumeuse)")
- Ne mets AUCUNE balise HTML non plus.

📋 FORMAT DU COURRIEL:
1. Salutation personnalisée — Utilise le prénom du client, remercie pour la rencontre, ajoute un petit commentaire personnel relié à la discussion (joke, référence, félicitations)
2. Contexte — Rappelle brièvement le besoin discuté (hypothèque, famille, etc.)
3. Options détaillées — Pour chaque option discutée:
   - Commence par 🟢 Option #1 – [Nom du produit] ([Assureur])
   - Pour chaque personne couverte: 👩 ou 👨 + prénom + détails (date de naissance, fumeur/non-fumeur)
   - ✔ Type de produit
   - ✔ Montant de couverture
   - ✔ Avec/sans examen médical
   - ✔ Prime mensuelle : XX,XX $
   - Section "Pourquoi cette stratégie? ✅" avec des 🔹 points d'avantages
4. 📌 Résumé des coûts — Total mensuel clair avec détail par produit
5. 📧 Prochaine étape — Invitation à réfléchir, se reparler, poser des questions, ton amical et sans pression

🎨 STYLE:
- Ton professionnel mais chaleureux, amical et humain — comme si tu parlais à un ami
- Ajoute des petites touches personnelles reliées à la conversation (si le client a mentionné ses enfants, son travail, un événement, fais-y référence naturellement)
- Tutoiement si le transcript montre du tutoiement, sinon vouvoiement
- Utilise des emojis stratégiquement mais naturellement (🟢🟡🔵 pour les options, ✔ pour les détails, 🔹 pour les avantages, 💰 pour les totaux, 📧 pour les étapes, 😊 👍 pour le ton)
- Félicite le client si approprié (achat maison, naissance, retraite, etc.)
- Sois précis avec les chiffres — utilise EXACTEMENT ceux mentionnés dans le transcript
- Ne mets PAS "Objet:" au début — commence directement par "Bonjour [Prénom],"
- Termine avec le nom complet du conseiller et "Conseiller en sécurité financière"
- Mentionne "(Aucune taxe et frais de police inclus.)" après le total si approprié

⚠️ IMPORTANT:
- N'invente AUCUN chiffre. Si un montant n'est pas clair dans le transcript, mets "à confirmer"
- Utilise les noms exacts des compagnies d'assurance mentionnées dans le transcript
- Si le transcript mentionne des objections ou préoccupations du client, adresse-les subtilement dans les avantages
- Le courriel doit donner envie au client de revenir vers le conseiller sans être pushy
- RAPPEL: PAS de Markdown (**, ##, __, etc.) — texte brut avec emojis uniquement`;

    const clientContext = clientInfo
        ? `\n\n📇 INFORMATIONS CLIENT CONNUES:\n${clientInfo}`
        : '';

    const conseiller = conseillerName || 'Le conseiller';

    const userPrompt = `Voici le transcript de ma rencontre avec le client. Rédige le courriel de soumission.${clientContext}

👤 NOM DU CONSEILLER: ${conseiller}

📝 TRANSCRIPT DE LA RENCONTRE:
---
${transcript}
---

Rédige maintenant le courriel de soumission complet.`;

    const response = await callClaude(
        systemPrompt,
        userPrompt,
        apiKey,
        6000 // Soumissions are long
    );

    return jsonResponse({
        content: [{ text: response }]
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTES AMF - Générer des notes de suivi conformité à partir d'un transcript
// ═══════════════════════════════════════════════════════════════════════════

async function handleNotesAMF(body, apiKey) {
    const { transcript, clientInfo, conseillerName } = body;

    if (!transcript || transcript.trim().length < 50) {
        return jsonResponse({ error: 'Transcript requis (minimum 50 caractères)' }, 400);
    }

    const systemPrompt = AMF_NOTES_SYSTEM_PROMPT;

    const clientContext = clientInfo
        ? `\n\nINFORMATIONS CLIENT CONNUES:\n${clientInfo}`
        : '';

    const conseiller = conseillerName || 'Le conseiller';

    const userPrompt = `Génère la note au dossier AMF à partir de ce transcript.${clientContext}

CONSEILLER: ${conseiller}

TRANSCRIPT DE L'APPEL/RENCONTRE:
---
${transcript}
---

Rédige maintenant la note au dossier.`;

    const response = await callClaude(
        systemPrompt,
        userPrompt,
        apiKey,
        4000
    );

    return jsonResponse({
        content: [{ text: response }]
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEAN TRANSCRIPT - Nettoyer et corriger un transcript Whisper
// ═══════════════════════════════════════════════════════════════════════════

async function handleCleanTranscript(body, apiKey) {
    const { transcript } = body;

    if (!transcript || transcript.trim().length < 50) {
        return jsonResponse({ error: 'Transcript requis (minimum 50 caractères)' }, 400);
    }

    const systemPrompt = `Tu es un correcteur de transcription spécialisé en assurance et services financiers au Québec.

🎯 MISSION: Corrige UNIQUEMENT les erreurs de transcription évidentes. NE MODIFIE PAS le sens des phrases.

📋 RÈGLES:
- Corrige les fautes de transcription évidentes (mots mal captés par Whisper)
- Utilise ce dictionnaire de noms de compagnies: Desjardins, Beneva, UV Assurance, UV Mutuelle, Équitable, iA Groupe financier, Industrielle Alliance, Manuvie, SSQ, Sun Life, Canada Vie, BMO Assurance, Empire Vie, RBC Assurance, Humania, Foresters
- Corrige les noms propres courants en assurance: REÉÉ (RESP), CÉLI (TFSA), FERR, REER, RAP, testament
- Garde les expressions québécoises telles quelles (tsé, faque, pis, bin, anyway)
- Si un mot est incertain, garde l'original et ajoute [?]
- NE JAMAIS ajouter d'information qui n'est pas dans le transcript
- NE JAMAIS changer le sens ou reformuler
- Garde la même structure (paragraphes, speakers, etc.)
- Format les montants correctement: 300 000 $, 36,49 $/mois, 25 $

⛔ INTERDIT:
- Ajouter des résumés ou analyses
- Supprimer des parties du transcript
- Reformuler les phrases
- Inventer du contenu`;

    const response = await callClaude(
        systemPrompt,
        `Corrige les erreurs de transcription dans ce transcript:\n\n${transcript}`,
        apiKey,
        8000
    );

    return jsonResponse({
        content: [{ text: response }]
    });
}

async function callClaude(systemPrompt, userPrompt, apiKey, maxTokens = 2000) {
    const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message || 'Claude API error');
    }

    return data.content?.[0]?.text || '';
}

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
