/**
 * FINOX Google APIs Pages Function
 * Gère Gmail, Calendar et Drive via le token OAuth de Supabase
 *
 * Endpoints:
 * - POST /google/gmail/messages - Récupérer les emails avec un contact spécifique
 * - GET  /google/gmail/inbox - Récupérer les emails récents (boîte de réception globale)
 * - GET  /google/gmail/message/:id - Récupérer un email complet
 * - POST /google/gmail/send - Envoyer un email
 * - GET  /google/calendar/events - Récupérer les événements
 * - POST /google/calendar/events - Créer un événement
 * - DELETE /google/calendar/events/:eventId - Supprimer un événement
 * - GET  /google/drive/files - Lister les fichiers
 * - GET  /google/health - Health check
 * - POST /google/refresh-token - Rafraîchir le token manuellement
 *
 * Authentication:
 * - Option 1: Bearer token (access_token) - utilisé directement
 * - Option 2: X-User-Id header + X-Supabase-Key header - auto-refresh du token
 */

// ═══ Email Encoding Helpers v9 — Pure ASCII enforcement + btoa ═══

// MIME B-encoding UTF-8 : encode le texte en UTF-8 puis base64
function mimeB(str) {
    const bytes = new TextEncoder().encode(str);
    // Manual base64 for the MIME word only
    const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let b64 = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i], b1 = bytes[i+1] || 0, b2 = bytes[i+2] || 0;
        b64 += B[b0 >> 2];
        b64 += B[((b0 & 3) << 4) | (b1 >> 4)];
        b64 += (i+1 < bytes.length) ? B[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
        b64 += (i+2 < bytes.length) ? B[b2 & 0x3f] : '=';
    }
    return '=?UTF-8?B?' + b64 + '?=';
}

// Encode body HTML to base64 (UTF-8 content → base64 ASCII)
function bodyToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let b64 = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i], b1 = bytes[i+1] || 0, b2 = bytes[i+2] || 0;
        b64 += B[b0 >> 2];
        b64 += B[((b0 & 3) << 4) | (b1 >> 4)];
        b64 += (i+1 < bytes.length) ? B[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
        b64 += (i+2 < bytes.length) ? B[b2 & 0x3f] : '=';
    }
    return b64;
}

// Vérifie si une string est 100% ASCII (0-127)
function isAscii(str) {
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 127) return false;
    }
    return true;
}

// Encode pour header email : si non-ASCII, MIME B-encode
function safeHeader(str) {
    if (!str || isAscii(str)) return str || '';
    return mimeB(str);
}

// Encode un header From/To qui peut être "Nom <email>" ou juste "email"
function safeEmailHeader(val) {
    if (!val) return '';
    const m = val.match(/^(.*?)\s*<(.+)>$/);
    if (m) {
        const name = m[1].trim().replace(/^"|"$/g, '');
        return `${safeHeader(name)} <${m[2]}>`;
    }
    return val; // just email, should be ASCII
}

// base64url via btoa — CRITICAL: emailRaw MUST be pure ASCII
// btoa() lancera une erreur si non-ASCII, ce qui nous alerte immédiatement
function asciiToBase64url(asciiStr) {
    return btoa(asciiStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ALLOWED_ORIGINS = ['https://crm.finox.ca', 'https://crm-finox.ca', 'http://localhost:8788', 'http://localhost:3000'];

function getCorsHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-Supabase-Key',
        'Content-Type': 'application/json'
    };
}

// Dynamic CORS headers — set at start of each request
let CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://crm.finox.ca',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-Supabase-Key',
    'Content-Type': 'application/json'
};

// Google OAuth Configuration
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function onRequest(context) {
    const { request, env } = context;

    // Set dynamic CORS headers based on request origin
    CORS_HEADERS = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.replace('/google/', '').split('/').filter(Boolean);
    const service = pathParts[0]; // gmail, calendar, drive, refresh-token
    const action = pathParts[1];  // messages, send, events, files
    const param = pathParts[2];   // optional param (message id, etc.)

    // Clone request body early for potential retry (body can only be read once)
    let requestBody = null;
    if (request.method === 'POST' && service !== 'refresh-token') {
        try {
            requestBody = await request.clone().json();
        } catch (e) {
            // No body or not JSON
        }
    }

    try {
        // Health check
        if (service === 'health') {
            return jsonResponse({
                status: 'ok',
                service: 'FINOX Google APIs',
                version: 'v9-btoa-ascii-2026-03-13',
                features: ['auto-refresh tokens', 'gmail', 'calendar', 'drive'],
                timestamp: new Date().toISOString()
            });
        }

        // Encoding diagnostic endpoint
        if (service === 'encoding-test') {
            const testStr = 'hypothécaire à été';
            const bEncoded = mimeB(testStr);
            const miniEmail = `Subject: ${bEncoded}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\ntest`;
            const allAscii = isAscii(miniEmail);
            let b64url = '';
            let method = '';
            try {
                b64url = asciiToBase64url(miniEmail);
                method = 'btoa';
            } catch (e) {
                // Fallback — should NOT happen if email is pure ASCII
                b64url = 'BTOA_FAILED: ' + e.message;
                method = 'btoa_failed';
            }
            return jsonResponse({
                version: 'v9-btoa-ascii-2026-03-13',
                input: testStr,
                mimeB_result: bEncoded,
                emailIsAscii: allAscii,
                method: method,
                fullEmailBase64url: b64url,
                fullEmailRaw: miniEmail,
                timestamp: new Date().toISOString()
            });
        }

        // ── SEND-TEST: envoie un vrai email avec sujet accentué hardcodé ──
        // GET /google/send-test?to=email@example.com
        // Bypass complet du client pour isoler le problème
        if (service === 'send-test') {
            const testTo = url.searchParams.get('to');
            if (!testTo) {
                return jsonResponse({ error: 'Ajouter ?to=email@example.com' }, 400);
            }
            let accessToken;
            try {
                accessToken = await getAccessToken(request, url, env);
            } catch (e) {
                return jsonResponse({ error: 'Token requis: ' + e.message }, 401);
            }
            if (!accessToken) {
                return jsonResponse({ error: 'Token requis. Ajouter header Authorization: Bearer ...' }, 401);
            }

            // Get sender email
            const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (!profRes.ok) {
                return jsonResponse({ error: 'Profile fetch failed' }, 500);
            }
            const prof = await profRes.json();
            const from = prof.emailAddress;

            // Hardcoded accented subject — NO client involvement
            const testSubject = 'Test v9: hypothécaire à évaluer — été réussi';
            const testBody = '<html><head><meta charset="UTF-8"></head><body><h2>Test d\'encodage v9</h2><p>Si vous lisez ce message correctement, l\'encodage fonctionne!</p><p>Caractères: é è ê ë à â ä ù û ü ô ö î ï ç</p></body></html>';

            const mimeSubject = mimeB(testSubject);
            const b64Body = bodyToBase64(testBody);

            const rawEmail = [
                `From: ${from}`,
                `To: ${testTo}`,
                `Subject: ${mimeSubject}`,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
                'Content-Transfer-Encoding: base64',
                '',
                b64Body
            ].join('\r\n');

            const emailIsAscii = isAscii(rawEmail);
            let encoded, encMethod;
            try {
                encoded = asciiToBase64url(rawEmail);
                encMethod = 'btoa_ok';
            } catch (e) {
                // Find the non-ASCII chars
                const nonAscii = [];
                for (let i = 0; i < rawEmail.length && nonAscii.length < 10; i++) {
                    if (rawEmail.charCodeAt(i) > 127) {
                        nonAscii.push({ pos: i, char: rawEmail[i], code: rawEmail.charCodeAt(i), context: rawEmail.substring(Math.max(0,i-10), i+10) });
                    }
                }
                return jsonResponse({
                    error: 'btoa() failed — non-ASCII in raw email!',
                    message: e.message,
                    emailIsAscii,
                    nonAsciiChars: nonAscii,
                    rawFirst500: rawEmail.substring(0, 500)
                }, 500);
            }

            // Send via Gmail API
            const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ raw: encoded })
            });

            const sendData = await sendRes.json();
            if (!sendRes.ok) {
                return jsonResponse({ error: 'Gmail API error', detail: sendData }, sendRes.status);
            }

            return jsonResponse({
                success: true,
                messageId: sendData.id,
                threadId: sendData.threadId,
                _debug: {
                    version: 'v9-send-test',
                    to: testTo,
                    from: from,
                    subjectMimeB: mimeSubject,
                    emailIsAscii: emailIsAscii,
                    encMethod: encMethod,
                    rawFirst500: rawEmail.substring(0, 500),
                    rawLength: rawEmail.length,
                    encodedFirst100: encoded.substring(0, 100)
                }
            });
        }

        // Manual token refresh endpoint
        if (service === 'refresh-token') {
            return await handleRefreshToken(request, env);
        }

        // Get access token - try multiple methods
        let accessToken = await getAccessToken(request, url, env);

        if (!accessToken) {
            return jsonResponse({
                error: 'Access token required. Provide either Bearer token or X-User-Id + X-Supabase-Key headers'
            }, 401);
        }

        // Route to appropriate handler with retry on token expiration
        try {
            return await routeRequest(service, action, param, accessToken, request, url, requestBody);
        } catch (error) {
            // If token expired, try to refresh and retry
            if (error.message.includes('invalid authentication') ||
                error.message.includes('Invalid Credentials') ||
                error.message.includes('Token has been expired')) {

                console.log('[Google API] Token expired, attempting refresh...');

                const userId = request.headers.get('X-User-Id');
                const supabaseKey = request.headers.get('X-Supabase-Key') || env.SUPABASE_SERVICE_KEY;
                const supabaseUrl = env.SUPABASE_URL;

                if (userId && supabaseKey) {
                    const newToken = await refreshUserToken(userId, supabaseUrl, supabaseKey, env);
                    if (newToken) {
                        console.log('[Google API] Token refreshed successfully, retrying request...');
                        return await routeRequest(service, action, param, newToken, request, url, requestBody);
                    }
                }

                throw new Error('Token expired and could not be refreshed. Please reconnect Google.');
            }
            throw error;
        }

    } catch (error) {
        console.error('Google API Error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}

// ═══════════════════════════════════════════════════════════════
// TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function getAccessToken(request, url, env) {
    // Method 1: Bearer token from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Method 3: User ID + Supabase Key - fetch/refresh token from database
    const userId = request.headers.get('X-User-Id');
    const supabaseKey = request.headers.get('X-Supabase-Key') || env.SUPABASE_SERVICE_KEY;
    const supabaseUrl = env.SUPABASE_URL;

    if (userId && supabaseKey) {
        return await getOrRefreshToken(userId, supabaseUrl, supabaseKey, env);
    }

    return null;
}

async function getOrRefreshToken(userId, supabaseUrl, supabaseKey, env) {
    // Fetch current token info using RPC function (tokens are encrypted in DB)
    const response = await fetch(
        `${supabaseUrl}/rest/v1/rpc/get_google_tokens_for_api`,
        {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_user_id: userId })
        }
    );

    if (!response.ok) {
        console.error('[Google API] Failed to fetch google_connections:', await response.text());
        return null;
    }

    const connection = await response.json();
    if (!connection || !connection.access_token) {
        console.log('[Google API] No Google connection found for user:', userId);
        return null;
    }

    // Check if token is expired or will expire in next 5 minutes
    const expiresAt = new Date(connection.token_expires_at);
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt > fiveMinutesFromNow) {
        // Token is still valid
        console.log('[Google API] Using existing valid token (decrypted)');
        return connection.access_token;
    }

    // Token expired or expiring soon - refresh it
    console.log('[Google API] Token expired or expiring, refreshing...');
    return await refreshUserToken(userId, supabaseUrl, supabaseKey, env, connection.refresh_token);
}

async function refreshUserToken(userId, supabaseUrl, supabaseKey, env, refreshToken = null) {
    // If no refresh token provided, fetch it from database (decrypted)
    if (!refreshToken) {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/rpc/get_google_tokens_for_api`,
            {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_user_id: userId })
            }
        );

        if (!response.ok) {
            console.error('[Google API] Failed to fetch refresh token');
            return null;
        }

        const connection = await response.json();
        if (!connection || !connection.refresh_token) {
            console.error('[Google API] No refresh token found for user');
            return null;
        }

        refreshToken = connection.refresh_token;
    }

    // Get Google OAuth credentials from environment
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('[Google API] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment');
        return null;
    }

    // Refresh the token with Google
    console.log('[Google API] Attempting token refresh with Google...');
    console.log('[Google API] Client ID prefix:', clientId?.substring(0, 20) + '...');
    console.log('[Google API] Refresh token prefix:', refreshToken?.substring(0, 20) + '...');

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        console.error('[Google API] Token refresh failed:', JSON.stringify(error));
        console.error('[Google API] Error description:', error.error_description || 'No description');
        return null;
    }

    const tokenData = await tokenResponse.json();

    // Calculate new expiration time
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();

    // Update token in database (encrypted) using RPC function
    const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/rpc/update_google_token_encrypted`,
        {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                p_user_id: userId,
                p_access_token: tokenData.access_token,
                p_expires_at: expiresAt
            })
        }
    );

    if (!updateResponse.ok) {
        console.error('[Google API] Failed to update token in database:', await updateResponse.text());
        // Still return the new token even if database update failed
    } else {
        console.log('[Google API] Token refreshed and saved to database (encrypted)');
    }

    return tokenData.access_token;
}

async function handleRefreshToken(request, env) {
    const userId = request.headers.get('X-User-Id');
    const supabaseKey = request.headers.get('X-Supabase-Key') || env.SUPABASE_SERVICE_KEY;
    const supabaseUrl = env.SUPABASE_URL;

    // Debug: Check environment variables
    const envCheck = {
        hasGoogleClientId: !!env.GOOGLE_CLIENT_ID,
        hasGoogleClientSecret: !!env.GOOGLE_CLIENT_SECRET,
        hasSupabaseUrl: !!env.SUPABASE_URL,
        hasSupabaseKey: !!env.SUPABASE_SERVICE_KEY,
        userId: userId
    };
    console.log('[Google API] Environment check:', envCheck);

    if (!userId) {
        return jsonResponse({ error: 'X-User-Id header required', envCheck }, 400);
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return jsonResponse({
            error: 'Server configuration error: Missing Google OAuth credentials',
            envCheck
        }, 500);
    }

    if (!supabaseUrl || !supabaseKey) {
        return jsonResponse({
            error: 'Server configuration error: Missing Supabase credentials',
            envCheck
        }, 500);
    }

    const newToken = await refreshUserToken(userId, supabaseUrl, supabaseKey, env);

    if (newToken) {
        return jsonResponse({
            success: true,
            access_token: newToken,
            message: 'Token refreshed successfully',
            expires_in: 3600
        });
    } else {
        return jsonResponse({
            error: 'Failed to refresh token. User may need to reconnect Google.',
            hint: 'Check if refresh_token exists in google_connections table',
            envCheck
        }, 500);
    }
}

async function routeRequest(service, action, param, accessToken, request, url, requestBody = null) {
    switch (service) {
        case 'gmail':
            return await handleGmail(action, param, accessToken, request, requestBody, url);
        case 'calendar':
            return await handleCalendar(action, param, accessToken, request, url, requestBody);
        case 'drive':
            return await handleDrive(action, param, accessToken, request, url);
        default:
            return jsonResponse({ error: 'Unknown service: ' + service }, 404);
    }
}

// ═══════════════════════════════════════════════════════════════
// GMAIL HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleGmail(action, param, accessToken, request, requestBody, url) {
    switch (action) {
        case 'messages':
            return await getGmailMessages(accessToken, requestBody);
        case 'inbox':
            return await getGmailInbox(accessToken, url);
        case 'message':
            return await getGmailMessage(accessToken, param);
        case 'send':
            return await sendGmailMessage(accessToken, requestBody);
        case 'mark-read':
            return await markGmailAsRead(accessToken, requestBody);
        case 'mark-unread':
            return await markGmailAsUnread(accessToken, requestBody);
        default:
            return jsonResponse({ error: 'Unknown Gmail action: ' + action }, 404);
    }
}

async function getGmailMessages(accessToken, body) {
    const { contact_email, max_results = 15 } = body || {};

    if (!contact_email) {
        return jsonResponse({ error: 'contact_email required' }, 400);
    }

    // Search for emails with this contact
    const query = encodeURIComponent(`from:${contact_email} OR to:${contact_email}`);
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${max_results}`;

    const listResponse = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!listResponse.ok) {
        const error = await listResponse.json();
        throw new Error(error.error?.message || 'Gmail API error');
    }

    const listData = await listResponse.json();

    if (!listData.messages || listData.messages.length === 0) {
        return jsonResponse({ messages: [] });
    }

    // Fetch details for each message (in parallel, max 10)
    const messagePromises = listData.messages.slice(0, 10).map(async (msg) => {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
        const msgResponse = await fetch(msgUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!msgResponse.ok) return null;

        const msgData = await msgResponse.json();
        const headers = msgData.payload?.headers || [];

        return {
            id: msgData.id,
            threadId: msgData.threadId,
            snippet: msgData.snippet,
            internalDate: msgData.internalDate,
            labelIds: msgData.labelIds || [],
            from: headers.find(h => h.name === 'From')?.value || '',
            to: headers.find(h => h.name === 'To')?.value || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || ''
        };
    });

    const messages = (await Promise.all(messagePromises)).filter(Boolean);

    return jsonResponse({ messages });
}

/**
 * GET /gmail/inbox - Récupérer les emails récents de la boîte de réception
 * Query params:
 *   - q: Gmail search query (ex: "is:unread in:inbox", "in:inbox newer_than:1d")
 *   - max_results: nombre max d'emails (défaut 20)
 *
 * Utilisé par le Command Center pour lister tous les emails récents
 * (contrairement à /gmail/messages qui filtre par contact_email)
 */
async function getGmailInbox(accessToken, url) {
    const searchQuery = url.searchParams.get('q') || 'is:unread in:inbox';
    const maxResults = parseInt(url.searchParams.get('max_results')) || 20;
    const countOnly = url.searchParams.get('count_only') === 'true';

    const query = encodeURIComponent(searchQuery);
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${countOnly ? 1 : maxResults}`;

    const listResponse = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!listResponse.ok) {
        const error = await listResponse.json();
        throw new Error(error.error?.message || 'Gmail API error');
    }

    const listData = await listResponse.json();
    const resultSizeEstimate = listData.resultSizeEstimate || 0;

    if (!listData.messages || listData.messages.length === 0) {
        return jsonResponse({ messages: [], resultSizeEstimate: 0 });
    }

    // Mode count_only : retourner juste le nombre estimé sans charger les détails
    if (countOnly) {
        return jsonResponse({ messages: [], resultSizeEstimate });
    }

    // Fetch details for each message (in parallel)
    const messagePromises = listData.messages.slice(0, maxResults).map(async (msg) => {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
        const msgResponse = await fetch(msgUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!msgResponse.ok) return null;

        const msgData = await msgResponse.json();
        const headers = msgData.payload?.headers || [];

        return {
            id: msgData.id,
            threadId: msgData.threadId,
            snippet: msgData.snippet,
            from: headers.find(h => h.name === 'From')?.value || '',
            to: headers.find(h => h.name === 'To')?.value || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
            internalDate: msgData.internalDate || null,
            labelIds: msgData.labelIds || []
        };
    });

    const messages = (await Promise.all(messagePromises)).filter(Boolean);

    return jsonResponse({ messages, resultSizeEstimate });
}

async function markGmailAsRead(accessToken, body) {
    const { message_ids } = body || {};
    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
        return jsonResponse({ error: 'message_ids array required' }, 400);
    }

    const results = [];
    for (const msgId of message_ids.slice(0, 20)) {
        try {
            const res = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
                }
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                results.push({ id: msgId, success: false, status: res.status, error: errBody });
            } else {
                results.push({ id: msgId, success: true });
            }
        } catch (e) {
            results.push({ id: msgId, success: false, error: e.message });
        }
    }

    return jsonResponse({
        success: results.some(r => r.success),
        updated: results.filter(r => r.success).length,
        total: message_ids.length,
        results
    });
}

async function markGmailAsUnread(accessToken, body) {
    const { message_ids } = body || {};
    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
        return jsonResponse({ error: 'message_ids array required' }, 400);
    }

    const results = [];
    for (const msgId of message_ids.slice(0, 20)) {
        try {
            const res = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ addLabelIds: ['UNREAD'] })
                }
            );
            results.push({ id: msgId, success: res.ok });
        } catch (e) {
            results.push({ id: msgId, success: false, error: e.message });
        }
    }

    return jsonResponse({
        success: results.some(r => r.success),
        updated: results.filter(r => r.success).length,
        total: message_ids.length,
        results
    });
}

async function getGmailMessage(accessToken, messageId) {
    if (!messageId) {
        return jsonResponse({ error: 'Message ID required' }, 400);
    }

    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
    const response = await fetch(msgUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Gmail API error');
    }

    const data = await response.json();
    const headers = data.payload?.headers || [];

    // Extract body (prefer HTML, fallback text/plain)
    let body = '';
    let bodyHtml = '';
    function extractParts(parts) {
        if (!parts) return;
        for (const part of parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
                bodyHtml = decodeBase64(part.body.data);
            } else if (part.mimeType === 'text/plain' && part.body?.data && !body) {
                body = decodeBase64(part.body.data);
            }
            if (part.parts) extractParts(part.parts);
        }
    }

    if (data.payload?.body?.data) {
        if (data.payload.mimeType === 'text/html') {
            bodyHtml = decodeBase64(data.payload.body.data);
        } else {
            body = decodeBase64(data.payload.body.data);
        }
    }
    if (data.payload?.parts) {
        extractParts(data.payload.parts);
    }

    // Extract attachments metadata
    const attachments = [];
    function extractAttachments(parts) {
        if (!parts) return;
        for (const part of parts) {
            if (part.filename && part.body?.attachmentId) {
                attachments.push({
                    filename: part.filename,
                    mimeType: part.mimeType,
                    size: part.body.size || 0,
                    attachmentId: part.body.attachmentId
                });
            }
            if (part.parts) extractAttachments(part.parts);
        }
    }
    extractAttachments(data.payload?.parts);

    return jsonResponse({
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds || [],
        internalDate: data.internalDate,
        from: headers.find(h => h.name === 'From')?.value || '',
        to: headers.find(h => h.name === 'To')?.value || '',
        cc: headers.find(h => h.name === 'Cc')?.value || '',
        subject: headers.find(h => h.name === 'Subject')?.value || '',
        date: headers.find(h => h.name === 'Date')?.value || '',
        messageId: headers.find(h => h.name === 'Message-ID' || h.name === 'Message-Id')?.value || '',
        snippet: data.snippet,
        body: bodyHtml || body,
        bodyText: body,
        attachments: attachments
    });
}

async function sendGmailMessage(accessToken, requestBody) {
    const {
        to, subject, body: messageBody,
        signature, html,
        attachments,
        in_reply_to, thread_id
    } = requestBody || {};

    if (!to) {
        return jsonResponse({ error: 'Recipient (to) required' }, 400);
    }

    // Get sender email
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!profileResponse.ok) {
        throw new Error('Could not get user profile');
    }

    const profile = await profileResponse.json();
    const fromEmail = profile.emailAddress;

    // Build HTML body with signature
    let bodyContent = messageBody || '';
    // Convert plain text newlines to HTML breaks
    let htmlBody = bodyContent.replace(/\n/g, '<br>\n');

    if (signature) {
        htmlBody += '<br><br>' + signature;
    }

    // Wrap in full HTML
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;">${htmlBody}</body></html>`;

    // ═══ v9: Pure ASCII enforcement + btoa() ═══
    // EVERY non-ASCII part gets MIME B-encoded → emailRaw is guaranteed 100% ASCII
    // btoa() will THROW if any non-ASCII sneaks through (instant detection)
    const safeSubject = subject || '(Sans objet)';
    const fromName = fromEmail.split('@')[0];
    const hasAttachments = attachments && attachments.length > 0;
    const boundary = 'finox_boundary_' + Date.now();

    // MIME B-encode subject AND fromName (fromName can have accented chars!)
    const mimeSubject = mimeB(safeSubject);
    const safeFrom = safeHeader(fromName);
    const safeTo = safeEmailHeader(to);

    const headerLines = [
        `From: ${safeFrom} <${fromEmail}>`,
        `To: ${safeTo}`,
        `Subject: ${mimeSubject}`,
        'MIME-Version: 1.0'
    ];

    if (in_reply_to) {
        headerLines.push(`In-Reply-To: ${in_reply_to}`);
        headerLines.push(`References: ${in_reply_to}`);
    }

    // Body HTML → base64 (result is pure ASCII)
    const bodyBase64 = bodyToBase64(fullHtml);

    let emailRaw = '';

    if (hasAttachments) {
        headerLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
        emailRaw = headerLines.join('\r\n') + '\r\n\r\n';
        emailRaw += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${bodyBase64}\r\n`;
        for (const att of attachments) {
            const attName = att.filename || att.name || 'file';
            const safeName = isAscii(attName) ? attName : mimeB(attName);
            const mimeType = att.mimeType || att.type || 'application/octet-stream';
            const base64 = att.base64Data || att.data || '';
            emailRaw += `--${boundary}\r\nContent-Type: ${mimeType}; name="${safeName}"\r\nContent-Disposition: attachment; filename="${safeName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n`;
        }
        emailRaw += `--${boundary}--`;
    } else {
        headerLines.push('Content-Type: text/html; charset=UTF-8');
        headerLines.push('Content-Transfer-Encoding: base64');
        emailRaw = headerLines.join('\r\n') + '\r\n\r\n' + bodyBase64;
    }

    // ── CRITICAL: Encode via btoa() — throws if non-ASCII present ──
    const emailIsAscii = isAscii(emailRaw);
    let encodedEmail, encodeMethod;

    try {
        encodedEmail = asciiToBase64url(emailRaw);
        encodeMethod = 'btoa';
    } catch (btoaError) {
        // btoa failed! Find where the non-ASCII chars are
        const nonAscii = [];
        for (let i = 0; i < emailRaw.length && nonAscii.length < 5; i++) {
            if (emailRaw.charCodeAt(i) > 127) {
                nonAscii.push({
                    pos: i,
                    charCode: emailRaw.charCodeAt(i),
                    context: emailRaw.substring(Math.max(0, i - 20), i + 20)
                });
            }
        }
        // Return error with diagnostic instead of crashing
        return jsonResponse({
            error: 'btoa() failed — non-ASCII detected in raw email',
            version: 'v9',
            btoaError: btoaError.message,
            emailIsAscii,
            nonAsciiFound: nonAscii,
            headerPreview: emailRaw.substring(0, 400)
        }, 500);
    }

    // Build send payload
    const sendPayload = { raw: encodedEmail };
    if (thread_id) {
        sendPayload.threadId = thread_id;
    }

    // Send via JSON raw endpoint
    const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(sendPayload)
    });

    if (!sendResponse.ok) {
        const error = await sendResponse.json().catch(() => ({}));
        throw new Error(error.error?.message || 'Failed to send email');
    }

    const result = await sendResponse.json();
    return jsonResponse({
        success: true,
        messageId: result.id,
        threadId: result.threadId,
        _debug: {
            version: 'v9-btoa',
            encodeMethod,
            emailIsAscii,
            subjectReceived: subject,
            subjectCodePoints: Array.from(subject || '').slice(0, 20).map(c => c.codePointAt(0)),
            mimeSubject: mimeSubject,
            fromName: fromName,
            fromNameIsAscii: isAscii(fromName),
            toIsAscii: isAscii(to),
            rawFirst400: emailRaw.substring(0, 400),
            rawLength: emailRaw.length,
            base64urlFirst80: encodedEmail.substring(0, 80)
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleCalendar(action, param, accessToken, request, url, requestBody) {
    switch (action) {
        case 'events':
            if (request.method === 'POST') {
                return await createCalendarEvent(accessToken, requestBody);
            } else if (request.method === 'DELETE') {
                return await deleteCalendarEvent(accessToken, param);
            } else {
                return await getCalendarEvents(accessToken, url);
            }
        default:
            return jsonResponse({ error: 'Unknown Calendar action: ' + action }, 404);
    }
}

async function getCalendarEvents(accessToken, url) {
    const timeMin = url.searchParams.get('timeMin') || new Date().toISOString();
    const timeMax = url.searchParams.get('timeMax') || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

    const response = await fetch(calUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Calendar API error');
    }

    const data = await response.json();

    const events = (data.items || []).map(event => ({
        id: event.id,
        summary: event.summary || '',
        description: event.description || '',
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        allDay: !event.start?.dateTime,
        transparency: event.transparency || 'opaque',
        location: event.location || '',
        attendees: event.attendees || [],
        hangoutLink: event.hangoutLink || '',
        colorId: event.colorId || null,
        htmlLink: event.htmlLink || ''
    }));

    return jsonResponse({ events });
}

async function createCalendarEvent(accessToken, requestBody) {
    const { summary, description, start, end, attendees, addGoogleMeet, location } = requestBody || {};

    if (!summary || !start || !end) {
        return jsonResponse({ error: 'summary, start, and end are required' }, 400);
    }

    const eventBody = {
        summary,
        description: description || '',
        start: { dateTime: start, timeZone: 'America/Toronto' },
        end: { dateTime: end, timeZone: 'America/Toronto' }
    };

    if (location) {
        eventBody.location = location;
    }

    // Build attendees list, auto-include Finox AI bot for Meet recordings
    const FINOX_BOT_EMAIL = 'finox-bot@finox.ca';
    const attendeeList = (attendees || []).map(email => ({ email }));
    if (addGoogleMeet && !attendeeList.some(a => a.email === FINOX_BOT_EMAIL)) {
        attendeeList.push({ email: FINOX_BOT_EMAIL, responseStatus: 'accepted' });
    }
    if (attendeeList.length > 0) {
        eventBody.attendees = attendeeList;
    }

    if (addGoogleMeet) {
        eventBody.conferenceData = {
            createRequest: {
                requestId: 'finox-' + Date.now(),
                conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
        };
    }

    const calUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
                  (addGoogleMeet ? '?conferenceDataVersion=1' : '');

    const response = await fetch(calUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to create event');
    }

    const result = await response.json();
    return jsonResponse({
        success: true,
        eventId: result.id,
        htmlLink: result.htmlLink,
        hangoutLink: result.hangoutLink || null
    });
}

async function deleteCalendarEvent(accessToken, eventId) {
    if (!eventId) {
        return jsonResponse({ error: 'Event ID required' }, 400);
    }

    const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;

    const response = await fetch(calUrl, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    // Google Calendar DELETE returns 204 No Content on success
    if (response.status === 204 || response.ok) {
        return jsonResponse({ success: true, deletedEventId: eventId });
    }

    const error = await response.json().catch(() => ({ error: { message: 'Delete failed' } }));
    throw new Error(error.error?.message || 'Failed to delete event');
}

// ═══════════════════════════════════════════════════════════════
// DRIVE HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleDrive(action, param, accessToken, request, url) {
    switch (action) {
        case 'files':
            return await getDriveFiles(accessToken, url);
        case 'folders':
            return await getDriveFolders(accessToken, url);
        default:
            return jsonResponse({ error: 'Unknown Drive action: ' + action }, 404);
    }
}

async function getDriveFiles(accessToken, url) {
    const folderId = url.searchParams.get('folderId') || 'root';
    const query = url.searchParams.get('q') || '';

    let driveQuery = `'${folderId}' in parents and trashed = false`;
    if (query) {
        driveQuery += ` and name contains '${query}'`;
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(driveQuery)}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)&orderBy=modifiedTime desc`;

    const response = await fetch(driveUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Drive API error');
    }

    const data = await response.json();
    return jsonResponse({ files: data.files || [] });
}

async function getDriveFolders(accessToken, url) {
    const parentId = url.searchParams.get('parentId') || 'root';

    const driveQuery = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(driveQuery)}&fields=files(id,name,modifiedTime)&orderBy=name`;

    const response = await fetch(driveUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Drive API error');
    }

    const data = await response.json();
    return jsonResponse({ folders: data.files || [] });
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: CORS_HEADERS
    });
}

function decodeBase64(data) {
    try {
        // URL-safe base64 to standard base64
        const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(base64);
        // Decode UTF-8
        return decodeURIComponent(escape(decoded));
    } catch (e) {
        return data;
    }
}
