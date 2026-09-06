// Themed replacements for window.prompt() and window.confirm().
//
// window.prompt() is disabled by Electron (always returns null silently) —
// every call site using it was silently broken. window.confirm() technically
// works in Electron but renders as a plain OS dialog that clashes with the
// app's theme. Both are replaced here with in-app modals matching the
// existing .dialog / .dialog-inner / .dialog-actions styling.
//
// Usage:
//   const name = await showPromptDialog({ title: 'Rename', message: 'New name:', defaultValue: 'foo.txt' });
//   if (name === null) return; // cancelled
//
//   const ok = await showConfirmDialog({ title: 'Delete file?', message: 'This cannot be undone.', danger: true });
//   if (!ok) return;

(function () {
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'dialog hidden';
    overlay.id = 'generic-modal-dialog';
    document.body.appendChild(overlay);
    return overlay;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function showPromptDialog({ title = 'Enter a value', message = '', defaultValue = '', placeholder = '', confirmLabel = 'OK' } = {}) {
    const dlg = ensureOverlay();
    return new Promise((resolve) => {
      dlg.innerHTML = `
        <div class="dialog-inner card" style="min-width:420px;max-width:520px;">
          <h3>${esc(title)}</h3>
          ${message ? `<p class="dialog-desc">${esc(message)}</p>` : ''}
          <label style="margin-top:4px;">
            <input id="gm-prompt-input" type="text" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" autocomplete="off" />
          </label>
          <div class="dialog-actions">
            <button id="gm-prompt-cancel"><span class="icon-wrap">${window.icon ? window.icon('x', 14) : ''}</span> Cancel</button>
            <button id="gm-prompt-ok" class="btn-primary"><span class="icon-wrap">${window.icon ? window.icon('check', 14) : ''}</span> ${esc(confirmLabel)}</button>
          </div>
        </div>
      `;
      const input = dlg.querySelector('#gm-prompt-input');
      const btnOk = dlg.querySelector('#gm-prompt-ok');
      const btnCancel = dlg.querySelector('#gm-prompt-cancel');

      function cleanup(result) {
        dlg.classList.add('hidden');
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cleanup(input.value); }
      });
      btnOk.onclick = () => cleanup(input.value);
      btnCancel.onclick = () => cleanup(null);
      document.addEventListener('keydown', onKey);

      dlg.classList.remove('hidden');
      requestAnimationFrame(() => {
        input.focus();
        // Select base name (before extension) for quick rename, like the transfer dialog does
        const val = input.value;
        const dotIdx = val.lastIndexOf('.');
        if (dotIdx > 0) input.setSelectionRange(0, dotIdx);
        else input.select();
      });
    });
  }

  // Optional `checkbox` param: { label, defaultChecked }. When provided, the
  // dialog shows an extra checkbox below the message, and the promise
  // resolves to { confirmed, checked } instead of a bare boolean — so
  // existing callers that don't pass `checkbox` are unaffected.
  function showConfirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, checkbox = null } = {}) {
    const dlg = ensureOverlay();
    return new Promise((resolve) => {
      const checkboxHtml = checkbox ? `
        <label class="confirm-checkbox-row">
          <input type="checkbox" id="gm-confirm-check" ${checkbox.defaultChecked ? 'checked' : ''} />
          <span>${esc(checkbox.label)}</span>
        </label>
      ` : '';
      dlg.innerHTML = `
        <div class="dialog-inner card ${danger ? 'mismatch-card' : ''}" style="min-width:400px;max-width:480px;">
          <h3 class="${danger ? 'mismatch-title' : ''}">${esc(title)}</h3>
          ${message ? `<p class="dialog-desc">${esc(message)}</p>` : ''}
          ${checkboxHtml}
          <div class="dialog-actions">
            <button id="gm-confirm-cancel"><span class="icon-wrap">${window.icon ? window.icon('x', 14) : ''}</span> ${esc(cancelLabel)}</button>
            <button id="gm-confirm-ok" class="btn-primary"><span class="icon-wrap">${window.icon ? window.icon(danger ? 'trash' : 'check', 14) : ''}</span> ${esc(confirmLabel)}</button>
          </div>
        </div>
      `;
      const btnOk = dlg.querySelector('#gm-confirm-ok');
      const btnCancel = dlg.querySelector('#gm-confirm-cancel');
      const check = dlg.querySelector('#gm-confirm-check');
      if (danger) {
        btnOk.style.background = 'rgba(255, 51, 102, 0.85)';
        btnOk.style.borderColor = 'var(--danger)';
        btnOk.style.boxShadow = '0 0 14px var(--danger-glow)';
      }

      const resolveWith = (confirmed) => {
        if (checkbox) resolve({ confirmed, checked: check ? check.checked : false });
        else resolve(confirmed);
      };
      function cleanup(confirmed) {
        dlg.classList.add('hidden');
        document.removeEventListener('keydown', onKey);
        resolveWith(confirmed);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        // For destructive (danger) actions, Enter does nothing — the person must
        // click the button explicitly. This prevents an accidental keypress from
        // triggering something irreversible. Non-destructive confirms still allow
        // Enter as a convenience.
        else if (e.key === 'Enter' && !danger) { e.preventDefault(); cleanup(true); }
      }
      btnOk.onclick = () => cleanup(true);
      btnCancel.onclick = () => cleanup(false);
      document.addEventListener('keydown', onKey);

      dlg.classList.remove('hidden');
      requestAnimationFrame(() => btnCancel.focus()); // default focus on the safe option
    });
  }

  // Multi-line paste preview. Matches SolarPuTTY / PuTTY's "confirm multi-line
  // paste" behavior: shows the pasted content in a scrollable read-only text
  // area, lets the user review and optionally edit before it goes to the
  // shell. Resolves to the (possibly-edited) string to send, or null on cancel.
  function showPasteConfirmDialog({ text, lineCount, sessionName }) {
    const dlg = ensureOverlay();
    return new Promise((resolve) => {
      // Show a truncated title but full content in the textarea. Keep the
      // <textarea> editable — a user may want to strip a stray line or fix
      // an obvious typo before sending, and that's exactly the kind of
      // moment this dialog exists to catch.
      const target = sessionName ? ` to <strong>${esc(sessionName)}</strong>` : '';
      dlg.innerHTML = `
        <div class="dialog-inner card paste-confirm-card" style="min-width:560px;max-width:760px;">
          <h3>Paste ${lineCount} lines${target}?</h3>
          <p class="dialog-desc">Review the content below. Click Paste to send it to the shell, or Cancel to discard.</p>
          <textarea id="gm-paste-text" class="paste-confirm-textarea" spellcheck="false" wrap="off"></textarea>
          <label class="paste-confirm-hint">
            <input type="checkbox" id="gm-paste-strip-sudo" />
            <span>Strip leading <code>sudo</code> from each line (useful if you already ran <code>sudo -v</code>)</span>
          </label>
          <div class="dialog-actions">
            <button id="gm-paste-cancel"><span class="icon-wrap">${window.icon ? window.icon('x', 14) : ''}</span> Cancel</button>
            <button id="gm-paste-ok" class="btn-primary"><span class="icon-wrap">${window.icon ? window.icon('clipboard', 14) : ''}</span> Paste</button>
          </div>
        </div>
      `;
      const ta = dlg.querySelector('#gm-paste-text');
      const btnOk = dlg.querySelector('#gm-paste-ok');
      const btnCancel = dlg.querySelector('#gm-paste-cancel');
      const stripSudo = dlg.querySelector('#gm-paste-strip-sudo');

      // Set value directly (not via HTML) so newlines and special chars can't
      // be interpreted as markup by any templating shortcut.
      ta.value = text;

      function currentPayload() {
        let v = ta.value;
        if (stripSudo.checked) {
          v = v.split(/\r?\n/).map(line => line.replace(/^\s*sudo\s+/, '')).join('\n');
        }
        return v;
      }

      function cleanup(result) {
        dlg.classList.add('hidden');
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
        // Ctrl+Enter confirms — Enter alone would just add a newline in the
        // textarea, which is what the user expects when editing.
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); cleanup(currentPayload());
        }
      }
      btnOk.onclick = () => cleanup(currentPayload());
      btnCancel.onclick = () => cleanup(null);
      document.addEventListener('keydown', onKey);

      dlg.classList.remove('hidden');
      // Focus the Paste button (not the textarea) so the user can press Enter
      // to confirm without editing. If they want to edit, they click the box.
      requestAnimationFrame(() => btnOk.focus());
    });
  }

  window.showPromptDialog = showPromptDialog;
  window.showConfirmDialog = showConfirmDialog;
  window.showPasteConfirmDialog = showPasteConfirmDialog;
})();
