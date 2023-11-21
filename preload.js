// preload.js
window.addEventListener('DOMContentLoaded', () => {
  // Disable unnecessary modules to reduce memory usage
  const { remote, ipcRenderer } = require('electron');
  delete window.require;
  delete window.exports;
  delete window.module;

  // Disable Node.js integration
  if (remote) {
    remote.app.removeAllListeners();
    remote.getCurrentWindow().removeAllListeners();
  }

  // Expose a limited set of APIs to the renderer process
  window.ipcRenderer = ipcRenderer;
});
