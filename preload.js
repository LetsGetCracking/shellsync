const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  loginStatus: () => ipcRenderer.invoke('login:status'),
  loginEnable: (password) => ipcRenderer.invoke('login:enable', { password }),
  loginDisable: (password) => ipcRenderer.invoke('login:disable', { password }),
  loginVerify: (password) => ipcRenderer.invoke('login:verify', { password }),
  setSettings: (data) => ipcRenderer.invoke('settings:set', data),
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  getSessionsHealStatus: () => ipcRenderer.invoke('sessions:heal-status'),
  setSessions: (data) => ipcRenderer.invoke('sessions:set', data),
  getSessionPassword: (id) => ipcRenderer.invoke('sessions:get-password', id),
  migrationStatus: () => ipcRenderer.invoke('migration:status'),
  migrationRun: () => ipcRenderer.invoke('migration:run'),

  // Known hosts (host-key verification)
  knownHostsList: () => ipcRenderer.invoke('knownhosts:list'),
  knownHostsRemove: (hostname, port) => ipcRenderer.invoke('knownhosts:remove', { hostname, port }),
  knownHostsRemoveAll: () => ipcRenderer.invoke('knownhosts:remove-all'),
  knownHostsImportOpenSsh: () => ipcRenderer.invoke('knownhosts:import-openssh'),
  knownHostsImportStatus: () => ipcRenderer.invoke('knownhosts:import-status'),

  // Host verify — subscribe to prompts from main, respond via IPC
  onHostVerifyPrompt: (cb) => sub('host-verify:prompt', cb),
  hostVerifyRespond: (promptId, accept, remember) =>
    ipcRenderer.send('host-verify:respond', { promptId, accept, remember }),

  sshConnect: (opts) => ipcRenderer.invoke('ssh:connect', opts),
  sshWrite: (sessionId, data) => ipcRenderer.send('ssh:write', { sessionId, data }),
  sshResize: (sessionId, cols, rows) => ipcRenderer.send('ssh:resize', { sessionId, cols, rows }),
  sshDisconnect: (sessionId) => ipcRenderer.send('ssh:disconnect', { sessionId }),
  sshExec: (sessionId, command) => ipcRenderer.invoke('ssh:exec', { sessionId, command }),

  // RDP session support (delegates to native Windows mstsc.exe + cmdkey.exe)
  rdpLaunch: (session) => ipcRenderer.invoke('rdp:launch', session),
  rdpSaveCredentials: (data) => ipcRenderer.invoke('rdp:saveCredentials', data),
  rdpDeleteCredentials: (data) => ipcRenderer.invoke('rdp:deleteCredentials', data),

  // window controls (custom title bar)
  winMinimize: () => ipcRenderer.send('window:minimize'),
  winMaximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
  winClose: () => ipcRenderer.send('window:close'),
  winIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowState: (cb) => sub('window:state', cb),
  onSshData: (sessionId, cb) => sub(`ssh:data:${sessionId}`, cb),
  onSshClose: (sessionId, cb) => sub(`ssh:close:${sessionId}`, cb),
  onSftpReady: (sessionId, cb) => sub(`ssh:sftp-ready:${sessionId}`, cb),
  onSftpError: (sessionId, cb) => sub(`ssh:sftp-error:${sessionId}`, cb),
  onSftpProgress: (sessionId, cb) => sub(`sftp:progress:${sessionId}`, cb),

  sftpList: (sessionId, remotePath) => ipcRenderer.invoke('sftp:list', { sessionId, remotePath }),
  sftpExistsBatch: (sessionId, remotePaths) => ipcRenderer.invoke('sftp:exists-batch', { sessionId, remotePaths }),
  sftpMkdir: (sessionId, remotePath) => ipcRenderer.invoke('sftp:mkdir', { sessionId, remotePath }),
  sftpDelete: (sessionId, remotePath, isDirectory) => ipcRenderer.invoke('sftp:delete', { sessionId, remotePath, isDirectory }),
  sftpRename: (sessionId, from, to) => ipcRenderer.invoke('sftp:rename', { sessionId, from, to }),
  sftpUpload: (sessionId, localPath, remotePath) => ipcRenderer.invoke('sftp:upload', { sessionId, localPath, remotePath }),
  sftpDownload: (sessionId, remotePath, localPath) => ipcRenderer.invoke('sftp:download', { sessionId, remotePath, localPath }),

  localHome: () => ipcRenderer.invoke('local:home'),
  localList: (localPath) => ipcRenderer.invoke('local:list', { localPath }),
  localExistsBatch: (localPaths) => ipcRenderer.invoke('local:exists-batch', { localPaths }),
  localMkdir: (localPath) => ipcRenderer.invoke('local:mkdir', { localPath }),
  localDelete: (localPath, isDirectory) => ipcRenderer.invoke('local:delete', { localPath, isDirectory }),
  localRename: (from, to) => ipcRenderer.invoke('local:rename', { from, to }),
  localJoin: (base, name) => ipcRenderer.invoke('local:join', { base, name }),
  localDirname: (p) => ipcRenderer.invoke('local:dirname', { p }),
  localPickDir: () => ipcRenderer.invoke('local:pick-dir'),
  localShowInFolder: (p) => ipcRenderer.invoke('local:show-in-folder', { p }),

  importSshConfig: () => ipcRenderer.invoke('sshconfig:import'),
  exportSessions: (sessions) => ipcRenderer.invoke('sessions:export', sessions),
  importSessions: () => ipcRenderer.invoke('sessions:import'),
});

function sub(channel, cb) {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
