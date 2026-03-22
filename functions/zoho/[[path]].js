/**
 * FINOX Zoho Bridge - Cloudflare Pages Function
 * Pont entre Zoho CRM et l'ABF Finox standalone.
 *
 * Endpoints:
 * - POST /zoho/sync-client      - Créer/MAJ un client depuis Zoho (webhook)
 * - GET  /zoho/launch            - Rediriger vers ABF avec client_id
 * - GET  /zoho/status/:clientId  - Retourner le % ABF complété
 * - GET  /zoho/health            - Health check
 */

let SUPABASE_URL, SUPABASE_SERVICE_KEY;

const ORG_ID = '7572c420-6c4d-4313-8284-7ba5a4351f2c';

// Rate limiter simple
const rateLimits = new Map();
function checkRateLimit(ip, max = 30, windowMs = 60000, endpoint = 'default') {
    const now = Date.now();
    if (rateLimits.size > 200) {
        for (const [k, v] of rateLimits) {
            if (now - v.start > 120000) rateLimits.delete(k);
        }
    }
    const key = (ip || 'unknown') + ':' + endpoint;
    const entry = rateLimits.get(key);
    if (!entry || now - entry.start > windowMs) {
        rateLimits.set(key, { start: now, count: 1 });
        return true;
    }
    entry.count++;
    return entry.count <= max;
}

function json(data, corsHeaders, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

// ═══════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════
export async function onRequest(context) {
    const { request, env } = context;

    SUPABASE_URL = env.SUPABASE_URL;
    SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

    const ALLOWED_ORIGINS = [
        'https://abf.finox.ca',
        'https://crm.finox.ca',
        'https://crm-finox.ca',
        'http://localhost:8788',
        'http://localhost:3000'
    ];
    const reqOrigin = request.headers.get('Origin') || '';
    const corsHeaders = {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Zoho-Key',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const route = path.replace('/zoho', '');

    try {
        // Health check
        if (route === '/health' || route === '' || route === '/') {
            return json({ status: 'ok', service: 'finox-zoho-bridge', timestamp: new Date().toISOString() }, corsHeaders);
        }

        // POST /zoho/sync-client
        if (route === '/sync-client' && request.method === 'POST') {
            const ip = request.headers.get('cf-connecting-ip');
            if (!checkRateLimit(ip, 30, 60000, 'sync')) {
                return json({ error: 'Rate limit exceeded' }, corsHeaders, 429);
            }
            return await handleSyncClient(request, env, corsHeaders);
        }

        // GET /zoho/launch?client_id=xxx ou ?zoho_id=xxx
        if (route === '/launch' && request.method === 'GET') {
            return await handleLaunch(url, env, corsHeaders);
        }

        // GET /zoho/status/:clientId
        const statusMatch = route.match(/^\/status\/(.+)$/);
        if (statusMatch && request.method === 'GET') {
            return await handleStatus(statusMatch[1], env, corsHeaders);
        }

        return json({ error: 'Route not found' }, corsHeaders, 404);
    } catch (err) {
        console.error('Zoho bridge error:', err);
        return json({ error: 'Internal server error', details: err.message }, corsHeaders, 500);
    }
}

// ═══════════════════════════════════════════════════════════════
// SYNC CLIENT - Webhook Zoho → Supabase
// ═══════════════════════════════════════════════════════════════
async function handleSyncClient(request, env, corsHeaders) {
    // Vérifier la clé API Zoho (simple shared secret)
    const apiKey = request.headers.get('X-Zoho-Key') || '';
    if (!env.ZOHO_API_KEY || apiKey !== env.ZOHO_API_KEY) {
        return json({ error: 'Unauthorized - invalid API key' }, corsHeaders, 401);
    }

    const body = await request.json();
    const { zoho_id, first_name, last_name, email, phone, phone_mobile, date_of_birth, sex, address, city, province, postal_code, conseiller_email } = body;

    if (!zoho_id || !first_name || !last_name) {
        return json({ error: 'Missing required fields: zoho_id, first_name, last_name' }, corsHeaders, 400);
    }

    // Trouver le conseiller par email (pour assigner le client)
    let conseiller_id = null;
    if (conseiller_email) {
        const profileRes = await supabaseFetch(`/rest/v1/profiles?email=eq.${encodeURIComponent(conseiller_email)}&select=id&limit=1`);
        if (profileRes.ok) {
            const profiles = await profileRes.json();
            if (profiles.length > 0) conseiller_id = profiles[0].id;
        }
    }

    // Vérifier si le client existe déjà (par zoho_id)
    const existingRes = await supabaseFetch(`/rest/v1/clients?zoho_id=eq.${encodeURIComponent(zoho_id)}&organization_id=eq.${ORG_ID}&select=id&limit=1`);
    const existing = existingRes.ok ? await existingRes.json() : [];

    const clientData = {
        first_name,
        last_name,
        zoho_id,
        organization_id: ORG_ID,
        ...(email && { email }),
        ...(phone && { phone }),
        ...(phone_mobile && { phone_mobile }),
        ...(date_of_birth && { date_of_birth }),
        ...(sex && { sex }),
        ...(address && { address }),
        ...(city && { city }),
        ...(province && { province }),
        ...(postal_code && { postal_code }),
        ...(conseiller_id && { conseiller_id }),
    };

    let clientId;
    let action;

    if (existing.length > 0) {
        // Update
        clientId = existing[0].id;
        clientData.updated_at = new Date().toISOString();
        const updateRes = await supabaseFetch(`/rest/v1/clients?id=eq.${clientId}`, {
            method: 'PATCH',
            body: JSON.stringify(clientData),
        });
        if (!updateRes.ok) {
            const err = await updateRes.text();
            return json({ error: 'Failed to update client', details: err }, corsHeaders, 500);
        }
        action = 'updated';
    } else {
        // Insert
        clientData.type_contact = 'client';
        clientData.status = 'client';
        clientData.created_at = new Date().toISOString();
        clientData.updated_at = new Date().toISOString();
        const insertRes = await supabaseFetch('/rest/v1/clients', {
            method: 'POST',
            body: JSON.stringify(clientData),
            headers: { 'Prefer': 'return=representation' },
        });
        if (!insertRes.ok) {
            const err = await insertRes.text();
            return json({ error: 'Failed to create client', details: err }, corsHeaders, 500);
        }
        const inserted = await insertRes.json();
        clientId = inserted[0].id;
        action = 'created';
    }

    return json({
        success: true,
        action,
        client_id: clientId,
        abf_url: `https://abf.finox.ca/abf.html?from=zoho&id=${clientId}`,
    }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// LAUNCH - Rediriger vers ABF (auto-create si client n'existe pas)
// ═══════════════════════════════════════════════════════════════
async function handleLaunch(url, env, corsHeaders) {
    const clientId = url.searchParams.get('client_id');
    const zohoId = url.searchParams.get('zoho_id');
    const firstName = url.searchParams.get('first_name') || '';
    const lastName = url.searchParams.get('last_name') || '';
    const email = url.searchParams.get('email') || '';
    const phone = url.searchParams.get('phone') || '';
    const dob = url.searchParams.get('dob') || '';
    const sex = url.searchParams.get('sex') || '';
    const smoker = url.searchParams.get('smoker') || '';
    const conseillerEmail = url.searchParams.get('conseiller_email') || '';

    if (!clientId && !zohoId) {
        return json({ error: 'Provide client_id or zoho_id' }, corsHeaders, 400);
    }

    let targetId = clientId;

    if (!targetId && zohoId) {
        // Chercher le client par zoho_id
        const res = await supabaseFetch(`/rest/v1/clients?zoho_id=eq.${encodeURIComponent(zohoId)}&organization_id=eq.${ORG_ID}&select=id&limit=1`);
        if (res.ok) {
            const clients = await res.json();
            if (clients.length > 0) {
                targetId = clients[0].id;
            }
        }

        // Auto-create si le client n'existe pas encore
        if (!targetId) {
            // Trouver le conseiller par email pour l'assigner
            let conseiller_id = null;
            if (conseillerEmail) {
                const profileRes = await supabaseFetch(`/rest/v1/profiles?email=eq.${encodeURIComponent(conseillerEmail)}&select=id&limit=1`);
                if (profileRes.ok) {
                    const profiles = await profileRes.json();
                    if (profiles.length > 0) conseiller_id = profiles[0].id;
                }
            }

            const newClient = {
                zoho_id: zohoId,
                first_name: firstName || 'Nouveau',
                last_name: lastName || 'Client',
                organization_id: ORG_ID,
                type_contact: 'client',
                status: 'prospect',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...(email && { email }),
                ...(phone && { phone }),
                ...(dob && { date_of_birth: dob }),
                ...(sex && { sex }),
                ...(smoker && { smoker: smoker === 'true' || smoker === 'Oui' }),
                ...(conseiller_id && { conseiller_id }),
            };

            const insertRes = await supabaseFetch('/rest/v1/clients', {
                method: 'POST',
                body: JSON.stringify(newClient),
                headers: { 'Prefer': 'return=representation' },
            });

            if (insertRes.ok) {
                const inserted = await insertRes.json();
                targetId = inserted[0].id;
            } else {
                const err = await insertRes.text();
                return json({ error: 'Failed to create client', details: err }, corsHeaders, 500);
            }
        }
    }

    // Redirect vers ABF
    const host = url.hostname.includes('pages.dev') ? url.origin : 'https://abf.crm-finox.ca';
    const abfUrl = `${host}/abf.html?from=zoho&id=${targetId}`;
    return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, 'Location': abfUrl }
    });
}

// ═══════════════════════════════════════════════════════════════
// STATUS - % ABF complété
// ═══════════════════════════════════════════════════════════════
async function handleStatus(clientIdOrZohoId, env, corsHeaders) {
    let clientId = clientIdOrZohoId;

    // Si c'est pas un UUID, c'est probablement un zoho_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientIdOrZohoId);
    if (!isUuid) {
        const res = await supabaseFetch(`/rest/v1/clients?zoho_id=eq.${encodeURIComponent(clientIdOrZohoId)}&organization_id=eq.${ORG_ID}&select=id&limit=1`);
        if (res.ok) {
            const clients = await res.json();
            if (clients.length > 0) {
                clientId = clients[0].id;
            } else {
                return json({ error: 'Client not found' }, corsHeaders, 404);
            }
        }
    }

    // Récupérer les données client pour évaluer la complétion
    const clientRes = await supabaseFetch(`/rest/v1/clients?id=eq.${clientId}&select=first_name,last_name,email,phone,date_of_birth,address,city,revenu_emploi,total_actifs,total_passifs,abf_data,objectifs_client&limit=1`);
    if (!clientRes.ok) {
        return json({ error: 'Failed to fetch client' }, corsHeaders, 500);
    }
    const clients = await clientRes.json();
    if (clients.length === 0) {
        return json({ error: 'Client not found' }, corsHeaders, 404);
    }
    const client = clients[0];

    // Compter les sections ABF remplies
    const sections = {
        contact: !!(client.first_name && client.last_name && client.date_of_birth),
        coordonnees: !!(client.email || client.phone),
        adresse: !!(client.address && client.city),
        emploi: !!client.revenu_emploi,
        actifs: client.total_actifs !== null && client.total_actifs !== undefined,
        objectifs: !!(client.objectifs_client && Object.keys(client.objectifs_client).length > 0),
    };

    // Vérifier les tables ABF dédiées
    const abfRes = await supabaseFetch(`/rest/v1/abf?client_id=eq.${clientId}&select=id&limit=1`);
    const abfRows = abfRes.ok ? await abfRes.json() : [];
    sections.abf_form = abfRows.length > 0;

    const assRes = await supabaseFetch(`/rest/v1/abf_assurances?client_id=eq.${clientId}&select=id&limit=1`);
    const assRows = assRes.ok ? await assRes.json() : [];
    sections.assurances = assRows.length > 0;

    const completed = Object.values(sections).filter(Boolean).length;
    const total = Object.keys(sections).length;
    const percentage = Math.round((completed / total) * 100);

    return json({
        client_id: clientId,
        client_name: `${client.first_name} ${client.last_name}`,
        abf_completion: {
            percentage,
            completed,
            total,
            sections
        },
        abf_url: `https://abf.finox.ca/abf.html?from=zoho&id=${clientId}`,
    }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
async function supabaseFetch(path, options = {}) {
    const url = `${SUPABASE_URL}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
}
