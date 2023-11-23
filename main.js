const { app, BrowserWindow, Menu, dialog, session } = require("electron");
const prompt = require("electron-prompt");
require("v8-compile-cache"); // Use V8 Engine code cache
const { ElectronBlocker, fullLists } = require("@cliqz/adblocker-electron");
const ProgressBar = require("electron-progressbar");
const Store = require("electron-store");
const fetch = require("cross-fetch"); // required 'fetch'
const fs = require('fs').promises;
let win;
const store = new Store();

let { adblockerEnabled } = store.get("adBlockerState")
  ? store.get("adBlockerState")
  : true;

async function createWindow() {
  async function blockerX() {
    let blocker;
    try {
      blocker = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
  path: 'engine.bin',
  read: fs.readFile,
  write: fs.writeFile,
});
    } catch (err) {
      dialog.showErrorBox("Error", "Cannot fetch block list.");
      console.log(err);
      return;
    }
    return blocker;
  }

  let blocker = await blockerX();
  prompt({
    title: "Enter URL",
    label: "URL:",
    value: "https://google.com",
    inputAttrs: {
      type: "url",
    },
    type: "input",
  })
    .then((r) => {
      if (r === null) {
        console.log("user cancelled");
      } else {
        win = new BrowserWindow({
          width: 800,
          height: 600,
          frame: true,
          webPreferences: {
            nodeIntegration: false, // disable nodeIntegration for security.
            contextIsolation: true, // protect against prototype pollution.
            enableRemoteModule: false, // turn off remote module.
            sandbox: true,
          },
        });
        if (store.get("adBlockerState") === true) {
          blocker.enableBlockingInSession(win.webContents.session);
        }
        win.loadURL(r);

        win.on("closed", () => {
          win = null;
        });

        const template = [
          {
            label: "Menu",
            submenu: [
              {
                label: "Quit",
                accelerator:
                  process.platform === "darwin" ? "Command+Q" : "Ctrl+Q",
                click() {
                  app.quit();
                },
              },
            ],
          },
          {
            label: "View",
            submenu: [
              {
                label: "Reload",
                accelerator: "CmdOrCtrl+R",
                click() {
                  win.reload();
                },
              },
              {
                label: "Toggle Full Screen",
                accelerator:
                  process.platform === "darwin" ? "Ctrl+Command+F" : "F11", // Shortcut key
                click: () => {
                  win.setAutoHideMenuBar(win.isFullScreen());
                  win.setMenuBarVisibility(!win.isFullScreen());
                  win.setFullScreen(!win.isFullScreen());
                },
              },
              {
                label: "Toggle Developer Tools",
                accelerator:
                  process.platform === "darwin"
                    ? "Command+Alt+I"
                    : "Ctrl+Shift+I",
                click() {
                  win.webContents.toggleDevTools();
                },
              },
            ],
          },
          {
            label: "Navigate",
            submenu: [
              {
                label: "Back",
                accelerator:
                  process.platform === "darwin" ? "Command+[" : "Alt+Left",
                click() {
                  win.webContents.goBack();
                },
              },
              {
                label: "Forward",
                accelerator:
                  process.platform === "darwin" ? "Command+]" : "Alt+Right",
                click() {
                  win.webContents.goForward();
                },
              },
            ],
          },
          {
            label: "Adblocker",
            submenu: [
              {
                label: "Enable",
                type: "checkbox",
                checked: store.get("adBlockerState"),
                click(menuItem) {
                  if (!adblockerEnabled) {
                    blocker.enableBlockingInSession(session.defaultSession);
                    adblockerEnabled = !adblockerEnabled;
                    store.set("adBlockerState", adblockerEnabled);
                    menuItem.menu.items[1].checked = false;
                  } else {
                    menuItem.menu.items[0].checked = true;
                  }
                },
              },
              {
                label: "Disable",
                type: "checkbox",
                checked: !store.get("adBlockerState"),
                click(menuItem) {
                  if (adblockerEnabled) {
                    blocker.disableBlockingInSession(session.defaultSession);
                    adblockerEnabled = !adblockerEnabled;
                    store.set("adBlockerState", adblockerEnabled);
                    menuItem.menu.items[0].checked = false;
                  } else {
                    menuItem.menu.items[1].checked = true;
                  }
                },
              },
            ],
          },
          {
            label: "Download",
            submenu: [
              {
                label: "Show Download History",
                click() {
                  dialog.showMessageBox({
                    message:
                      "Download history: " +
                      JSON.stringify(store.get("downloadHistory")),
                  });
                },
              },
            ],
          },

          {
            label: "Help",
            submenu: [
              {
                label: "About",
                click() {
                  dialog.showMessageBox({
                    type: "info",
                    title: "About",
                    message: `Version: Beta!\nThis is a browser developed by UnknownVPS using Electron.`,
                    buttons: ["OK"],
                  });
                },
              },
            ],
          },
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
        win.webContents.session.on(
          "will-download",
          (event, item, webContents) => {
            downloadItem = item; // Store the download item

            // Create a new progress bar
            let progressBar = new ProgressBar({
              indeterminate: false,
              text: "Preparing download...",
              detail: "Wait...",
            });
            progressBar
              .on("completed", function () {
                console.info(`completed...`);
                progressBar.detail = "Task completed. Exiting...";
              })
              .on("aborted", function (value) {
                console.info(`aborted... ${value}`);
              })
              .on("progress", function (value) {
                progressBar.detail = `Downloaded ${value} out of ${
                  progressBar.getOptions().maxValue
                }...\nDownload ${value}% Complete! Due to technical difficulies pausing is not possible atm.`;
              });

            item.on("updated", (event, state) => {
              if (state === "interrupted") {
                console.log("Download is interrupted but can be resumed");
              } else if (state === "progressing") {
                if (item.isPaused()) {
                  console.log("Download is paused");
                } else {
                  // Update the progress bar value
                  let totalBytes = item.getTotalBytes();
                  if (totalBytes > 0) {
                    let progress = (item.getReceivedBytes() / totalBytes) * 100;
                    progressBar.value = progress;
                  } else {
                    // If totalBytes is not available, switch to indeterminate mode
                    progressBar.options.indeterminate = true;
                  }
                  console.log(`Received bytes: ${item.getReceivedBytes()}`);
                }
              }
            });

            item.once("done", (event, state) => {
              if (state === "completed") {
                console.log("Download successfully");
                progressBar.setCompleted();
              } else {
                console.log(`Download failed: ${state}`);
                progressBar.close();
              }

              let downloadHistory = store.get("downloadHistory") || [];
              downloadHistory.push({
                url: item.getURL(),
                filename: item.getFilename(),
                fileSize: item.getTotalBytes(),
              });
              store.set("downloadHistory", downloadHistory);
            });
          },
        );
      }
    })
    .catch(console.error);
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (win === null) {
    createWindow();
  }
});
