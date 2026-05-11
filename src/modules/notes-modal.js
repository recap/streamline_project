// ─── Notes Modal ───────────────────────────────────────────────────────────
// Full-screen markdown editor modal using EasyMDE.
// Appended inside #scaled-content so it shares the 1920x1200 design space.
// The EasyMDE editor sits in an absolutely-positioned inner div with an
// inverse scale transform so CodeMirror cursor math stays correct, while
// the header/buttons remain in the normal flex flow (never pushed off-screen).

let overlayEl = null;
let editorWrapEl = null;   // flex slot (position: relative)
let editorScaledEl = null; // absolutely-positioned, inverse-scaled inner div
let easyMDE = null;
let onConfirmCallback = null;

function getAppScale() {
    const content = document.getElementById('scaled-content');
    if (!content) return 1;
    const transform = content.style.transform || '';
    const match = transform.match(/scale\(([\d.]+)\)/);
    return match ? parseFloat(match[1]) : 1;
}

function buildModal() {
    // If the overlay was detached from DOM (router wipes #scaled-content on navigation),
    // tear down stale references so we rebuild fresh.
    if (overlayEl && !overlayEl.isConnected) {
        if (easyMDE) {
            easyMDE.toTextArea();
            easyMDE = null;
        }
        overlayEl = null;
        editorWrapEl = null;
        editorScaledEl = null;
    }
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'notes-modal-overlay';

    const container = document.createElement('div');
    container.className = 'notes-modal-container';

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'notes-modal-header';

    const title = document.createElement('span');
    title.className = 'notes-modal-title';
    title.textContent = 'Notes';

    const actions = document.createElement('div');
    actions.className = 'notes-modal-header-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'notes-modal-cancel';
    cancelBtn.textContent = 'CANCEL';
    cancelBtn.addEventListener('click', closeModal);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'notes-modal-confirm';
    confirmBtn.textContent = 'CONFIRM';
    confirmBtn.addEventListener('click', handleConfirm);

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    header.appendChild(title);
    header.appendChild(actions);

    // ── Editor area ─────────────────────────────────────────────────────────
    // Outer wrapper: flex slot that takes remaining space, acts as position anchor
    editorWrapEl = document.createElement('div');
    editorWrapEl.className = 'notes-modal-editor-wrap';

    // Inner wrapper: absolutely positioned, gets the inverse scale transform
    editorScaledEl = document.createElement('div');
    editorScaledEl.className = 'notes-modal-editor-scaled';

    const textarea = document.createElement('textarea');
    textarea.id = 'notes-modal-textarea';
    editorScaledEl.appendChild(textarea);
    editorWrapEl.appendChild(editorScaledEl);

    // ── Assemble ────────────────────────────────────────────────────────────
    container.appendChild(header);
    container.appendChild(editorWrapEl);
    overlayEl.appendChild(container);

    // Append inside #scaled-content so buttons/text match the design-space sizing
    const scaledContent = document.getElementById('scaled-content');
    if (scaledContent) {
        scaledContent.appendChild(overlayEl);
    } else {
        document.body.appendChild(overlayEl);
    }
}

function applyInverseScale() {
    if (!editorScaledEl || !editorWrapEl) return;
    const scale = getAppScale();
    if (scale && scale !== 1) {
        const inv = 1 / scale;
        // The wrap's layout size is in design-space pixels (e.g. ~1040px tall).
        // We need the inner div to be wrap-size / scale in CSS pixels so that
        // after transform: scale(inv) it visually fills the wrap exactly.
        const wrapRect = editorWrapEl.getBoundingClientRect();
        const cssWidth = wrapRect.width / scale;   // undo parent scale to get design px
        const cssHeight = wrapRect.height / scale;

        editorScaledEl.style.width = `${cssWidth * (1 / inv)}px`;
        editorScaledEl.style.height = `${cssHeight * (1 / inv)}px`;
        editorScaledEl.style.transform = `scale(${inv})`;
        editorScaledEl.style.transformOrigin = 'top left';
    } else {
        // No scaling needed — fill the wrapper naturally
        editorScaledEl.style.width = '100%';
        editorScaledEl.style.height = '100%';
        editorScaledEl.style.transform = '';
    }
}

function initEasyMDE() {
    if (easyMDE) return;

    const textarea = document.getElementById('notes-modal-textarea');
    if (!textarea) return;

    easyMDE = new EasyMDE({
        element: textarea,
        spellChecker: false,
        status: false,
        autoDownloadFontAwesome: true,
        placeholder: 'Write your notes here\u2026',
        toolbar: [
            'bold', 'italic', 'heading', '|',
            'unordered-list', 'ordered-list', '|',
            'link', 'quote', 'horizontal-rule', '|',
            'preview', 'side-by-side',
        ],
        autosave: {
            enabled: true,
            uniqueId: 'profile-notes-autosave',
            delay: 5000,
        },
        minHeight: '100%',
        maxHeight: '100%',
    });
}

// ── Open / Close ────────────────────────────────────────────────────────────

export function openNotesModal(currentText, onConfirm) {
    buildModal();
    onConfirmCallback = onConfirm;
    overlayEl.classList.add('active');

    // Wait a frame for the overlay to be visible and laid out,
    // then compute inverse scale and init EasyMDE
    requestAnimationFrame(() => {
        applyInverseScale();
        setTimeout(() => {
            initEasyMDE();
            easyMDE.value(currentText || '');
            easyMDE.codemirror.refresh();
            easyMDE.codemirror.focus();
        }, 350);
    });
}

function handleConfirm() {
    if (onConfirmCallback && easyMDE) {
        onConfirmCallback(easyMDE.value());
    }
    closeModal();
}

function closeModal() {
    if (!overlayEl) return;
    overlayEl.classList.remove('active');
    onConfirmCallback = null;
}
