/**
 * FINOX Shared Links - Cloudflare Pages Function
 * Génère et gère des liens temporaires pour que les clients
 * puissent remplir des formulaires sans login.
 *
 * Endpoints:
 * - POST /share/generate          - Générer un lien (auth JWT requise)
 * - GET  /share/validate/:token   - Valider un token (public)
 * - GET  /share/load/:token       - Charger les données existantes (public)
 * - POST /share/save/:token       - Sauvegarder les données du formulaire (public)
 * - GET  /share/links/:clientId   - Lister les liens d'un client (auth JWT)
 * - POST /share/revoke/:linkId    - Révoquer un lien (auth JWT)
 * - GET  /share/health            - Health check
 */

let SUPABASE_URL, SUPABASE_SERVICE_KEY;

// Rate limiter simple en mémoire — par endpoint pour éviter que les appels
// normaux d'un chargement de page (validate + db + module) s'entreconsomment
const rateLimits = new Map();
function checkRateLimit(ip, max = 10, windowMs = 60000, endpoint = 'default') {
    const now = Date.now();
    // Nettoyage inline des entrées expirées (pas de setInterval en global scope)
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
    if (entry.count > max) return false;
    return true;
}

// ═══════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════
export async function onRequest(context) {
    const { request, env } = context;

    SUPABASE_URL = env.SUPABASE_URL;
    SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

    const ALLOWED_ORIGINS = ['https://crm.finox.ca', 'https://crm-finox.ca', 'http://localhost:8788', 'http://localhost:3000'];
    const reqOrigin = request.headers.get('Origin') || '';
    const corsHeaders = {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const route = path.replace('/share', '');

    try {
        // Health check
        if (route === '/health' || route === '') {
            return json({ status: 'ok', service: 'finox-shared-links', timestamp: new Date().toISOString() }, corsHeaders);
        }

        // POST /share/generate (auth)
        if (route === '/generate' && request.method === 'POST') {
            return await handleGenerate(request, corsHeaders);
        }

        // GET /share/validate/:token (public)
        const validateMatch = route.match(/^\/validate\/(.+)$/);
        if (validateMatch && request.method === 'GET') {
            const ip = request.headers.get('cf-connecting-ip');
            if (!checkRateLimit(ip, 20, 60000, 'validate')) return json({ error: 'Rate limit exceeded' }, corsHeaders, 429);
            return await handleValidate(validateMatch[1], corsHeaders);
        }

        // GET /share/load/:token (public)
        const loadMatch = route.match(/^\/load\/(.+)$/);
        if (loadMatch && request.method === 'GET') {
            const ip = request.headers.get('cf-connecting-ip');
            if (!checkRateLimit(ip, 20, 60000, 'load')) return json({ error: 'Rate limit exceeded' }, corsHeaders, 429);
            return await handleLoad(loadMatch[1], corsHeaders);
        }

        // POST /share/save/:token (public)
        const saveMatch = route.match(/^\/save\/(.+)$/);
        if (saveMatch && request.method === 'POST') {
            const ip = request.headers.get('cf-connecting-ip');
            if (!checkRateLimit(ip, 10, 60000, 'save')) return json({ error: 'Rate limit exceeded' }, corsHeaders, 429);
            return await handleSave(saveMatch[1], request, corsHeaders);
        }

        // GET /share/links/:clientId (auth)
        const linksMatch = route.match(/^\/links\/(.+)$/);
        if (linksMatch && request.method === 'GET') {
            return await handleListLinks(linksMatch[1], request, corsHeaders);
        }

        // POST /share/revoke/:linkId (auth)
        const revokeMatch = route.match(/^\/revoke\/(.+)$/);
        if (revokeMatch && request.method === 'POST') {
            return await handleRevoke(revokeMatch[1], request, corsHeaders);
        }

        // POST /share/db/:token — Proxy DB pour modules réels
        const dbMatch = route.match(/^\/db\/(.+)$/);
        if (dbMatch && request.method === 'POST') {
            const ip = request.headers.get('cf-connecting-ip');
            if (!checkRateLimit(ip, 60, 60000, 'db')) return json({ error: 'Rate limit exceeded' }, corsHeaders, 429);
            return await handleDbProxy(dbMatch[1], request, corsHeaders);
        }

        // GET /share/module/:moduleName — Servir le HTML d'un module
        const moduleMatch = route.match(/^\/module\/(.+)$/);
        if (moduleMatch && request.method === 'GET') {
            const ip = request.headers.get('cf-connecting-ip');
            if (!checkRateLimit(ip, 20, 60000, 'module')) return json({ error: 'Rate limit exceeded' }, corsHeaders, 429);
            // Redirect vers le fichier statique du module
            const moduleName = moduleMatch[1];
            const allowed = ['outil-budget', 'outil-profil-investisseur', 'outil-calc-hypo', 'outil-reee', 'outils-calculateur-vie'];
            if (!allowed.includes(moduleName)) return json({ error: 'Module not allowed' }, corsHeaders, 403);
            const moduleUrl = `https://crm.finox.ca/modules/${moduleName}.html`;
            const moduleRes = await fetch(moduleUrl);
            if (!moduleRes.ok) return json({ error: 'Module not found' }, corsHeaders, 404);
            const html = await moduleRes.text();
            return new Response(html, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        return json({ error: 'Not found', path }, corsHeaders, 404);

    } catch (error) {
        console.error('Share function error:', error);
        return json({ error: error.message }, corsHeaders, 500);
    }
}

function json(data, corsHeaders, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// ═══════════════════════════════════════════════════════════════
// AUTH HELPER
// ═══════════════════════════════════════════════════════════════
async function verifyAuth(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.replace('Bearer ', '');

    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${token}`
        }
    });

    if (!res.ok) return null;
    return await res.json();
}

// ═══════════════════════════════════════════════════════════════
// GENERATE — Créer un lien partageable
// ═══════════════════════════════════════════════════════════════
async function handleGenerate(request, cors) {
    const user = await verifyAuth(request);
    if (!user) return json({ error: 'Unauthorized' }, cors, 401);

    const body = await request.json();
    const { client_id, tool_type, expiry_days = 10 } = body;

    if (!client_id || !tool_type) {
        return json({ error: 'client_id and tool_type required' }, cors, 400);
    }

    const validTools = ['budget', 'profil_investisseur', 'calc_hypo', 'reee', 'assurance_vie'];
    if (!validTools.includes(tool_type)) {
        return json({ error: `Invalid tool_type. Must be one of: ${validTools.join(', ')}` }, cors, 400);
    }

    // Générer un token crypto 32 bytes → hex 64 chars
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Récupérer le prénom du client
    const clientRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}&select=first_name,conseiller_id,organization_id`,
        { headers: sbHeaders() }
    );
    const clients = await clientRes.json();
    const client = clients[0];
    if (!client) return json({ error: 'Client not found' }, cors, 404);

    // Récupérer l'org_id du profil
    const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=organization_id`,
        { headers: sbHeaders() }
    );
    const profiles = await profileRes.json();
    const orgId = profiles[0]?.organization_id || client.organization_id;

    const expiresAt = new Date(Date.now() + expiry_days * 24 * 60 * 60 * 1000).toISOString();

    // Insérer le lien
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/client_shared_links`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({
            token,
            client_id,
            tool_type,
            conseiller_id: user.id,
            organization_id: orgId,
            expires_at: expiresAt,
            client_first_name: client.first_name || 'Client'
        })
    });

    if (!insertRes.ok) {
        const err = await insertRes.text();
        throw new Error(`Failed to create link: ${err}`);
    }

    const [link] = await insertRes.json();

    // Timeline entry
    const toolLabels = { budget: 'Budget Personnel', profil_investisseur: 'Profil Investisseur', calc_hypo: 'Calc. Hypothécaire', reee: 'REEE', assurance_vie: 'Assurance Vie' };
    await addTimeline(client_id, 'shared_link_created', `🔗 Lien client généré — ${toolLabels[tool_type]}`, `Expire le ${new Date(expiresAt).toLocaleDateString('fr-CA')}`);

    return json({
        success: true,
        link_id: link.id,
        token,
        url: `https://crm.finox.ca/client-form.html?t=${token}`,
        expires_at: expiresAt,
        tool_type
    }, cors);
}

// ═══════════════════════════════════════════════════════════════
// VALIDATE — Vérifier un token (public)
// ═══════════════════════════════════════════════════════════════
async function handleValidate(token, cors) {
    const link = await getLink(token);
    if (!link) return json({ valid: false, reason: 'not_found' }, cors);
    if (link.is_revoked) return json({ valid: false, reason: 'revoked' }, cors);
    if (new Date(link.expires_at) < new Date()) return json({ valid: false, reason: 'expired' }, cors);

    // Incrémenter access_count
    await fetch(`${SUPABASE_URL}/rest/v1/client_shared_links?id=eq.${link.id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            access_count: (link.access_count || 0) + 1,
            last_accessed_at: new Date().toISOString()
        })
    });

    return json({
        valid: true,
        tool_type: link.tool_type,
        client_id: link.client_id,
        client_first_name: link.client_first_name || 'Client',
        expires_at: link.expires_at,
        completed_at: link.completed_at
    }, cors);
}

// ═══════════════════════════════════════════════════════════════
// LOAD — Charger données existantes (public)
// ═══════════════════════════════════════════════════════════════
async function handleLoad(token, cors) {
    const link = await getValidLink(token);
    if (!link) return json({ error: 'Invalid or expired link' }, cors, 403);

    let data = null;

    switch (link.tool_type) {
        case 'budget': {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/abf_budget?client_id=eq.${link.client_id}&order=ordre`,
                { headers: sbHeaders() }
            );
            data = await res.json();
            break;
        }
        case 'profil_investisseur': {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/clients?id=eq.${link.client_id}&select=profil_investisseur_data`,
                { headers: sbHeaders() }
            );
            const rows = await res.json();
            data = rows[0]?.profil_investisseur_data || null;
            break;
        }
        case 'calc_hypo': {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/clients?id=eq.${link.client_id}&select=tools_data`,
                { headers: sbHeaders() }
            );
            const rows = await res.json();
            data = rows[0]?.tools_data?.calc_hypo || null;
            break;
        }
        case 'reee': {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/clients?id=eq.${link.client_id}&select=abf_data`,
                { headers: sbHeaders() }
            );
            const rows = await res.json();
            data = rows[0]?.abf_data?.reee || null;
            break;
        }
        case 'assurance_vie': {
            // Charger la dernière recherche sauvegardée
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/client_recherches_assurance_vie?client_id=eq.${link.client_id}&order=created_at.desc&limit=1`,
                { headers: sbHeaders() }
            );
            const rows = await res.json();
            data = rows[0]?.search_params || null;
            break;
        }
    }

    return json({ success: true, tool_type: link.tool_type, data }, cors);
}

// ═══════════════════════════════════════════════════════════════
// SAVE — Sauvegarder les données du client (public)
// ═══════════════════════════════════════════════════════════════
async function handleSave(token, request, cors) {
    const link = await getValidLink(token);
    if (!link) return json({ error: 'Invalid or expired link' }, cors, 403);

    const body = await request.json();
    const { data } = body;

    if (!data) return json({ error: 'data field required' }, cors, 400);

    try {
        switch (link.tool_type) {
            case 'budget':
                await saveBudget(link.client_id, data);
                break;
            case 'profil_investisseur':
                await saveProfilInvestisseur(link.client_id, data);
                break;
            case 'calc_hypo':
                await saveCalcHypo(link.client_id, data);
                break;
            case 'reee':
                await saveReee(link.client_id, data);
                break;
            case 'assurance_vie':
                await saveAssuranceVie(link.client_id, data);
                break;
            default:
                return json({ error: 'Unknown tool_type' }, cors, 400);
        }

        // Marquer comme complété
        await fetch(`${SUPABASE_URL}/rest/v1/client_shared_links?id=eq.${link.id}`, {
            method: 'PATCH',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
        });

        // Timeline
        const toolLabels = { budget: 'Budget Personnel', profil_investisseur: 'Profil Investisseur', calc_hypo: 'Calc. Hypothécaire', reee: 'REEE', assurance_vie: 'Assurance Vie' };
        await addTimeline(link.client_id, 'shared_link_completed', `✅ Client a complété — ${toolLabels[link.tool_type]}`, 'Via lien partagé');

        return json({ success: true, message: 'Données sauvegardées' }, cors);

    } catch (err) {
        console.error('Save error:', err);
        return json({ error: err.message }, cors, 500);
    }
}

// ═══════════════════════════════════════════════════════════════
// SAVE HELPERS — par type d'outil
// ═══════════════════════════════════════════════════════════════

async function saveBudget(clientId, items) {
    if (!Array.isArray(items)) throw new Error('Budget data must be an array');

    // Valider la forme des items
    for (const item of items) {
        if (!item.field_id || typeof item.amount !== 'number') {
            throw new Error('Each budget item must have field_id and amount');
        }
    }

    // DELETE existing
    await fetch(`${SUPABASE_URL}/rest/v1/abf_budget?client_id=eq.${clientId}`, {
        method: 'DELETE',
        headers: sbHeaders()
    });

    // INSERT new
    if (items.length > 0) {
        const rows = items.map((item, i) => ({
            client_id: clientId,
            field_id: item.field_id,
            category: item.category || 'revenus',
            label: item.field_id,
            amount: item.amount,
            frequency: item.frequency || '1',
            ordre: i
        }));

        const res = await fetch(`${SUPABASE_URL}/rest/v1/abf_budget`, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(rows)
        });

        if (!res.ok) throw new Error('Failed to insert budget items');
    }
}

async function saveProfilInvestisseur(clientId, data) {
    if (!data || typeof data !== 'object') throw new Error('Profil data must be an object');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ profil_investisseur_data: data })
    });

    if (!res.ok) throw new Error('Failed to save profil investisseur');
}

async function saveCalcHypo(clientId, data) {
    if (!data || typeof data !== 'object') throw new Error('Calc hypo data must be an object');

    // Charger tools_data existant, merger
    const getRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=tools_data`,
        { headers: sbHeaders() }
    );
    const rows = await getRes.json();
    const existing = rows[0]?.tools_data || {};

    const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools_data: { ...existing, calc_hypo: data } })
    });

    if (!res.ok) throw new Error('Failed to save calc hypo');
}

async function saveReee(clientId, data) {
    if (!data || typeof data !== 'object') throw new Error('REEE data must be an object');

    // Charger abf_data existant, merger
    const getRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=abf_data`,
        { headers: sbHeaders() }
    );
    const rows = await getRes.json();
    const existing = rows[0]?.abf_data || {};

    const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ abf_data: { ...existing, reee: data } })
    });

    if (!res.ok) throw new Error('Failed to save REEE');
}

async function saveAssuranceVie(clientId, data) {
    if (!data || typeof data !== 'object') throw new Error('Assurance vie data must be an object');

    // Insérer une nouvelle recherche dans client_recherches_assurance_vie
    const row = {
        client_id: clientId,
        search_params: data,
        selected_products: [],
        label: `Soumission client — ${new Date().toLocaleDateString('fr-CA')}`
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/client_recherches_assurance_vie`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
    });

    if (!res.ok) throw new Error('Failed to save assurance vie');
}

// ═══════════════════════════════════════════════════════════════
// DB PROXY — Proxy Supabase pour modules réels (public via token)
// ═══════════════════════════════════════════════════════════════
async function handleDbProxy(token, request, cors) {
    const link = await getValidLink(token);
    if (!link) return json({ error: 'Invalid or expired link' }, cors, 403);

    const body = await request.json();
    const { action, table, query, data, filters } = body;
    // action: 'select', 'insert', 'update', 'delete', 'upsert'

    // Tables autorisées — SEULEMENT les tables utilisées par les modules
    const allowedTables = [
        'clients', 'abf_budget', 'abf_hypo_calc', 'abf_reee',
        'client_recherches_assurance_vie', 'abf_enfants'
    ];
    if (!allowedTables.includes(table)) {
        return json({ error: `Table '${table}' not allowed` }, cors, 403);
    }

    // Sécurité: forcer le scope au client_id du lien
    const clientId = link.client_id;

    try {
        let url, method, reqBody, headers;
        headers = { ...sbHeaders(), 'Content-Type': 'application/json' };

        switch (action) {
            case 'select': {
                // Construire l'URL avec les filtres
                let qs = query || '';
                // Retirer les filtres id/client_id envoyés par le module (on les force ci-dessous)
                if (qs) {
                    qs = qs.split('&').filter(p => {
                        if (table === 'clients') return !p.startsWith('id=eq.');
                        return !p.startsWith('client_id=eq.');
                    }).join('&');
                }
                // Forcer le filtre client_id (sécurité)
                if (table === 'clients') {
                    url = `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}${qs ? '&' + qs : ''}`;
                } else {
                    url = `${SUPABASE_URL}/rest/v1/${table}?client_id=eq.${clientId}${qs ? '&' + qs : ''}`;
                }
                method = 'GET';
                break;
            }
            case 'insert': {
                url = `${SUPABASE_URL}/rest/v1/${table}`;
                method = 'POST';
                headers['Prefer'] = 'return=representation';
                // Forcer client_id sur chaque row
                if (Array.isArray(data)) {
                    reqBody = JSON.stringify(data.map(d => ({ ...d, client_id: clientId })));
                } else {
                    reqBody = JSON.stringify({ ...data, client_id: clientId });
                }
                break;
            }
            case 'update': {
                // Nettoyer filtres dupliqués
                let uf = filters || '';
                if (uf) {
                    uf = uf.split('&').filter(p => {
                        if (table === 'clients') return !p.startsWith('id=eq.');
                        return !p.startsWith('client_id=eq.');
                    }).join('&');
                }
                if (table === 'clients') {
                    url = `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}`;
                } else {
                    url = `${SUPABASE_URL}/rest/v1/${table}?client_id=eq.${clientId}${uf ? '&' + uf : ''}`;
                }
                method = 'PATCH';
                headers['Prefer'] = 'return=representation';
                reqBody = JSON.stringify(data);
                break;
            }
            case 'delete': {
                if (table === 'clients') {
                    return json({ error: 'Cannot delete client record' }, cors, 403);
                }
                // Nettoyer filtres dupliqués
                let df = filters || '';
                if (df) {
                    df = df.split('&').filter(p => !p.startsWith('client_id=eq.')).join('&');
                }
                url = `${SUPABASE_URL}/rest/v1/${table}?client_id=eq.${clientId}${df ? '&' + df : ''}`;
                method = 'DELETE';
                break;
            }
            case 'upsert': {
                url = `${SUPABASE_URL}/rest/v1/${table}`;
                method = 'POST';
                headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
                if (Array.isArray(data)) {
                    reqBody = JSON.stringify(data.map(d => ({ ...d, client_id: clientId })));
                } else {
                    reqBody = JSON.stringify({ ...data, client_id: clientId });
                }
                break;
            }
            default:
                return json({ error: `Unknown action: ${action}` }, cors, 400);
        }

        const opts = { method, headers };
        if (reqBody) opts.body = reqBody;

        const res = await fetch(url, opts);
        const text = await res.text();

        let result;
        try { result = JSON.parse(text); } catch { result = text; }

        if (!res.ok) {
            return json({ error: result, status: res.status }, cors, res.status);
        }

        return json({ data: result, error: null }, cors);

    } catch (err) {
        console.error('DB Proxy error:', err);
        return json({ error: err.message }, cors, 500);
    }
}

// ═══════════════════════════════════════════════════════════════
// LIST LINKS — Lister les liens d'un client (auth)
// ═══════════════════════════════════════════════════════════════
async function handleListLinks(clientId, request, cors) {
    const user = await verifyAuth(request);
    if (!user) return json({ error: 'Unauthorized' }, cors, 401);

    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/client_shared_links?client_id=eq.${clientId}&order=created_at.desc`,
        { headers: sbHeaders() }
    );

    const links = await res.json();

    // Enrichir avec le statut
    const now = new Date();
    const enriched = links.map(l => ({
        ...l,
        status: l.is_revoked ? 'revoked'
            : new Date(l.expires_at) < now ? 'expired'
            : l.completed_at ? 'completed'
            : 'active'
    }));

    return json({ success: true, links: enriched }, cors);
}

// ═══════════════════════════════════════════════════════════════
// REVOKE — Révoquer un lien (auth)
// ═══════════════════════════════════════════════════════════════
async function handleRevoke(linkId, request, cors) {
    const user = await verifyAuth(request);
    if (!user) return json({ error: 'Unauthorized' }, cors, 401);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/client_shared_links?id=eq.${linkId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            is_revoked: true,
            updated_at: new Date().toISOString()
        })
    });

    if (!res.ok) throw new Error('Failed to revoke link');

    return json({ success: true, message: 'Lien révoqué' }, cors);
}

// ═══════════════════════════════════════════════════════════════
// DB HELPERS
// ═══════════════════════════════════════════════════════════════
function sbHeaders() {
    return {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    };
}

async function getLink(token) {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/client_shared_links?token=eq.${token}&select=*`,
        { headers: sbHeaders() }
    );
    const data = await res.json();
    return data[0] || null;
}

async function getValidLink(token) {
    const link = await getLink(token);
    if (!link) return null;
    if (link.is_revoked) return null;
    if (new Date(link.expires_at) < new Date()) return null;
    return link;
}

async function addTimeline(clientId, type, title, description) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/client_timeline`, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                activity_type: type,
                title,
                description,
                created_at: new Date().toISOString()
            })
        });
    } catch (e) {
        console.error('Timeline error:', e);
    }
}
