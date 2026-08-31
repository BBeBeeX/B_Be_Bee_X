//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
//#endregion
//#region ../../packages/kernel/src/fiber-state.ts
var import_electron = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { spawnSync } = require("child_process");
	var fs = require("fs");
	var path = require("path");
	var pathFile = path.join(__dirname, "path.txt");
	function downloadElectron() {
		console.log("Downloading Electron binary...");
		if (spawnSync(process.execPath, [path.join(__dirname, "install.js")], { stdio: "inherit" }).status !== 0) throw new Error("Electron failed to install correctly. Please delete `node_modules/electron` and run \"npx install-electron --no\" manually.");
	}
	/**
	* Fetches the path to the Electron executable to use in development mode.
	* If the executable is missing, attempt to download it first.
	*
	* @returns the path to the Electron executable to run
	*/
	function getElectronPath() {
		let executablePath;
		if (fs.existsSync(pathFile)) executablePath = fs.readFileSync(pathFile, "utf-8");
		if (process.env.ELECTRON_OVERRIDE_DIST_PATH) return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || "electron");
		if (executablePath) {
			const fullPath = path.join(__dirname, "dist", executablePath);
			if (!fs.existsSync(fullPath)) downloadElectron();
			return fullPath;
		} else {
			try {
				downloadElectron();
			} catch {
				throw new Error("Electron failed to install correctly. Please delete `node_modules/electron` and run \"npx install-electron --no\" manually.");
			}
			executablePath = fs.readFileSync(pathFile, "utf-8");
			return path.join(__dirname, "dist", executablePath);
		}
	}
	module.exports = getElectronPath();
})))();
new RegExp(`([?&](?:${[
	...[
		"token",
		"access_token",
		"refresh_token",
		"password",
		"passwd",
		"pwd",
		"passphrase",
		"secret",
		"authorization",
		"auth",
		"cookie",
		"set-cookie",
		"api_key",
		"apikey",
		"session",
		"credential",
		"private_key",
		"privatekey",
		"code_verifier",
		"client_secret",
		"signature"
	],
	"code",
	"key",
	"sig",
	"state"
].join("|")})=)[^&\\s]+`, "gi");
//#endregion
//#region ../../packages/core-desktop-bridge/src/protocol.ts
/**
* The wire format between the Electron renderer and main.
*
* Deliberately mechanical: a service name, a method name, and JSON-ish
* arguments. No domain concept crosses this boundary — `main` does not learn
* what a track is (docs/02 §2).
*/
/** IPC channel names. One per shape of call, not one per method. */
var CH = {
	/** `(service, method, args) => result` */
	call: "BBeBee:call",
	/** `(uri, range) => handle` — opens a chunked read. */
	streamOpen: "BBeBee:stream:open",
	/** `(handle) => Uint8Array | null` — null ends the stream. */
	streamPull: "BBeBee:stream:pull",
	streamClose: "BBeBee:stream:close",
	/** `() => token` — begins a db transaction that later calls join. */
	txBegin: "BBeBee:tx:begin",
	txEnd: "BBeBee:tx:end"
};
//#endregion
//#region preload/index.ts
/**
* The preload bridge.
*
* Exposes one frozen object, `window.BBeBee`, carrying only what the renderer
* genuinely cannot do for itself. Every method is mechanical — no domain
* concepts cross this boundary (docs/02 §2).
*/
var api = {
	paths: { get: (kind) => import_electron.ipcRenderer.invoke("paths:get", kind) },
	shell: { openExternal: (url) => import_electron.ipcRenderer.invoke("shell:openExternal", url) },
	dialog: { pickDirectory: () => import_electron.ipcRenderer.invoke("dialog:pickDirectory") },
	platform: process.platform,
	versions: {
		electron: process.versions.electron,
		node: process.versions.node
	}
};
import_electron.contextBridge.exposeInMainWorld("BBeBee", api);
/**
* The core-service bridge.
*
* Separate from `BBeBee` above because it is machinery, not app surface: the
* renderer's `ctx.fs`/`ctx.db` forward through here. Still only mechanical
* calls — no domain concept crosses (docs/02 §2).
*/
import_electron.contextBridge.exposeInMainWorld("BBeBeeBridge", {
	call: (service, method, args, token) => import_electron.ipcRenderer.invoke(CH.call, service, method, args, token),
	streamOpen: (uri, range) => import_electron.ipcRenderer.invoke(CH.streamOpen, uri, range),
	streamPull: (handle) => import_electron.ipcRenderer.invoke(CH.streamPull, handle),
	streamClose: (handle) => import_electron.ipcRenderer.invoke(CH.streamClose, handle),
	txBegin: () => import_electron.ipcRenderer.invoke(CH.txBegin),
	txEnd: (token, commit) => import_electron.ipcRenderer.invoke(CH.txEnd, token, commit)
});
//#endregion
