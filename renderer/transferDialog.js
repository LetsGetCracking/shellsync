// Transfer Confirm Dialog
// Usage:
//   const result = await confirmTransfer({
//     direction: 'up' | 'down',
//     sourceFolder: 'C:\\Users\\me\\Downloads',
//     destFolder: '/var/www',
//     files: [{ name: 'a.txt', size: 1024 }, ...],
//     existingNames: Set<string>,   // names already in the destination
//     sessionId,                     // for live existence re-checks after rename
//     isRemoteDest: boolean,
//   });
// Returns null if cancelled, or an array of items with final { name, action: 'transfer' | 'skip' }.

(function () {
  let dialogEl = null;

  function ensureDialog() {
    if (dialogEl) return dialogEl;

    dialogEl = document.createElement('div');
    dialogEl.id = 'transfer-dialog';
    dialogEl.className = 'dialog hidden';
    dialogEl.innerHTML = `
      <div class="dialog-inner glass td-dialog">
        <h3 id="td-title">Confirm File Transfer</h3>
        <div class="td-header-info">
          <div class="td-info-row">
            <span class="td-label">From:</span>
            <span class="td-path" id="td-source-path"></span>
          </div>
          <div class="td-info-row">
            <span class="td-label">To:</span>
            <span class="td-path" id="td-dest-path"></span>
          </div>
        </div>
        <div id="td-summary" class="td-summary"></div>
        <div id="td-list" class="td-list"></div>
        <div class="dialog-actions">
          <button id="td-cancel"><span>Cancel</span></button>
          <button id="td-confirm" class="btn-primary"><span id="td-confirm-label">Transfer</span></button>
        </div>
      </div>
    `;
    document.body.appendChild(dialogEl);
    return dialogEl;
  }

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  // Auto-suggest a non-colliding name: foo.tar.gz -> foo (1).tar.gz -> foo (2).tar.gz
  function suggestUniqueName(name, existingNames) {
    // Only strip a single, standard extension. Multi-dot names keep everything after first dot as ext.
    const m = name.match(/^(.+?)(\.[^.]+)?$/);
    const base = m[1];
    const ext = m[2] || '';
    for (let i = 1; i < 1000; i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!existingNames.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}${ext}`;
  }

  async function confirmTransfer(opts) {
    ensureDialog();

    const { direction, sourceFolder, destFolder, files, sessionId, isRemoteDest } = opts;
    let existingNames = new Set(opts.existingNames || []);

    // Build state: one entry per file with its current desired name and status
    const state = files.map(f => ({
      original: f.name,
      currentName: f.name,
      size: f.size,
      sourcePath: f.sourcePath, // set for uploads (Windows source path)
      action: 'transfer', // 'transfer' | 'skip'
      conflict: existingNames.has(f.name),
    }));

    return new Promise((resolve) => {
      const dlg = dialogEl;
      const title = dlg.querySelector('#td-title');
      const src = dlg.querySelector('#td-source-path');
      const dest = dlg.querySelector('#td-dest-path');
      const summary = dlg.querySelector('#td-summary');
      const list = dlg.querySelector('#td-list');
      const btnCancel = dlg.querySelector('#td-cancel');
      const btnConfirm = dlg.querySelector('#td-confirm');
      const confirmLabel = dlg.querySelector('#td-confirm-label');

      title.textContent = direction === 'up' ? 'Confirm Upload' : 'Confirm Download';
      src.textContent = sourceFolder || (direction === 'up' ? '(local files)' : '(remote files)');
      dest.textContent = destFolder;

      function updateSummary() {
        const active = state.filter(s => s.action === 'transfer').length;
        const skipped = state.filter(s => s.action === 'skip').length;
        const conflicts = state.filter(s => s.conflict && s.action === 'transfer').length;
        let parts = [];
        parts.push(`${active} file${active === 1 ? '' : 's'} to transfer`);
        if (skipped) parts.push(`<span class="td-warn-text">${skipped} skipped</span>`);
        if (conflicts) parts.push(`<span class="td-danger-text">${conflicts} will overwrite</span>`);
        summary.innerHTML = parts.join(' · ');
        confirmLabel.textContent = active === 0 ? 'Nothing to transfer' : (conflicts > 0 ? `Transfer (${conflicts} overwrite)` : 'Transfer');
        btnConfirm.disabled = active === 0;
      }

      function renderRows() {
        list.innerHTML = '';
        state.forEach((s, idx) => {
          const row = document.createElement('div');
          row.className = 'td-row';
          if (s.action === 'skip') row.classList.add('skipped');
          else if (s.conflict) row.classList.add('conflict');

          row.innerHTML = `
            <span class="td-icon">${window.icon('file', 16)}</span>
            <div class="td-fields">
              <div class="td-name-line">
                <input class="td-name" value="${esc(s.currentName)}" ${s.action === 'skip' ? 'disabled' : ''} />
                <span class="td-size">${fmtSize(s.size)}</span>
              </div>
              ${s.conflict && s.action === 'transfer' ? `
                <div class="td-conflict">
                  <span class="td-conflict-msg">${window.icon('eye', 12)} File already exists</span>
                  <div class="td-conflict-actions">
                    <button data-action="overwrite" class="td-btn td-btn-danger">Overwrite</button>
                    <button data-action="rename" class="td-btn td-btn-cyan">Rename</button>
                    <button data-action="skip" class="td-btn">Skip</button>
                  </div>
                </div>
              ` : ''}
              ${s.action === 'skip' ? `
                <div class="td-status td-status-skip">
                  Skipped
                  <button data-action="unskip" class="td-btn td-btn-cyan">Include</button>
                </div>
              ` : ''}
              ${!s.conflict && s.action === 'transfer' && s.currentName !== s.original ? `
                <div class="td-status td-status-renamed">
                  ${window.icon('edit', 12)} Renamed from "${esc(s.original)}"
                </div>
              ` : ''}
            </div>
          `;

          // Name input
          const nameInput = row.querySelector('.td-name');
          if (nameInput) {
            // Auto-select the base name (before extension) on focus for easy rename
            nameInput.addEventListener('focus', () => {
              const val = nameInput.value;
              const dotIdx = val.lastIndexOf('.');
              if (dotIdx > 0) nameInput.setSelectionRange(0, dotIdx);
              else nameInput.select();
            });
            nameInput.addEventListener('input', () => {
              s.currentName = nameInput.value;
              // Re-check conflict for this new name
              const wasConflict = s.conflict;
              s.conflict = existingNames.has(s.currentName) && s.currentName !== '';
              if (wasConflict !== s.conflict) renderRows(); // rerender if state changed
              updateSummary();
            });
          }

          // Action buttons
          row.querySelectorAll('button[data-action]').forEach(btn => {
            btn.onclick = (e) => {
              e.preventDefault();
              const action = btn.dataset.action;
              if (action === 'overwrite') {
                // Keep the name — conflict stays flagged for the summary "will overwrite" count
                // Just needs the row to re-render without the action bar (we mark it acknowledged)
                s.acknowledgedOverwrite = true;
              } else if (action === 'rename') {
                s.currentName = suggestUniqueName(s.currentName, existingNames);
                s.conflict = false;
              } else if (action === 'skip') {
                s.action = 'skip';
              } else if (action === 'unskip') {
                s.action = 'transfer';
                s.conflict = existingNames.has(s.currentName);
              }
              renderRows();
              updateSummary();
              // Focus the name input if we just renamed, so user can tweak
              if (action === 'rename') {
                requestAnimationFrame(() => {
                  const inp = list.children[idx].querySelector('.td-name');
                  if (inp) inp.focus();
                });
              }
            };
          });

          // If overwrite was acknowledged, hide the conflict-action panel (still show it's overwriting)
          if (s.conflict && s.acknowledgedOverwrite) {
            const conflictPanel = row.querySelector('.td-conflict');
            if (conflictPanel) {
              conflictPanel.innerHTML = `
                <span class="td-conflict-msg td-danger-text">${window.icon('eye', 12)} Will overwrite existing file</span>
                <button data-action="cancel-overwrite" class="td-btn td-btn-cyan">Undo</button>
              `;
              conflictPanel.querySelector('button').onclick = () => {
                s.acknowledgedOverwrite = false;
                renderRows();
                updateSummary();
              };
            }
          }

          list.appendChild(row);
        });
      }

      function cleanup(result) {
        dlg.classList.add('hidden');
        btnConfirm.onclick = null;
        btnCancel.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
        else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'INPUT') {
          e.preventDefault();
          if (!btnConfirm.disabled) doConfirm();
        }
      }

      function doConfirm() {
        // Validate: no active transfer may have an empty name; no duplicate final names
        const active = state.filter(s => s.action === 'transfer');
        const emptyNames = active.filter(s => !s.currentName.trim());
        if (emptyNames.length) {
          alert('Some files have empty names. Please provide a name or skip them.');
          return;
        }
        const finalNames = active.map(s => s.currentName);
        const dupes = finalNames.filter((n, i) => finalNames.indexOf(n) !== i);
        if (dupes.length) {
          alert('Duplicate destination names in this batch:\n\n  ' + [...new Set(dupes)].join('\n  '));
          return;
        }
        cleanup(state.map(s => ({
          originalName: s.original,
          name: s.currentName,
          sourcePath: s.sourcePath,
          action: s.action,
          size: s.size,
        })));
      }

      btnConfirm.onclick = doConfirm;
      btnCancel.onclick = () => cleanup(null);
      document.addEventListener('keydown', onKey);

      renderRows();
      updateSummary();
      dlg.classList.remove('hidden');
      // Focus first name input for quick rename
      requestAnimationFrame(() => {
        const first = list.querySelector('.td-name');
        if (first) { first.focus(); /* leaves the selection from onfocus handler */ }
      });
    });
  }

  window.confirmTransfer = confirmTransfer;
})();
