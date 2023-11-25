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

let { adblockerEnabled } = store.get("adBlockerState")
  ? store.get("adBlockerState")
  : true;

let blocker; // Declare blocker outside of createWindow function
let views = [];
async function askPrompt() {
  return prompt({
    title: "Enter URL",
    label: "URL:",
    value: "https://google.com",
    inputAttrs: {
      type: "url",
    },
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

  activeViewIndex = index; // Update the active view index here
}

function updateMenu() {
  const tabsMenu = views.map((view, index) => ({
    label: `Tab ${index + 1}`,
    accelerator: process.platform === "darwin" ? `Command+${index + 1}` : `Ctrl+${index + 1}`,
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
              message: `Version: 0.0.4!\nThis is a browser developed by UnknownVPS using Electron.`,
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
