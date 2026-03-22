// ═══════════════════════════════════════════════════════════════
// SMART BAR — NOTES DE SUIVI 📝
// ═══════════════════════════════════════════════════════════════

let notesData = [];

window.openNotesModal = function() {
    document.getElementById('notesModalOverlay').classList.add('show');
    loadNotes();
};

window.closeNotesModal = function() {
    document.getElementById('notesModalOverlay').classList.remove('show');
};

async function loadNotes() {
    if (!FINOX.CLIENT_ID) return;
    try {
        const { data, error } = await FINOX.supabase
            .from('client_timeline')
            .select('*')
            .eq('client_id', FINOX.CLIENT_ID)
            .eq('activity_type', 'note')
            .order('created_at', { ascending: false });

        if (error) throw error;
        notesData = data || [];
        updateNotesBadge();
        renderNotes();
    } catch (e) {
        console.error('[Notes] Load error:', e);
    }
}

function updateNotesBadge() {
    const count = notesData.length;
    const badge = document.getElementById('sbNotesBadge');
    const btnBadge = document.getElementById('notesBtnBadge');

    if (badge) {
        if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    }
    if (btnBadge) {
        if (count > 0) { btnBadge.textContent = count; btnBadge.classList.remove('hidden'); }
        else { btnBadge.classList.add('hidden'); }
    }
}

function renderNotes() {
    const container = document.getElementById('notesList');
    if (!container) return;

    if (notesData.length === 0) {
        container.innerHTML = `
            <div class="notes-empty">
                <div class="notes-empty-icon">📝</div>
                <div class="notes-empty-text">Aucune note pour le moment</div>
            </div>`;
        return;
    }

    const escHtml = FINOX.escapeHtml || (t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; });

    container.innerHTML = notesData.map(note => {
        const date = new Date(note.created_at).toLocaleDateString('fr-CA', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        const noteText = note.description || note.title || '';
        return `<div class="notes-item" id="note-${note.id}">
            <div class="notes-item-text">${escHtml(noteText)}</div>
            <div class="notes-item-edit" style="display:none">
                <textarea class="notes-edit-textarea" id="noteEdit-${note.id}">${escHtml(noteText)}</textarea>
                <div class="notes-edit-actions">
                    <button class="notes-edit-btn notes-edit-save" onclick="saveEditNote('${note.id}')">✓ Sauvegarder</button>
                    <button class="notes-edit-btn notes-edit-cancel" onclick="cancelEditNote('${note.id}')">✕ Annuler</button>
                </div>
            </div>
            <div class="notes-item-footer">
                <span class="notes-item-date">${date}</span>
                <div class="notes-item-actions">
                    <button class="notes-item-action notes-item-edit-btn" onclick="editNote('${note.id}')" title="Modifier">✏️</button>
                    <button class="notes-item-action notes-item-delete" onclick="deleteNote('${note.id}')" title="Supprimer">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.addNote = async function() {
    const input = document.getElementById('noteInput');
    const text = input.value.trim();
    if (!text || !FINOX.CLIENT_ID) return;

    try {
        const user = FINOX.getCurrentUser();
        const { data, error } = await FINOX.supabase
            .from('client_timeline')
            .insert({
                client_id: FINOX.CLIENT_ID,
                activity_type: 'note',
                title: 'Note de suivi',
                description: text,
                created_by: user?.id || null
            })
            .select('*')
            .single();

        if (error) throw error;
        input.value = '';
        notesData.unshift(data);
        updateNotesBadge();
        renderNotes();
        FINOX.showNotification('📝 Note ajoutée', 'success');
    } catch (e) {
        console.error('[Notes] Add error:', e);
        FINOX.showNotification('Erreur', 'error');
    }
};

window.editNote = function(noteId) {
    const item = document.getElementById(`note-${noteId}`);
    if (!item) return;
    item.querySelector('.notes-item-text').style.display = 'none';
    item.querySelector('.notes-item-footer').style.display = 'none';
    item.querySelector('.notes-item-edit').style.display = 'block';
    const textarea = document.getElementById(`noteEdit-${noteId}`);
    if (textarea) { textarea.focus(); textarea.selectionStart = textarea.value.length; }
};

window.cancelEditNote = function(noteId) {
    const item = document.getElementById(`note-${noteId}`);
    if (!item) return;
    item.querySelector('.notes-item-text').style.display = '';
    item.querySelector('.notes-item-footer').style.display = '';
    item.querySelector('.notes-item-edit').style.display = 'none';
};

window.saveEditNote = async function(noteId) {
    const textarea = document.getElementById(`noteEdit-${noteId}`);
    if (!textarea) return;
    const newText = textarea.value.trim();
    if (!newText) return FINOX.showNotification('La note ne peut pas être vide', 'error');

    try {
        const { data, error } = await FINOX.supabase
            .from('client_timeline')
            .update({ description: newText, title: 'Note de suivi' })
            .eq('id', noteId)
            .eq('client_id', FINOX.CLIENT_ID)
            .select('*')
            .single();

        if (error) throw error;
        if (!data) throw new Error('Aucune ligne mise à jour');
        // Update local cache
        const idx = notesData.findIndex(n => String(n.id) === String(noteId));
        if (idx >= 0) notesData[idx] = data;
        renderNotes();
        FINOX.showNotification('✏️ Note modifiée', 'success');
    } catch (e) {
        console.error('[Notes] Edit error:', e);
        FINOX.showNotification('Erreur: ' + (e.message || 'sauvegarde échouée'), 'error');
    }
};

window.deleteNote = async function(noteId) {
    const confirmed = await FINOX.confirm('Supprimer cette note?');
    if (!confirmed) return;

    try {
        const { error } = await FINOX.supabase
            .from('client_timeline')
            .delete()
            .eq('id', noteId);

        if (error) throw error;
        notesData = notesData.filter(n => n.id !== noteId);
        updateNotesBadge();
        renderNotes();
        FINOX.showNotification('Note supprimée', 'success');
    } catch (e) {
        console.error('[Notes] Delete error:', e);
        FINOX.showNotification('Erreur', 'error');
    }
};
