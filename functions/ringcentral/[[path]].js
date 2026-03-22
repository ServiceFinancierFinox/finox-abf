/**
 * FINOX RingCentral Pages Function - Multi-Tenant OAuth
 * Gère l'envoi/réception de SMS, appels et présence via RingCentral API
 * Supporte plusieurs conseillers avec leur propre compte RingCentral
 *
 * SÉCURITÉ: Tous les credentials sont stockés dans Cloudflare Environment Variables
 * - RC_CLIENT_ID
 * - RC_CLIENT_SECRET
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 *
 * Endpoints:
 * - GET  /ringcentral/oauth/start      - Démarre le flow OAuth
 * - GET  /ringcentral/oauth/callback   - Callback OAuth (reçoit le code)
 * - POST /ringcentral/oauth/disconnect - Déconnecte RingCentral
 * - POST /ringcentral/sms/send         - Envoyer un SMS
 * - POST /ringcentral/sms/messages     - Récupérer les SMS avec un contact
 * - POST /ringcentral/sms/inbox        - Récupérer tous les SMS entrants récents
 * - POST /ringcentral/sms/read-status  - Marquer messages comme lu/non lu
 * - POST /ringcentral/call-log         - Récupérer l'historique d'appels avec un contact
 * - POST /ringcentral/presence         - Statut de présence (en appel, disponible, etc.)
 * - POST /ringcentral/call-control     - Contrôler un appel (hold/unhold/hangup)
 * - POST /ringcentral/contacts/sync   - Synchroniser un contact CRM vers le carnet RC
 * - GET  /ringcentral/account/info     - Info du compte
 * - GET  /ringcentral/connection/status - Statut de connexion
 * - GET  /ringcentral/health           - Health check
 */

// Configuration RingCentral statique (non-sensible)
const RC_SERVER = 'https://platform.ringcentral.com';
const RC_REDIRECT_URI = 'https://crm.finox.ca/ringcentral/oauth/callback';
const RC_SCOPES = 'ReadAccounts ReadMessages SMS CallControl Contacts ReadCallLog ReadCallRecording';

// ═══════════════════════════════════════════════════════════════
// PAGES FUNCTION - Point d'entrée principal
// ═══════════════════════════════════════════════════════════════
export async function onRequest(context) {
    const { request, env } = context;

    // Récupérer les credentials depuis les variables d'environnement Cloudflare
    const config = {
        rcClientId: env.RC_CLIENT_ID,
        rcClientSecret: env.RC_CLIENT_SECRET,
        supabaseUrl: env.SUPABASE_URL,
        supabaseServiceKey: env.SUPABASE_SERVICE_KEY
    };

    // Vérifier que les variables d'environnement sont définies
    if (!config.rcClientId || !config.rcClientSecret) {
        return jsonResponse({
            error: 'Configuration error',
            message: 'RC_CLIENT_ID et RC_CLIENT_SECRET doivent être définis dans Cloudflare'
        }, {}, 500);
    }

    if (!config.supabaseUrl || !config.supabaseServiceKey) {
        return jsonResponse({
            error: 'Configuration error',
            message: 'SUPABASE_URL et SUPABASE_SERVICE_KEY doivent être définis dans Cloudflare'
        }, {}, 500);
    }

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const route = path.replace('/ringcentral', '');

    try {
        // Routes publiques (pas besoin d'auth)
        if (route === '/health' || path === '/ringcentral/health') {
            return jsonResponse({ status: 'ok', service: 'finox-ringcentral-oauth', version: '2.1-secure' }, corsHeaders);
        }

        // OAuth Start
        if (route === '/oauth/start' || path === '/ringcentral/oauth/start') {
            return await handleOAuthStart(url, corsHeaders, config);
        }

        // OAuth Callback
        if (route === '/oauth/callback' || path === '/ringcentral/oauth/callback') {
            return await handleOAuthCallback(url, corsHeaders, config);
        }

        // ── RC Webhook (public — appelé par les serveurs RC) ──
        if (route === '/webhook' || path === '/ringcentral/webhook') {
            return await handleWebhook(request, corsHeaders, config, env);
        }

        // Extraire le user_id
        let userId = request.headers.get('X-User-Id');

        if (!userId && request.method === 'POST') {
            try {
                const clonedRequest = request.clone();
                const body = await clonedRequest.json();
                userId = body.user_id;
            } catch (_e) {
                // Erreur de parsing ignorée - userId reste null
            }
        }

        if (!userId) {
            userId = url.searchParams.get('user_id');
        }

        // Statut de connexion
        if (route === '/connection/status' || path === '/ringcentral/connection/status') {
            if (!userId) {
                return jsonResponse({ error: 'user_id required' }, corsHeaders, 400);
            }
            return await handleConnectionStatus(userId, corsHeaders, config);
        }

        // Déconnexion
        if ((route === '/oauth/disconnect' || path === '/ringcentral/oauth/disconnect') && request.method === 'POST') {
            if (!userId) {
                return jsonResponse({ error: 'user_id required' }, corsHeaders, 400);
            }
            return await handleDisconnect(userId, corsHeaders, config);
        }

        // Routes SMS (besoin d'une connexion RC active)
        if (!userId) {
            return jsonResponse({ error: 'user_id required for SMS operations' }, corsHeaders, 400);
        }

        const connection = await getRingCentralConnection(userId, config);

        if (!connection) {
            return jsonResponse({
                error: 'RingCentral not connected',
                code: 'RC_NOT_CONNECTED',
                message: 'Veuillez connecter votre compte RingCentral dans les paramètres'
            }, corsHeaders, 401);
        }

        let token;
        try {
            token = await getValidToken(connection, userId, config);
        } catch (tokenError) {
            console.error('[RingCentral] Token refresh failed:', tokenError.message);
            return jsonResponse({
                error: 'RC_TOKEN_EXPIRED',
                code: 'RC_TOKEN_EXPIRED',
                message: 'Session RingCentral expirée. Veuillez vous reconnecter dans Paramètres > Intégrations.'
            }, corsHeaders, 401);
        }

        if ((route === '/sms/send' || path === '/ringcentral/sms/send') && request.method === 'POST') {
            return await handleSendSMS(request, token, connection.rc_phone_number, corsHeaders);
        }

        if ((route === '/sms/messages' || path === '/ringcentral/sms/messages') && request.method === 'POST') {
            return await handleGetMessages(request, token, corsHeaders);
        }

        if ((route === '/sms/inbox' || path === '/ringcentral/sms/inbox') && request.method === 'POST') {
            return await handleGetInbox(request, token, corsHeaders, config, userId);
        }

        if ((route === '/sms/read-status' || path === '/ringcentral/sms/read-status') && request.method === 'POST') {
            return await handleReadStatus(request, token, corsHeaders);
        }

        if ((route === '/call-log' || path === '/ringcentral/call-log') && request.method === 'POST') {
            return await handleCallLog(request, token, corsHeaders);
        }

        if ((route === '/presence' || path === '/ringcentral/presence') && request.method === 'POST') {
            return await handlePresence(request, token, corsHeaders);
        }

        if (route === '/account/info' || path === '/ringcentral/account/info') {
            return await handleAccountInfo(token, connection, corsHeaders);
        }

        // ── Call Control endpoint ──
        if ((route === '/call-control' || path === '/ringcentral/call-control') && request.method === 'POST') {
            return await handleCallControl(request, token, corsHeaders);
        }

        // ── Contacts sync endpoint ──
        if ((route === '/contacts/sync' || path === '/ringcentral/contacts/sync') && request.method === 'POST') {
            return await handleContactSync(request, token, corsHeaders, config);
        }

        // ── Recordings: list recent recordings (5+ min) ──
        if ((route === '/recordings' || path === '/ringcentral/recordings') && request.method === 'POST') {
            return await handleRecordings(request, token, corsHeaders, config, userId);
        }

        // ── Subscribe webhook for recording events ──
        if ((route === '/webhook/subscribe' || path === '/ringcentral/webhook/subscribe') && request.method === 'POST') {
            return await handleWebhookSubscribe(token, corsHeaders, config);
        }

        return jsonResponse({ error: 'Not found', path: path, route: route }, corsHeaders, 404);

    } catch (error) {
        // Log erreur côté serveur seulement, ne pas exposer le stack en production
        console.error('[RingCentral] Function error:', error.message);
        return jsonResponse({
            error: 'Internal server error',
            message: error.message
        }, corsHeaders, 500);
    }
}

function jsonResponse(data, corsHeaders, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

function htmlResponse(html) {
    return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
    });
}

// ═══════════════════════════════════════════════════════════════
// OAUTH HANDLERS
// ═══════════════════════════════════════════════════════════════

function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

async function handleOAuthStart(url, corsHeaders, config) {
    const userId = url.searchParams.get('user_id');
    const returnUrl = url.searchParams.get('return_url') || 'https://crm.finox.ca/app.html';

    if (!userId) {
        return jsonResponse({ error: 'user_id parameter required' }, corsHeaders, 400);
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const state = btoa(JSON.stringify({
        user_id: userId,
        return_url: returnUrl,
        code_verifier: codeVerifier
    }));

    const authUrl = new URL(`${RC_SERVER}/restapi/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.rcClientId);
    authUrl.searchParams.set('redirect_uri', RC_REDIRECT_URI);
    // Ne PAS passer le scope — RingCentral utilise les scopes configurés dans le Developer Console
    // (évite l'erreur "invalid_request: scope non valide" si un scope n'est pas activé dans l'app)
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return new Response(null, {
        status: 302,
        headers: {
            ...corsHeaders,
            'Location': authUrl.toString()
        }
    });
}

async function handleOAuthCallback(url, corsHeaders, config) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
        return htmlResponse(`
            <html><body style="font-family:sans-serif;text-align:center;padding:50px;">
                <h1>Erreur de connexion</h1>
                <p>${error}: ${url.searchParams.get('error_description') || 'Unknown error'}</p>
                <button onclick="window.close()">Fermer</button>
            </body></html>
        `);
    }

    if (!code || !state) {
        return htmlResponse(`
            <html><body style="font-family:sans-serif;text-align:center;padding:50px;">
                <h1>Paramètres manquants</h1>
                <p>Code ou state manquant dans la réponse</p>
                <button onclick="window.close()">Fermer</button>
            </body></html>
        `);
    }

    let stateData;
    try {
        stateData = JSON.parse(atob(state));
    } catch (_e) {
        return htmlResponse(`
            <html><body style="font-family:sans-serif;text-align:center;padding:50px;">
                <h1>State invalide</h1>
                <button onclick="window.close()">Fermer</button>
            </body></html>
        `);
    }

    const { user_id, return_url, code_verifier } = stateData;

    try {
        const tokenBody = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: RC_REDIRECT_URI
        });

        if (code_verifier) {
            tokenBody.set('code_verifier', code_verifier);
        }

        const tokenResponse = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${btoa(`${config.rcClientId}:${config.rcClientSecret}`)}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: tokenBody
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[RingCentral] Token exchange error:', errorText);
            throw new Error('Failed to exchange code for tokens');
        }

        const tokens = await tokenResponse.json();

        const accountInfo = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~`, {
            headers: { 'Authorization': `Bearer ${tokens.access_token}` }
        });

        let rcAccountData = {};
        if (accountInfo.ok) {
            rcAccountData = await accountInfo.json();
        }

        let phoneNumber = null;
        try {
            const phoneResponse = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/phone-number`, {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` }
            });
            if (phoneResponse.ok) {
                const phoneData = await phoneResponse.json();
                const smsNumber = phoneData.records?.find(p =>
                    p.features?.includes('SmsSender') || p.usageType === 'DirectNumber'
                );
                phoneNumber = smsNumber?.phoneNumber || phoneData.records?.[0]?.phoneNumber;
            }
        } catch (phoneErr) {
            console.error('[RingCentral] Error fetching phone number:', phoneErr.message);
        }

        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        const saveResult = await saveRingCentralConnection(user_id, {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: expiresAt,
            rc_account_id: rcAccountData.account?.id || tokens.owner_id,
            rc_extension_id: rcAccountData.id?.toString(),
            rc_phone_number: phoneNumber,
            rc_user_name: rcAccountData.name || rcAccountData.contact?.firstName
        }, config);

        if (!saveResult.success) {
            throw new Error('Failed to save connection: ' + saveResult.error);
        }

        return htmlResponse(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>RingCentral Connecté</title>
                <style>
                    body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #fff; text-align: center; padding: 50px; }
                    .success { color: #4CAF50; font-size: 48px; }
                    h1 { color: #C9A227; }
                    p { color: #888; }
                    .phone { color: #00BCD4; font-size: 20px; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="success">✓</div>
                <h1>RingCentral Connecté!</h1>
                <p>Votre compte est maintenant lié</p>
                ${phoneNumber ? `<p class="phone">${phoneNumber}</p>` : ''}
                <p style="margin-top:30px;color:#666">Cette fenêtre va se fermer automatiquement...</p>
                <script>
                    if (window.opener) {
                        window.opener.postMessage({ type: 'RINGCENTRAL_CONNECTED', phone: '${phoneNumber || ''}' }, '*');
                    }
                    setTimeout(() => {
                        window.close();
                        window.location.href = '${return_url}?rc_connected=true';
                    }, 2000);
                </script>
            </body>
            </html>
        `);

    } catch (callbackError) {
        console.error('[RingCentral] OAuth callback error:', callbackError.message);
        return htmlResponse(`
            <html>
            <head><style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;text-align:center;padding:50px;}</style></head>
            <body>
                <h1 style="color:#f44336">Erreur de connexion</h1>
                <p>${callbackError.message}</p>
                <button onclick="window.close()" style="padding:10px 20px;margin-top:20px;cursor:pointer;">Fermer</button>
            </body>
            </html>
        `);
    }
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════════

async function getRingCentralConnection(userId, config) {
    const response = await fetch(
        `${config.supabaseUrl}/rest/v1/ringcentral_connections?user_id=eq.${userId}&is_active=eq.true&select=*`,
        {
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`
            }
        }
    );

    if (!response.ok) {
        console.error('[RingCentral] Supabase error:', await response.text());
        return null;
    }

    const data = await response.json();
    return data[0] || null;
}

async function saveRingCentralConnection(userId, connectionData, config) {
    const response = await fetch(
        `${config.supabaseUrl}/rest/v1/ringcentral_connections`,
        {
            method: 'POST',
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                user_id: userId,
                ...connectionData,
                is_active: true,
                connected_at: new Date().toISOString()
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error('[RingCentral] Save connection error:', error);
        return { success: false, error };
    }

    return { success: true };
}

async function updateTokens(userId, accessToken, refreshToken, expiresAt, config) {
    const response = await fetch(
        `${config.supabaseUrl}/rest/v1/ringcentral_connections?user_id=eq.${userId}`,
        {
            method: 'PATCH',
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                access_token: accessToken,
                refresh_token: refreshToken,
                token_expires_at: expiresAt,
                last_used_at: new Date().toISOString()
            })
        }
    );

    return response.ok;
}

// ═══════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function getValidToken(connection, userId, config) {
    const expiresAt = new Date(connection.token_expires_at);
    const now = new Date();

    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
        return await refreshAccessToken(connection, userId, config);
    }

    return connection.access_token;
}

async function refreshAccessToken(connection, userId, config) {
    if (!connection.refresh_token) {
        throw new Error('No refresh token available');
    }

    const response = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${btoa(`${config.rcClientId}:${config.rcClientSecret}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: connection.refresh_token
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RingCentral] Token refresh error:', errorText);
        throw new Error('Failed to refresh token - reconnection required');
    }

    const tokens = await response.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await updateTokens(userId, tokens.access_token, tokens.refresh_token, expiresAt, config);

    return tokens.access_token;
}

// ═══════════════════════════════════════════════════════════════
// CONNECTION STATUS & DISCONNECT
// ═══════════════════════════════════════════════════════════════

async function handleConnectionStatus(userId, corsHeaders, config) {
    const connection = await getRingCentralConnection(userId, config);

    if (!connection) {
        return jsonResponse({
            connected: false,
            message: 'RingCentral non connecté'
        }, corsHeaders);
    }

    // Vérifier si le token est encore valide (ou peut être rafraîchi)
    try {
        await getValidToken(connection, userId, config);
        return jsonResponse({
            connected: true,
            phone_number: connection.rc_phone_number,
            user_name: connection.rc_user_name,
            connected_at: connection.connected_at,
            last_used_at: connection.last_used_at
        }, corsHeaders);
    } catch (_tokenErr) {
        // Token expiré ET refresh échoué → session morte, reconnecter
        console.warn('[RingCentral] Status check: token expired for user', userId);
        return jsonResponse({
            connected: false,
            expired: true,
            message: 'Session RingCentral expirée — veuillez reconnecter',
            phone_number: connection.rc_phone_number,
            user_name: connection.rc_user_name
        }, corsHeaders);
    }
}

async function handleDisconnect(userId, corsHeaders, config) {
    const response = await fetch(
        `${config.supabaseUrl}/rest/v1/ringcentral_connections?user_id=eq.${userId}`,
        {
            method: 'DELETE',
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`
            }
        }
    );

    if (!response.ok) {
        return jsonResponse({ success: false, error: 'Failed to disconnect' }, corsHeaders, 500);
    }

    return jsonResponse({ success: true, message: 'RingCentral déconnecté' }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// SMS HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleSendSMS(request, token, fromNumber, corsHeaders) {
    const body = await request.json();
    const { to, text } = body;

    if (!to || !text) {
        return jsonResponse({ error: 'Missing required fields: to, text' }, corsHeaders, 400);
    }

    if (!fromNumber) {
        return jsonResponse({ error: 'No phone number configured for this account' }, corsHeaders, 400);
    }

    const toNumber = formatPhoneNumber(to);

    const response = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/sms`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: { phoneNumber: fromNumber },
            to: [{ phoneNumber: toNumber }],
            text: text
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RingCentral] SMS send error:', errorText);
        return jsonResponse({ error: 'Failed to send SMS', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    return jsonResponse({
        success: true,
        messageId: data.id,
        from: fromNumber,
        to: toNumber,
        text: text,
        timestamp: data.creationTime
    }, corsHeaders);
}

async function handleGetMessages(request, token, corsHeaders) {
    const body = await request.json();
    const { contact_phone, max_results = 100 } = body;

    if (!contact_phone) {
        return jsonResponse({ error: 'Missing required field: contact_phone' }, corsHeaders, 400);
    }

    const contactNumber = formatPhoneNumber(contact_phone);
    const contactNumberClean = contactNumber.replace(/\D/g, '');

    const params = new URLSearchParams({
        messageType: 'SMS',
        perPage: '200',
        dateFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    });

    const response = await fetch(
        `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store?${params}`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RingCentral] Get messages error:', errorText);
        return jsonResponse({ error: 'Failed to get messages', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    const filteredMessages = (data.records || []).filter(msg => {
        const fromNum = (msg.from?.phoneNumber || '').replace(/\D/g, '');
        const toNumbers = (msg.to || []).map(t => (t.phoneNumber || '').replace(/\D/g, ''));
        const contactLast10 = contactNumberClean.slice(-10);
        const fromLast10 = fromNum.slice(-10);

        return fromLast10 === contactLast10 ||
               toNumbers.some(tn => tn.slice(-10) === contactLast10);
    });

    const messages = filteredMessages.map(msg => ({
        id: msg.id,
        direction: msg.direction,
        from: msg.from?.phoneNumber || msg.from?.name || 'Unknown',
        to: msg.to?.[0]?.phoneNumber || msg.to?.[0]?.name || 'Unknown',
        text: msg.subject || '',
        subject: msg.subject || '',
        timestamp: msg.creationTime,
        creationTime: msg.creationTime,
        readStatus: msg.readStatus,
        type: msg.type
    }));

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const limitedMessages = messages.slice(-max_results);

    return jsonResponse({
        success: true,
        contact: contactNumber,
        totalFound: filteredMessages.length,
        count: limitedMessages.length,
        messages: limitedMessages
    }, corsHeaders);
}

async function handleAccountInfo(token, connection, corsHeaders) {
    const response = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        return jsonResponse({ error: 'Failed to get account info', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    return jsonResponse({
        success: true,
        account: {
            id: data.id,
            name: data.name,
            extensionNumber: data.extensionNumber,
            status: data.status,
            type: data.type,
            phoneNumber: connection.rc_phone_number
        }
    }, corsHeaders);
}

async function handleGetInbox(request, token, corsHeaders, config, userId) {
    const body = await request.json();
    const { since, limit = 250, direction } = body;

    const dateFrom = since
        ? new Date(since).toISOString()
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
        messageType: 'SMS',
        perPage: String(Math.min(limit, 250)),
        dateFrom: dateFrom
    });

    // Allow filtering by direction, or get all (both inbound + outbound)
    if (direction) {
        params.set('direction', direction);
    }

    const response = await fetch(
        `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store?${params}`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RingCentral] Get inbox error:', errorText);
        return jsonResponse({ error: 'Failed to get inbox', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    const messages = (data.records || []).map(msg => ({
        id: msg.id,
        direction: msg.direction,
        from: msg.from?.phoneNumber || 'Unknown',
        to: msg.to?.[0]?.phoneNumber || 'Unknown',
        text: msg.subject || '',
        timestamp: msg.creationTime,
        readStatus: msg.readStatus
    }));

    messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Fire-and-forget: persist inbound SMS to client_timeline for realtime notifications
    if (config?.supabaseUrl) {
        persistInboundSmsToTimeline(messages, config, userId).catch(e =>
            console.error('[RC] SMS timeline persist error:', e.message)
        );
    }

    return jsonResponse({
        success: true,
        count: messages.length,
        messages: messages,
        lastCheck: new Date().toISOString()
    }, corsHeaders);
}

/**
 * Persist inbound SMS to client_timeline for Supabase Realtime notifications.
 * Matches SMS phone numbers to clients, deduplicates via external_id unique index.
 */
async function persistInboundSmsToTimeline(messages, config, userId) {
    const inbound = messages.filter(m => m.direction === 'Inbound');
    if (inbound.length === 0) return;

    // Get all clients with phone numbers for matching
    const clientsResp = await fetch(
        `${config.supabaseUrl}/rest/v1/clients?select=id,phone,first_name,last_name&or=(phone.not.is.null,phone.neq.)&limit=5000`,
        {
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`
            }
        }
    );
    if (!clientsResp.ok) return;
    const clients = await clientsResp.json();

    // Build phone→client map (normalize to last 10 digits)
    const phoneMap = new Map();
    for (const c of clients) {
        if (c.phone) {
            const normalized = c.phone.replace(/\D/g, '').slice(-10);
            if (normalized.length === 10) phoneMap.set(normalized, c);
        }
    }

    // Match and insert
    for (const msg of inbound.slice(0, 20)) {
        const fromNorm = (msg.from || '').replace(/\D/g, '').slice(-10);
        const client = phoneMap.get(fromNorm);
        if (!client) continue;

        const entry = {
            client_id: client.id,
            activity_type: 'sms_inbound',
            title: `💬 SMS de ${client.first_name || ''} ${client.last_name || ''}`.trim(),
            description: (msg.text || '').substring(0, 200),
            external_id: String(msg.id),
            external_source: 'ringcentral',
            phone_number: msg.from,
            created_by: userId || null
        };

        // Upsert with ON CONFLICT on external_id (unique index) — skip duplicates
        await fetch(`${config.supabaseUrl}/rest/v1/client_timeline`, {
            method: 'POST',
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=ignore-duplicates'
            },
            body: JSON.stringify(entry)
        }).catch(() => {}); // Ignore individual insert errors (likely dupes)
    }
}

async function handleReadStatus(request, token, corsHeaders) {
    const body = await request.json();
    const { message_ids, read_status } = body;

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
        return jsonResponse({ error: 'message_ids array required' }, corsHeaders, 400);
    }

    if (!read_status || !['Read', 'Unread'].includes(read_status)) {
        return jsonResponse({ error: 'read_status must be "Read" or "Unread"' }, corsHeaders, 400);
    }

    const results = [];
    for (const messageId of message_ids) {
        try {
            const response = await fetch(
                `${RC_SERVER}/restapi/v1.0/account/~/extension/~/message-store/${messageId}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ readStatus: read_status })
                }
            );

            if (response.ok) {
                results.push({ id: messageId, success: true });
            } else {
                const errorText = await response.text();
                console.error(`[RingCentral] Read status update error for ${messageId}:`, errorText);
                results.push({ id: messageId, success: false, error: errorText });
            }
        } catch (statusErr) {
            results.push({ id: messageId, success: false, error: statusErr.message });
        }
    }

    const successCount = results.filter(r => r.success).length;

    return jsonResponse({
        success: successCount > 0,
        updated: successCount,
        total: message_ids.length,
        read_status: read_status,
        results: results
    }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// CALL LOG & PRESENCE HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleCallLog(request, token, corsHeaders) {
    const body = await request.json();
    const { contact_phone, max_results = 25, date_from } = body;

    if (!contact_phone) {
        return jsonResponse({ error: 'Missing required field: contact_phone' }, corsHeaders, 400);
    }

    const contactNumber = formatPhoneNumber(contact_phone);
    const contactNumberClean = contactNumber.replace(/\D/g, '');
    const contactLast10 = contactNumberClean.slice(-10);

    const dateFrom = date_from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const perPage = Math.min(max_results * 3, 250); // Fetch more to account for filtering

    const params = new URLSearchParams({
        type: 'Voice',
        view: 'Detailed',
        dateFrom: dateFrom,
        perPage: String(perPage)
    });

    const response = await fetch(
        `${RC_SERVER}/restapi/v1.0/account/~/extension/~/call-log?${params}`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RingCentral] Call log error:', errorText);
        return jsonResponse({ error: 'Failed to get call log', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    // Filter by contact phone number (same last-10-digits matching as SMS)
    const filteredRecords = (data.records || []).filter(record => {
        const fromNum = (record.from?.phoneNumber || '').replace(/\D/g, '');
        const toNum = (record.to?.phoneNumber || '').replace(/\D/g, '');
        return fromNum.slice(-10) === contactLast10 || toNum.slice(-10) === contactLast10;
    });

    const records = filteredRecords.slice(0, max_results).map(record => ({
        id: record.id,
        sessionId: record.sessionId,
        direction: record.direction,
        from: record.from?.phoneNumber || record.from?.name || '',
        to: record.to?.phoneNumber || record.to?.name || '',
        duration: record.duration || 0,
        startTime: record.startTime,
        result: record.result,
        type: record.type,
        action: record.action
    }));

    // Sort by time (oldest first)
    records.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    return jsonResponse({
        success: true,
        contact: contactNumber,
        count: records.length,
        records: records
    }, corsHeaders);
}

async function handlePresence(request, token, corsHeaders) {
    const response = await fetch(
        `${RC_SERVER}/restapi/v1.0/account/~/extension/~/presence?detailedTelephonyState=true`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RingCentral] Presence error:', errorText);
        return jsonResponse({ error: 'Failed to get presence', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    return jsonResponse({
        success: true,
        telephonyStatus: data.telephonyStatus || 'NoCall',
        presenceStatus: data.presenceStatus || 'Offline',
        activeCalls: (data.activeCalls || []).map(call => ({
            id: call.id,
            direction: call.direction,
            from: call.from || call.fromName || '',
            to: call.to || call.toName || '',
            telephonyStatus: call.telephonyStatus,
            startTime: call.startTime,
            sessionId: call.sessionId,
            telephonySessionId: call.telephonySessionId || null,
            partyId: call.partyId || null
        }))
    }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// CALL CONTROL HANDLER (hold, unhold, hangup via Telephony Sessions API)
// ═══════════════════════════════════════════════════════════════

async function handleCallControl(request, token, corsHeaders) {
    const body = await request.json();
    const { action, telephony_session_id, party_id } = body;

    if (!action || !telephony_session_id || !party_id) {
        return jsonResponse({
            error: 'Missing required fields: action, telephony_session_id, party_id'
        }, corsHeaders, 400);
    }

    if (!['hold', 'unhold', 'hangup'].includes(action)) {
        return jsonResponse({
            error: 'Invalid action. Must be: hold, unhold, or hangup'
        }, corsHeaders, 400);
    }

    const baseUrl = `${RC_SERVER}/restapi/v1.0/account/~/telephony/sessions/${telephony_session_id}/parties/${party_id}`;
    let fetchUrl, method;

    switch (action) {
        case 'hold':
            fetchUrl = `${baseUrl}/hold`;
            method = 'POST';
            break;
        case 'unhold':
            fetchUrl = `${baseUrl}/unhold`;
            method = 'POST';
            break;
        case 'hangup':
            fetchUrl = baseUrl;
            method = 'DELETE';
            break;
    }

    const response = await fetch(fetchUrl, {
        method: method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[RingCentral] Call control ${action} error:`, errorText);

        if (response.status === 403) {
            return jsonResponse({
                error: 'Insufficient permissions',
                code: 'RC_SCOPE_MISSING',
                message: 'Les scopes CallControl ne sont pas activés. Reconnectez-vous dans Paramètres > Intégrations.'
            }, corsHeaders, 403);
        }

        if (response.status === 404) {
            return jsonResponse({
                error: 'Call session not found',
                code: 'CALL_NOT_FOUND',
                message: 'La session d\'appel n\'existe plus'
            }, corsHeaders, 404);
        }

        return jsonResponse({
            error: `Failed to ${action} call`,
            details: errorText
        }, corsHeaders, response.status);
    }

    // Pour hangup (DELETE), pas de body de réponse
    let result = null;
    if (action !== 'hangup') {
        try {
            result = await response.json();
        } catch (_e) {
            result = null;
        }
    }

    return jsonResponse({
        success: true,
        action: action,
        result: result
    }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// CONTACTS SYNC — Synchronise un contact CRM vers le carnet RC
// ═══════════════════════════════════════════════════════════════

async function handleContactSync(request, token, corsHeaders, config) {
    const body = await request.json();
    const { client_id } = body;

    if (!client_id) {
        return jsonResponse({ error: 'Missing required field: client_id' }, corsHeaders, 400);
    }

    // Fetch client data from Supabase
    const clientRes = await fetch(
        `${config.supabaseUrl}/rest/v1/clients?id=eq.${client_id}&select=id,first_name,last_name,phone,phone_mobile,email,company,rc_contact_id`,
        {
            headers: {
                'apikey': config.supabaseServiceKey,
                'Authorization': `Bearer ${config.supabaseServiceKey}`
            }
        }
    );

    if (!clientRes.ok) {
        return jsonResponse({ error: 'Failed to fetch client data' }, corsHeaders, 500);
    }

    const clients = await clientRes.json();
    const client = clients[0];
    if (!client) {
        return jsonResponse({ error: 'Client not found' }, corsHeaders, 404);
    }

    // Skip if no phone number at all
    if (!client.phone && !client.phone_mobile) {
        return jsonResponse({ success: true, skipped: true, reason: 'no_phone' }, corsHeaders);
    }

    // Build RC contact body
    const rcContact = {
        firstName: client.first_name || '',
        lastName: client.last_name || ''
    };

    // Map phone numbers
    if (client.phone) {
        rcContact.businessPhone = formatPhoneNumber(client.phone);
    }
    if (client.phone_mobile) {
        rcContact.mobilePhone = formatPhoneNumber(client.phone_mobile);
    }
    if (client.email) {
        rcContact.email = client.email;
    }
    if (client.company) {
        rcContact.company = client.company;
    }

    // Notes to identify CRM source
    rcContact.notes = `Finox CRM — ID: ${client.id}`;

    let rcContactId = client.rc_contact_id;
    let action = 'created';

    try {
        if (rcContactId) {
            // UPDATE existing contact
            const updateRes = await fetch(
                `${RC_SERVER}/restapi/v1.0/account/~/extension/~/address-book/contact/${rcContactId}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(rcContact)
                }
            );

            if (updateRes.status === 404) {
                // Contact was deleted in RC — recreate
                rcContactId = null;
            } else if (!updateRes.ok) {
                const errText = await updateRes.text();
                console.error('[RingCentral] Contact update error:', errText);

                if (updateRes.status === 403) {
                    return jsonResponse({
                        error: 'Insufficient permissions',
                        code: 'RC_SCOPE_MISSING',
                        message: 'Le scope Contacts n\'est pas active. Reconnectez-vous dans Parametres > Integrations.'
                    }, corsHeaders, 403);
                }

                return jsonResponse({ error: 'Failed to update RC contact', details: errText }, corsHeaders, updateRes.status);
            } else {
                action = 'updated';
                const updatedContact = await updateRes.json();
                rcContactId = updatedContact.id?.toString();
            }
        }

        if (!rcContactId) {
            // CREATE new contact
            const createRes = await fetch(
                `${RC_SERVER}/restapi/v1.0/account/~/extension/~/address-book/contact`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(rcContact)
                }
            );

            if (!createRes.ok) {
                const errText = await createRes.text();
                console.error('[RingCentral] Contact create error:', errText);

                if (createRes.status === 403) {
                    return jsonResponse({
                        error: 'Insufficient permissions',
                        code: 'RC_SCOPE_MISSING',
                        message: 'Le scope Contacts n\'est pas active. Reconnectez-vous dans Parametres > Integrations.'
                    }, corsHeaders, 403);
                }

                return jsonResponse({ error: 'Failed to create RC contact', details: errText }, corsHeaders, createRes.status);
            }

            const newContact = await createRes.json();
            rcContactId = newContact.id?.toString();
            action = 'created';
        }

        // Save rc_contact_id back to Supabase
        if (rcContactId) {
            await fetch(
                `${config.supabaseUrl}/rest/v1/clients?id=eq.${client_id}`,
                {
                    method: 'PATCH',
                    headers: {
                        'apikey': config.supabaseServiceKey,
                        'Authorization': `Bearer ${config.supabaseServiceKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ rc_contact_id: rcContactId })
                }
            );
        }

        console.log(`[RingCentral] Contact ${action}: ${client.first_name} ${client.last_name} → RC ID: ${rcContactId}`);

        return jsonResponse({
            success: true,
            action: action,
            rc_contact_id: rcContactId,
            client_name: `${client.first_name || ''} ${client.last_name || ''}`.trim()
        }, corsHeaders);

    } catch (e) {
        console.error('[RingCentral] Contact sync error:', e.message);
        return jsonResponse({ error: 'Contact sync failed', message: e.message }, corsHeaders, 500);
    }
}

function formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');

    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return '+' + cleaned;
    }

    if (cleaned.length === 10) {
        return '+1' + cleaned;
    }

    if (!phone.startsWith('+')) {
        return '+' + cleaned;
    }

    return phone;
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOK — Recevoir les événements RC (recording.completed)
// ═══════════════════════════════════════════════════════════════

async function handleWebhook(request, corsHeaders, config, env) {
    // RC webhook validation: echo the Validation-Token header
    const validationToken = request.headers.get('Validation-Token');
    if (validationToken) {
        console.log('[RC Webhook] Validation request received');
        return new Response('', {
            status: 200,
            headers: {
                ...corsHeaders,
                'Validation-Token': validationToken
            }
        });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ status: 'ok' }, corsHeaders);
    }

    try {
        const event = await request.json();
        console.log('[RC Webhook] Event received:', event.event, event.subscriptionId);

        // Only process telephony session notifications (call recordings)
        if (!event.body) {
            return jsonResponse({ status: 'ignored', reason: 'no body' }, corsHeaders);
        }

        const body = event.body;

        // Handle call session events — look for recordings in completed calls
        // RC sends telephony/sessions events; recording info is in the parties
        const parties = body.parties || [];
        for (const party of parties) {
            if (party.recordings && party.recordings.length > 0) {
                for (const recording of party.recordings) {
                    // Check call duration — only process 5+ min calls
                    const durationSec = body.duration || party.duration || 0;
                    if (durationSec < 300) {
                        console.log('[RC Webhook] Call too short:', durationSec, 's — skipping');
                        continue;
                    }

                    console.log('[RC Webhook] Recording found! Duration:', durationSec, 's, ID:', recording.id);

                    // Find the user by matching RC extension
                    const extensionId = body.extensionId || party.extensionId;
                    const phoneNumber = party.from?.phoneNumber || party.to?.phoneNumber || '';

                    // Trigger pipeline async (don't block webhook response)
                    const pipelineUrl = new URL('/whisper/pipeline', request.url).toString();
                    context_waitUntil_polyfill(env, fetch(pipelineUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'pipeline',
                            recording_id: recording.id,
                            rc_extension_id: extensionId,
                            call_duration: durationSec,
                            phone_number: phoneNumber,
                            direction: party.direction || body.direction,
                            call_start: body.startTime || body.creationTime
                        })
                    }).catch(err => console.error('[RC Webhook] Pipeline trigger failed:', err.message)));
                }
            }
        }

        return jsonResponse({ status: 'processed' }, corsHeaders);

    } catch (error) {
        console.error('[RC Webhook] Error:', error.message);
        return jsonResponse({ status: 'error', message: error.message }, corsHeaders, 500);
    }
}

// Polyfill for waitUntil — CF Pages Functions context
function context_waitUntil_polyfill(env, promise) {
    // In CF Pages, we can't use waitUntil easily, so just fire-and-forget
    promise.catch(err => console.error('[waitUntil] Error:', err.message));
}

// ═══════════════════════════════════════════════════════════════
// RECORDINGS — Lister les enregistrements récents (5+ min)
// ═══════════════════════════════════════════════════════════════

async function handleRecordings(request, token, corsHeaders, config, userId) {
    const body = await request.json();
    const minDuration = body.min_duration || 300; // 5 min default
    const daysBack = body.days_back || 7;

    const dateFrom = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
        type: 'Voice',
        view: 'Detailed',
        withRecording: 'true',
        dateFrom: dateFrom,
        perPage: '100'
    });

    const response = await fetch(
        `${RC_SERVER}/restapi/v1.0/account/~/extension/~/call-log?${params}`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[RC Recordings] Error:', errorText);
        return jsonResponse({ error: 'Failed to get recordings', details: errorText }, corsHeaders, response.status);
    }

    const data = await response.json();

    // Filter: 5+ min duration AND has recording
    const recordings = (data.records || [])
        .filter(r => r.recording && (r.duration || 0) >= minDuration)
        .map(r => ({
            id: r.id,
            sessionId: r.sessionId,
            recording_id: r.recording.id,
            recording_uri: r.recording.contentUri,
            duration: r.duration,
            direction: r.direction,
            from: r.from?.phoneNumber || r.from?.name || '',
            to: r.to?.phoneNumber || r.to?.name || '',
            startTime: r.startTime,
            result: r.result
        }));

    // Check which ones are already transcribed
    let transcribedIds = [];
    try {
        const checkResp = await fetch(
            `${config.supabaseUrl}/rest/v1/transcripts?conseiller_id=eq.${userId}&audio_source=eq.ringcentral&select=metadata`,
            {
                headers: {
                    'apikey': config.supabaseServiceKey,
                    'Authorization': `Bearer ${config.supabaseServiceKey}`
                }
            }
        );
        if (checkResp.ok) {
            const existing = await checkResp.json();
            transcribedIds = existing
                .map(t => t.metadata?.rc_recording_id)
                .filter(Boolean);
        }
    } catch (e) { /* ignore */ }

    // Mark which are already processed
    const enriched = recordings.map(r => ({
        ...r,
        already_transcribed: transcribedIds.includes(String(r.recording_id))
    }));

    return jsonResponse({
        success: true,
        count: enriched.length,
        recordings: enriched
    }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOK SUBSCRIBE — S'abonner aux événements RC
// ═══════════════════════════════════════════════════════════════

async function handleWebhookSubscribe(token, corsHeaders, config) {
    const webhookUrl = 'https://crm.finox.ca/ringcentral/webhook';

    try {
        const response = await fetch(
            `${RC_SERVER}/restapi/v1.0/subscription`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    eventFilters: [
                        '/restapi/v1.0/account/~/extension/~/telephony/sessions'
                    ],
                    deliveryMode: {
                        transportType: 'WebHook',
                        address: webhookUrl
                    },
                    expiresIn: 630720000 // Max: ~20 years
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[RC Webhook Subscribe] Error:', errorText);
            return jsonResponse({ error: 'Subscription failed', details: errorText }, corsHeaders, response.status);
        }

        const sub = await response.json();
        console.log('[RC Webhook Subscribe] Success:', sub.id, sub.status);

        return jsonResponse({
            success: true,
            subscription_id: sub.id,
            status: sub.status,
            expires_at: sub.expirationTime
        }, corsHeaders);

    } catch (error) {
        console.error('[RC Webhook Subscribe] Error:', error.message);
        return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
}
