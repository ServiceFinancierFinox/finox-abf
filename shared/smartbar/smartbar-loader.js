// ═══════════════════════════════════════════════════════════════
// SMART BAR — LOADER & CORE
// Injecte le dock HTML + overlays, constants, helpers, badges,
// Escape handler, legacy messages compat
// ═══════════════════════════════════════════════════════════════

// ── WORKER ENDPOINTS ──
const RC_WORKER = 'https://crm.finox.ca/ringcentral';
const GOOGLE_WORKER = 'https://crm.finox.ca/google';
const AI_REPLY_WORKER = 'https://crm.finox.ca/gemini';   // Gemini Flash — quick replies SMS/Email
const AI_HEAVY_WORKER = 'https://crm.finox.ca/claude';   // Claude Sonnet — résumé dossier, lettres, analyse

// ── SHARED STATE ──
let smsPopupLoaded = false;
let emailPopupLoaded = false;
let emailPopupMessages = [];
let emailPopupSelected = null;
let composeAttachments2 = [];
let replyAttachments = [];
let smsSelectedContact = 'client';
let emailSelectedContact = 'client';

// Legacy messages state
let msgCurrentTab = 'sms';
let msgSmsMessages = [];
let msgEmailMessages = [];
let msgSmsLoaded = false;
let msgEmailLoaded = false;
let msgSelectedEmail = null;

// ══════════════════════════════════════════
// initSmartBar() — Point d'entrée principal
// ══════════════════════════════════════════
function initSmartBar() {
    injectSmartBarHTML();
    setupEscapeHandler();
    if (FINOX.CLIENT_ID) loadMsgBadges();
}

// ══════════════════════════════════════════
// HTML INJECTION
// ══════════════════════════════════════════
function injectSmartBarHTML() {
    // Crée un conteneur et y injecte tout le HTML smart bar
    const container = document.createElement('div');
    container.id = 'smartBarContainer';
    container.innerHTML = `
    <!-- SMART BAR — Dock flottant unifié -->
    <div class="smart-bar" id="smartBar">
        <button class="sb-btn sb-call" id="sbCallBtn" data-tooltip="Appeler" onclick="startDirectCall()">📞</button>
        <button class="sb-btn sb-sms" id="sbSmsBtn" data-tooltip="SMS" onclick="openSmsPopup()">
            💬<span class="sb-badge hidden" id="sbSmsBadge">0</span>
        </button>
        <button class="sb-btn sb-email" id="sbEmailBtn" data-tooltip="Email" onclick="openEmailPopup()">
            📧<span class="sb-badge hidden" id="sbEmailBadge">0</span>
        </button>
        <button class="sb-btn sb-cal" data-tooltip="Rencontre" onclick="openCalendarPopup()">📅</button>
        <div class="sb-call-tracker" id="sbCallTracker">
            <div class="smart-bar-sep"></div>
            <span class="sb-call-status" id="sbCallStatus">📞 Appel...</span>
            <span class="sb-call-timer" id="sbCallTimer">00:00</span>
            <div class="sb-call-controls" id="sbCallControls" style="display:none;">
                <button class="sb-ctrl-btn sb-ctrl-hold" id="sbHoldBtn" onclick="toggleCallHold()" title="Mettre en attente">⏸️</button>
                <button class="sb-ctrl-btn sb-ctrl-hangup" id="sbHangupBtn" onclick="hangupCall()" title="Raccrocher">📵</button>
            </div>
        </div>
        <div class="smart-bar-sep"></div>
        <button class="sb-btn sb-tasks" id="sbTasksBtn" data-tooltip="Tâches" onclick="openTachesPopup()">
            📋<span class="sb-badge hidden" id="sbTasksBadge">0</span>
        </button>
        <button class="sb-btn sb-notes" id="sbNotesBtn" data-tooltip="Notes" onclick="openNotesModal()">
            📝<span class="sb-badge hidden" id="sbNotesBadge">0</span>
        </button>
        <button class="sb-btn sb-manni" id="sbFinoxAiBtn" data-tooltip="Finox AI" onclick="openFinoxAiPopup()">🤖</button>
        <div class="smart-bar-sep"></div>
        <div style="position:relative;">
            <button class="sb-btn sb-quick" id="sbQuickBtn" data-tooltip="Actions rapides" onclick="toggleQuickActions()">⚡</button>
            <div class="sb-quick-menu" id="sbQuickMenu">
                <button class="sb-quick-item" onclick="quickAction('opportunity')"><span class="sq-icon">🎯</span><span class="sq-label">Nouvelle opportunité</span></button>
                <button class="sb-quick-item" onclick="quickAction('signature')"><span class="sq-icon">✍️</span><span class="sq-label">Envoyer ABF pour signature</span></button>
                <button class="sb-quick-item" onclick="quickAction('document')"><span class="sq-icon">📤</span><span class="sq-label">Demander un document</span></button>
                <button class="sb-quick-item" onclick="quickAction('email')"><span class="sq-icon">📧</span><span class="sq-label">Envoyer un courriel</span></button>
                <button class="sb-quick-item" onclick="quickAction('status')"><span class="sq-icon">🔄</span><span class="sq-label">Changer le statut</span></button>
                <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0;"></div>
                <button class="sb-quick-item" onclick="quickAction('vault')"><span class="sq-icon">🔑</span><span class="sq-label">Accès Assureurs</span></button>
                <button class="sb-quick-item" onclick="quickAction('boss_push')"><span class="sq-icon">🏠</span><span class="sq-label">Envoyer vers BOSS</span></button>
            </div>
        </div>
        <div class="smart-bar-sep"></div>
        <button class="sb-btn sb-apercu" id="sbApercuBtn" data-tooltip="Aperçu Client" onclick="toggleDashDrawer()">👤</button>
    </div>

    <!-- BOUTON FLOTTANT CALENDRIER (legacy) -->
    <button class="calendar-floating-btn" id="calendarFloatingBtn" onclick="openCalendarPopup()" title="Planifier une rencontre">📅</button>

    <!-- POPUP CALENDRIER -->
    <div class="calendar-popup-overlay" id="calendarPopupOverlay" onclick="closeCalendarPopup()">
        <div class="calendar-popup" onclick="event.stopPropagation()">
            <div class="calendar-popup-header">
                <div class="calendar-popup-header-left">
                    <div class="calendar-popup-icon">📅</div>
                    <div class="calendar-popup-info">
                        <h4>Google Calendar</h4>
                        <span id="calPopupAccount">Non connecté</span>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <div id="calPopupStatus"><button class="mini-cal-today-btn" onclick="connectGoogleCalendar()" style="font-size:11px;padding:6px 12px;">Connecter</button></div>
                    <button class="calendar-popup-close" onclick="closeCalendarPopup()">✕</button>
                </div>
            </div>
            <div class="calendar-content-wrapper">
                <div class="mini-calendar-section">
                    <div class="mini-calendar-nav">
                        <button class="mini-cal-nav-btn" onclick="calPrevMonth()">◀</button>
                        <span class="mini-cal-month" id="calPopupMonth">Janvier 2026</span>
                        <button class="mini-cal-nav-btn" onclick="calNextMonth()">▶</button>
                        <button class="mini-cal-today-btn" onclick="calGoToToday()">Aujourd'hui</button>
                    </div>
                    <div class="mini-calendar-grid" id="calPopupGrid"></div>
                </div>
                <div class="day-schedule-section">
                    <div class="day-schedule-inner">
                        <div class="day-schedule-title" id="calPopupDateTitle">📅 Sélectionnez une date</div>
                        <div class="time-slots-container" id="calPopupTimeSlots">
                            <div class="comm-empty-state" style="padding:20px;"><div class="comm-empty-icon">📅</div><div class="comm-empty-text">Choisir une date</div></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="calendar-scheduled-meetings">
                <div class="scheduled-meetings-header">
                    <span class="scheduled-meetings-title" id="calPopupMeetingsTitle">📆 RDV de la journée</span>
                    <button class="refresh-meetings-btn" onclick="calLoadScheduledMeetings()">↻</button>
                </div>
                <div class="scheduled-meetings-list" id="calPopupMeetingsList">
                    <div class="comm-empty-state" style="padding:15px;"><div class="comm-empty-text" style="font-size:11px;">Aucun RDV planifié</div></div>
                </div>
            </div>
        </div>
    </div>

    <!-- BOUTON FLOTTANT NOTES -->
    <button class="notes-btn" id="notesFloatingBtn" onclick="openNotesModal()" title="Notes de suivi">
        📝
        <span class="notes-btn-badge hidden" id="notesBtnBadge">0</span>
    </button>

    <!-- MODAL NOTES DE SUIVI -->
    <div class="notes-modal-overlay" id="notesModalOverlay" onclick="closeNotesModal()">
        <div class="notes-modal" onclick="event.stopPropagation()">
            <div class="notes-modal-header">
                <div class="notes-modal-title">📝 Notes de suivi</div>
                <button class="notes-modal-close" onclick="closeNotesModal()">✕</button>
            </div>
            <div class="notes-modal-body">
                <div class="notes-list" id="notesList">
                    <div class="notes-empty">
                        <div class="notes-empty-icon">📝</div>
                        <div class="notes-empty-text">Aucune note pour le moment</div>
                    </div>
                </div>
            </div>
            <div class="notes-modal-footer">
                <div class="notes-input-row">
                    <textarea class="notes-input" id="noteInput" placeholder="Ajouter une note de suivi..." onkeypress="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();addNote();}"></textarea>
                    <button class="notes-add-btn" onclick="addNote()">+ Ajouter</button>
                </div>
            </div>
        </div>
    </div>

    <!-- BOUTON FLOTTANT APPELS (legacy) -->
    <button class="call-btn" id="callFloatingBtn" onclick="startDirectCall()" title="Appeler le client">📞</button>

    <!-- MINI-TRACKER D'APPEL (legacy) -->
    <div class="call-tracker hidden" id="callTracker">
        <span class="call-tracker-status" id="callTrackerStatus">📞 Appel...</span>
        <span class="call-tracker-timer" id="callTrackerTimer">00:00</span>
    </div>

    <!-- BOUTON FLOTTANT MESSAGES (legacy) -->
    <button class="msg-btn" id="msgFloatingBtn" onclick="openMsgModal()" title="Messages">
        💬
        <span class="msg-btn-badge hidden" id="msgBtnBadge">0</span>
    </button>

    <!-- MODAL MESSAGES (legacy) -->
    <div class="msg-modal-overlay" id="msgModalOverlay" onclick="closeMsgModal()">
        <div class="msg-modal" onclick="event.stopPropagation()">
            <div class="msg-modal-header">
                <div class="msg-modal-title">💬 Messages — <span id="msgClientName">Client</span></div>
                <button class="msg-modal-close" onclick="closeMsgModal()">✕</button>
            </div>
            <div class="msg-tabs">
                <button class="msg-tab active" id="msgTabSms" onclick="switchMsgTab('sms')">💬 SMS <span class="msg-tab-badge hidden" id="msgSmsBadge">0</span></button>
                <button class="msg-tab" id="msgTabEmail" onclick="switchMsgTab('email')">📧 Email <span class="msg-tab-badge hidden" id="msgEmailBadge">0</span></button>
            </div>
            <div class="msg-modal-body">
                <div class="msg-panel active" id="msgSmsPanel">
                    <div class="msg-conv" id="msgSmsConv">
                        <div class="msg-empty"><div class="msg-empty-icon">💬</div><div class="msg-empty-text">Cliquez pour charger les SMS</div></div>
                    </div>
                </div>
                <div class="msg-panel" id="msgEmailPanel">
                    <div class="msg-email-list" id="msgEmailList">
                        <div class="msg-empty"><div class="msg-empty-icon">📧</div><div class="msg-empty-text">Cliquez pour charger les emails</div></div>
                    </div>
                </div>
            </div>
            <div class="msg-modal-footer">
                <div class="msg-reply-row">
                    <textarea class="msg-reply-input" id="msgReplyInput" placeholder="Votre message SMS..." onkeypress="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendMsgReply();}"></textarea>
                    <button class="msg-send-btn" id="msgSendBtn" onclick="sendMsgReply()">Envoyer</button>
                </div>
            </div>
        </div>
    </div>

    <!-- SIDELOAD SMS -->
    <div class="sideload-overlay" id="smsPopupOverlay" onclick="closeSmsPopup()">
        <div class="sideload-popup sms-popup" onclick="event.stopPropagation()">
            <div class="sideload-header">
                <div class="sideload-title">💬 SMS — <span id="smsPopupClient">Client</span></div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <button class="sb-mark-unread-btn hidden" id="smsMarkUnreadBtn" onclick="event.stopPropagation();markSmsUnread()" title="Marquer comme non lu">📬 Non lu</button>
                    <button class="sideload-close" onclick="closeSmsPopup()">✕</button>
                </div>
            </div>
            <div class="contact-selector" id="smsContactSelector" style="display:none;"></div>
            <div class="sideload-body" id="smsPopupBody">
                <div class="msg-conv" id="smsPopupConv">
                    <div class="sideload-loading">⏳ Chargement...</div>
                </div>
            </div>
            <div class="sideload-footer">
                <div class="sms-actions-row">
                    <button class="sms-action-btn ai-btn" id="smsAiBtn" onclick="smsQuickAiReply()">✨ AI Reply</button>
                    <button class="sms-action-btn" onclick="toggleSmsEmojiPicker()">😊 Emoji</button>
                    <button class="sms-action-btn" onclick="toggleSmsTemplates()">📋 Modèles</button>
                </div>
                <div class="sms-templates-panel" id="smsTemplatesPanel">
                    <div class="sms-template-item" onclick="insertSmsTemplate('accueil')">
                        <div class="sms-template-label">👋 Accueil</div>
                        Bonjour {prénom}, merci de nous avoir contacté! Comment puis-je vous aider?
                    </div>
                    <div class="sms-template-item" onclick="insertSmsTemplate('suivi')">
                        <div class="sms-template-label">📋 Suivi</div>
                        Bonjour {prénom}, je fais un suivi concernant notre dernière conversation. Avez-vous des questions?
                    </div>
                    <div class="sms-template-item" onclick="insertSmsTemplate('rappel')">
                        <div class="sms-template-label">⏰ Rappel RDV</div>
                        Bonjour {prénom}, un petit rappel pour notre rendez-vous prévu. Au plaisir!
                    </div>
                    <div class="sms-template-item" onclick="insertSmsTemplate('merci')">
                        <div class="sms-template-label">🙏 Remerciement</div>
                        Merci {prénom} pour votre confiance! N'hésitez pas si vous avez besoin de quoi que ce soit.
                    </div>
                </div>
                <div class="sms-emoji-panel" id="smsEmojiPanel">
                    <div class="sms-emoji-grid" id="smsEmojiGrid"></div>
                </div>
                <div class="sms-reply-row">
                    <textarea class="sms-reply-input" id="smsReplyInput" placeholder="Votre message SMS..." oninput="autoExpandTextarea(this)" onkeypress="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendSmsFromPopup();}"></textarea>
                    <button class="sms-send-btn" id="smsSendBtn" onclick="sendSmsFromPopup()">Envoyer</button>
                </div>
            </div>
        </div>
    </div>

    <!-- SIDELOAD EMAIL -->
    <div class="sideload-overlay" id="emailPopupOverlay" onclick="closeEmailPopup()">
        <div class="sideload-popup email-popup" onclick="event.stopPropagation()">
            <div class="sideload-header">
                <div class="sideload-title">📧 Email — <span id="emailPopupClient">Client</span></div>
                <div class="email-popup-header-actions">
                    <button class="sb-mark-unread-btn hidden" id="emailMarkUnreadBtn" onclick="event.stopPropagation();markEmailUnread()" title="Marquer comme non lu">📬 Non lu</button>
                    <a class="email-popup-new-btn" id="emailPopupOpenFile" href="#" target="_blank" style="text-decoration:none;" title="Ouvrir le dossier client">📂 Dossier</a>
                    <button class="email-popup-new-btn" onclick="openEmailComposeFromPopup()">✏️ Nouveau</button>
                    <button class="sideload-close" onclick="closeEmailPopup()">✕</button>
                </div>
            </div>
            <div class="contact-selector" id="emailContactSelector" style="display:none;"></div>
            <div class="sideload-body" id="emailPopupBody">
                <div id="emailPopupList">
                    <div class="msg-email-list" id="emailPopupEmailList">
                        <div class="sideload-loading">⏳ Chargement...</div>
                    </div>
                </div>
                <div class="email-popup-detail" id="emailPopupDetail">
                    <div class="email-detail-topbar">
                        <button class="email-popup-back" onclick="emailPopupBackToList()">← Retour</button>
                        <span class="email-detail-direction" id="emailDetailDirection">Reçu</span>
                    </div>
                    <div class="email-popup-subject" id="emailPopupSubject"></div>
                    <div class="email-detail-meta-row">
                        <span class="email-detail-from" id="emailDetailFrom"></span>
                        <span class="email-detail-date" id="emailDetailDate"></span>
                    </div>
                    <div class="email-detail-body" id="emailDetailBody">
                        <div class="sideload-loading">⏳ Chargement...</div>
                    </div>
                    <div class="email-detail-attachments" id="emailDetailAttachments"></div>
                </div>
            </div>
            <div class="sideload-footer">
                <div class="email-reply-actions">
                    <button class="email-action-btn" onclick="document.getElementById('emailReplyFileInput').click()">📎 Joindre</button>
                    <button class="email-action-btn ai-btn" id="emailAiBtn" onclick="emailQuickAiReply()">✨ AI Reply</button>
                </div>
                <div class="email-reply-attachments" id="emailReplyAttachments"></div>
                <input type="file" id="emailReplyFileInput" multiple style="display:none" onchange="handleReplyFiles(this.files)">
                <div class="email-reply-row">
                    <textarea class="email-reply-input" id="emailReplyInput" placeholder="Votre réponse email..." oninput="autoExpandTextarea(this)" onkeypress="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendEmailFromPopup();}"></textarea>
                    <button class="email-send-btn" id="emailSendBtn" onclick="sendEmailFromPopup()">Envoyer</button>
                </div>
            </div>
        </div>
    </div>

    <!-- EMAIL COMPOSE SUB-MODAL -->
    <div class="email-compose-overlay" id="emailComposeOverlay" onclick="closeEmailCompose2()">
        <div class="email-compose-modal" onclick="event.stopPropagation()">
            <div class="email-compose-header">
                <div class="email-compose-title">✏️ Nouveau courriel</div>
                <button class="sideload-close" onclick="closeEmailCompose2()">✕</button>
            </div>
            <div class="email-compose-body">
                <div class="email-compose-field">
                    <label class="email-compose-label">À</label>
                    <input class="email-compose-input" id="emailComposeTo2" type="email" placeholder="email@exemple.com">
                </div>
                <div class="email-compose-field">
                    <label class="email-compose-label">Objet</label>
                    <input class="email-compose-input" id="emailComposeSubject2" type="text" placeholder="Objet du courriel">
                </div>
                <div class="email-compose-field">
                    <label class="email-compose-label">Message</label>
                    <div class="email-compose-editor" id="emailComposeBody2" contenteditable="true" placeholder="Rédigez votre message..."></div>
                </div>
                <div class="email-compose-field">
                    <label class="email-compose-label">Pièces jointes</label>
                    <div class="email-compose-attachments" id="emailComposeAttachments2">
                        <div class="email-compose-attachments-hint" id="emailComposeAttHint2">📎 Glissez-déposez des fichiers ici ou <button style="background:none;border:none;color:#EA4335;cursor:pointer;text-decoration:underline;font-size:12px;" onclick="document.getElementById('emailComposeFileInput2').click()">parcourir</button></div>
                    </div>
                    <input type="file" id="emailComposeFileInput2" multiple style="display:none" onchange="handleComposeFiles2(this.files)">
                </div>
                <div class="email-compose-signature" id="emailComposeSignature2"></div>
            </div>
            <div class="email-compose-footer">
                <div class="email-compose-footer-actions">
                    <button class="email-action-btn ai-btn" onclick="composeAiDraft2()">✨ AI Brouillon</button>
                </div>
                <button class="email-compose-send-btn" id="emailComposeSendBtn2" onclick="sendComposedEmail2()">📤 Envoyer</button>
            </div>
        </div>
    </div>

    <!-- SIDELOAD FINOX AI -->
    <div class="sideload-overlay" id="finoxAiPopupOverlay" onclick="closeFinoxAiPopup()">
        <div class="sideload-popup finoxai-popup" onclick="event.stopPropagation()">
            <div class="sideload-header">
                <div class="sideload-title">🤖 Finox AI — <span id="finoxAiPopupClient">Client</span></div>
                <button class="sideload-close" onclick="closeFinoxAiPopup()">✕</button>
            </div>
            <div class="sideload-body" id="finoxAiPopupBody">
                <div class="finoxai-queries-grid" id="finoxAiQueriesGrid">
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('dossier_summary')"><span class="fq-icon">📊</span> Résumé du dossier</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('next_step')"><span class="fq-icon">🎯</span> Prochaine étape</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('objections')"><span class="fq-icon">⚠️</span> Objections anticipées</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('sales_opportunities')"><span class="fq-icon">💡</span> Opportunités de vente</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('coverage_gaps')"><span class="fq-icon">📉</span> Lacunes couverture</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('followup_strategy')"><span class="fq-icon">🔄</span> Stratégie de relance</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('comm_history')"><span class="fq-icon">📋</span> Historique comm.</div>
                    <div class="finoxai-query-chip" onclick="finoxAiQuery('closing_strategy')"><span class="fq-icon">🏆</span> Stratégie de closing</div>
                </div>
                <div class="finoxai-response-area" id="finoxAiResponseArea">
                    <div class="finoxai-response-header">
                        <div class="finoxai-response-title" id="finoxAiResponseTitle">📊 Résumé du dossier</div>
                        <button class="finoxai-back-btn" onclick="finoxAiBackToQueries()">← Requêtes</button>
                    </div>
                    <div class="finoxai-response-body" id="finoxAiResponseBody"></div>
                    <div class="finoxai-response-meta" id="finoxAiResponseMeta"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- MODAL SELECTION TYPE RDV -->
    <div class="booking-modal-overlay" id="typeSelectModalOverlay" onclick="closeTypeSelectModal()">
        <div class="booking-modal type-select-modal" onclick="event.stopPropagation()">
            <button class="booking-modal-close" onclick="closeTypeSelectModal()">✕</button>
            <div class="type-select-header">
                <div class="type-select-title">📅 Planifier une rencontre</div>
                <div class="type-select-datetime" id="typeSelectDateTime">Lundi 27 janvier à 12:00</div>
                <div class="type-select-client">avec <strong id="typeSelectClientName">Client</strong></div>
            </div>
            <div class="type-select-body">
                <div class="type-select-col">
                    <div class="type-select-col-header appel"><span>📞</span> Appels</div>
                    <div class="type-select-list" id="typeSelectAppels"></div>
                </div>
                <div class="type-select-col">
                    <div class="type-select-col-header rencontre"><span>🤝</span> Rencontres</div>
                    <div class="type-select-list" id="typeSelectRencontres"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- MODAL CONFIRMATION RDV -->
    <div class="booking-modal-overlay" id="bookingModalOverlay" onclick="closeBookingModal()">
        <div class="booking-modal" onclick="event.stopPropagation()">
            <button class="booking-modal-close" onclick="closeBookingModal()">✕</button>
            <div class="booking-modal-header">
                <div class="booking-modal-icon" id="modalMeetingIcon">❤️</div>
                <div class="booking-modal-type" id="modalMeetingType">Rencontre comparative d'assurance vie</div>
            </div>
            <div class="booking-modal-details">
                <div class="booking-modal-detail">
                    <span class="booking-detail-icon">👤</span>
                    <span class="booking-detail-text" id="modalClientName">Client</span>
                </div>
                <div class="booking-modal-detail">
                    <span class="booking-detail-icon">📅</span>
                    <span class="booking-detail-text" id="modalDateTime">--</span>
                </div>
                <div class="booking-modal-detail">
                    <span class="booking-detail-icon">⏱️</span>
                    <span class="booking-detail-text" id="modalDuration">30 minutes</span>
                </div>
            </div>
            <div class="booking-modal-options">
                <label class="booking-modal-option"><input type="checkbox" id="modalEmailInvite" checked><span class="option-icon">📧</span><span>Envoyer invitation email</span></label>
                <label class="booking-modal-option"><input type="checkbox" id="modalSmsReminder" checked><span class="option-icon">📱</span><span>Rappel SMS</span></label>
                <label class="booking-modal-option" id="modalMeetOption"><input type="checkbox" id="modalGoogleMeet"><span class="option-icon">📹</span><span>Google Meet</span></label>
            </div>
            <div class="booking-modal-location" id="modalLocationSection" style="display:none;">
                <div class="booking-modal-location-label">📍 Lieu de la rencontre</div>
                <div class="booking-modal-location-buttons">
                    <button type="button" class="location-btn active" id="locationBtnClient" onclick="selectLocation('client')">🏠 Chez le client</button>
                    <button type="button" class="location-btn" id="locationBtnBureau" onclick="selectLocation('bureau')">🏢 Au bureau</button>
                </div>
            </div>
            <input type="text" class="booking-modal-notes" id="modalNotes" placeholder="Notes (optionnel)...">
            <button class="booking-modal-confirm" onclick="confirmBookingFromModal()">
                <span>✅ Confirmer la rencontre</span>
            </button>
        </div>
    </div>

    <!-- SIDELOAD TÂCHES -->
    <div class="sideload-overlay" id="tachesPopupOverlay" onclick="closeTachesPopup()">
        <div class="sideload-popup tasks-popup" onclick="event.stopPropagation()">
            <div class="sideload-header">
                <div class="sideload-title">📋 Tâches — <span id="tachesPopupClient">Client</span></div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="tp-add-toggle-btn" onclick="tachesPopupToggleAdd()">＋ Nouvelle</button>
                    <button class="sideload-close" onclick="closeTachesPopup()">✕</button>
                </div>
            </div>
            <div class="sideload-body" id="tachesPopupBody">
                <!-- Stats mini cards -->
                <div class="tp-stats-row" id="tachesPopupStats">
                    <div class="tp-stat-card pending"><span class="tp-stat-num" id="tpStatPending">0</span><span class="tp-stat-label">En attente</span></div>
                    <div class="tp-stat-card progress"><span class="tp-stat-num" id="tpStatProgress">0</span><span class="tp-stat-label">En cours</span></div>
                    <div class="tp-stat-card done"><span class="tp-stat-num" id="tpStatDone">0</span><span class="tp-stat-label">Complétées</span></div>
                </div>
                <!-- Add form (hidden by default) -->
                <div class="tp-add-form" id="tachesPopupAddForm">
                    <input type="text" class="tp-add-input" id="tpTaskTitle" placeholder="Titre de la tâche..." onkeydown="if(event.key==='Enter') tachesPopupAddTask()">
                    <div class="tp-add-options">
                        <select class="tp-add-select" id="tpTaskPriority">
                            <option value="normal">🔵 Normal</option>
                            <option value="low">⚪ Basse</option>
                            <option value="high">🟠 Haute</option>
                            <option value="urgent">🔴 Urgente</option>
                        </select>
                        <select class="tp-add-select" id="tpTaskAssign"><option value="">👤 Moi-même</option></select>
                        <button class="tp-add-submit" onclick="tachesPopupAddTask()">Ajouter</button>
                    </div>
                </div>
                <!-- Filters -->
                <div class="tp-filter-bar" id="tachesPopupFilters">
                    <button class="tp-filter active" data-filter="active" onclick="tachesPopupFilter('active')">Actives</button>
                    <button class="tp-filter" data-filter="completed" onclick="tachesPopupFilter('completed')">Complétées</button>
                    <button class="tp-filter" data-filter="all" onclick="tachesPopupFilter('all')">Toutes</button>
                </div>
                <!-- Task list -->
                <div id="tachesPopupList">
                    <div class="sideload-empty"><div class="sideload-empty-icon">📋</div><div class="sideload-empty-text">Ouvrir pour charger les tâches</div></div>
                </div>
            </div>
        </div>
    </div>`;

    document.body.appendChild(container);
}

// ══════════════════════════════════════════
// ESCAPE HANDLER
// ══════════════════════════════════════════
function setupEscapeHandler() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (typeof closeMobileMenu === 'function') closeMobileMenu();
            const sbt = document.getElementById('sbCallTracker'); if (sbt && sbt.classList.contains('active')) sbt.classList.remove('active');
            const sqm = document.getElementById('sbQuickMenu'); if (sqm) sqm.classList.remove('open');
            if (document.getElementById('notesModalOverlay')?.classList.contains('show')) { closeNotesModal(); return; }
            if (document.getElementById('msgModalOverlay')?.classList.contains('show')) { closeMsgModal(); return; }
            // Sideload popups (fermer dans l'ordre: compose > taches > email/sms/finoxai > calendar)
            if (document.getElementById('emailComposeOverlay')?.classList.contains('show')) { closeEmailCompose2(); return; }
            if (document.getElementById('tachesPopupOverlay')?.classList.contains('show')) { closeTachesPopup(); return; }
            if (document.getElementById('smsPopupOverlay')?.classList.contains('show')) { closeSmsPopup(); return; }
            if (document.getElementById('emailPopupOverlay')?.classList.contains('show')) { closeEmailPopup(); return; }
            if (document.getElementById('finoxAiPopupOverlay')?.classList.contains('show')) { closeFinoxAiPopup(); return; }
            if (document.getElementById('calendarPopupOverlay')?.classList.contains('show')) { closeCalendarPopup(); return; }
        }
    });
}

// ══════════════════════════════════════════
// RC CONTACT SYNC — Auto-sync client vers carnet RingCentral
// ══════════════════════════════════════════

async function syncClientToRingCentral(clientId) {
    if (!clientId) return;
    try {
        const user = FINOX.getCurrentUser();
        if (!user) return;

        // Quick check: is RC connected?
        const statusRes = await fetch(RC_WORKER + '/connection/status', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': user.id }
        });
        const statusData = await statusRes.json();
        if (!statusData.connected) return; // RC pas connecté → skip silencieusement

        // Sync the contact
        const res = await fetch(RC_WORKER + '/contacts/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, user_id: user.id })
        });
        const data = await res.json();

        if (data.code === 'RC_SCOPE_MISSING') {
            console.warn('[RC Sync] Scope Contacts manquant — reconnectez RC');
            return;
        }

        if (data.success) {
            console.log(`✅ RC Contact ${data.action}: ${data.client_name} → RC ID: ${data.rc_contact_id}`);
        } else if (data.skipped) {
            // No phone number, skip silently
        } else {
            console.warn('[RC Sync] Error:', data.error);
        }
    } catch (e) {
        // Never block the save — just log
        console.warn('[RC Sync] Failed silently:', e.message);
    }
}

// ══════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════

function getClientName() {
    const cd = FINOX.getClientData();
    return cd ? `${cd.first_name || ''} ${cd.last_name || ''}`.trim() || 'Client' : 'Client';
}

function getClientFirstName() {
    const cd = FINOX.getClientData();
    return cd?.first_name || 'Client';
}

function autoExpandTextarea(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Contact Selector (client / conjoint) ──
function buildContactSelector(containerId, type, selected) {
    const cd = FINOX.getClientData();
    if (!cd) return;

    // Vérifier si le conjoint a les données nécessaires
    const conjointName = cd.conjoint_first_name || cd.conjoint_last_name;
    if (!conjointName) return; // Pas de conjoint = pas de sélecteur

    let hasConjointData = false;
    if (type === 'sms') {
        hasConjointData = !!(cd.conjoint_phone || cd.conjoint_phone_mobile);
    } else if (type === 'email') {
        hasConjointData = !!cd.conjoint_email;
    }

    if (!hasConjointData) return;

    const clientName = `${cd.first_name || ''} ${cd.last_name || ''}`.trim() || 'Client';
    const cjName = `${cd.conjoint_first_name || ''} ${cd.conjoint_last_name || ''}`.trim();
    const currentSel = selected || (type === 'sms' ? smsSelectedContact : emailSelectedContact);
    const switchFn = type === 'sms' ? 'switchSmsContact' : 'switchEmailContact';

    const container = document.getElementById(containerId);
    if (!container) return;

    container.style.display = 'flex';
    const escClient = FINOX.escapeHtml ? FINOX.escapeHtml(clientName) : clientName;
    const escCj = FINOX.escapeHtml ? FINOX.escapeHtml(cjName) : cjName;
    container.innerHTML = `
        <button class="contact-chip ${currentSel === 'client' ? 'active' : ''}" onclick="${switchFn}('client')"><span class="chip-dot"></span>${escClient}</button>
        <button class="contact-chip ${currentSel === 'conjoint' ? 'active' : ''}" onclick="${switchFn}('conjoint')"><span class="chip-dot"></span>${escCj}</button>
    `;
}

function getSelectedSmsPhone() {
    const cd = FINOX.getClientData();
    if (!cd) return null;
    if (smsSelectedContact === 'conjoint') {
        return cd.conjoint_phone || cd.conjoint_phone_mobile || null;
    }
    return cd.phone || cd.phone_mobile || null;
}

function getSelectedEmailAddress() {
    const cd = FINOX.getClientData();
    if (!cd) return null;
    if (emailSelectedContact === 'conjoint') {
        return cd.conjoint_email || null;
    }
    return cd.email || null;
}

function switchSmsContact(who) {
    smsSelectedContact = who;
    buildContactSelector('smsContactSelector', 'sms', who);
    smsPopupLoaded = false;
    loadSmsPopupConv();
}

function switchEmailContact(who) {
    emailSelectedContact = who;
    buildContactSelector('emailContactSelector', 'email', who);
    emailPopupLoaded = false;
    loadEmailPopupConv();
}

// ── Google Token Helper ──
async function getMsgGoogleToken() {
    // 1. Vérifier/rafraîchir le token proactivement via le serveur
    if (FINOX.ensureValidGoogleToken) {
        try {
            const freshToken = await FINOX.ensureValidGoogleToken();
            if (freshToken) return freshToken;
        } catch(e) {
            console.warn('[Token] ensureValidGoogleToken error:', e.message);
        }
    }
    // 2. Fallback: session Supabase (seulement valide juste après le login)
    try {
        const { data: { session } } = await FINOX.supabase.auth.getSession();
        if (session?.provider_token) return session.provider_token;
    } catch(e) {}
    // 3. Fallback: token stocké localement
    const tokens = FINOX.getGoogleTokens();
    return tokens?.access_token || null;
}

// ── Format Time Helper ──
function formatMsgTime(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'À l\'instant';
    if (diffMin < 60) return `Il y a ${diffMin}min`;
    if (diffH < 24) return `Il y a ${diffH}h`;
    if (diffD === 1) return 'Hier';
    if (diffD < 7) return `Il y a ${diffD}j`;
    return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ══════════════════════════════════════════
// QUICK ACTIONS
// ══════════════════════════════════════════
window.toggleQuickActions = function() {
    const menu = document.getElementById('sbQuickMenu');
    menu.classList.toggle('open');
};

window.quickAction = function(action) {
    document.getElementById('sbQuickMenu').classList.remove('open');

    switch(action) {
        case 'task':
            openTachesPopup();
            setTimeout(() => tachesPopupToggleAdd(), 200);
            break;
        case 'opportunity':
            if (typeof loadModule === 'function') loadModule('pipeline');
            break;
        case 'signature':
            FINOX.showNotification('📝 Signature ABF - Bientôt disponible', 'info');
            break;
        case 'document':
            FINOX.showNotification('📤 Demande de document - Bientôt disponible', 'info');
            break;
        case 'email':
            if (typeof openEmailPopup === 'function') {
                openEmailPopup();
                setTimeout(() => openEmailComposeFromPopup(), 300);
            }
            break;
        case 'status':
            if (typeof loadModule === 'function') loadModule('pulse-vital');
            break;
        case 'vault':
            if (window.toggleQuickVault) {
                window.toggleQuickVault();
            } else if (window.parent && window.parent.toggleQuickVault) {
                window.parent.toggleQuickVault();
            } else {
                sbOpenInlineVault();
            }
            break;
        case 'boss_push':
            pushClientToBoss();
            break;
    }
};

// ══════════════════════════════════════════
// INLINE VAULT — Fallback si Quick Vault pas dispo
// ══════════════════════════════════════════
window.sbOpenInlineVault = async function() {
    // Remove existing popup if any
    document.getElementById('sbVaultPopup')?.remove();

    const QV_CIE = [
        { key: 'apexa', name: 'APEXA', logo: 'https://www.apexa.ca/hs-fs/hubfs/apexa-2025.png', url: 'https://portal.apexa.ca/portal/' },
        { key: 'assomption_lia', name: 'Assomption Lia', logo: 'https://saq-7t4.pages.dev/images/assureurs/assomption-vie.png', url: 'https://lia.assomption.ca' },
        { key: 'assomption_vesta', name: 'Assomption Vesta', logo: 'https://saq-7t4.pages.dev/images/assureurs/assomption-vie.png', url: 'https://vesta.assomption.ca' },
        { key: 'beneva', name: 'Beneva', logo: 'https://saq-7t4.pages.dev/images/assureurs/beneva.png', url: 'https://www.beneva.ca/fr/espace-client' },
        { key: 'bmo', name: 'BMO Assurance', logo: 'https://saq-7t4.pages.dev/images/assureurs/bmo-assurance.png', url: 'https://www.bmo.com/principal/particuliers/assurances/' },
        { key: 'canadavie', name: 'Canada Vie', logo: 'https://saq-7t4.pages.dev/images/assureurs/canada-vie.png', url: 'https://www.canadalife.com/fr/sign-in.html' },
        { key: 'centralize_equisoft', name: 'Centralize (Equisoft)', logo: 'https://www.equisoft.com/assets/images/_600x60_fit_center-center_82_none/910604/LOGO-EQUISOFT-3.png', url: 'https://agenz-portal.centralize.equisoft.com/agenz/login.htm#list_client' },
        { key: 'desjardins', name: 'Desjardins Assurances', logo: 'https://saq-7t4.pages.dev/images/assureurs/desjardins.png', url: 'https://www.desjardins.com/portail-agent' },
        { key: 'empire', name: 'Empire Vie', logo: 'https://saq-7t4.pages.dev/images/assureurs/empire-vie.png', url: 'https://www.empire.ca/fr/connexion' },
        { key: 'equitable', name: 'Equitable Assurance vie', logo: 'https://saq-7t4.pages.dev/images/assureurs/equitable.png', url: 'https://www.equitable.ca/fr/' },
        { key: 'foresters', name: 'Foresters', logo: 'https://saq-7t4.pages.dev/images/assureurs/foresters.png', url: 'https://www.foresters.com/en/sign-in' },
        { key: 'gfs_zendesk', name: 'GFS (Zendesk)', logo: 'https://gfsignature.com/wp-content/uploads/2022/08/logo_modifs_finale-300x158.png', url: 'https://wp.guide-gfs.com/' },
        { key: 'humania', name: 'Humania Assurance', logo: 'https://saq-7t4.pages.dev/images/assureurs/humania.png', url: 'https://www.humania.ca' },
        { key: 'ia', name: 'iA Groupe financier', logo: 'https://saq-7t4.pages.dev/images/assureurs/ia-groupe-financier.png', url: 'https://www.ia.ca/connexion' },
        { key: 'ivari', name: 'ivari', logo: 'https://saq-7t4.pages.dev/images/assureurs/ivari.png', url: 'https://www.ivari.ca/fr/login' },
        { key: 'manuvie', name: 'Manuvie', logo: 'https://saq-7t4.pages.dev/images/assureurs/manuvie.png', url: 'https://www.manuvie.ca/connexion.html' },
        { key: 'ppc', name: 'Plan de Protection du Canada', logo: 'https://saq-7t4.pages.dev/images/assureurs/plan-protection-canada.png', url: 'https://www.planprotectioncanada.com' },
        { key: 'rbc', name: 'RBC Assurance', logo: 'https://saq-7t4.pages.dev/images/assureurs/rbc-assurance.png', url: 'https://www.rbcassurances.com/fr/' },
        { key: 'sunlife', name: 'Sun Life', logo: 'https://saq-7t4.pages.dev/images/assureurs/sun-life.png', url: 'https://www.sunlife.ca/fr/sign-in/' },
        { key: 'uv', name: 'UV Assurance', logo: 'https://saq-7t4.pages.dev/images/assureurs/uv-assurance.png', url: 'https://www.uvassurance.ca' },
        { key: 'viefund', name: 'VieFund (Agenz)', logo: 'https://www.viefund.com/wp-content/themes/viefund/assets/images/logo.png', url: 'https://www.viefund-agenz.ca/' }
    ];

    let creds = {};
    let customCies = [];
    const user = FINOX.getCurrentUser?.();
    if (user) {
        try {
            const { data } = await FINOX.supabase
                .from('conseiller_credentials')
                .select('*')
                .eq('user_id', user.id);
            if (data) {
                data.forEach(r => {
                    creds[r.company_key] = r;
                    if (!QV_CIE.find(c => c.key === r.company_key)) {
                        customCies.push({ key: r.company_key, name: r.company_name, logo: r.logo_url || '', url: r.login_url || '', custom: true });
                    }
                });
            }
        } catch(e) { console.error(e); }
    }

    const allCies = [...QV_CIE, ...customCies];
    const configured = allCies.filter(c => {
        const cr = creds[c.key];
        return cr && (cr.username || cr.password_encrypted);
    });

    // Build popup HTML
    const overlay = document.createElement('div');
    overlay.id = 'sbVaultOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9990;backdrop-filter:blur(2px);';
    overlay.onclick = () => { overlay.remove(); popup.remove(); };

    const popup = document.createElement('div');
    popup.id = 'sbVaultPopup';
    popup.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        width:340px;max-height:460px;background:rgba(18,18,24,0.97);
        backdrop-filter:blur(24px) saturate(1.6);-webkit-backdrop-filter:blur(24px) saturate(1.6);
        border:1px solid rgba(255,255,255,0.1);border-radius:18px;
        box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 40px rgba(201,162,39,0.06);
        z-index:9991;display:flex;flex-direction:column;overflow:hidden;
        animation:sbVaultIn 0.25s ease-out;
    `;

    // Add animation keyframe
    if (!document.getElementById('sbVaultStyle')) {
        const style = document.createElement('style');
        style.id = 'sbVaultStyle';
        style.textContent = `
            @keyframes sbVaultIn { from { opacity:0; transform:translateX(-50%) translateY(20px) scale(0.95); } to { opacity:1; transform:translateX(-50%) translateY(0) scale(1); } }
            .sbv-item:hover { background:rgba(255,255,255,0.04) !important; }
            .sbv-act:hover { background:rgba(232,180,77,0.12) !important; color:#C9A227 !important; }
            .sbv-go:hover { filter:brightness(1.15) !important; }
            .sbv-search:focus { border-color:#C9A227 !important; outline:none; }
        `;
        document.head.appendChild(style);
    }

    function buildList(filter) {
        const list = filter
            ? configured.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
            : configured;

        if (list.length === 0 && configured.length === 0) {
            return `<div style="text-align:center;padding:30px 16px;color:rgba(255,255,255,0.4);font-size:12px;">
                <div style="font-size:28px;margin-bottom:8px;opacity:0.3;">🔐</div>
                Aucun accès configuré<br>
                <span style="font-size:10px;opacity:0.6;">Paramètres > Compagnies pour ajouter vos identifiants</span>
            </div>`;
        }
        if (list.length === 0) {
            return '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);font-size:12px;">🔍 Aucun résultat</div>';
        }

        return list.map(cie => {
            const cr = creds[cie.key] || {};
            const logoHtml = cie.logo
                ? `<img src="${cie.logo}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.parentElement.textContent='🏦'">`
                : '🏦';
            const userSnip = cr.username ? cr.username.substring(0, 3) + '•••' : '';
            return `
            <div class="sbv-item" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;" data-key="${cie.key}">
                <div style="width:30px;height:30px;border-radius:7px;background:#fff;display:flex;align-items:center;justify-content:center;padding:3px;flex-shrink:0;overflow:hidden;font-size:13px;">${logoHtml}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cie.name}</div>
                    ${userSnip ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userSnip}</div>` : ''}
                </div>
                <div style="display:flex;gap:3px;flex-shrink:0;">
                    ${cr.username ? `<button class="sbv-act" onclick="event.stopPropagation();sbvCopy('${cie.key}','user')" style="width:28px;height:28px;border-radius:7px;border:none;background:transparent;color:rgba(255,255,255,0.4);cursor:pointer;font-size:12px;" title="Copier identifiant">📋</button>` : ''}
                    ${cr.password_encrypted ? `<button class="sbv-act" onclick="event.stopPropagation();sbvCopy('${cie.key}','pwd')" style="width:28px;height:28px;border-radius:7px;border:none;background:transparent;color:rgba(255,255,255,0.4);cursor:pointer;font-size:12px;" title="Copier mot de passe">🔐</button>` : ''}
                    <button class="sbv-go" onclick="event.stopPropagation();sbvOpen('${cie.key}')" style="width:28px;height:28px;border-radius:7px;border:none;background:linear-gradient(135deg,#C9A227,#A88520);color:#000;cursor:pointer;font-size:11px;" title="Ouvrir + copier mdp">↗</button>
                </div>
            </div>`;
        }).join('');
    }

    popup.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:16px;">🔑</span>
            <span style="font-size:13px;font-weight:700;color:#C9A227;flex:1;">Accès Rapide</span>
            <button onclick="document.getElementById('sbVaultOverlay')?.remove();document.getElementById('sbVaultPopup')?.remove();" style="width:26px;height:26px;border-radius:50%;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>
        </div>
        <div style="padding:8px 12px;position:relative;">
            <span style="position:absolute;left:22px;top:50%;transform:translateY(-50%);font-size:11px;pointer-events:none;">🔍</span>
            <input class="sbv-search" id="sbvSearchInput" type="text" placeholder="Rechercher..." style="width:100%;padding:8px 10px 8px 30px;font-size:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#fff;font-family:inherit;box-sizing:border-box;">
        </div>
        <div id="sbvList" style="flex:1;overflow-y:auto;padding:4px 0;max-height:320px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.08) transparent;">
            ${buildList('')}
        </div>
        <div onclick="document.getElementById('sbVaultOverlay')?.remove();document.getElementById('sbVaultPopup')?.remove();window.location.hash='#/settings';setTimeout(()=>{const b=document.querySelector('[data-module=\\'param-compagnies.html\\']');if(b)b.click();},600);" style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(255,255,255,0.4);text-align:center;cursor:pointer;">
            ⚙️ Gérer les compagnies
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // Search filter
    const searchInput = document.getElementById('sbvSearchInput');
    if (searchInput) {
        searchInput.oninput = () => {
            const listEl = document.getElementById('sbvList');
            if (listEl) listEl.innerHTML = buildList(searchInput.value);
        };
        setTimeout(() => searchInput.focus(), 100);
    }

    // Escape to close
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            popup.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Copy & Open helpers
    window.sbvCopy = async function(key, type) {
        const cr = creds[key];
        if (!cr) return;
        const val = type === 'user' ? cr.username : cr.password_encrypted;
        if (!val) return;
        try { await navigator.clipboard.writeText(val); } catch(e) {
            const ta = document.createElement('textarea'); ta.value = val;
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        }
        FINOX.showNotification(type === 'user' ? 'Identifiant copié' : 'Mot de passe copié', 'success');
    };

    window.sbvOpen = async function(key) {
        const cr = creds[key];
        const cie = allCies.find(c => c.key === key);
        const url = cr?.login_url || cie?.url;
        if (!url) { FINOX.showNotification('Aucune URL configurée', 'error'); return; }
        if (cr?.password_encrypted) {
            try { await navigator.clipboard.writeText(cr.password_encrypted); } catch(e) {}
            FINOX.showNotification('Mot de passe copié — Ctrl+V pour coller', 'success');
        }
        window.open(url, '_blank');
        overlay.remove(); popup.remove();
    };
};

// ══════════════════════════════════════════
// BOSS - Envoyer dossier client
// ══════════════════════════════════════════
window.pushClientToBoss = async function() {
    const cd = FINOX.getClientData?.();
    if (!cd) {
        FINOX.showNotification('Aucun client sélectionné. Ouvrez un dossier client d\'abord.', 'error');
        return;
    }

    // Vérifier que BOSS est configuré
    let bossConnected = false;
    try {
        const statusRes = await fetch(`https://crm.finox.ca/boss/connection/status?organization_id=${FINOX.ORG_ID}`);
        const statusData = await statusRes.json();
        bossConnected = statusData.connected;
    } catch (e) {
        console.error('Erreur vérification BOSS:', e);
    }

    if (!bossConnected) {
        FINOX.showNotification('🏠 BOSS n\'est pas configuré. Allez dans Paramètres > Intégrations.', 'error');
        return;
    }

    // Confirmation
    const clientName = `${cd.first_name || ''} ${cd.last_name || ''}`.trim();
    const ok = await FINOX.confirm(
        `Envoyer le dossier de ${clientName} vers BOSS?\n\nLes informations personnelles, coordonnées, emploi et conjoint seront transmises.`
    );
    if (!ok) return;

    // Chercher les actifs/passifs individuels du client
    let abfActifs = [];
    try {
        const { data: rows } = await FINOX.supabase
            .from('abf_actifs')
            .select('type, categorie, description, valeur, valeur_passif, paiement_mensuel, proprietaire')
            .eq('client_id', cd.id);
        if (rows) abfActifs = rows;
    } catch (e) {
        console.warn('Impossible de charger abf_actifs:', e);
    }

    // Envoi
    FINOX.showNotification('📤 Envoi vers BOSS en cours...', 'info');

    try {
        const res = await fetch('https://crm.finox.ca/boss/push-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organization_id: FINOX.ORG_ID,
                client_data: cd,
                abf_actifs: abfActifs,
                notes: `Lead créé depuis Finox CRM — ${clientName}`
            })
        });

        const data = await res.json();
        console.log('📡 BOSS push result:', data.success ? '✅ Succès' : '❌ Erreur', data);

        if (data.success) {
            FINOX.showNotification('✅ Dossier envoyé vers BOSS avec succès!', 'success');

            // Logger dans client_timeline
            try {
                await FINOX.supabase.from('client_timeline').insert({
                    client_id: FINOX.CLIENT_ID,
                    activity_type: 'integration',
                    title: 'Push BOSS — Succès',
                    description: 'Dossier envoyé vers BOSS avec succès',
                    metadata: {
                        boss_action: 'boss_push',
                        success: true,
                        boss_response: data.boss_response,
                        pushed_at: new Date().toISOString()
                    },
                    created_by: FINOX.getCurrentUser()?.id
                });
            } catch (logErr) {
                console.warn('Erreur log timeline BOSS:', logErr);
            }
        } else {
            FINOX.showNotification(`❌ Erreur BOSS: ${data.error || 'Erreur inconnue'}`, 'error');
            if (data.debug_payload) {
                console.log('🔍 BOSS debug_payload:', JSON.stringify(data.debug_payload, null, 2));
            }

            // Logger l'erreur aussi
            try {
                await FINOX.supabase.from('client_timeline').insert({
                    client_id: FINOX.CLIENT_ID,
                    activity_type: 'integration',
                    title: 'Push BOSS — Erreur',
                    description: data.error || 'Erreur inconnue',
                    metadata: {
                        boss_action: 'boss_push_error',
                        success: false,
                        error: data.error,
                        pushed_at: new Date().toISOString()
                    },
                    created_by: FINOX.getCurrentUser()?.id
                });
            } catch (logErr) {
                console.warn('Erreur log timeline BOSS:', logErr);
            }
        }
    } catch (err) {
        console.error('Erreur push BOSS:', err);
        FINOX.showNotification(`❌ Erreur réseau: ${err.message}`, 'error');
    }
};

// Close quick actions on click outside
document.addEventListener('click', function(e) {
    const menu = document.getElementById('sbQuickMenu');
    const btn = document.getElementById('sbQuickBtn');
    if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// ══════════════════════════════════════════
// BADGES SMS / EMAIL
// ══════════════════════════════════════════
async function loadMsgBadges() {
    try {
        if (!FINOX.getClientData()) {
            try { await FINOX.loadClientData(); } catch(e) {}
        }
        if (!FINOX.getClientData()) return;

        const [smsCount, emailCount, tasksCount] = await Promise.all([getMsgSmsUnreplied(), getMsgEmailUnread(), getActiveTasksCount()]);

        // SMS badge
        const smsBadge = document.getElementById('sbSmsBadge');
        if (smsBadge) {
            if (smsCount > 0) { smsBadge.textContent = smsCount; smsBadge.classList.remove('hidden'); }
            else { smsBadge.classList.add('hidden'); }
        }

        // Email badge
        const emailBadge = document.getElementById('sbEmailBadge');
        if (emailBadge) {
            if (emailCount > 0) { emailBadge.textContent = emailCount; emailBadge.classList.remove('hidden'); }
            else { emailBadge.classList.add('hidden'); }
        }

        // Tasks badge
        const tasksBadge = document.getElementById('sbTasksBadge');
        if (tasksBadge) {
            if (tasksCount > 0) { tasksBadge.textContent = tasksCount; tasksBadge.classList.remove('hidden'); }
            else { tasksBadge.classList.add('hidden'); }
        }

        // Legacy badges (for old modal compat)
        const total = smsCount + emailCount;
        const legacyBadge = document.getElementById('msgBtnBadge');
        const legacySbBadge = document.getElementById('sbMsgBadge');
        if (legacyBadge) { if (total > 0) { legacyBadge.textContent = total; legacyBadge.classList.remove('hidden'); } else { legacyBadge.classList.add('hidden'); } }
        if (legacySbBadge) { if (total > 0) { legacySbBadge.textContent = total; legacySbBadge.classList.remove('hidden'); } else { legacySbBadge.classList.add('hidden'); } }

        // Tab badges (old modal)
        const smsBadgeTab = document.getElementById('msgSmsBadge');
        const emailBadgeTab = document.getElementById('msgEmailBadge');
        if (smsBadgeTab) { if (smsCount > 0) { smsBadgeTab.textContent = smsCount; smsBadgeTab.classList.remove('hidden'); } else { smsBadgeTab.classList.add('hidden'); } }
        if (emailBadgeTab) { if (emailCount > 0) { emailBadgeTab.textContent = emailCount; emailBadgeTab.classList.remove('hidden'); } else { emailBadgeTab.classList.add('hidden'); } }
    } catch (e) {
        console.warn('[Badges] Error:', e.message);
    }
}

async function getMsgSmsUnreplied() {
    const clientId = FINOX.CLIENT_ID;
    // Check force-unread flag
    if (clientId) {
        try { const set = new Set(JSON.parse(localStorage.getItem('finox_sms_force_unread') || '[]')); if (set.has(clientId)) return 1; } catch {}
    }
    const phone = FINOX.getClientData()?.phone || FINOX.getClientData()?.phone_mobile;
    if (!phone) return 0;
    const user = FINOX.getCurrentUser();
    if (!user) return 0;
    try {
        const res = await fetch(RC_WORKER + '/sms/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_phone: phone, max_results: 10, user_id: user.id })
        });
        if (!res.ok) return 0;
        const data = await res.json();
        if (data.code === 'RC_NOT_CONNECTED' || data.code === 'RC_TOKEN_EXPIRED') return 0;
        const msgs = data.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].direction === 'Inbound') {
                const hasReply = msgs.slice(i + 1).some(m => m.direction === 'Outbound');
                return hasReply ? 0 : 1;
            }
        }
        return 0;
    } catch (e) { return 0; }
}

async function getMsgEmailUnread() {
    const clientId = FINOX.CLIENT_ID;
    // Check force-unread flag
    if (clientId) {
        try { const set = new Set(JSON.parse(localStorage.getItem('finox_email_force_unread') || '[]')); if (set.has(clientId)) return 1; } catch {}
    }
    const email = FINOX.getClientData()?.email;
    if (!email) return 0;
    if (!FINOX.isGoogleConnected()) return 0;
    try {
        const data = await FINOX.googleFetch(`/gmail/inbox?q=${encodeURIComponent('is:unread in:inbox from:' + email)}&max_results=10`);
        const msgs = data?.messages || [];
        return msgs.length;
    } catch (e) { return 0; }
}

// ── Mark SMS as read (clear badge) when opening SMS popup ──
window.markSmsRead = function() {
    const badge = document.getElementById('sbSmsBadge');
    if (badge) badge.classList.add('hidden');
    const clientId = FINOX.CLIENT_ID;
    if (clientId) {
        const key = 'finox_sms_force_unread';
        try { const set = new Set(JSON.parse(localStorage.getItem(key) || '[]')); set.delete(clientId); localStorage.setItem(key, JSON.stringify([...set])); } catch {}
    }
    // Show "mark unread" button
    const btn = document.getElementById('smsMarkUnreadBtn');
    if (btn) btn.classList.remove('hidden');
};

// ── Mark SMS as unread (force badge back) ──
window.markSmsUnread = function() {
    const badge = document.getElementById('sbSmsBadge');
    if (badge) { badge.textContent = '1'; badge.classList.remove('hidden'); }
    const clientId = FINOX.CLIENT_ID;
    if (clientId) {
        const key = 'finox_sms_force_unread';
        try { const set = new Set(JSON.parse(localStorage.getItem(key) || '[]')); set.add(clientId); localStorage.setItem(key, JSON.stringify([...set].slice(-200))); } catch {}
    }
    // Hide "mark unread" button, show "mark read" instead (just hide it)
    const btn = document.getElementById('smsMarkUnreadBtn');
    if (btn) btn.classList.add('hidden');
};

// ── Mark Email as read (clear badge + Gmail mark-as-read) ──
window.markEmailRead = async function() {
    const badge = document.getElementById('sbEmailBadge');
    if (badge) badge.classList.add('hidden');
    const clientId = FINOX.CLIENT_ID;
    if (clientId) {
        const key = 'finox_email_force_unread';
        try { const set = new Set(JSON.parse(localStorage.getItem(key) || '[]')); set.delete(clientId); localStorage.setItem(key, JSON.stringify([...set])); } catch {}
    }
    // Show "mark unread" button
    const btn = document.getElementById('emailMarkUnreadBtn');
    if (btn) btn.classList.remove('hidden');
};

// ── Mark Email as unread (force badge back) ──
window.markEmailUnread = function() {
    const badge = document.getElementById('sbEmailBadge');
    if (badge) { badge.textContent = '1'; badge.classList.remove('hidden'); }
    const clientId = FINOX.CLIENT_ID;
    if (clientId) {
        const key = 'finox_email_force_unread';
        try { const set = new Set(JSON.parse(localStorage.getItem(key) || '[]')); set.add(clientId); localStorage.setItem(key, JSON.stringify([...set].slice(-200))); } catch {}
    }
    const btn = document.getElementById('emailMarkUnreadBtn');
    if (btn) btn.classList.add('hidden');
};

async function getActiveTasksCount() {
    const clientId = FINOX.CLIENT_ID || (FINOX.getClientId ? FINOX.getClientId() : null);
    if (!clientId) return 0;
    const user = FINOX.getCurrentUser();
    if (!user) return 0;
    try {
        const { data: profile } = await FINOX.supabase
            .from('profiles').select('organization_id').eq('id', user.id).single();
        if (!profile) return 0;
        const { count } = await FINOX.supabase
            .from('tasks').select('id', { count: 'exact', head: true })
            .eq('client_id', clientId)
            .eq('organization_id', profile.organization_id)
            .in('status', ['pending', 'in_progress']);
        return count || 0;
    } catch (e) { return 0; }
}

// ══════════════════════════════════════════
// LEGACY MESSAGES MODAL (compat)
// ══════════════════════════════════════════

window.openMsgModal = async function() {
    const overlay = document.getElementById('msgModalOverlay');
    overlay.classList.add('show');

    let cd = FINOX.getClientData();
    if (!cd) {
        try { cd = await FINOX.loadClientData(); } catch(e) {}
    }
    document.getElementById('msgClientName').textContent = cd ? `${cd.first_name || ''} ${cd.last_name || ''}`.trim() || 'Client' : 'Client';

    if (cd) {
        msgSmsLoaded = false;
        msgEmailLoaded = false;
    }

    if (msgCurrentTab === 'sms') {
        loadSmsConv();
    } else {
        loadEmailConv();
    }

    setTimeout(() => document.getElementById('msgReplyInput')?.focus(), 200);
};

window.closeMsgModal = function() {
    document.getElementById('msgModalOverlay').classList.remove('show');
    document.getElementById('msgReplyInput').value = '';
    msgSelectedEmail = null;
};

window.switchMsgTab = function(tab) {
    msgCurrentTab = tab;
    document.getElementById('msgTabSms').classList.toggle('active', tab === 'sms');
    document.getElementById('msgTabEmail').classList.toggle('active', tab === 'email');
    document.getElementById('msgSmsPanel').classList.toggle('active', tab === 'sms');
    document.getElementById('msgEmailPanel').classList.toggle('active', tab === 'email');
    document.getElementById('msgReplyInput').placeholder = tab === 'sms' ? 'Votre message SMS...' : 'Votre réponse email...';
    if (tab === 'sms' && !msgSmsLoaded) loadSmsConv();
    if (tab === 'email' && !msgEmailLoaded) loadEmailConv();
    if (tab === 'sms') msgSelectedEmail = null;
};

async function loadMsgBadge() {
    try {
        if (!FINOX.getClientData()) {
            try { await FINOX.loadClientData(); } catch(e) {}
        }
        if (!FINOX.getClientData()) return;

        const [smsCount, emailCount] = await Promise.all([getMsgSmsUnreplied(), getMsgEmailUnread()]);
        const total = smsCount + emailCount;
        const badge = document.getElementById('msgBtnBadge');
        const sbBadge = document.getElementById('sbMsgBadge');
        const smsBadge = document.getElementById('msgSmsBadge');
        const emailBadge = document.getElementById('msgEmailBadge');

        if (total > 0) {
            if (badge) { badge.textContent = total; badge.classList.remove('hidden'); }
            if (sbBadge) { sbBadge.textContent = total; sbBadge.classList.remove('hidden'); }
        } else {
            if (badge) badge.classList.add('hidden');
            if (sbBadge) sbBadge.classList.add('hidden');
        }
        if (smsCount > 0) { if (smsBadge) { smsBadge.textContent = smsCount; smsBadge.classList.remove('hidden'); } }
        else { if (smsBadge) smsBadge.classList.add('hidden'); }
        if (emailCount > 0) { if (emailBadge) { emailBadge.textContent = emailCount; emailBadge.classList.remove('hidden'); } }
        else { if (emailBadge) emailBadge.classList.add('hidden'); }
    } catch (e) {
        console.warn('[Msg] Badge error:', e.message);
    }
}

async function loadSmsConv() {
    const container = document.getElementById('msgSmsConv');
    const phone = FINOX.getClientData()?.phone || FINOX.getClientData()?.phone_mobile;

    if (!phone) {
        container.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">📵</div><div class="msg-empty-text">Aucun numéro de téléphone pour ce client</div></div>';
        msgSmsLoaded = true;
        return;
    }

    const user = FINOX.getCurrentUser();
    if (!user) {
        container.innerHTML = '<div class="msg-error">Utilisateur non authentifié</div>';
        return;
    }

    container.innerHTML = '<div class="msg-loading">⏳ Chargement des SMS...</div>';

    try {
        const res = await fetch(RC_WORKER + '/sms/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_phone: phone, max_results: 20, user_id: user.id })
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        if (data.code === 'RC_NOT_CONNECTED') {
            container.innerHTML = '<div class="msg-error">RingCentral non connecté. Connectez votre compte dans les paramètres.</div>';
            msgSmsLoaded = true;
            return;
        }
        if (data.code === 'RC_TOKEN_EXPIRED') {
            container.innerHTML = '<div class="msg-error">Session RingCentral expirée. Reconnectez votre compte.</div>';
            msgSmsLoaded = true;
            return;
        }

        msgSmsMessages = data.messages || [];
        renderSmsConv();
        msgSmsLoaded = true;
    } catch (e) {
        console.error('[Msg] SMS load error:', e);
        container.innerHTML = '<div class="msg-error">Erreur de chargement des SMS</div>';
    }
}

function renderSmsConv() {
    const container = document.getElementById('msgSmsConv');

    if (msgSmsMessages.length === 0) {
        container.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">💬</div><div class="msg-empty-text">Aucun SMS avec ce client</div></div>';
        return;
    }

    const escHtml = FINOX.escapeHtml || (t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; });
    let html = '';

    msgSmsMessages.forEach(msg => {
        const dir = (msg.direction || '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
        const text = msg.subject || msg.text || '';
        const time = formatMsgTime(msg.creationTime || msg.timestamp);
        html += `<div class="msg-bubble-wrap ${dir}">
            <div class="msg-bubble">${escHtml(text)}</div>
            <div class="msg-bubble-time">${time}</div>
        </div>`;
    });

    container.innerHTML = html;
    const body = document.querySelector('.msg-modal-body');
    if (body) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

async function loadEmailConv() {
    const container = document.getElementById('msgEmailList');
    const email = FINOX.getClientData()?.email;

    if (!email) {
        container.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">📭</div><div class="msg-empty-text">Aucune adresse email pour ce client</div></div>';
        msgEmailLoaded = true;
        return;
    }

    const token = await getMsgGoogleToken();
    if (!token) {
        container.innerHTML = '<div class="msg-error">Google non connecté. Connectez votre compte dans les paramètres.</div>';
        msgEmailLoaded = true;
        return;
    }

    container.innerHTML = '<div class="msg-loading">⏳ Chargement des emails...</div>';

    try {
        const res = await fetch(GOOGLE_WORKER + '/gmail/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ contact_email: email, max_results: 10 })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error || '';
            if (errMsg.includes('Token expired') || errMsg.includes('reconnect Google') || res.status === 401) {
                container.innerHTML = '<div class="msg-error">🔑 Session Google expirée.<br><small>Allez dans <b>Paramètres → Connexions</b> pour reconnecter votre compte Google.</small></div>';
                msgEmailLoaded = true;
                return;
            }
            throw new Error(errMsg || 'HTTP ' + res.status);
        }
        const data = await res.json();
        msgEmailMessages = data.messages || [];
        renderEmailList();
        msgEmailLoaded = true;

        // Mark unread inbound emails as read in Gmail
        const userEmail = FINOX.getGoogleTokens()?.email?.toLowerCase() || '';
        const unreadIds = msgEmailMessages
            .filter(m => m.labelIds?.includes('UNREAD') && !(m.labelIds?.includes('SENT') || m.from?.toLowerCase().includes(userEmail)))
            .map(m => m.id);
        if (unreadIds.length > 0) {
            FINOX.googleFetch('/gmail/mark-read', {
                method: 'POST',
                body: JSON.stringify({ message_ids: unreadIds })
            }).then(() => {
                // Refresh badges after marking as read
                loadMsgBadges();
            }).catch(() => {});
        }
    } catch (e) {
        console.error('[Msg] Email load error:', e);
        container.innerHTML = '<div class="msg-error">Erreur de chargement des emails</div>';
    }
}

function renderEmailList() {
    const container = document.getElementById('msgEmailList');

    if (msgEmailMessages.length === 0) {
        container.innerHTML = '<div class="msg-empty"><div class="msg-empty-icon">📧</div><div class="msg-empty-text">Aucun email avec ce client</div></div>';
        return;
    }

    const escHtml = FINOX.escapeHtml || (t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; });
    let html = '';

    msgEmailMessages.forEach(em => {
        const isUnread = em.labelIds?.includes('UNREAD') || em.unread;
        const isSent = em.labelIds?.includes('SENT');
        const selected = msgSelectedEmail?.id === em.id;
        const subj = em.subject || '(Pas de sujet)';
        const snippet = em.snippet || '';
        const from = isSent ? '→ Envoyé' : (em.from || '').replace(/<[^>]+>/g, '').trim();
        const time = formatMsgTime(em.internalDate ? new Date(parseInt(em.internalDate)) : em.timestamp);

        html += `<div class="msg-email-item ${isUnread ? 'unread' : ''} ${selected ? 'selected' : ''}" onclick="selectMsgEmail('${em.id}')">
            <div class="msg-email-header">
                <div class="msg-email-subject">${escHtml(subj)}</div>
                <div class="msg-email-date">${time}</div>
            </div>
            <div class="msg-email-from">${escHtml(from)}</div>
            <div class="msg-email-snippet">${escHtml(snippet)}</div>
        </div>`;
    });

    container.innerHTML = html;
    const body = document.querySelector('.msg-modal-body');
    if (body) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

window.selectMsgEmail = function(emailId) {
    msgSelectedEmail = msgEmailMessages.find(e => e.id === emailId) || null;
    renderEmailList();
    document.getElementById('msgReplyInput')?.focus();
};

window.sendMsgReply = async function() {
    const input = document.getElementById('msgReplyInput');
    const btn = document.getElementById('msgSendBtn');
    const text = input.value.trim();
    if (!text) return;

    btn.disabled = true;
    btn.textContent = 'Envoi...';

    try {
        if (msgCurrentTab === 'sms') {
            await sendMsgSms(text);
        } else {
            await sendMsgEmail(text);
        }

        input.value = '';
        FINOX.showNotification(msgCurrentTab === 'sms' ? '📱 SMS envoyé!' : '📧 Email envoyé!', 'success');

        if (msgCurrentTab === 'sms') {
            msgSmsLoaded = false;
            loadSmsConv();
        } else {
            msgEmailLoaded = false;
            loadEmailConv();
        }

        loadMsgBadges();

    } catch (e) {
        console.error('[Msg] Send error:', e);
        FINOX.showNotification('Erreur: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Envoyer';
    }
};

async function sendMsgSms(text) {
    const phone = FINOX.getClientData()?.phone || FINOX.getClientData()?.phone_mobile;
    const user = FINOX.getCurrentUser();
    if (!phone || !user) throw new Error('Données manquantes');

    const res = await fetch(RC_WORKER + '/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, text: text, user_id: user.id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
}

async function sendMsgEmail(text) {
    const emailTo = FINOX.getClientData()?.email;
    const token = await getMsgGoogleToken();
    if (!emailTo || !token) throw new Error('Données manquantes');

    const signature = FINOX.getEmailSignature ? FINOX.getEmailSignature() : '';
    let subject = 'Message';
    let threadId = undefined;
    let inReplyTo = undefined;

    if (msgSelectedEmail) {
        subject = (msgSelectedEmail.subject || '').startsWith('Re:') ? msgSelectedEmail.subject : 'Re: ' + (msgSelectedEmail.subject || '');
        threadId = msgSelectedEmail.threadId;
        inReplyTo = msgSelectedEmail.id;
    }

    // ── DIRECT GMAIL API (bypass CF Workers UTF-8 corruption) ──
    if (typeof GmailDirect !== 'undefined') {
        await GmailDirect.send({
            token, to: emailTo, subject, body: text, signature,
            inReplyTo, threadId
        });
    } else {
        // Fallback to CF Worker if GmailDirect not loaded yet
        const res = await fetch(GOOGLE_WORKER + '/gmail/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                to: emailTo, subject, body: text, signature,
                thread_id: threadId, in_reply_to: inReplyTo
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
    }
}
