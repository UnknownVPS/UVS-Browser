const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  session,
  clipboard,
  nativeImage,
  BrowserView,
} = require("electron");
const prompt = require("electron-prompt");
require("v8-compile-cache"); // Use V8 Engine code cache
const { ElectronBlocker } = require("@cliqz/adblocker-electron");
const ProgressBar = require("electron-progressbar");
const Store = require("electron-store");
const fetch = require("cross-fetch"); // required 'fetch'
const fs = require("fs").promises;
let win;
const store = new Store();

if (!store.get("adBlockerState")) {
  store.set("adBlockerState", true);
}

let blocker; // Declare blocker outside of createWindow function
let views = [];
async function askPrompt() {
  return prompt({
    title: "Enter URL",
    label: "URL:",
    value: "https://google.com",
    type: "input",
  }).then((r) => {
    if (r === null) {
      console.log("user cancelled");
      return null;
    } else {
      return r;
    }
  });
}

async function createWindow() {
  // Only create a new blocker if one doesn't already exist
  if (!blocker) {
    try {
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: "engine.bin",
        read: fs.readFile,
        write: fs.writeFile,
      });
    } catch (err) {
      dialog.showErrorBox("Error", "Cannot fetch block list.");
      console.log(err);
      return;
    }
  }

  // Reuse existing window if it exists
  if (!win) {
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
  }

  // Create initial tab
  const url = await askPrompt();
  url ? createTab(url) : app.quit();

  updateMenu(); // Initial menu setup
  if (store.get("adBlockerState") === true) {
    blocker.enableBlockingInSession(session.defaultSession);
  }
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

let activeViewIndex = 0;
let downloadItem;
function createTab(url) {
  if (views.length >= 5) {
    dialog.showErrorBox("Error", "Cannot open more than 5 tabs.");
    return;
  }

  const view = new BrowserView();
  const size = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
  view.setAutoResize({ width: true, height: true });
  win.setBrowserView(view);
  view.webContents.loadURL(url);
  views.push(view);

  activeViewIndex = views.length - 1; // Update the active view index here

  updateMenu(); // Update the menu after adding a tab
  win.on("enter-full-screen", () => {
    const size = win.getSize();
    for (let view of views) {
      view.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
    }
  });

  win.on("leave-full-screen", () => {
    const size = win.getContentSize();
    for (let view of views) {
      view.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
    }
  });

  view.webContents.on("page-title-updated", (event, title) => {
    win.setTitle(title);
    updateMenu();
  });

  view.webContents.session.on("will-download", (event, item, webContents) => {
    downloadItem = item; // Store the download item

    // Create a new progress bar
    let progressBar = new ProgressBar({
      indeterminate: false,
      text: "Downloading...",
      detail: "Wait...",
    });
    progressBar
      .on("completed", function () {
        progressBar.detail = "Task completed. Exiting...";
      })
      .on("aborted", function (value) {
        console.info(`Progress bar closed at ${value}`);
        dialog.showMessageBox({
          title: "Progress Bar Closed",
          message: "Please use menu to track progress!",
        });
      })
      .on("progress", function (value) {
        progressBar.detail = `Downloaded ${value.toFixed(
          2,
        )} out of ${progressBar
          .getOptions()
          .maxValue.toFixed(
            2,
          )}...\n To pause or cancel download check the menu!`;
      });

    item.on("updated", (event, state) => {
      if (state === "interrupted") {
        dialog.showMessageBox({
          type: "info",
          title: "Info",
          message: "Download is interrupted but can be resumed",
        });
      } else if (state === "progressing") {
        if (item.isPaused()) {
          progressBar.detail =
            "Download paused. Check the menu to resume or cancel.";
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
        }
      }
    });

    item.once("done", (event, state) => {
      if (state === "completed") {
        progressBar.setCompleted();
        let downloadHistory = store.get("downloadHistory") || [];
        downloadHistory.push({
          url: item.getURL(),
          filename: item.getFilename(),
          fileSize: item.getTotalBytes(),
        });
        store.set("downloadHistory", downloadHistory);
      } else {
        dialog.showErrorBox("Error", `Download failed: ${state}`);
        progressBar.close();
      }
    });
  });

  view.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error(
      "Oops! Something went wrong!",
      "Error Code: " + errorCode + " : " + errorDescription,
    );
  });

  return view;
}

function closeTab(index) {
  if (index >= views.length || !views[index]) {
    dialog.showErrorBox("Error", "No tab to close at index " + index);
    return;
  }

  const view = views[index];

  if (!(view instanceof BrowserView)) {
    console.log("Not a BrowserView at index", index);
    return;
  }

  try {
    view.webContents.destroy();
    views.splice(index, 1);
    updateMenu(); // Update the menu after closing a tab

    // Update the active view index here
    if (activeViewIndex === index) {
      activeViewIndex = views.length > 0 ? views.length - 1 : 0;
    } else if (activeViewIndex > index) {
      activeViewIndex--;
    }
  } catch (error) {
    console.error("Error when destroying view:", error);
  }
}

function changeTab(index) {
  if (index >= views.length) {
    console.log("No tab to change to at index", index);
    return;
  }
  const view = views[index];
  const size = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
  win.setBrowserView(views[index]);
  const title = view.webContents.getTitle();
  win.setTitle(title);
  activeViewIndex = index; // Update the active view index here
}

function updateMenu() {
  const tabsMenu = views.map((view, index) => ({
    label: `${view.webContents.getTitle()}`,
    accelerator:
      process.platform === "darwin"
        ? `Command+${index + 1}`
        : `Ctrl+${index + 1}`,
    click() {
      changeTab(index);
    },
  }));
  const tabsCloseMenu = views.map((view, index) => ({
    label: `Tab ${index + 1}`,
    click() {
      closeTab(index);
    },
  }));
  const template = [
    {
      label: "Menu",
      submenu: [
        {
          label: "Change URL",
          accelerator: process.platform === "darwin" ? "Command+N" : "Ctrl+N",
          click: async () => {
            const r = await askPrompt();
            const view = views[activeViewIndex];
            r ? view.webContents.loadURL(r) : console.log("user cancelled");
          },
        },
        {
          label: "Tabs",
          submenu: [
            {
              label: "Add Tab",
              accelerator:
                process.platform === "darwin" ? "Command+T" : "Ctrl+T",
              click: async () => {
                const r = await askPrompt();
                r ? createTab(r) : null;
              },
            },
            {
              label: "Close Tab",
              submenu: tabsCloseMenu,
            },
            {
              label: "Switch to Tab",
              submenu: tabsMenu,
            },
          ],
        },
        {
          label: "Adblocker",
          submenu: [
            {
              label: "Enable",
              type: "radio",
              checked: store.get("adBlockerState"),
              click(menuItem) {
                if (!store.get("adBlockerState")) {
                  blocker.enableBlockingInSession(session.defaultSession);
                  store.set("adBlockerState", !store.get("adBlockerState"));
                }
              },
            },
            {
              label: "Disable",
              type: "radio",
              checked: !store.get("adBlockerState"),
              click(menuItem) {
                if (store.get("adBlockerState")) {
                  blocker.disableBlockingInSession(session.defaultSession);
                  store.set("adBlockerState", !store.get("adBlockerState"));
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
              accelerator: process.platform === "darwin" ? "Command+J" : "Ctrl+J",
              click() {
                let downloadHistory = store.get("downloadHistory");
                let message = "Download History:\n";
                downloadHistory.forEach((download, index) => {
                  message += `${index + 1}. ${download.filename} (${(
                    download.fileSize /
                    (1000 * 1000)
                  ).toFixed(2)}MB)\n`;
                });

                dialog
                  .showMessageBox({
                    type: "info",
                    title: "Download History",
                    message: message,
                    buttons: ["OK", "Copy URL"],
                  })
                  .then((result) => {
                    if (result.response === 1) {
                      // If 'Copy URL' button is clicked
                      // Create an options object for the dropdown menu
                      let options = {};
                      downloadHistory.forEach((download, index) => {
                        options[index] = `${download.filename} (${(
                          download.fileSize /
                          (1000 * 1000)
                        ).toFixed(2)}MB)`;
                      });

                      prompt({
                        title: "Copy URL",
                        label: "Select a download:",
                        type: "select",
                        selectOptions: options,
                      }).then((result) => {
                        if (result !== null) {
                          let index = parseInt(result);
                          clipboard.writeText(downloadHistory[index].url);
                        }
                      });
                    }
                  });
              },
            },
            {
              label: "Pause/Resume Download",
              click() {
                if (downloadItem) {
                  if (downloadItem.isPaused()) {
                    downloadItem.resume();
                  } else {
                    downloadItem.pause();
                  }
                }
              },
            },
            {
              label: "Show Progress",
              click() {
                let progress =
                  (downloadItem.getReceivedBytes() /
                    downloadItem.getTotalBytes()) *
                  100;
                dialog.showMessageBox({
                  title: "Current Progress",
                  message: `${progress.toFixed(
                    2,
                  )}% Completed \n Reopen to track new progress! `,
                });
              },
            },
            {
              label: "Cancel Download",
              click() {
                if (downloadItem) {
                  downloadItem.cancel();
                }
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
                  message: `Version: 0.0.5!\nThis is a browser developed by UnknownVPS using Electron.`,
                  buttons: ["OK"],
                });
              },
            },
          ],
        },
        {
          label: "Quit",
          accelerator: process.platform === "darwin" ? "Command+Q" : "Ctrl+Q",
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
          label: "Screenshot (Clipboard)",
          click() {
            const view = views[activeViewIndex];
            view.webContents.capturePage().then((image) => {
              clipboard.writeImage(image);
            });
          },
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click() {
            const view = views[activeViewIndex];
            view
              ? view.webContents.reload()
              : dialog.showErrorBox("Error", "Load a Tab first");
          },
        },
        {
          label: "Toggle Full Screen",
          accelerator: process.platform === "darwin" ? "Ctrl+Command+F" : "F11", // Shortcut key
          click: () => {
            win.setAutoHideMenuBar(win.isFullScreen());
            win.setMenuBarVisibility(!win.isFullScreen());
            win.setFullScreen(!win.isFullScreen());
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator:
            process.platform === "darwin" ? "Command+Alt+I" : "Ctrl+Shift+I",
          click() {
            const view = views[activeViewIndex];
            view.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: "Navigate",
      submenu: [
        {
          label: "Back",
          accelerator: process.platform === "darwin" ? "Command+[" : "Alt+Left",
          click() {
            const view = views[activeViewIndex];
            view.webContents.goBack();
          },
        },
        {
          label: "Forward",
          accelerator:
            process.platform === "darwin" ? "Command+]" : "Alt+Right",
          click() {
            const view = views[activeViewIndex];
            view.webContents.goForward();
          },
        },
      ],
    },
    {
      type: "separator",
    },
    {
      label: "Tabs:",
    },
  ];
  if (views.length >= 1) {
    for (let index = 0; index < views.length; index++) {
      template.push({
        label: tabsMenu[index].label.substring(0, 10),
        click() {
          changeTab(index);
        },
      });

      template.push({
        label: "×",
        click() {
          closeTab(index);
        },
      });

      template.push({
        type: "separator",
      });
    }
  }
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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

