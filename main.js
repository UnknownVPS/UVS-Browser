const { app, BrowserWindow, Menu, dialog, session } = require("electron");
const prompt = require("electron-prompt");
require("v8-compile-cache"); // Use V8 Engine code cache
const { ElectronBlocker, fullLists } = require("@cliqz/adblocker-electron");
const ProgressBar = require("electron-progressbar");
const Store = require("electron-store");
const fetch = require("cross-fetch"); // required 'fetch'
const fs = require("fs");
const path = require("path");
const https = require("https");
let win;
const listFilePath = path.join(app.getPath("userData")) + "/easylist.txt";
const privacyFilePath = path.join(app.getPath("userData")) + "/easyprivacy.txt";
const stateFilePath =
  path.join(app.getPath("userData")) + "/adblockerstate.txt";
let easyListURL = "https://easylist.to/easylist/easylist.txt";
let easyPrivacyURL = "https://easylist.to/easylist/easyprivacy.txt";
const store = new Store();

// Function to download a list
async function downloadList(url, filePath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          fs.writeFileSync(filePath, data);
          resolve();
        });
        res.on("error", (err) => {
          if (fs.existsSync(filePath)) {
            resolve(); // If file exists, resolve the promise
          } else {
            reject(new Error("File not downloaded")); // If file does not exist, reject the promise
          }
        });
      })
      .on("error", (err) => {
        if (fs.existsSync(filePath)) {
          resolve(); // If file exists, resolve the promise
        } else {
          reject(
            new Error(
              "Please Connect to Internet! No adblock files were found!",
            ),
          ); // If file does not exist, reject the promise
        }
      });
  });
}

function loadState() {
  try {
    const stateJSON = fs.readFileSync(stateFilePath, "utf-8");
    return JSON.parse(stateJSON);
  } catch (err) {
    // If the file doesn't exist or is not valid JSON, return a default state
    return { adblockerEnabled: true };
  }
}

// Function to save the state
function saveState(state) {
  const stateJSON = JSON.stringify(state);
  fs.writeFileSync(stateFilePath, stateJSON);
}

function showDownloads() {
  const files = downloadedFiles.map((file) => file.label).join("\n");
  const progress = downloads
    .map((download) => {
      const totalBytes = download.getTotalBytes();
      const receivedBytes = download.getReceivedBytes();
      const progress = receivedBytes / totalBytes;
      const speed = receivedBytes / (download.getStartTime() / 1000); // bytes per second
      return `${download.getFilename()}: ${Math.round(
        progress * 100,
      )}% complete, ${Math.round(speed)} B/s`;
    })
    .join("\n");
  dialog.showMessageBox({
    type: "info",
    title: "Download Progress",
    message: "Here is the progress of your downloads:\n\n" + progress,
    buttons: ["OK"],
  });
}

let { adblockerEnabled } = loadState();

async function createWindow() {
  async function blockerX() {
    let blocker;
    try {
      // Download the lists
      await downloadList(easyListURL, listFilePath);
      await downloadList(easyPrivacyURL, privacyFilePath);

      const listData = await fs.readFileSync(listFilePath, "utf-8");
      const privacyData = await fs.readFileSync(privacyFilePath, "utf-8");
      blocker = await ElectronBlocker.parse(listData);
    } catch (err) {
      dialog.showErrorBox("Error", err.message);
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
            preload: __dirname + "/preload.js", // use a preload script.
          },
        });
        blocker.enableBlockingInSession(win.webContents.session);
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
                checked: adblockerEnabled,
                click(menuItem) {
                  if (!adblockerEnabled) {
                    blocker.enableBlockingInSession(session.defaultSession);
                    adblockerEnabled = !adblockerEnabled;
                    saveState({ adblockerEnabled });
                    menuItem.menu.items[1].checked = false;
                  }
                },
              },
              {
                label: "Disable",
                type: "checkbox",
                checked: !adblockerEnabled,
                click(menuItem) {
                  if (adblockerEnabled) {
                    blocker.disableBlockingInSession(session.defaultSession);
                    adblockerEnabled = !adblockerEnabled;
                    saveState({ adblockerEnabled });
                    menuItem.menu.items[0].checked = false;
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
