// Vertical dual-pane file browser (local top, remote bottom)
// Every transfer (drag-drop, context-menu send) now goes through the confirm dialog.

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function createFileBrowser(sessionId, container, onStatus) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'dual-pane';
  container.appendChild(wrap);

  const localSide = makeSide('LOCAL', false);
  const remoteSide = makeSide('REMOTE', true);
  wrap.appendChild(localSide.el);
  wrap.appendChild(remoteSide.el);

  let localPath = await window.api.localHome();
  let remotePath = '.';
  let localItemsCache = [];   // last-loaded local items (for existence checks)
  let remoteItemsCache = [];  // last-loaded remote items

  // ---------- UPLOAD (local -> remote) ----------
  async function uploadFiles(files) {
    // files: [{ name, sourcePath, size }]
    if (!files.length) return;
    // Fresh remote listing to know what would collide (browser cache could be stale)
    const list = await window.api.sftpList(sessionId, remotePath);
    const existingNames = new Set(list.ok ? list.items.map(i => i.name) : remoteItemsCache.map(i => i.name));

    const decisions = await window.confirmTransfer({
      direction: 'up',
      sourceFolder: files.length === 1
        ? files[0].sourcePath.replace(/[/\\][^/\\]+$/, '')
        : '(multiple locations)',
      destFolder: remotePath,
      files: files.map(f => ({ name: f.name, size: f.size, sourcePath: f.sourcePath })),
      existingNames,
      sessionId,
      isRemoteDest: true,
    });
    if (!decisions) return; // cancelled

    // Perform each transfer sequentially
    for (const d of decisions) {
      if (d.action === 'skip') continue;
      const destPath = remotePath.replace(/\/+$/, '') + '/' + d.name;
      onStatus(`↑ ${d.name}`, 0);
      const r = await window.api.sftpUpload(sessionId, d.sourcePath, destPath);
      if (!r.ok) {
        onStatus(`Upload failed: ${d.name} — ${r.error}`);
        await new Promise(res => setTimeout(res, 2500));
      }
    }
    onStatus(`✓ Transfer complete`);
    setTimeout(() => onStatus(''), 2500);
    refreshRemote();
    if (window.notifyDiskUsageChanged) window.notifyDiskUsageChanged();
  }

  // ---------- DOWNLOAD (remote -> local) ----------
  async function downloadFiles(files) {
    // files: [{ name, size, sourceRemotePath }]
    if (!files.length) return;
    // Fresh local listing
    const list = await window.api.localList(localPath);
    const existingNames = new Set(list.ok ? list.items.map(i => i.name) : localItemsCache.map(i => i.name));

    const decisions = await window.confirmTransfer({
      direction: 'down',
      sourceFolder: remotePath,
      destFolder: localPath,
      files: files.map(f => ({ name: f.name, size: f.size, sourcePath: f.sourceRemotePath })),
      existingNames,
      sessionId,
      isRemoteDest: false,
    });
    if (!decisions) return;

    for (const d of decisions) {
      if (d.action === 'skip') continue;
      const destPath = await window.api.localJoin(localPath, d.name);
      onStatus(`↓ ${d.name}`, 0);
      const r = await window.api.sftpDownload(sessionId, d.sourcePath, destPath);
      if (!r.ok) {
        onStatus(`Download failed: ${d.name} — ${r.error}`);
        await new Promise(res => setTimeout(res, 2500));
      }
    }
    onStatus(`✓ Transfer complete`);
    setTimeout(() => onStatus(''), 2500);
    refreshLocal();
  }

  // ---------- List refresh ----------
  async function refreshLocal() {
    const r = await window.api.localList(localPath);
    if (!r.ok) { localSide.showError(r.error); return; }
    localPath = r.path;
    localItemsCache = r.items;
    localSide.setPath(localPath);
    localSide.render(r.items, {
      onOpen: async (item) => {
        if (item.name === '..') localPath = await window.api.localDirname(localPath);
        else if (item.isDirectory) localPath = await window.api.localJoin(localPath, item.name);
        else return;
        refreshLocal();
      },
      onDelete: async (item) => {
        const ok = await window.showConfirmDialog({
          title: 'Delete File', message: `Delete local "${item.name}"? This cannot be undone.`,
          confirmLabel: 'Delete', danger: true,
        });
        if (!ok) return;
        const full = await window.api.localJoin(localPath, item.name);
        const r = await window.api.localDelete(full, item.isDirectory);
        if (!r.ok) alert(r.error);
        refreshLocal();
      },
      onRename: async (item) => {
        const nn = await window.showPromptDialog({
          title: 'Rename File', message: `Rename "${item.name}" to:`, defaultValue: item.name,
        });
        if (!nn || nn === item.name) return;
        const from = await window.api.localJoin(localPath, item.name);
        const to = await window.api.localJoin(localPath, nn);
        const r = await window.api.localRename(from, to);
        if (!r.ok) alert(r.error);
        refreshLocal();
      },
      onSendToOther: async (item) => {
        if (item.isDirectory) { alert('Folder upload not supported yet'); return; }
        const full = await window.api.localJoin(localPath, item.name);
        await uploadFiles([{ name: item.name, sourcePath: full, size: item.size }]);
      },
    });
  }

  async function refreshRemote() {
    const r = await window.api.sftpList(sessionId, remotePath);
    if (!r.ok) { remoteSide.showError(r.error); return; }
    remotePath = r.path;
    remoteItemsCache = r.items;
    remoteSide.setPath(remotePath);
    remoteSide.render(r.items, {
      onOpen: (item) => {
        if (item.name === '..') {
          const parts = remotePath.split('/').filter(Boolean);
          parts.pop();
          remotePath = '/' + parts.join('/');
        } else if (item.isDirectory) {
          remotePath = remotePath.replace(/\/+$/, '') + '/' + item.name;
        } else return;
        refreshRemote();
      },
      onDelete: async (item) => {
        const ok = await window.showConfirmDialog({
          title: 'Delete File', message: `Delete remote "${item.name}"? This cannot be undone.`,
          confirmLabel: 'Delete', danger: true,
        });
        if (!ok) return;
        const full = remotePath.replace(/\/+$/, '') + '/' + item.name;
        const r = await window.api.sftpDelete(sessionId, full, item.isDirectory);
        if (!r.ok) alert(r.error);
        refreshRemote();
      },
      onRename: async (item) => {
        const nn = await window.showPromptDialog({
          title: 'Rename File', message: `Rename "${item.name}" to:`, defaultValue: item.name,
        });
        if (!nn || nn === item.name) return;
        const from = remotePath.replace(/\/+$/, '') + '/' + item.name;
        const to = remotePath.replace(/\/+$/, '') + '/' + nn;
        const r = await window.api.sftpRename(sessionId, from, to);
        if (!r.ok) alert(r.error);
        refreshRemote();
      },
      onSendToOther: async (item) => {
        if (item.isDirectory) { alert('Folder download not supported yet'); return; }
        const src = remotePath.replace(/\/+$/, '') + '/' + item.name;
        await downloadFiles([{ name: item.name, sourceRemotePath: src, size: item.size }]);
      },
    });
  }

  // Header buttons
  localSide.btnUp.onclick = async () => { localPath = await window.api.localDirname(localPath); refreshLocal(); };
  localSide.btnRefresh.onclick = refreshLocal;
  localSide.btnHome.onclick = async () => { localPath = await window.api.localHome(); refreshLocal(); };
  localSide.btnMkdir.onclick = async () => {
    const n = await window.showPromptDialog({ title: 'New Local Folder', message: 'Folder name:', placeholder: 'New Folder' });
    if (!n) return;
    const full = await window.api.localJoin(localPath, n);
    const r = await window.api.localMkdir(full);
    if (!r.ok) alert(r.error);
    refreshLocal();
  };
  localSide.pathInput.onkeydown = (e) => {
    if (e.key === 'Enter') { localPath = localSide.pathInput.value; refreshLocal(); }
  };

  remoteSide.btnUp.onclick = () => {
    const parts = remotePath.split('/').filter(Boolean); parts.pop();
    remotePath = '/' + parts.join('/'); refreshRemote();
  };
  remoteSide.btnRefresh.onclick = refreshRemote;
  remoteSide.btnHome.onclick = () => { remotePath = '.'; refreshRemote(); };
  remoteSide.btnMkdir.onclick = async () => {
    const n = await window.showPromptDialog({ title: 'New Remote Folder', message: 'Folder name:', placeholder: 'New Folder' });
    if (!n) return;
    const full = remotePath.replace(/\/+$/, '') + '/' + n;
    const r = await window.api.sftpMkdir(sessionId, full);
    if (!r.ok) alert(r.error);
    refreshRemote();
  };
  remoteSide.pathInput.onkeydown = (e) => {
    if (e.key === 'Enter') { remotePath = remoteSide.pathInput.value; refreshRemote(); }
  };

  // Drag from Windows Explorer -> remote pane
  remoteSide.list.addEventListener('dragover', (e) => {
    e.preventDefault(); remoteSide.list.classList.add('drag-hover');
  });
  remoteSide.list.addEventListener('dragleave', () => remoteSide.list.classList.remove('drag-hover'));
  remoteSide.list.addEventListener('drop', async (e) => {
    e.preventDefault();
    remoteSide.list.classList.remove('drag-hover');
    const dropped = [...e.dataTransfer.files].map(f => ({
      name: f.name, sourcePath: f.path, size: f.size,
    }));
    if (dropped.length) await uploadFiles(dropped);
  });

  refreshLocal();
  refreshRemote();

  return {
    refresh: () => { refreshLocal(); refreshRemote(); },
    dispose: () => { container.innerHTML = ''; },
  };
}

function makeSide(label, isRemote) {
  const el = document.createElement('div');
  el.className = 'fb-side' + (isRemote ? ' remote' : '');

  const header = document.createElement('div'); header.className = 'fb-header';
  header.innerHTML = `
    <span class="fb-label">${label}</span>
    <button title="Up">${window.icon('arrow-up', 13)}</button>
    <button title="Home">${window.icon('home', 13)}</button>
    <button title="Refresh">${window.icon('refresh', 13)}</button>
    <button title="New folder">${window.icon('folder-plus', 13)}</button>
    <input class="fb-path" />
  `;
  const [btnUp, btnHome, btnRefresh, btnMkdir] = header.querySelectorAll('button');
  const pathInput = header.querySelector('input');

  const list = document.createElement('div'); list.className = 'fb-list';

  el.appendChild(header); el.appendChild(list);

  function setPath(p) { pathInput.value = p; }
  function showError(msg) {
    list.innerHTML = `<div class="fb-empty" style="color:var(--danger)">Error: ${escapeHtml(msg)}</div>`;
  }
  function render(items, handlers) {
    list.innerHTML = '';
    const upRow = { name: '..', isDirectory: true, size: null, mtime: null };
    [upRow, ...items].forEach(item => {
      const row = document.createElement('div'); row.className = 'fb-row';
      const iconName = item.name === '..' ? 'arrow-up' : (item.isDirectory ? 'folder' : 'file');
      row.innerHTML = `
        <span class="icon">${window.icon(iconName, 14)}</span>
        <span class="name">${escapeHtml(item.name)}</span>
        <span class="size">${item.isDirectory ? '' : fmtSize(item.size)}</span>
      `;
      row.ondblclick = () => handlers.onOpen(item);
      row.oncontextmenu = (e) => {
        e.preventDefault();
        if (item.name === '..') return;
        const arrow = isRemote ? 'arrow-up' : 'arrow-down';
        const arrowText = isRemote ? 'Download to local ↑' : 'Upload to remote ↓';
        window.showContextMenu(e.clientX, e.clientY, [
          { label: arrowText, icon: arrow, onClick: () => handlers.onSendToOther(item) },
          { label: 'Rename...', icon: 'edit', onClick: () => handlers.onRename(item) },
          { sep: true },
          { label: 'Delete', icon: 'trash', onClick: () => handlers.onDelete(item) },
        ]);
      };
      list.appendChild(row);
    });
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fb-empty'; empty.textContent = '(empty)';
      list.appendChild(empty);
    }
  }

  return { el, btnUp, btnHome, btnRefresh, btnMkdir, pathInput, list, setPath, showError, render };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

window.createFileBrowser = createFileBrowser;
