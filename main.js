const { app, BrowserWindow, Menu, dialog, session } = require("electron");
const prompt = require("electron-prompt");
require("v8-compile-cache"); // Use V8 Engine code cache
const { ElectronBlocker } = require("@cliqz/adblocker-electron");
const fetch = require("cross-fetch"); // required 'fetch'
const fs = require("fs");
const path = require("path");
const https = require("https");
let win;
const listFilePath = path.join(app.getPath("userData")) + "/easylist.txt";
const stateFilePath =
  path.join(app.getPath("userData")) + "/adblockerstate.txt";
let listURL = "https://easylist.to/easylist/easylist.txt";
// Function to download the list
function downloadList() {
  https
    .get(listURL, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        fs.writeFileSync(listFilePath, data);
      });
    })
    .on("error", (err) => {
      if (!fs.existsSync(listFilePath)) {
        dialog.showErrorBox(
          "Error",
          "No existing list found. Please connect to the internet.",
        );
      }
    });
}

downloadList();

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

let { adblockerEnabled } = loadState();

async function createWindow() {
  async function blockerX() {
    try {
      const listData = await fs.readFileSync(listFilePath, "utf-8");
      blocker = await ElectronBlocker.parse(listData);
    } catch (err) {
      dialog.showErrorBox("Error", "Failed to load the adblocker.");
      console.log(err);
    }
    return blocker;
  }
  let blocker = blockerX().blocker;
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
          // Other menu items

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
