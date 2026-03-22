/**
 * ═══════════════════════════════════════════════════════════════
 * FINOX OS — Team Chat Module v1.0
 * ═══════════════════════════════════════════════════════════════
 * Bulle flottante + volet déroulant + Supabase Realtime
 * Chargé globalement via app.html & abf.html
 */
(function() {
    'use strict';

    // ─────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────
    const state = {
        isOpen: false,
        isPinned: false,
        view: 'channels',        // 'channels' | 'conversation'
        currentChannel: null,
        channels: [],
        messages: [],
        members: [],
        presenceMap: {},         // userId -> status
        unreadCounts: {},        // channelId -> count
        totalUnread: 0,
        replyTo: null,
        realtimeChannel: null,
        presenceChannel: null,
        channelSubscription: null,
        typingTimeout: null,
        lastTypingBroadcast: 0,
        typingUsers: {},         // channelId -> { userId: timeout }
        messageOffset: 0,
        loadingMore: false,
        hasMore: true,
        initialized: false
    };

    const PAGE_SIZE = 50;
    const TYPING_TIMEOUT = 3000;
    const PRESENCE_INTERVAL = 60000;

    const EMOJIS = ['👍','👎','😄','😂','🔥','❤️','🎉','👏','😮','🤔','💯','✅','🚀','💡','⚡','🙏'];

    // ─────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────
    function getUser() {
        return FINOX.getCurrentUser();
    }

    function getOrgId() {
        return FINOX.ORG_ID;
    }

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }

    function escapeHtml(str) {
        return FINOX.escapeHtml ? FINOX.escapeHtml(str) : str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();

        const time = d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

        if (isToday) return time;
        if (isYesterday) return `Hier ${time}`;
        return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) + ' ' + time;
    }

    function formatDateSep(ts) {
        const d = new Date(ts);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Hier';
        return d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function playNotificationSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.25);
        } catch(e) {}
    }

    // ─── Incoming call ringtone ───
    let ringtoneCtx = null;
    let ringtoneInterval = null;

    function startRingtone() {
        try {
            ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
            const playTone = () => {
                if (!ringtoneCtx) return;
                const osc = ringtoneCtx.createOscillator();
                const gain = ringtoneCtx.createGain();
                osc.connect(gain);
                gain.connect(ringtoneCtx.destination);
                // Two-tone ring
                osc.frequency.setValueAtTime(440, ringtoneCtx.currentTime);
                osc.frequency.setValueAtTime(520, ringtoneCtx.currentTime + 0.15);
                osc.frequency.setValueAtTime(440, ringtoneCtx.currentTime + 0.3);
                osc.frequency.setValueAtTime(520, ringtoneCtx.currentTime + 0.45);
                gain.gain.setValueAtTime(0.12, ringtoneCtx.currentTime);
                gain.gain.setValueAtTime(0.12, ringtoneCtx.currentTime + 0.55);
                gain.gain.exponentialRampToValueAtTime(0.001, ringtoneCtx.currentTime + 0.6);
                osc.start(ringtoneCtx.currentTime);
                osc.stop(ringtoneCtx.currentTime + 0.6);
            };
            playTone();
            ringtoneInterval = setInterval(playTone, 1200);
        } catch(e) {}
    }

    function stopRingtone() {
        if (ringtoneInterval) clearInterval(ringtoneInterval);
        ringtoneInterval = null;
        if (ringtoneCtx) { try { ringtoneCtx.close(); } catch(e) {} }
        ringtoneCtx = null;
    }

    function showIncomingCall(callerName, meetUrl) {
        // Remove existing popup if any
        const existing = document.getElementById('tcCallPopup');
        if (existing) existing.remove();

        startRingtone();

        const popup = document.createElement('div');
        popup.id = 'tcCallPopup';
        popup.className = 'tc-call-popup';
        popup.innerHTML = `
            <div class="tc-call-card">
                <div class="tc-call-pulse-ring"></div>
                <div class="tc-call-avatar">${getInitials(callerName)}</div>
                <div class="tc-call-info">
                    <div class="tc-call-label">Appel vidéo entrant</div>
                    <div class="tc-call-name">${escapeHtml(callerName)}</div>
                    <div class="tc-call-sub">Google Meet</div>
                </div>
                <div class="tc-call-actions">
                    <button class="tc-call-btn tc-call-decline" onclick="window.TeamChat.declineCall()">
                        <span>✕</span>
                        Refuser
                    </button>
                    <button class="tc-call-btn tc-call-accept" onclick="window.TeamChat.acceptCall('${escapeHtml(meetUrl)}')">
                        <span>📹</span>
                        Accepter
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);

        // Auto-dismiss after 30s
        setTimeout(() => {
            if (document.getElementById('tcCallPopup')) declineCall();
        }, 30000);
    }

    function acceptCall(meetUrl) {
        stopRingtone();
        const popup = document.getElementById('tcCallPopup');
        if (popup) popup.remove();
        window.open(meetUrl, '_blank');
    }

    function declineCall() {
        stopRingtone();
        const popup = document.getElementById('tcCallPopup');
        if (popup) {
            popup.style.animation = 'tcCallOut 0.3s ease-in forwards';
            setTimeout(() => popup.remove(), 300);
        }
    }

    // Parse @mentions and links in message content
    function parseContent(text) {
        if (!text) return '';
        let html = escapeHtml(text);
        // @mentions
        html = html.replace(/@(\w+(?:\s\w+)?)/g, '<span class="tc-mention">@$1</span>');
        // URLs
        html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--info);text-decoration:underline;">$1</a>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // ─────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────
    async function init() {
        if (state.initialized) return;
        const user = getUser();
        if (!user) {
            setTimeout(init, 1000);
            return;
        }

        state.initialized = true;
        console.log('[TeamChat] Initializing...');

        try {
            injectHTML();
            await loadMembers();
            await loadChannels();
            setupRealtime();
            setupPresence();
            renderChannelList();
            // Load unreads in background (non-blocking)
            loadUnreadCounts().catch(e => console.warn('[TeamChat] unread count error:', e));
            // Restore pinned state from localStorage
            if (localStorage.getItem('finox_tc_pinned') === '1') {
                openPanel();
                togglePin();
            }
            console.log('[TeamChat] Ready —', state.channels.length, 'channels,', state.members.length, 'members');
        } catch(e) {
            console.error('[TeamChat] Init error:', e);
            // Ensure bubble is still visible even if something fails
            injectHTML();
        }
    }

    // ─────────────────────────────────────────
    // INJECT HTML STRUCTURE
    // ─────────────────────────────────────────
    function injectHTML() {
        // Don't inject twice
        if (document.getElementById('tcBubble')) return;

        const bubble = document.createElement('button');
        bubble.id = 'tcBubble';
        bubble.className = 'tc-bubble';
        bubble.onclick = togglePanel;
        bubble.innerHTML = `💬<span class="tc-bubble-badge hidden" id="tcBadge">0</span>`;
        document.body.appendChild(bubble);

        const overlay = document.createElement('div');
        overlay.id = 'tcOverlay';
        overlay.className = 'tc-overlay';
        overlay.onclick = closePanel;
        document.body.appendChild(overlay);

        const panel = document.createElement('div');
        panel.id = 'tcPanel';
        panel.className = 'tc-panel';
        panel.innerHTML = `
            <div id="tcChannelView">
                <div class="tc-header">
                    <div class="tc-header-left">
                        <h3>💬 Équipe</h3>
                        <span class="tc-online-count" id="tcOnlineCount">0 en ligne</span>
                    </div>
                    <div class="tc-header-actions">
                        <button class="tc-header-btn" id="tcPinBtn" onclick="window.TeamChat.togglePin()" title="Épingler">📌</button>
                        <button class="tc-header-btn" onclick="window.TeamChat.showNewChannel()" title="Nouveau">＋</button>
                        <button class="tc-header-btn" onclick="window.TeamChat.closePanel()" title="Fermer">✕</button>
                    </div>
                </div>
                <div class="tc-my-status" id="tcMyStatus">
                    <button class="tc-status-btn" onclick="window.TeamChat.cycleStatus()" id="tcMyStatusBtn" title="Changer mon statut">
                        <span class="tc-status-dot" id="tcMyStatusDot"></span>
                        <span id="tcMyStatusLabel">En ligne</span>
                        <span style="font-size:10px;opacity:0.5;margin-left:auto;">▾</span>
                    </button>
                </div>
                <div class="tc-channels" id="tcChannels"></div>
            </div>
            <div id="tcConvView" style="display:none; height:100%; flex-direction:column;">
                <div class="tc-conv-header">
                    <button class="tc-back-btn" onclick="window.TeamChat.backToChannels()">←</button>
                    <div class="tc-conv-title">
                        <h4 id="tcConvName">—</h4>
                        <small id="tcConvSub"></small>
                    </div>
                    <div class="tc-header-actions" style="position:relative;">
                        <button class="tc-header-btn tc-meet-btn" onclick="window.TeamChat.startMeet()" title="Appel vidéo" style="font-size:16px;">📹</button>
                        <button class="tc-header-btn" onclick="window.TeamChat.toggleConvMenu()" title="Options">⋯</button>
                        <button class="tc-header-btn" onclick="window.TeamChat.closePanel()" title="Fermer">✕</button>
                        <div class="tc-conv-menu" id="tcConvMenu"></div>
                    </div>
                </div>
                <div id="tcPinnedBar" style="display:none;"></div>
                <div id="tcPinnedList" style="display:none;" class="tc-pinned-list"></div>
                <div class="tc-messages" id="tcMessages"></div>
                <div class="tc-typing" id="tcTyping"></div>
                <div class="tc-input-area" id="tcInputArea">
                    <div id="tcReplyPreview" style="display:none;"></div>
                    <div class="tc-input-row">
                        <div class="tc-input-actions">
                        </div>
                        <div class="tc-input-wrap">
                            <textarea class="tc-input" id="tcInput" placeholder="Message..." rows="1"
                                onkeydown="window.TeamChat.handleInputKey(event)"
                                oninput="window.TeamChat.handleInputChange(this)"></textarea>
                        </div>
                        <button class="tc-send-btn" id="tcSendBtn" onclick="window.TeamChat.sendMessage()" disabled>➤</button>
                    </div>
                </div>
            </div>
            <div id="tcModal" style="display:none;"></div>
        `;
        document.body.appendChild(panel);
    }

    // ─────────────────────────────────────────
    // DATA LOADING
    // ─────────────────────────────────────────
    async function loadMembers() {
        try {
            const { data } = await FINOX.supabase
                .from('profiles')
                .select('id, first_name, last_name, photo_url, email, role')
                .eq('organization_id', getOrgId())
                .eq('is_active', true);
            state.members = (data || []).map(m => ({
                ...m,
                full_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Inconnu'
            }));
        } catch(e) {
            console.error('[TeamChat] loadMembers error:', e);
            state.members = [];
        }
    }

    function getMember(userId) {
        return state.members.find(m => m.id === userId) || { id: userId, full_name: 'Inconnu' };
    }

    async function loadChannels() {
        const user = getUser();
        try {
            const { data } = await FINOX.supabase
                .from('team_channels')
                .select('*')
                .eq('organization_id', getOrgId())
                .eq('is_archived', false)
                .order('last_message_at', { ascending: false });

            // Filter: only show channels where user is a member,
            // OR public channels (type='channel') which are org-wide
            state.channels = (data || []).filter(ch => {
                if (ch.type === 'channel') return true; // org-wide channels visible to all
                if (!ch.members || ch.members.length === 0) return ch.type === 'channel';
                return ch.members.includes(user?.id);
            });
        } catch(e) {
            console.error('[TeamChat] loadChannels error:', e);
        }
    }

    async function ensureDefaultChannels() {
        // DMs are created on-demand via the "+" button, not auto-created
        // This avoids spamming channels for large teams
    }

    async function loadMessages(channelId, append = false) {
        if (!channelId) return;

        if (!append) {
            state.messageOffset = 0;
            state.hasMore = true;
        }

        try {
            const { data } = await FINOX.supabase
                .from('team_messages')
                .select('*')
                .eq('channel_id', channelId)
                .eq('is_deleted', false)
                .order('created_at', { ascending: false })
                .range(state.messageOffset, state.messageOffset + PAGE_SIZE - 1);

            const msgs = (data || []).reverse();

            if (msgs.length < PAGE_SIZE) state.hasMore = false;

            if (append) {
                state.messages = [...msgs, ...state.messages];
            } else {
                state.messages = msgs;
            }

            state.messageOffset += msgs.length;
        } catch(e) {
            console.error('[TeamChat] loadMessages error:', e);
        }
    }

    // ─────────────────────────────────────────
    // REALTIME
    // ─────────────────────────────────────────
    function setupRealtime() {
        // Messages realtime
        state.realtimeChannel = FINOX.supabase
            .channel('team-messages-rt')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'team_messages', filter: `organization_id=eq.${getOrgId()}` },
                payload => handleNewMessage(payload.new)
            )
            .subscribe(status => {
                console.log('[TeamChat] Messages realtime:', status);
            });

        // Channel updates
        state.channelSubscription = FINOX.supabase
            .channel('team-channels-rt')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'team_channels', filter: `organization_id=eq.${getOrgId()}` },
                async () => {
                    await loadChannels();
                    if (state.view === 'channels') renderChannelList();
                }
            )
            .subscribe();

        // Presence via broadcast
        state.presenceChannel = FINOX.supabase
            .channel('team-presence-rt', { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                handleTypingEvent(payload);
            })
            .subscribe();
    }

    function handleNewMessage(msg) {
        const user = getUser();
        if (!msg || !user) return;

        // CRITICAL: Only process messages from channels the user belongs to
        const ch = state.channels.find(c => c.id === msg.channel_id);
        if (!ch) return; // Channel not in our list = not our business

        // Add to current conversation if viewing that channel
        if (state.view === 'conversation' && state.currentChannel?.id === msg.channel_id) {
            // Avoid duplicates
            if (!state.messages.find(m => m.id === msg.id)) {
                state.messages.push(msg);
                renderMessages(true);
                scrollToBottom();
            }
            // Mark as read
            markAsRead(msg);
        } else {
            // Increment unread
            state.unreadCounts[msg.channel_id] = (state.unreadCounts[msg.channel_id] || 0) + 1;
            updateBadge();

            // Re-render channel list if visible
            if (state.view === 'channels' && state.isOpen) {
                renderChannelList();
            }
        }

        // Notification sound + bubble pulse (only for others' messages, not muted)
        const isMuted = ch && (ch.muted_by || []).includes(user.id);

        // INCOMING MEET CALL — show full-screen popup
        if (msg.content_type === 'meet_link' && msg.sender_id !== user.id && !isMuted) {
            const callerName = getMember(msg.sender_id).full_name;
            const meetUrl = msg.metadata?.meet_url;
            if (meetUrl) showIncomingCall(callerName, meetUrl);
        } else if (msg.sender_id !== user.id && !isMuted) {
            playNotificationSound();
            const bubble = document.getElementById('tcBubble');
            if (bubble) {
                bubble.classList.add('has-new');
                setTimeout(() => bubble.classList.remove('has-new'), 3000);
            }
        }

        // Update channel preview in state
        if (ch) {
            ch.last_message_at = msg.created_at;
            ch.last_message_preview = msg.content?.substring(0, 100);
            // Re-sort channels
            state.channels.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        }
    }

    async function markAsRead(msg) {
        const user = getUser();
        if (!user || !msg) return;
        if (msg.read_by && msg.read_by.includes(user.id)) return;

        try {
            await FINOX.supabase.rpc('', {}).catch(() => {}); // fallback: direct update
            await FINOX.supabase
                .from('team_messages')
                .update({ read_by: [...(msg.read_by || []), user.id] })
                .eq('id', msg.id);
        } catch(e) {}
    }

    // ─────────────────────────────────────────
    // PRESENCE
    // ─────────────────────────────────────────
    function setupPresence() {
        updatePresence('online');
        // Periodic presence update
        const presInt = setInterval(() => updatePresence('online'), PRESENCE_INTERVAL);

        // Visibility change
        document.addEventListener('visibilitychange', () => {
            updatePresence(document.hidden ? 'away' : 'online');
        });

        // Before unload
        window.addEventListener('beforeunload', () => {
            updatePresence('offline');
        });

        // Load initial presence
        loadPresence();
        renderMyStatus();

        // Register cleanup
        if (FINOX.registerInterval) FINOX.registerInterval(presInt);
    }

    const STATUS_CYCLE = [
        { key: 'online',  label: 'En ligne',  dot: '🟢', color: 'var(--success)' },
        { key: 'away',    label: 'Absent',     dot: '🟡', color: 'var(--warning)' },
        { key: 'busy',    label: 'Occupé',     dot: '🔴', color: 'var(--danger)' },
        { key: 'offline', label: 'Invisible',  dot: '⚫', color: 'var(--text-muted)' }
    ];

    let myStatusIndex = 0; // default: online

    function cycleStatus() {
        // Show dropdown instead of cycling
        const btn = document.getElementById('tcMyStatusBtn');
        const existing = document.getElementById('tcStatusDropdown');
        if (existing) { existing.remove(); return; }

        const dd = document.createElement('div');
        dd.id = 'tcStatusDropdown';
        dd.className = 'tc-status-dropdown';
        dd.innerHTML = STATUS_CYCLE.map((st, i) => `
            <button class="tc-status-option ${i === myStatusIndex ? 'active' : ''}" onclick="window.TeamChat.setStatus(${i})">
                <span class="tc-status-dot" style="background:${st.color}"></span>
                ${st.label}
            </button>
        `).join('');
        btn.parentElement.appendChild(dd);

        // Close on outside click
        setTimeout(() => {
            const close = (e) => {
                if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('click', close); }
            };
            document.addEventListener('click', close);
        }, 10);
    }

    function setStatus(index) {
        myStatusIndex = index;
        const st = STATUS_CYCLE[myStatusIndex];
        updatePresence(st.key);
        renderMyStatus(st);
        const dd = document.getElementById('tcStatusDropdown');
        if (dd) dd.remove();
    }

    function renderMyStatus(st) {
        if (!st) st = STATUS_CYCLE[myStatusIndex];
        const dot = document.getElementById('tcMyStatusDot');
        const label = document.getElementById('tcMyStatusLabel');
        if (dot) dot.style.background = st.color;
        if (label) label.textContent = st.label;
    }

    async function updatePresence(status) {
        const user = getUser();
        if (!user) return;

        try {
            const { error } = await FINOX.supabase
                .from('team_presence')
                .upsert({
                    user_id: user.id,
                    status: status,
                    last_seen: new Date().toISOString(),
                    organization_id: getOrgId()
                }, { onConflict: 'user_id' });
            if (error) console.error('[TeamChat] Presence update error:', error);
        } catch(e) {
            console.error('[TeamChat] Presence exception:', e);
        }
    }

    async function loadPresence() {
        try {
            const { data } = await FINOX.supabase
                .from('team_presence')
                .select('user_id, status, last_seen')
                .eq('organization_id', getOrgId());

            state.presenceMap = {};
            (data || []).forEach(p => {
                // Consider users who haven't been seen in 2 minutes as offline
                const lastSeen = new Date(p.last_seen);
                const isStale = (Date.now() - lastSeen.getTime()) > 120000;
                state.presenceMap[p.user_id] = isStale ? 'offline' : p.status;
            });

            updateOnlineCount();
        } catch(e) {}
    }

    function updateOnlineCount() {
        const onlineCount = Object.values(state.presenceMap).filter(s => s === 'online' || s === 'away').length;
        const el = document.getElementById('tcOnlineCount');
        if (el) el.textContent = `${onlineCount} en ligne`;
    }

    // ─────────────────────────────────────────
    // TYPING
    // ─────────────────────────────────────────
    function broadcastTyping() {
        if (!state.currentChannel || !state.presenceChannel) return;
        const now = Date.now();
        if (now - state.lastTypingBroadcast < 2000) return;
        state.lastTypingBroadcast = now;

        const user = getUser();
        const member = getMember(user.id);
        state.presenceChannel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                channel_id: state.currentChannel.id,
                user_id: user.id,
                user_name: member.full_name || 'Quelqu\'un'
            }
        });
    }

    function handleTypingEvent({ channel_id, user_id, user_name }) {
        const user = getUser();
        if (!user || user_id === user.id) return;

        if (!state.typingUsers[channel_id]) state.typingUsers[channel_id] = {};

        clearTimeout(state.typingUsers[channel_id][user_id]);
        state.typingUsers[channel_id][user_id] = setTimeout(() => {
            delete state.typingUsers[channel_id][user_id];
            renderTyping();
        }, TYPING_TIMEOUT);

        state.typingUsers[channel_id][user_id]._name = user_name;
        renderTyping();
    }

    function renderTyping() {
        const el = document.getElementById('tcTyping');
        if (!el || !state.currentChannel) return;

        const channelTyping = state.typingUsers[state.currentChannel.id] || {};
        const names = Object.values(channelTyping)
            .filter(v => v._name)
            .map(v => v._name);

        if (names.length === 0) {
            el.innerHTML = '';
        } else if (names.length === 1) {
            el.innerHTML = `<div class="tc-typing-dots"><span></span><span></span><span></span></div> ${escapeHtml(names[0])} écrit...`;
        } else {
            el.innerHTML = `<div class="tc-typing-dots"><span></span><span></span><span></span></div> ${names.length} personnes écrivent...`;
        }
    }

    // ─────────────────────────────────────────
    // UNREAD / BADGE
    // ─────────────────────────────────────────
    async function loadUnreadCounts() {
        const user = getUser();
        if (!user) return;

        try {
            // Single query: get all unread messages across all our channels
            const channelIds = state.channels.map(ch => ch.id);
            if (channelIds.length === 0) return;

            const { data } = await FINOX.supabase
                .from('team_messages')
                .select('channel_id')
                .in('channel_id', channelIds)
                .eq('is_deleted', false)
                .neq('sender_id', user.id);

            // Count per channel (messages not sent by me = potentially unread)
            // Simple heuristic: count messages where I'm not in read_by
            state.unreadCounts = {};
            (data || []).forEach(msg => {
                // For now just reset - actual read tracking happens on open
            });

            state.totalUnread = Object.values(state.unreadCounts).reduce((a, b) => a + b, 0);
            updateBadge();
        } catch(e) {
            console.error('[TeamChat] loadUnreadCounts error:', e);
        }
    }

    function updateBadge() {
        state.totalUnread = Object.values(state.unreadCounts).reduce((a, b) => a + b, 0);
        const badge = document.getElementById('tcBadge');
        if (!badge) return;

        if (state.totalUnread > 0) {
            badge.textContent = state.totalUnread > 99 ? '99+' : state.totalUnread;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    // ─────────────────────────────────────────
    // RENDERING — Channel List
    // ─────────────────────────────────────────
    function renderChannelList() {
        const container = document.getElementById('tcChannels');
        if (!container) return;

        const user = getUser();

        // Split pinned vs unpinned
        const pinnedChannels = state.channels.filter(ch => (ch.pinned_by || []).includes(user?.id));
        const unpinned = state.channels.filter(ch => !(ch.pinned_by || []).includes(user?.id));

        const announcements = unpinned.filter(ch => ch.type === 'announcement');
        const channels = unpinned.filter(ch => ch.type === 'channel');
        const directs = unpinned.filter(ch => ch.type === 'direct');
        const groups = unpinned.filter(ch => ch.type === 'group');

        let html = '';

        // Pinned conversations (always on top)
        if (pinnedChannels.length > 0) {
            html += `<div class="tc-channel-section">
                <div class="tc-channel-section-title">📌 Épinglés</div>`;
            pinnedChannels.forEach(ch => {
                html += renderChannelItem(ch, user, ch.type === 'direct');
            });
            html += '</div>';
        }

        // Announcements
        if (announcements.length > 0) {
            html += `<div class="tc-channel-section">
                <div class="tc-channel-section-title">📢 Annonces</div>`;
            announcements.forEach(ch => {
                html += renderChannelItem(ch, user);
            });
            html += '</div>';
        }

        // Channels
        if (channels.length > 0) {
            html += `<div class="tc-channel-section">
                <div class="tc-channel-section-title">Canaux</div>`;
            channels.forEach(ch => {
                html += renderChannelItem(ch, user);
            });
            html += '</div>';
        }

        // Direct Messages
        if (directs.length > 0) {
            html += `<div class="tc-channel-section">
                <div class="tc-channel-section-title">Messages directs</div>`;
            directs.forEach(ch => {
                html += renderChannelItem(ch, user, true);
            });
            html += '</div>';
        }

        // Groups
        if (groups.length > 0) {
            html += `<div class="tc-channel-section">
                <div class="tc-channel-section-title">Groupes</div>`;
            groups.forEach(ch => {
                html += renderChannelItem(ch, user);
            });
            html += '</div>';
        }

        if (!html) {
            html = `<div class="tc-messages-empty"><span>💬</span><span>Aucune conversation</span></div>`;
        }

        container.innerHTML = html;
    }

    function renderChannelItem(ch, user, isDirect = false) {
        const unread = state.unreadCounts[ch.id] || 0;
        let icon = ch.icon || '💬';
        let name = ch.name;
        let presenceDot = '';

        if (isDirect) {
            const otherId = ch.members?.find(m => m !== user?.id);
            const other = getMember(otherId);
            name = other?.full_name || ch.name;
            icon = getInitials(name);
            const pStatus = state.presenceMap[otherId] || 'offline';
            presenceDot = `<span class="tc-presence-dot ${pStatus}"></span>`;
        }

        const timeStr = ch.last_message_at ? formatTime(ch.last_message_at) : '';
        const preview = ch.last_message_preview
            ? escapeHtml(ch.last_message_preview.substring(0, 40)) + (ch.last_message_preview.length > 40 ? '...' : '')
            : 'Aucun message';

        const isTextIcon = isDirect;
        const isMuted = (ch.muted_by || []).includes(user?.id);
        const isAnnouncement = ch.type === 'announcement';
        const namePrefix = isAnnouncement ? '📢 ' : isDirect ? '' : '# ';

        return `<div class="tc-channel-item" onclick="window.TeamChat.openChannel('${ch.id}')">
            <div class="tc-channel-icon" style="${isTextIcon ? 'font-size:12px;font-weight:700;color:var(--gold);' : ''}">
                ${isTextIcon ? icon : `<span>${icon}</span>`}
                ${presenceDot}
            </div>
            <div class="tc-channel-info">
                <div class="tc-channel-name">${namePrefix}${escapeHtml(name)}${isMuted ? ' <span style="opacity:0.4;font-size:11px;">🔕</span>' : ''}</div>
                <div class="tc-channel-preview">${preview}</div>
            </div>
            <div class="tc-channel-meta">
                <span class="tc-channel-time">${timeStr}</span>
                ${unread > 0 ? `<span class="tc-channel-unread">${unread}</span>` : ''}
            </div>
        </div>`;
    }

    // ─────────────────────────────────────────
    // RENDERING — Messages
    // ─────────────────────────────────────────
    function renderMessages(scrollDown = false) {
        const container = document.getElementById('tcMessages');
        if (!container) return;

        if (state.messages.length === 0) {
            container.innerHTML = `<div class="tc-messages-empty"><span>💬</span><span>Commencez la conversation!</span></div>`;
            return;
        }

        const user = getUser();
        let html = '';
        let lastDate = null;
        let lastSender = null;

        state.messages.forEach((msg, i) => {
            // Date separator
            const msgDate = new Date(msg.created_at).toDateString();
            if (msgDate !== lastDate) {
                html += `<div class="tc-date-sep"><span>${formatDateSep(msg.created_at)}</span></div>`;
                lastDate = msgDate;
                lastSender = null;
            }

            // System message
            if (msg.content_type === 'system') {
                html += `<div class="tc-msg-system"><span>${parseContent(msg.content)}</span></div>`;
                lastSender = null;
                return;
            }

            const isMine = msg.sender_id === user?.id;
            const isGrouped = lastSender === msg.sender_id;
            const sender = getMember(msg.sender_id);
            const initials = getInitials(sender.full_name);
            const time = new Date(msg.created_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });

            html += `<div class="tc-msg ${isMine ? 'mine' : ''} ${isGrouped ? 'grouped' : ''}" data-msg-id="${msg.id}">`;
            html += `<div class="tc-msg-avatar">${initials}</div>`;
            html += `<div class="tc-msg-body">`;

            if (!isMine && !isGrouped) {
                html += `<div class="tc-msg-sender">${escapeHtml(sender.full_name || 'Inconnu')}</div>`;
            }

            // Content based on type
            if (msg.content_type === 'client_share') {
                const meta = msg.metadata || {};
                html += `<div class="tc-client-card" onclick="window.TeamChat.openClient('${meta.client_id}')">
                    <div class="tc-client-card-icon">📌</div>
                    <div class="tc-client-card-info">
                        <div class="tc-client-card-name">${escapeHtml(meta.client_name || 'Client')}</div>
                        <div class="tc-client-card-detail">${escapeHtml(meta.detail || '')}</div>
                    </div>
                </div>`;
            } else if (msg.content_type === 'meet_link') {
                const meta = msg.metadata || {};
                html += `<div class="tc-meet-card" onclick="window.open('${escapeHtml(meta.meet_url || '')}','_blank')">
                    <div class="tc-meet-card-icon">🎥</div>
                    <div class="tc-meet-card-text">
                        <div class="tc-meet-card-title">${escapeHtml(msg.content)}</div>
                        <div class="tc-meet-card-link">Cliquer pour rejoindre</div>
                    </div>
                    <button class="tc-meet-join" onclick="event.stopPropagation();window.open('${escapeHtml(meta.meet_url || '')}','_blank')">Rejoindre</button>
                </div>`;
            } else {
                // Reply reference
                if (msg.reply_to) {
                    const replyMsg = state.messages.find(m => m.id === msg.reply_to);
                    if (replyMsg) {
                        const replySender = getMember(replyMsg.sender_id);
                        html += `<div style="font-size:11px;color:var(--text-muted);border-left:2px solid var(--gold);padding:2px 8px;margin-bottom:4px;opacity:0.7;">
                            ↩ ${escapeHtml(replySender.full_name || '')}: ${escapeHtml((replyMsg.content || '').substring(0, 50))}
                        </div>`;
                    }
                }
                html += `<div class="tc-msg-content">${parseContent(msg.content)}</div>`;
            }

            const isPinned = msg.is_pinned;
            html += `<div class="tc-msg-time">${time}
                <span class="tc-msg-actions">
                    <button onclick="window.TeamChat.${isPinned ? 'unpinMessage' : 'pinMessage'}('${msg.id}')" title="${isPinned ? 'Désépingler' : 'Épingler'}">${isPinned ? '📌' : '📌'}</button>
                </span>
            </div>`;
            html += `</div></div>`;

            lastSender = msg.sender_id;
        });

        container.innerHTML = html;
        if (scrollDown || !state.loadingMore) scrollToBottom();
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            const el = document.getElementById('tcMessages');
            if (el) el.scrollTop = el.scrollHeight;
        });
    }

    // ─────────────────────────────────────────
    // PANEL TOGGLE
    // ─────────────────────────────────────────
    function togglePanel() {
        if (state.isOpen) {
            closePanel();
        } else {
            openPanel();
        }
    }

    function openPanel() {
        state.isOpen = true;
        const panel = document.getElementById('tcPanel');
        const overlay = document.getElementById('tcOverlay');
        const bubble = document.getElementById('tcBubble');
        if (panel) panel.classList.add('open');
        if (!state.isPinned && overlay) overlay.classList.add('show');
        if (bubble) bubble.classList.add('open');

        // Refresh data
        loadPresence();
        if (state.view === 'channels') renderChannelList();
    }

    function closePanel() {
        // Unpin if pinned
        if (state.isPinned) {
            state.isPinned = false;
            const btn = document.getElementById('tcPinBtn');
            const mainContent = document.querySelector('.app-container, .main-content, #appContent, main, .abf-container');
            if (btn) btn.style.color = '';
            if (mainContent) mainContent.style.marginRight = '';
            document.getElementById('tcPanel')?.classList.remove('pinned');
            localStorage.setItem('finox_tc_pinned', '0');
        }
        state.isOpen = false;
        const panel = document.getElementById('tcPanel');
        const overlay = document.getElementById('tcOverlay');
        const bubble = document.getElementById('tcBubble');
        if (panel) panel.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        if (bubble) bubble.classList.remove('open');
    }

    function togglePin() {
        state.isPinned = !state.isPinned;
        const btn = document.getElementById('tcPinBtn');
        const overlay = document.getElementById('tcOverlay');
        const mainContent = document.querySelector('.app-container, .main-content, #appContent, main, .abf-container');
        if (state.isPinned) {
            if (btn) btn.style.color = 'var(--gold)';
            overlay?.classList.remove('show');
            if (mainContent) mainContent.style.marginRight = '400px';
            document.getElementById('tcPanel')?.classList.add('pinned');
        } else {
            if (btn) btn.style.color = '';
            if (mainContent) mainContent.style.marginRight = '';
            document.getElementById('tcPanel')?.classList.remove('pinned');
        }
        localStorage.setItem('finox_tc_pinned', state.isPinned ? '1' : '0');
    }

    // ─────────────────────────────────────────
    // CHANNEL NAVIGATION
    // ─────────────────────────────────────────
    async function openChannel(channelId) {
        const ch = state.channels.find(c => c.id === channelId);
        if (!ch) return;

        state.currentChannel = ch;
        state.view = 'conversation';
        state.replyTo = null;

        // Show conversation view
        document.getElementById('tcChannelView').style.display = 'none';
        const convView = document.getElementById('tcConvView');
        convView.style.display = 'flex';

        // Set header
        const user = getUser();
        let name = ch.name;
        let sub = '';

        if (ch.type === 'direct') {
            const otherId = ch.members?.find(m => m !== user?.id);
            const other = getMember(otherId);
            name = other?.full_name || ch.name;
            const pStatus = state.presenceMap[otherId] || 'offline';
            sub = pStatus === 'online' ? '🟢 En ligne' : pStatus === 'away' ? '🟡 Absent' : '⚫ Hors ligne';
        } else {
            sub = `${ch.members?.length || 0} membres`;
        }

        const prefix = ch.type === 'direct' ? '' : ch.type === 'announcement' ? '📢 ' : '# ';
        document.getElementById('tcConvName').textContent = prefix + name;
        document.getElementById('tcConvSub').textContent = sub;

        // Show/hide input area based on write permission
        const inputArea = document.getElementById('tcInputArea');
        if (inputArea) {
            if (canWrite(ch, user?.id)) {
                inputArea.style.display = 'block';
            } else {
                inputArea.style.display = 'none';
                // Show read-only notice instead
                const existing = document.getElementById('tcReadOnly');
                if (!existing) {
                    const notice = document.createElement('div');
                    notice.id = 'tcReadOnly';
                    notice.className = 'tc-readonly-notice';
                    notice.innerHTML = '🔒 Canal en lecture seule';
                    inputArea.parentElement.appendChild(notice);
                }
                document.getElementById('tcReadOnly').style.display = 'flex';
            }
            // Hide read-only notice if we can write
            const readOnly = document.getElementById('tcReadOnly');
            if (readOnly && canWrite(ch, user?.id)) readOnly.style.display = 'none';
        }

        // Load pinned + messages
        await loadPinned(channelId);
        pinnedExpanded = false;
        const pinnedList = document.getElementById('tcPinnedList');
        if (pinnedList) pinnedList.style.display = 'none';

        await loadMessages(channelId);
        renderMessages(true);

        // Clear unread for this channel
        state.unreadCounts[channelId] = 0;
        updateBadge();

        // Mark all messages as read
        markAllRead(channelId);

        // Focus input
        setTimeout(() => {
            const input = document.getElementById('tcInput');
            if (input && canWrite(ch, user?.id)) input.focus();
        }, 100);
    }

    async function markAllRead(channelId) {
        const user = getUser();
        if (!user) return;

        try {
            // Mark unread messages as read
            const unreadMsgs = state.messages.filter(m =>
                m.sender_id !== user.id && !(m.read_by || []).includes(user.id)
            );

            for (const msg of unreadMsgs) {
                await FINOX.supabase
                    .from('team_messages')
                    .update({ read_by: [...(msg.read_by || []), user.id] })
                    .eq('id', msg.id);
            }
        } catch(e) {}
    }

    function backToChannels() {
        state.view = 'channels';
        state.currentChannel = null;

        document.getElementById('tcConvView').style.display = 'none';
        document.getElementById('tcChannelView').style.display = 'block';

        loadChannels().then(() => renderChannelList());
    }

    // ─────────────────────────────────────────
    // CONVERSATION OPTIONS MENU
    // ─────────────────────────────────────────
    function toggleConvMenu() {
        const menu = document.getElementById('tcConvMenu');
        if (!menu) return;

        if (menu.classList.contains('show')) {
            menu.classList.remove('show');
            return;
        }

        const ch = state.currentChannel;
        if (!ch) return;

        const user = getUser();
        const isMuted = (ch.muted_by || []).includes(user?.id);
        const isCreator = ch.created_by === user?.id;
        const profile = getMember(user?.id);
        const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
        const canDelete = isCreator || isAdmin;
        const canLeave = ch.type === 'group' || ch.type === 'announcement';
        const isDirect = ch.type === 'direct';

        let items = '';

        // Pin / Unpin conversation
        const isPinned = (ch.pinned_by || []).includes(user?.id);
        items += `<button class="tc-menu-item" onclick="window.TeamChat.togglePinChannel()">
            ${isPinned ? '📌 Désépingler la conversation' : '📌 Épingler en haut'}
        </button>`;

        // Mute / Unmute
        items += `<button class="tc-menu-item" onclick="window.TeamChat.toggleMute()">
            ${isMuted ? '🔔 Réactiver les notifications' : '🔕 Mettre en sourdine'}
        </button>`;

        // Leave group (not for DMs or main channels)
        if (canLeave) {
            items += `<button class="tc-menu-item" onclick="window.TeamChat.leaveChannel()">
                🚪 Quitter le groupe
            </button>`;
        }

        // Delete / Archive (creator or admin)
        if (canDelete && !isDirect) {
            items += `<div class="tc-menu-sep"></div>`;
            items += `<button class="tc-menu-item tc-menu-danger" onclick="window.TeamChat.deleteChannel()">
                🗑️ Supprimer la conversation
            </button>`;
        }

        menu.innerHTML = items;
        menu.classList.add('show');

        // Close on outside click
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && !e.target.closest('.tc-header-btn')) {
                menu.classList.remove('show');
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    async function togglePinChannel() {
        const ch = state.currentChannel;
        const user = getUser();
        if (!ch || !user) return;

        const pinned = ch.pinned_by || [];
        const isPinned = pinned.includes(user.id);
        const newPinned = isPinned
            ? pinned.filter(id => id !== user.id)
            : [...pinned, user.id];

        try {
            await FINOX.supabase
                .from('team_channels')
                .update({ pinned_by: newPinned })
                .eq('id', ch.id);

            ch.pinned_by = newPinned;
            FINOX.showNotification(isPinned ? 'Conversation désépinglée' : 'Conversation épinglée', 'success');
        } catch(e) {
            FINOX.showNotification('Erreur', 'error');
        }

        document.getElementById('tcConvMenu')?.classList.remove('show');
    }

    async function toggleMute() {
        const ch = state.currentChannel;
        const user = getUser();
        if (!ch || !user) return;

        const muted = ch.muted_by || [];
        const isMuted = muted.includes(user.id);
        const newMuted = isMuted
            ? muted.filter(id => id !== user.id)
            : [...muted, user.id];

        try {
            await FINOX.supabase
                .from('team_channels')
                .update({ muted_by: newMuted })
                .eq('id', ch.id);

            ch.muted_by = newMuted;
            FINOX.showNotification(isMuted ? 'Notifications réactivées' : 'Conversation en sourdine', 'success');
        } catch(e) {
            FINOX.showNotification('Erreur', 'error');
        }

        document.getElementById('tcConvMenu')?.classList.remove('show');
    }

    async function leaveChannel() {
        const ch = state.currentChannel;
        const user = getUser();
        if (!ch || !user) return;

        const confirmed = await FINOX.showConfirmDialog(
            'Quitter le groupe',
            `Voulez-vous vraiment quitter "${ch.name}"? Vous ne recevrez plus de messages.`
        );
        if (!confirmed) return;

        try {
            const newMembers = (ch.members || []).filter(id => id !== user.id);
            await FINOX.supabase
                .from('team_channels')
                .update({ members: newMembers })
                .eq('id', ch.id);

            // Send system message
            await FINOX.supabase.from('team_messages').insert({
                channel_id: ch.id,
                sender_id: user.id,
                content: `${getMember(user.id).full_name} a quitté le groupe`,
                content_type: 'system',
                read_by: [],
                organization_id: getOrgId()
            });

            // Remove from local state and go back
            state.channels = state.channels.filter(c => c.id !== ch.id);
            backToChannels();
            FINOX.showNotification('Vous avez quitté le groupe', 'success');
        } catch(e) {
            FINOX.showNotification('Erreur', 'error');
        }
    }

    async function deleteChannel() {
        const ch = state.currentChannel;
        if (!ch) return;

        const confirmed = await FINOX.showConfirmDialog(
            'Supprimer la conversation',
            `Supprimer "${ch.name}"? Tous les messages seront archivés.`
        );
        if (!confirmed) return;

        try {
            await FINOX.supabase
                .from('team_channels')
                .update({ is_archived: true })
                .eq('id', ch.id);

            state.channels = state.channels.filter(c => c.id !== ch.id);
            backToChannels();
            FINOX.showNotification('Conversation supprimée', 'success');
        } catch(e) {
            FINOX.showNotification('Erreur', 'error');
        }
    }

    // Check if user can write in the current channel
    function canWrite(ch, userId) {
        if (!ch) return false;
        if (ch.type !== 'announcement') return true;

        // Announcement: only creator, writers list, or admins can post
        if (ch.created_by === userId) return true;
        if ((ch.writers || []).includes(userId)) return true;

        const profile = getMember(userId);
        if (profile?.role === 'admin' || profile?.role === 'super_admin') return true;

        return false;
    }

    // ─────────────────────────────────────────
    // PINNED MESSAGES
    // ─────────────────────────────────────────
    let pinnedMessages = [];
    let pinnedExpanded = false;

    async function loadPinned(channelId) {
        try {
            const { data } = await FINOX.supabase
                .from('team_messages')
                .select('*')
                .eq('channel_id', channelId)
                .eq('is_pinned', true)
                .eq('is_deleted', false)
                .order('created_at', { ascending: false });
            pinnedMessages = data || [];
        } catch(e) { pinnedMessages = []; }
        renderPinnedBar();
    }

    function renderPinnedBar() {
        const bar = document.getElementById('tcPinnedBar');
        const list = document.getElementById('tcPinnedList');
        if (!bar || !list) return;

        if (pinnedMessages.length === 0) {
            bar.style.display = 'none';
            list.style.display = 'none';
            return;
        }

        const latest = pinnedMessages[0];
        const sender = getMember(latest.sender_id);
        bar.style.display = 'flex';
        bar.className = 'tc-pinned-bar';
        bar.onclick = () => {
            pinnedExpanded = !pinnedExpanded;
            list.style.display = pinnedExpanded ? 'block' : 'none';
        };
        bar.innerHTML = `
            <span class="tc-pinned-bar-icon">📌</span>
            <span class="tc-pinned-bar-text"><strong>${escapeHtml(sender.full_name)}</strong>: ${escapeHtml((latest.content || '').substring(0, 60))}</span>
            <span class="tc-pinned-bar-count">${pinnedMessages.length}</span>
        `;

        // Render expanded list
        list.innerHTML = pinnedMessages.map(msg => {
            const s = getMember(msg.sender_id);
            return `<div class="tc-pinned-item">
                <span class="tc-pinned-item-pin">📌</span>
                <div class="tc-pinned-item-content">
                    <div class="tc-pinned-item-sender">${escapeHtml(s.full_name)}</div>
                    <div class="tc-pinned-item-text">${escapeHtml((msg.content || '').substring(0, 120))}</div>
                </div>
                <button class="tc-pinned-item-unpin" onclick="event.stopPropagation();window.TeamChat.unpinMessage('${msg.id}')" title="Désépingler">✕</button>
            </div>`;
        }).join('');
    }

    async function pinMessage(msgId) {
        try {
            await FINOX.supabase
                .from('team_messages')
                .update({ is_pinned: true })
                .eq('id', msgId);

            const msg = state.messages.find(m => m.id === msgId);
            if (msg) {
                msg.is_pinned = true;
                pinnedMessages.unshift(msg);
                renderPinnedBar();
            }
            FINOX.showNotification('Message épinglé', 'success');
        } catch(e) {
            FINOX.showNotification('Erreur', 'error');
        }
    }

    async function unpinMessage(msgId) {
        try {
            await FINOX.supabase
                .from('team_messages')
                .update({ is_pinned: false })
                .eq('id', msgId);

            const msg = state.messages.find(m => m.id === msgId);
            if (msg) msg.is_pinned = false;
            pinnedMessages = pinnedMessages.filter(m => m.id !== msgId);
            renderPinnedBar();
            FINOX.showNotification('Message désépinglé', 'success');
        } catch(e) {
            FINOX.showNotification('Erreur', 'error');
        }
    }

    // ─────────────────────────────────────────
    // SEND MESSAGE
    // ─────────────────────────────────────────
    async function sendMessage() {
        const input = document.getElementById('tcInput');
        if (!input) return;

        const content = input.value.trim();
        if (!content || !state.currentChannel) return;

        const user = getUser();
        if (!user) return;

        input.value = '';
        input.style.height = 'auto';
        document.getElementById('tcSendBtn').disabled = true;

        try {
            const msgData = {
                channel_id: state.currentChannel.id,
                sender_id: user.id,
                content: content,
                content_type: 'text',
                metadata: {},
                read_by: [user.id],
                reply_to: state.replyTo?.id || null,
                organization_id: getOrgId()
            };

            const { error } = await FINOX.supabase
                .from('team_messages')
                .insert(msgData);

            if (error) throw error;

            // Clear reply
            state.replyTo = null;
            const replyEl = document.getElementById('tcReplyPreview');
            if (replyEl) replyEl.style.display = 'none';

        } catch(e) {
            console.error('[TeamChat] sendMessage error:', e);
            FINOX.showNotification('Erreur d\'envoi du message', 'error');
            input.value = content;
        }
    }

    // ─────────────────────────────────────────
    // INPUT HANDLING
    // ─────────────────────────────────────────
    function handleInputKey(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    function handleInputChange(el) {
        // Auto-resize
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 100) + 'px';

        // Enable/disable send
        const btn = document.getElementById('tcSendBtn');
        if (btn) btn.disabled = !el.value.trim();

        // Broadcast typing
        broadcastTyping();
    }

    // ─────────────────────────────────────────
    // SPECIAL ACTIONS
    // ─────────────────────────────────────────

    // Share current client
    async function shareClient() {
        if (!state.currentChannel) return;

        const clientId = FINOX.getClientId ? FINOX.getClientId() : FINOX.CLIENT_ID;
        if (!clientId) {
            FINOX.showNotification('Ouvrez un dossier client d\'abord', 'warning');
            return;
        }

        const clientData = FINOX.getClientData ? FINOX.getClientData() : null;
        const user = getUser();

        const name = clientData?.full_name || clientData?.nom_complet || 'Client';
        const pulse = clientData?.pulse_score || '—';
        const status = clientData?.statut || clientData?.lead_status || '—';

        try {
            await FINOX.supabase.from('team_messages').insert({
                channel_id: state.currentChannel.id,
                sender_id: user.id,
                content: `📌 ${name} — Pulse: ${pulse}% | Statut: ${status}`,
                content_type: 'client_share',
                metadata: {
                    client_id: clientId,
                    client_name: name,
                    detail: `Pulse: ${pulse}% | ${status}`
                },
                read_by: [user.id],
                organization_id: getOrgId()
            });
        } catch(e) {
            console.error('[TeamChat] shareClient error:', e);
            FINOX.showNotification('Erreur de partage', 'error');
        }
    }

    // Start Google Meet
    async function startMeet() {
        if (!state.currentChannel) return;

        const user = getUser();
        const member = getMember(user.id);
        const senderName = member?.full_name || 'Quelqu\'un';

        // Check Google connection
        if (!FINOX.isGoogleConnected || !FINOX.isGoogleConnected()) {
            FINOX.showNotification('Connectez Google pour créer un Meet', 'warning');
            return;
        }

        try {
            const tokens = FINOX.getGoogleTokens();
            if (!tokens?.access_token) {
                FINOX.showNotification('Token Google expiré — reconnectez-vous', 'warning');
                return;
            }

            // Create a Google Calendar event with Meet link
            const now = new Date();
            const end = new Date(now.getTime() + 30 * 60000);

            const event = {
                summary: `Appel Finox — ${state.currentChannel.name}`,
                start: { dateTime: now.toISOString() },
                end: { dateTime: end.toISOString() },
                conferenceData: {
                    createRequest: {
                        requestId: `finox-meet-${Date.now()}`,
                        conferenceSolutionKey: { type: 'hangoutsMeet' }
                    }
                }
            };

            const resp = await fetch(
                'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${tokens.access_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event)
                }
            );

            if (!resp.ok) throw new Error('Google Calendar API error');
            const calEvent = await resp.json();
            const meetUrl = calEvent.hangoutLink;

            if (!meetUrl) {
                FINOX.showNotification('Impossible de créer le lien Meet', 'error');
                return;
            }

            // Send meet message
            await FINOX.supabase.from('team_messages').insert({
                channel_id: state.currentChannel.id,
                sender_id: user.id,
                content: `🎥 ${senderName} a lancé un appel vidéo`,
                content_type: 'meet_link',
                metadata: { meet_url: meetUrl },
                read_by: [user.id],
                organization_id: getOrgId()
            });

            // Open meet in new tab (auto-record panel opens)
            window.open(meetUrl + (meetUrl.includes('?') ? '&' : '?') + 'record=true', '_blank');

        } catch(e) {
            console.error('[TeamChat] startMeet error:', e);
            FINOX.showNotification('Erreur lors de la création du Meet', 'error');
        }
    }

    // Open client file
    function openClient(clientId) {
        if (!clientId) return;
        // Navigate to client file
        window.location.href = `abf.html?id=${clientId}`;
    }

    // ─────────────────────────────────────────
    // NEW CHANNEL / DM MODAL
    // ─────────────────────────────────────────
    function showNewChannel() {
        const modal = document.getElementById('tcModal');
        if (!modal) return;

        const user = getUser();
        const others = state.members
            .filter(m => m.id !== user?.id)
            .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'fr'));

        // Build member list with presence dots (alphabetical)
        const memberList = others.map(m => {
            const pStatus = state.presenceMap[m.id] || 'offline';
            const statusIcon = pStatus === 'online' ? '🟢' : pStatus === 'away' ? '🟡' : '⚫';
            return `
                <label class="tc-member-item" data-uid="${m.id}">
                    <input type="checkbox" value="${m.id}" />
                    <div class="tc-member-avatar">${getInitials(m.full_name)}</div>
                    <div style="flex:1;min-width:0;">
                        <span class="tc-member-name">${escapeHtml(m.full_name)}</span>
                        <div style="font-size:10px;color:var(--text-muted);">${statusIcon} ${escapeHtml(m.role || '')}</div>
                    </div>
                </label>
            `;
        }).join('');

        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="tc-modal-overlay" onclick="window.TeamChat.closeModal()">
                <div class="tc-modal" onclick="event.stopPropagation()">
                    <h4>Nouvelle conversation</h4>
                    <input class="tc-modal-input" id="tcSearchMember" placeholder="🔍 Rechercher un membre..." oninput="window.TeamChat.filterMembers(this.value)" />
                    <div class="tc-channel-section-title" style="padding:8px 0 4px;">Sélectionner (1 = DM, 2+ = Groupe)</div>
                    <div class="tc-member-list" id="tcMemberList">${memberList}</div>
                    <input class="tc-modal-input" id="tcNewChannelName" placeholder="Nom du groupe (optionnel)" style="display:none;" />
                    <label class="tc-member-item" id="tcAnnouncementToggle" style="display:none;margin-top:4px;background:rgba(201,162,39,0.05);border:1px solid rgba(201,162,39,0.1);border-radius:8px;">
                        <input type="checkbox" id="tcIsAnnouncement" />
                        <span style="font-size:16px;">📢</span>
                        <div style="flex:1;">
                            <span class="tc-member-name">Canal d'annonce</span>
                            <div style="font-size:10px;color:var(--text-muted);">Seul toi et les admins peuvent écrire</div>
                        </div>
                    </label>
                    <div class="tc-modal-actions">
                        <button class="tc-modal-btn cancel" onclick="window.TeamChat.closeModal()">Annuler</button>
                        <button class="tc-modal-btn primary" onclick="window.TeamChat.createChannel()">Démarrer</button>
                    </div>
                </div>
            </div>
        `;

        // Show/hide group name + announcement toggle based on selection count
        modal.querySelectorAll('#tcMemberList input[type=checkbox]').forEach(cb => {
            cb.addEventListener('change', () => {
                const checked = modal.querySelectorAll('#tcMemberList input[type=checkbox]:checked').length;
                const nameInput = document.getElementById('tcNewChannelName');
                const annToggle = document.getElementById('tcAnnouncementToggle');
                if (nameInput) nameInput.style.display = checked >= 2 ? 'block' : 'none';
                if (annToggle) annToggle.style.display = checked >= 2 ? 'flex' : 'none';
            });
        });
    }

    function filterMembers(query) {
        const items = document.querySelectorAll('#tcMemberList .tc-member-item');
        const q = query.toLowerCase();
        items.forEach(item => {
            const name = item.querySelector('.tc-member-name')?.textContent?.toLowerCase() || '';
            item.style.display = name.includes(q) ? '' : 'none';
        });
    }

    async function createChannel() {
        const nameInput = document.getElementById('tcNewChannelName');
        const checkboxes = document.querySelectorAll('#tcMemberList input[type=checkbox]:checked');
        const isAnnouncement = document.getElementById('tcIsAnnouncement')?.checked || false;
        const user = getUser();

        const selectedIds = Array.from(checkboxes).map(cb => cb.value);
        if (selectedIds.length === 0) {
            FINOX.showNotification('Sélectionnez au moins un membre', 'warning');
            return;
        }

        const allMembers = [user.id, ...selectedIds];
        const name = nameInput?.value.trim();
        const isDM = selectedIds.length === 1 && !name && !isAnnouncement;
        const type = isAnnouncement ? 'announcement' : (isDM ? 'direct' : 'group');

        // Check if DM already exists
        if (isDM) {
            const existing = state.channels.find(ch =>
                ch.type === 'direct' &&
                ch.members.includes(user.id) &&
                ch.members.includes(selectedIds[0])
            );
            if (existing) {
                closeModal();
                openChannel(existing.id);
                return;
            }
        }

        const channelName = name || (isAnnouncement ? 'Annonce' : state.members
            .filter(m => selectedIds.includes(m.id))
            .map(m => m.full_name?.split(' ')[0] || 'Inconnu')
            .join(', '));

        try {
            const { data, error } = await FINOX.supabase
                .from('team_channels')
                .insert({
                    name: channelName,
                    type: type,
                    icon: isAnnouncement ? '📢' : (isDM ? getInitials(getMember(selectedIds[0]).full_name) : '👥'),
                    created_by: user.id,
                    organization_id: getOrgId(),
                    members: allMembers,
                    writers: isAnnouncement ? [user.id] : []
                })
                .select()
                .single();

            if (error) throw error;

            state.channels.unshift(data);
            closeModal();
            openChannel(data.id);
        } catch(e) {
            console.error('[TeamChat] createChannel error:', e);
            FINOX.showNotification('Erreur de création', 'error');
        }
    }

    function closeModal() {
        const modal = document.getElementById('tcModal');
        if (modal) {
            modal.style.display = 'none';
            modal.innerHTML = '';
        }
    }

    // ─────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────
    function cleanup() {
        if (state.realtimeChannel) {
            FINOX.supabase.removeChannel(state.realtimeChannel);
        }
        if (state.channelSubscription) {
            FINOX.supabase.removeChannel(state.channelSubscription);
        }
        if (state.presenceChannel) {
            FINOX.supabase.removeChannel(state.presenceChannel);
        }
        updatePresence('offline');
        state.initialized = false;
        console.log('[TeamChat] Cleaned up');
    }

    // ─────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────
    window.TeamChat = {
        init,
        togglePanel,
        openPanel,
        closePanel,
        openChannel,
        backToChannels,
        sendMessage,
        handleInputKey,
        handleInputChange,
        togglePin,
        startMeet,
        openClient,
        cycleStatus,
        setStatus,
        toggleConvMenu,
        togglePinChannel,
        toggleMute,
        leaveChannel,
        deleteChannel,
        pinMessage,
        unpinMessage,
        acceptCall,
        declineCall,
        showNewChannel,
        filterMembers,
        createChannel,
        closeModal,
        cleanup,
        getState: () => state
    };

    // Auto-init when DOM ready & FINOX available
    function tryInit() {
        if (window.FINOX && FINOX.getCurrentUser && FINOX.getCurrentUser()) {
            init();
        } else {
            setTimeout(tryInit, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }

})();
