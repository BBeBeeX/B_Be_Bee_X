import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createReadStream, createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import { statfs } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
// -- CommonJS Shims --
import __cjs_mod__ from "node:module";
import.meta.filename;
const __dirname = import.meta.dirname;
__cjs_mod__.createRequire(import.meta.url);
//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
//#endregion
//#region ../../node_modules/.pnpm/cosmokit@1.8.1/node_modules/cosmokit/lib/index.mjs
var import_electron = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { spawnSync } = __require("child_process");
	var fs = __require("fs");
	var path = __require("path");
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
function isNullable(value) {
	return value === null || value === void 0;
}
function defineProperty(object, key, value) {
	return Object.defineProperty(object, key, {
		writable: true,
		value,
		enumerable: false
	});
}
function is(type, value) {
	if (arguments.length === 1) return (value2) => is(type, value2);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
((Binary2) => {
	Binary2.is = isArrayBufferLike;
	Binary2.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary2.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary2.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary2.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary2.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
function tokenize(source, delimiters, delimiter) {
	const output = [];
	let state = 0;
	for (let i = 0; i < source.length; i++) {
		const code = source.charCodeAt(i);
		if (code >= 65 && code <= 90) {
			if (state === 1) {
				const next = source.charCodeAt(i + 1);
				if (next >= 97 && next <= 122) output.push(delimiter);
				output.push(code + 32);
			} else {
				if (state !== 0) output.push(delimiter);
				output.push(code + 32);
			}
			state = 1;
		} else if (code >= 97 && code <= 122) {
			output.push(code);
			state = 2;
		} else if (delimiters.includes(code)) {
			if (state !== 0) output.push(delimiter);
			state = 0;
		} else output.push(code);
	}
	return String.fromCharCode(...output);
}
function paramCase(source) {
	return tokenize(source, [45, 95], 45);
}
var hyphenate = paramCase;
var Time;
((Time2) => {
	Time2.millisecond = 1;
	Time2.second = 1e3;
	Time2.minute = Time2.second * 60;
	Time2.hour = Time2.minute * 60;
	Time2.day = Time2.hour * 24;
	Time2.week = Time2.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time2.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time2.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time2.minute - offset) / 1440);
	}
	Time2.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time2.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time2.minute);
	}
	Time2.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
	}
	Time2.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time2.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
		else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
		else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
		else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
		return ms + "ms";
	}
	Time2.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time2.toDigits = toDigits;
	function template(template2, time = /* @__PURE__ */ new Date()) {
		return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time2.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../node_modules/.pnpm/cordis@4.0.0-rc.9/node_modules/cordis/lib/index.js
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", {
	value,
	configurable: true
});
var DisposableList = class {
	static {
		__name(this, "DisposableList");
	}
	sn = 0;
	map = /* @__PURE__ */ new Map();
	weak = /* @__PURE__ */ new WeakMap();
	get length() {
		return this.map.size;
	}
	push(value) {
		const sn = ++this.sn;
		this.map.set(sn, value);
		this.weak.set(value, sn);
		return () => this.map.delete(sn);
	}
	delete(value) {
		const sn = this.weak.get(value);
		if (!sn) return false;
		return this.map.delete(sn);
	}
	clear() {
		const values = [...this.map.values()];
		this.map.clear();
		return values.reverse();
	}
	[Symbol.iterator]() {
		return this.map.values();
	}
	[/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
		return [...this];
	}
};
var symbols = {
	shadow: /* @__PURE__ */ Symbol.for("cordis.shadow"),
	caller: /* @__PURE__ */ Symbol.for("cordis.caller"),
	receiver: /* @__PURE__ */ Symbol.for("cordis.receiver"),
	original: /* @__PURE__ */ Symbol.for("cordis.original"),
	metadata: /* @__PURE__ */ Symbol.for("cordis.metadata"),
	initHooks: /* @__PURE__ */ Symbol.for("cordis.initHooks"),
	checkProto: /* @__PURE__ */ Symbol.for("cordis.checkProto"),
	effect: /* @__PURE__ */ Symbol.for("cordis.effect"),
	filter: /* @__PURE__ */ Symbol.for("cordis.filter"),
	isolate: /* @__PURE__ */ Symbol.for("cordis.isolate"),
	intercept: /* @__PURE__ */ Symbol.for("cordis.intercept"),
	init: /* @__PURE__ */ Symbol.for("cordis.init"),
	check: /* @__PURE__ */ Symbol.for("cordis.check"),
	config: /* @__PURE__ */ Symbol.for("cordis.config"),
	invoke: /* @__PURE__ */ Symbol.for("cordis.invoke"),
	extend: /* @__PURE__ */ Symbol.for("cordis.extend"),
	tracker: /* @__PURE__ */ Symbol.for("cordis.tracker"),
	resolveConfig: /* @__PURE__ */ Symbol.for("cordis.resolveConfig")
};
var GeneratorFunction = function* () {}.constructor;
var AsyncGeneratorFunction = async function* () {}.constructor;
function isConstructor(func) {
	if (!func.prototype) return false;
	if (func instanceof GeneratorFunction) return false;
	if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction) return false;
	return true;
}
__name(isConstructor, "isConstructor");
function joinPrototype(proto1, proto2) {
	if (proto1 === Object.prototype) return proto2;
	const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
	for (const key of Reflect.ownKeys(proto1)) Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
	return result;
}
__name(joinPrototype, "joinPrototype");
function isObject(value) {
	return value && (typeof value === "object" || typeof value === "function");
}
__name(isObject, "isObject");
function getPropertyDescriptor(target, prop) {
	let proto = target;
	while (proto) {
		const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
		if (desc) return desc;
		proto = Object.getPrototypeOf(proto);
	}
}
__name(getPropertyDescriptor, "getPropertyDescriptor");
function getTraceable(ctx, value) {
	if (!isObject(value)) return value;
	if (Object.hasOwn(value, symbols.shadow)) return Object.getPrototypeOf(value);
	const tracker = value[symbols.tracker];
	if (!tracker) return value;
	return createTraceable(ctx, value, tracker);
}
__name(getTraceable, "getTraceable");
function withProps(target, props) {
	if (!props) return target;
	return new Proxy(target, {
		get: /* @__PURE__ */ __name((target2, prop, receiver) => {
			if (prop in props && prop !== "constructor") return Reflect.get(props, prop, receiver);
			return Reflect.get(target2, prop, receiver);
		}, "get"),
		set: /* @__PURE__ */ __name((target2, prop, value, receiver) => {
			if (prop in props && prop !== "constructor") return Reflect.set(props, prop, value, receiver);
			return Reflect.set(target2, prop, value, receiver);
		}, "set")
	});
}
__name(withProps, "withProps");
function withProp(target, prop, value) {
	return withProps(target, Object.defineProperty(/* @__PURE__ */ Object.create(null), prop, {
		value,
		writable: false
	}));
}
__name(withProp, "withProp");
function createShadow(ctx, target, property, receiver) {
	if (!property) return receiver;
	const origin = getPropertyDescriptor(target, property)?.value;
	if (!origin) return receiver;
	return withProp(receiver, property, ctx.extend({ [symbols.shadow]: origin }));
}
__name(createShadow, "createShadow");
function createShadowMethod(ctx, value, outer, shadow) {
	return new Proxy(value, { apply: /* @__PURE__ */ __name((target, thisArg, args) => {
		if (thisArg === outer) thisArg = shadow;
		return getTraceable(ctx, Reflect.apply(target, thisArg, args));
	}, "apply") });
}
__name(createShadowMethod, "createShadowMethod");
function createTraceable(ctx, value, tracker) {
	const caller = ctx[symbols.shadow] ?? ctx;
	if (ctx[symbols.shadow]) ctx = Object.getPrototypeOf(ctx);
	const proxy = new Proxy(value, {
		get: /* @__PURE__ */ __name((target, prop, receiver) => {
			if (prop === symbols.original) return target;
			if (prop === symbols.caller) return caller;
			if (prop === tracker.property) return ctx;
			if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
			if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
			let shadow, innerValue;
			const desc = getPropertyDescriptor(target, prop);
			if (desc && "value" in desc) innerValue = desc.value;
			else {
				shadow = createShadow(ctx, target, tracker.property, receiver);
				innerValue = Reflect.get(target, prop, shadow);
			}
			const innerTracker = innerValue?.[symbols.tracker];
			if (innerTracker) return createTraceable(ctx, innerValue, innerTracker);
			else if (!tracker.noShadow && typeof innerValue === "function") {
				shadow ??= createShadow(ctx, target, tracker.property, receiver);
				return createShadowMethod(ctx, innerValue, receiver, shadow);
			} else return innerValue;
		}, "get"),
		set: /* @__PURE__ */ __name((target, prop, value2, receiver) => {
			if (prop === symbols.original) return false;
			if (prop === symbols.caller) return false;
			if (prop === tracker.property) return false;
			if (typeof prop === "symbol") return Reflect.set(target, prop, value2, receiver);
			if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.set(ctx, `${tracker.associate}.${prop}`, value2, withProp(ctx, symbols.receiver, receiver));
			const shadow = createShadow(ctx, target, tracker.property, receiver);
			return Reflect.set(target, prop, value2, shadow);
		}, "set"),
		apply: /* @__PURE__ */ __name((target, thisArg, args) => {
			return applyTraceable(tracker.noShadow ? proxy : createShadow(ctx, target, tracker.property, proxy), target, thisArg, args);
		}, "apply")
	});
	return proxy;
}
__name(createTraceable, "createTraceable");
function applyTraceable(proxy, value, thisArg, args) {
	if (!value[symbols.invoke]) return Reflect.apply(value, thisArg, args);
	return value[symbols.invoke].apply(proxy, args);
}
__name(applyTraceable, "applyTraceable");
function createCallable(name, proto, tracker) {
	const self = /* @__PURE__ */ __name(function(...args) {
		const proxy = createTraceable(self["ctx"], self, tracker);
		return Reflect.apply(proxy, this, args);
	}, "self");
	defineProperty(self, "name", name);
	return Object.setPrototypeOf(self, proto);
}
__name(createCallable, "createCallable");
function handleError(info, reason, getOuterStack) {
	const innerLines = info.error.stack.split("\n");
	if (typeof reason?.stack !== "string") {
		const outerError = new Error(reason);
		const lines2 = outerError.stack.split("\n");
		lines2.splice(1, Infinity, ...getOuterStack());
		outerError.stack = lines2.join("\n");
		throw outerError;
	}
	const lines = reason.stack.split("\n");
	let index = lines.indexOf(innerLines[2]);
	if (index === -1) throw reason;
	index -= info.offset;
	while (index > 0) {
		if (!lines[index - 1].endsWith(" (<anonymous>)")) break;
		index -= 1;
	}
	lines.splice(index, Infinity, ...getOuterStack());
	reason.stack = lines.join("\n");
	throw reason;
}
__name(handleError, "handleError");
function composeError(callback, getOuterStack = buildOuterStack()) {
	const info = {
		offset: 1,
		error: /* @__PURE__ */ new Error()
	};
	try {
		const result = callback(info);
		if (isObject(result) && "then" in result) return result.then(void 0, (reason) => handleError(info, reason, getOuterStack));
		else return result;
	} catch (reason) {
		handleError(info, reason, getOuterStack);
	}
}
__name(composeError, "composeError");
function buildOuterStack(offset = 0) {
	const outerError = /* @__PURE__ */ new Error();
	return () => outerError.stack.split("\n").slice(3 + offset);
}
__name(buildOuterStack, "buildOuterStack");
function isBailed(value) {
	return value !== null && value !== false && value !== void 0;
}
__name(isBailed, "isBailed");
var EventsService = class {
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
		this.on("internal/listener", function(name, listener, options) {
			if (name === "internal/update" && !options.global) return (this.fiber._hooks["internal/update"] ??= new DisposableList())[options.prepend ? "unshift" : "push"](listener);
		});
		this.on("internal/update", function(config, noSave, next) {
			const cbs = [...this._hooks["internal/update"] || []];
			const _next = /* @__PURE__ */ __name(() => {
				return (cbs.shift() ?? next).call(this, config, noSave, _next);
			}, "_next");
			return _next();
		}, {
			global: true,
			prepend: true
		});
	}
	ctx;
	static {
		__name(this, "EventsService");
	}
	_hooks = /* @__PURE__ */ Object.create(null);
	_resolve(type, args) {
		const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
		const name = args.shift();
		if ((typeof name !== "string" || !name.startsWith("internal/")) && this._hooks["internal/dispatch"]?.length) this.emit("internal/dispatch", type, name, args, thisArg);
		const filter = thisArg?.[Context.filter];
		return [thisArg, (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map((hook) => hook.callback)];
	}
	/** @deprecated */
	dispatch(type, args) {
		const [thisArg, callbacks] = this._resolve(type, args);
		return callbacks.map((callback) => callback.bind(thisArg));
	}
	async parallel(...args) {
		const [thisArg, callbacks] = this._resolve("emit", args);
		const errors = (await Promise.allSettled(callbacks.map(async (callback) => Reflect.apply(callback, thisArg, args)))).filter((result) => result.status === "rejected");
		if (errors.length) throw new AggregateError(errors.map((error) => error.reason));
	}
	emit(...args) {
		const [thisArg, callbacks] = this._resolve("emit", args);
		for (const callback of callbacks) Reflect.apply(callback, thisArg, args);
	}
	async serial(...args) {
		const [thisArg, callbacks] = this._resolve("serial", args);
		for (const callback of callbacks) {
			const result = await Reflect.apply(callback, thisArg, args);
			if (isBailed(result)) return result;
		}
	}
	bail(...args) {
		const [thisArg, callbacks] = this._resolve("bail", args);
		for (const callback of callbacks) {
			const result = Reflect.apply(callback, thisArg, args);
			if (isBailed(result)) return result;
		}
	}
	waterfall(...args) {
		const [thisArg, callbacks] = this._resolve("waterfall", args);
		const inner = args.pop();
		const next = /* @__PURE__ */ __name(() => {
			const callback = callbacks.shift();
			return callback ? Reflect.apply(callback, thisArg, args) : inner(...args);
		}, "next");
		args.push(next);
		return next();
	}
	register(label, name, callback, options) {
		const method = options.prepend ? "unshift" : "push";
		return this.ctx.fiber.effect(() => {
			(this._hooks[name] ??= [])[method]({
				ctx: this.ctx,
				callback,
				...options
			});
			return () => this.unregister(name, callback);
		}, label);
	}
	unregister(name, callback) {
		const hooks = this._hooks[name];
		if (!hooks) return;
		const index = hooks.findIndex((hook) => hook.callback === callback);
		if (index >= 0) {
			hooks.splice(index, 1);
			if (!hooks.length) delete this._hooks[name];
			return true;
		}
	}
	on(name, listener, options) {
		if (typeof options !== "object") options = { prepend: options };
		this.ctx.fiber.assertActive();
		listener = this.ctx.reflect.bind(listener);
		const result = this.bail(this.ctx, "internal/listener", name, listener, options);
		if (result) return result;
		const label = `ctx.on(${typeof name === "string" ? JSON.stringify(name) : name.toString()})`;
		return this.register(label, name, listener, options);
	}
	once(name, listener, options) {
		const dispose = this.on(name, function(...args) {
			dispose();
			return listener.apply(this, args);
		}, options);
		return dispose;
	}
};
var defaultFormatters = {
	s: /* @__PURE__ */ __name((value) => String(value), "s"),
	d: /* @__PURE__ */ __name((value) => Math.trunc(Number(value)), "d"),
	i: /* @__PURE__ */ __name((value) => Math.trunc(Number(value)), "i"),
	f: /* @__PURE__ */ __name((value) => Number(value), "f"),
	o: /* @__PURE__ */ __name((value) => JSON.stringify(value), "o"),
	O: /* @__PURE__ */ __name((value) => JSON.stringify(value), "O"),
	c: /* @__PURE__ */ __name(() => "", "c"),
	C: /* @__PURE__ */ __name((value, exporter, message) => {
		return Logger.color(exporter, Logger.code(message.name, exporter.colors), value);
	}, "C")
};
function isAggregateError(error) {
	return error instanceof Error && Array.isArray(error["errors"]);
}
__name(isAggregateError, "isAggregateError");
var Logger = class {
	constructor(options, service) {
		this.service = service;
		Object.assign(this, options);
		this.error = this._method("error", 0);
		this.info = this._method("info", 2);
		this.warn = this._method("warn", 1);
		this.debug = this._method("debug", 3);
	}
	service;
	static {
		__name(this, "Logger");
	}
	static color(exporter, code, value, decoration = "") {
		if (!exporter.colors) return "" + value;
		return `\x1B[3${code < 8 ? code : "8;5;" + code}${exporter.colors >= 2 ? decoration : ""}m${value}\x1B[0m`;
	}
	static code(name, level) {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = (hash << 3) - hash + name.charCodeAt(i) + 13;
			hash |= 0;
		}
		const colors = !level ? [] : level >= 2 ? c256 : c16;
		return colors[Math.abs(hash) % colors.length];
	}
	static format(exporter, message) {
		const args = message.args.slice();
		if (args[0] instanceof Error) {
			args[0] = args[0].stack || args[0].message;
			args.unshift("%s");
		} else if (typeof args[0] !== "string") args.unshift("%o");
		let format = args.shift();
		format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
			if (match === "%%") return "%";
			const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
			if (typeof formatter === "function") return formatter(args.shift(), exporter, message);
			return match;
		});
		const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
		for (let arg of args) {
			if (typeof arg === "object" && arg) arg = oFormatter(arg, exporter, message);
			format += " " + arg;
		}
		const { maxLength = 10240 } = exporter;
		return format.split(/\r?\n/g).map((line) => {
			return line.slice(0, maxLength) + (line.length > maxLength ? "..." : "");
		}).join("\n");
	}
	_method(type, level) {
		return (...args) => {
			if (args.length === 1 && args[0] instanceof Error) {
				if (args[0].cause) this[type](args[0].cause);
				else if (isAggregateError(args[0])) {
					args[0].errors.forEach((error) => this[type](error));
					return;
				}
			}
			const sn = ++this.service._snMessage;
			const ts = Date.now();
			for (const exporter of this.service.exporters.values()) {
				if ((exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 2) < level) continue;
				const message = {
					sn,
					ts,
					type,
					level,
					name: this.name,
					...this.meta,
					args
				};
				exporter.export(message);
			}
		};
	}
};
var c16 = [
	6,
	2,
	3,
	4,
	5,
	1
];
var c256 = [
	20,
	21,
	26,
	27,
	32,
	33,
	38,
	39,
	40,
	41,
	42,
	43,
	44,
	45,
	56,
	57,
	62,
	63,
	68,
	69,
	74,
	75,
	76,
	77,
	78,
	79,
	80,
	81,
	92,
	93,
	98,
	99,
	112,
	113,
	129,
	134,
	135,
	148,
	149,
	160,
	161,
	162,
	163,
	164,
	165,
	166,
	167,
	168,
	169,
	170,
	171,
	172,
	173,
	178,
	179,
	184,
	185,
	196,
	197,
	198,
	199,
	200,
	201,
	202,
	203,
	204,
	205,
	206,
	207,
	208,
	209,
	214,
	215,
	220,
	221
];
var LoggerService = class _LoggerService {
	static {
		__name(this, "LoggerService");
	}
	bufferSize = 1e3;
	buffer = [];
	ctx;
	_snMessage = 0;
	_snExporter = 0;
	exporters = /* @__PURE__ */ new Map();
	constructor(ctx) {
		const tracker = {
			property: "ctx",
			noShadow: true
		};
		const self = createCallable("logger", joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
		Object.assign(self, this);
		self.ctx = ctx;
		defineProperty(self, symbols.tracker, tracker);
		self.exporter({
			colors: 3,
			export: /* @__PURE__ */ __name((message) => {
				self.buffer.push(message);
				const overflow = self.buffer.length - self.bufferSize;
				if (overflow === 1) self.buffer.shift();
				else if (overflow > 1) self.buffer.splice(0, overflow);
			}, "export")
		});
		return self;
	}
	exporter(exporter) {
		return this.ctx.effect(() => {
			const id = ++this._snExporter;
			this.exporters.set(id, exporter);
			return () => this.exporters.delete(id);
		}, "ctx.logger.exporter()");
	}
	_resolveConfig() {
		let intercept = this.ctx[symbols.intercept];
		const configs = [];
		while ("logger" in intercept) {
			if (Object.hasOwn(intercept, "logger")) configs.unshift(intercept["logger"]);
			intercept = Object.getPrototypeOf(intercept);
		}
		return Object.assign({}, ...configs);
	}
	[symbols.invoke](name) {
		const config = this._resolveConfig();
		const fiber = (this[symbols.caller] ?? this.ctx).fiber;
		name ??= config.name;
		name ??= hyphenate(fiber.name);
		return new Logger({
			name,
			level: config.level,
			meta: { fiber: new WeakRef(fiber) }
		}, this);
	}
	static {
		for (const type of [
			"error",
			"info",
			"warn",
			"debug"
		]) _LoggerService.prototype[type] = function(...args) {
			return this()[type](...args);
		};
	}
};
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
var ValidationError = class extends TypeError {
	static {
		__name(this, "ValidationError");
	}
	name = "ValidationError";
	constructor(issues) {
		super(`invalid config:
` + issues.map((issue) => {
			if (issue.path) return `  - ${issue.message} (at ${issue.path.join(".")})`;
			else return `  - ${issue.message}`;
		}).join("\n"));
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
function resolveConfig(runtime, config) {
	if (!runtime.Config) return config;
	const result = runtime.Config["~standard"].validate(config);
	if ("then" in result) throw new TypeError("Async config validation is not supported");
	if (result.issues) throw new ValidationError(result.issues);
	else return result.value;
}
__name(resolveConfig, "resolveConfig");
var CordisError = class _CordisError extends Error {
	constructor(code, message) {
		super(message ?? _CordisError.Code[code]);
		this.code = code;
	}
	code;
	static {
		__name(this, "CordisError");
	}
};
((CordisError2) => {
	CordisError2.Code = { INACTIVE_EFFECT: "cannot create effect on inactive context" };
})(CordisError || (CordisError = {}));
var INACTIVE = "__INACTIVE__";
var Fiber = class {
	constructor(parent, config, inject, runtime, getOuterStack) {
		this.parent = parent;
		this.inject = inject;
		this.runtime = runtime;
		const collect = /* @__PURE__ */ __name((dispose) => {
			this._disposables.push(dispose);
		}, "collect");
		if (runtime) {
			this.uid = parent.registry.counter;
			this.ctx = this.context = parent.extend({ fiber: this });
			const injectEntries = Object.entries(this.inject);
			if (injectEntries.length) {
				this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
				for (const [name, config2] of injectEntries) {
					if (isNullable(config2)) continue;
					this.ctx[Context.intercept][name] = config2;
				}
			}
			this._runner = {
				epoch: INACTIVE,
				getOuterStack,
				execute: /* @__PURE__ */ __name(function() {
					if (isConstructor(runtime.callback)) {
						const instance = new runtime.callback(this.ctx, this.config);
						for (const hook of instance?.[symbols.initHooks] ?? []) hook();
						return instance?.[symbols.init]?.();
					} else return runtime.callback(this.ctx, this.config);
				}, "execute"),
				collect
			};
			this.context.emit("internal/plugin", this);
			for (const name of Object.keys(this.inject)) this._checkImpl(name);
			this.dispose = parent.fiber.effect(() => {
				const remove = runtime.fibers.push(this);
				try {
					this.config = resolveConfig(runtime, config);
					this._refresh();
				} catch (error) {
					this.ctx.logger.error(error);
					this._error = error;
				}
				return async () => {
					this.uid = null;
					this.context.emit("internal/plugin", this);
					if (this.ctx.registry.has(runtime.callback)) {
						remove();
						if (!runtime.fibers.length) this.ctx.registry.delete(runtime.callback);
					}
					this._setEpoch(INACTIVE);
					while (this.inertia) await this.inertia;
				};
			}, "ctx.plugin()");
		} else {
			this.uid = 0;
			this.ctx = this.context = parent;
			this.state = 2;
			this.store = /* @__PURE__ */ Object.create(null);
			this._runner = {
				epoch: "",
				getOuterStack,
				execute: /* @__PURE__ */ __name(() => {}, "execute"),
				collect
			};
			this.dispose = () => this.restart();
		}
	}
	parent;
	inject;
	runtime;
	static {
		__name(this, "Fiber");
	}
	uid;
	ctx;
	config;
	state = 0;
	dispose;
	store;
	inertia;
	_hooks = /* @__PURE__ */ Object.create(null);
	_disposables = new DisposableList();
	context;
	_error;
	_runner;
	_store = /* @__PURE__ */ Object.create(null);
	get name() {
		let fiber = this;
		do {
			if (fiber.runtime?.name) return fiber.runtime.name;
			fiber = fiber.parent.fiber;
		} while (fiber !== fiber.parent.fiber);
		return "root";
	}
	assertActive() {
		if (this.uid !== null) return;
		throw new CordisError("INACTIVE_EFFECT");
	}
	_execute(runner) {
		const oldEpoch = runner.epoch;
		return composeError((info) => {
			const safeCollect = /* @__PURE__ */ __name((dispose) => {
				if (typeof dispose === "function") runner.collect(dispose);
				else if (!isNullable(dispose)) throw new TypeError("Invalid effect");
			}, "safeCollect");
			const effect = runner.execute.call(this);
			if (typeof effect === "function") return runner.collect(effect);
			else if (isNullable(effect)) {} else if (!isObject(effect)) throw new TypeError("Invalid effect");
			else if ("then" in effect) return effect.then(safeCollect);
			else if (Symbol.iterator in effect) {
				info.error = /* @__PURE__ */ new Error();
				const iter = effect[Symbol.iterator]();
				while (true) {
					const result = iter.next();
					safeCollect(result.value);
					if (result.done) return;
				}
			} else if (Symbol.asyncIterator in effect) {
				const iter = effect[Symbol.asyncIterator]();
				return (async () => {
					await Promise.resolve();
					info.error = /* @__PURE__ */ new Error();
					while (true) {
						if (runner.epoch !== oldEpoch) return;
						const result = await iter.next();
						safeCollect(result.value);
						if (result.done) return;
					}
				})();
			} else throw new TypeError("Invalid effect");
		}, runner.getOuterStack);
	}
	effect(execute, label = "anonymous") {
		this.assertActive();
		const disposables = [];
		const dispose = /* @__PURE__ */ __name(() => {
			let task2;
			for (const dispose2 of disposables.splice(0).reverse()) if (task2) task2 = task2.then(dispose2);
			else {
				const result = dispose2();
				if (isObject(result) && "then" in result) task2 = result;
			}
			return task2;
		}, "dispose");
		const meta = {
			label,
			children: []
		};
		const runner = {
			execute,
			epoch: true,
			collect: /* @__PURE__ */ __name((dispose2) => {
				disposables.push(dispose2);
				this._disposables.delete(dispose2);
				if (dispose2[symbols.effect]) meta.children.push(dispose2[symbols.effect]);
			}, "collect"),
			getOuterStack: buildOuterStack()
		};
		let task;
		try {
			task = this._execute(runner);
		} catch (reason) {
			dispose();
			throw reason;
		}
		task?.catch(dispose).catch((error) => this.ctx.logger.error(error));
		const wrapper = defineProperty(() => {
			if (!runner.epoch) return;
			runner.epoch = false;
			return task ? task.then(dispose) : dispose();
		}, symbols.effect, meta);
		const disposeAsync = /* @__PURE__ */ __name(() => {
			if (!runner.epoch) return;
			runner.epoch = false;
			return dispose();
		}, "disposeAsync");
		wrapper.then = async (onFulfilled, onRejected) => {
			return Promise.resolve(task).then(() => disposeAsync).then(onFulfilled, onRejected);
		};
		disposables.push(this._disposables.push(wrapper));
		return wrapper;
	}
	getEffects() {
		return [...this._disposables].map((dispose) => dispose[symbols.effect]).filter(Boolean);
	}
	_getState() {
		if (this.uid === null) return 4;
		if (this._error) return 3;
		if (this._runner.epoch !== INACTIVE) return 2;
		return 0;
	}
	_updateState(callback) {
		const oldState = this.state;
		this.state = callback() ?? this._getState();
		if (oldState === this.state) return;
		this.context.emit("internal/status", this, oldState);
		if (oldState !== 2 && this.state !== 2) return;
		for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
			const impl = this.ctx.reflect.store[key];
			if (impl.fiber !== this) continue;
			this.ctx.reflect.notify([impl.name]);
		}
	}
	_checkImpl(name) {
		const impl = this.ctx.reflect._getImpl(name, true);
		if (!impl) return delete this._store[name];
		try {
			if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) return delete this._store[name];
		} catch (error) {
			impl.fiber.ctx.logger.error(error);
			return delete this._store[name];
		}
		this._store[name] = impl;
	}
	_refresh() {
		let epoch = false;
		epoch = "";
		for (const name of Object.keys(this.inject)) {
			const impl = this._store[name];
			if (!impl) {
				epoch = INACTIVE;
				break;
			}
			epoch += ":" + impl.fiber.uid;
		}
		this._setEpoch(epoch);
	}
	_setEpoch(epoch) {
		const oldEpoch = this._runner.epoch;
		if (epoch === oldEpoch) return;
		if (this._error) return;
		this._runner.epoch = epoch;
		if (this.inertia) return;
		this._updateState(() => {
			if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
				this.inertia = this._reload();
				return 1;
			} else {
				this.inertia = this._unload();
				return 5;
			}
		});
	}
	async _reload() {
		this.store = { ...this._store };
		const oldEpoch = this._runner.epoch;
		try {
			await Promise.resolve();
			await this._execute(this._runner);
		} catch (reason) {
			this.ctx.logger.error(reason);
			this._error = reason;
			this._runner.epoch = INACTIVE;
		}
		this._updateState(() => {
			if (this._runner.epoch === oldEpoch) this.inertia = void 0;
			else {
				this.inertia = this._unload();
				return 5;
			}
		});
	}
	async _unload() {
		await Promise.all(this._disposables.clear().map(async (dispose) => {
			try {
				await composeError(async (info) => {
					await Promise.resolve();
					info.error = /* @__PURE__ */ new Error();
					await dispose();
				}, this._runner.getOuterStack);
			} catch (reason) {
				this.ctx.logger.error(reason);
			}
		}));
		this.store = void 0;
		this._updateState(() => {
			if (this._runner.epoch === INACTIVE) this.inertia = void 0;
			else {
				this.inertia = this._reload();
				return 1;
			}
		});
	}
	async await() {
		while (this.inertia) await this.inertia;
		if (this._error) throw this._error;
		return this;
	}
	async restart() {
		const fiber = this.ctx.fiber;
		fiber.assertActive();
		fiber._setEpoch(INACTIVE);
		fiber._refresh();
		await fiber.await();
	}
	update(config, noSave = false) {
		const fiber = this.ctx.fiber;
		fiber.assertActive();
		config = resolveConfig(fiber.runtime, config);
		fiber.context.waterfall(fiber, "internal/update", config, noSave, () => {
			fiber.config = config;
			fiber._error = void 0;
			return fiber.restart();
		});
	}
};
function enhanceError(error) {
	const lines = error.stack.split("\n");
	lines.splice(0, 2, `Error: ${error.message}`);
	error.stack = lines.join("\n");
	return error;
}
__name(enhanceError, "enhanceError");
var RESERVED_WORDS = ["prototype", "then"];
function isSpecialProperty(prop) {
	return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");
}
__name(isSpecialProperty, "isSpecialProperty");
var ReflectService = class {
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
		this.mixin("reflect", [
			"get",
			"set",
			"provide",
			"accessor",
			"mixin"
		]);
		this.mixin("fiber", ["runtime", "effect"]);
		this.mixin("registry", ["inject", "plugin"]);
		this.mixin("events", [
			"on",
			"once",
			"parallel",
			"emit",
			"serial",
			"bail",
			"waterfall"
		]);
	}
	ctx;
	static {
		__name(this, "ReflectService");
	}
	static handler = {
		get: /* @__PURE__ */ __name((target, prop, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
			if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
			const error = /* @__PURE__ */ new Error(`cannot get property "${prop}" without inject`);
			try {
				const def = target.reflect.props[prop];
				if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
				if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false);
				return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
					const key = target[symbols.isolate][prop];
					let fiber = (ctx[symbols.shadow] ?? ctx).fiber;
					while (true) {
						const impl = fiber.store?.[prop];
						if (impl) return getTraceable(ctx, impl.value);
						if (prop in fiber.inject) {
							error.message = `cannot get required service "${prop}" in inactive context`;
							throw error;
						}
						if (!fiber.runtime) throw error;
						if (fiber.parent[symbols.isolate][prop] !== key) throw error;
						fiber = fiber.parent.fiber;
					}
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		}, "get"),
		set: /* @__PURE__ */ __name((target, prop, value, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
			const error = /* @__PURE__ */ new Error(`cannot set property "${prop}" without provide`);
			const def = target.reflect.props[prop];
			if (!def) {
				if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
				throw enhanceError(error);
			}
			try {
				if (def.type === "accessor") {
					if (!def.set) return false;
					return def.set.call(ctx, value, ctx[symbols.receiver], error);
				}
				return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
					return ctx.reflect.set(prop, value, error);
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		}, "set"),
		has: /* @__PURE__ */ __name((target, prop) => {
			if (isSpecialProperty(prop)) return Reflect.has(target, prop);
			if (Reflect.has(target, prop)) return true;
			return !!target.reflect.props[prop];
		}, "has")
	};
	store = /* @__PURE__ */ Object.create(null);
	props = /* @__PURE__ */ Object.create(null);
	get(name, strict = true) {
		return getTraceable(this.ctx, this._getImpl(name, strict)?.value);
	}
	_getImpl(name, strict = true) {
		const key = this.ctx[symbols.isolate][name];
		const impl = key && this.store[key];
		if (!impl) return;
		if (strict && impl.fiber.state !== 2) return;
		return impl;
	}
	set(name, value, error) {
		const key = this.ctx[symbols.isolate][name];
		const impl = this.store[key];
		if (!impl) throw new Error(`cannot set property "${name}" without provide`);
		if (impl.fiber !== this.ctx.fiber) throw new Error(`cannot set property "${name}" in multiple fibers`);
		impl.value = value;
		return true;
	}
	provide(name, value, check) {
		return this.ctx.fiber.effect(() => {
			if (!this.props[name]) this.props[name] ??= { type: "service" };
			else if (this.props[name].type !== "service") throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
			this.props[name] = { type: "service" };
			this.ctx.root[symbols.isolate][name] ??= Symbol(name);
			const key = this.ctx[symbols.isolate][name];
			const impl = {
				name,
				value,
				fiber: this.ctx.fiber,
				check
			};
			if (this.store[key]) throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
			this.store[key] = impl;
			this.ctx.fiber.store[name] = impl;
			if (this.ctx.fiber.state === 2) this.notify([name]);
			return async () => {
				delete this.store[key];
				const fibers = this.notify([name]);
				await Promise.allSettled(fibers.map((fiber) => fiber.await()));
				delete this.ctx.fiber.store[name];
			};
		}, `ctx.provide(${JSON.stringify(name)})`);
	}
	notify(names, filter = (ctx, name) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
		const fibers = [];
		for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
			let hasUpdate = false;
			for (const name of names) {
				if (!(name in fiber.inject)) continue;
				if (!filter(fiber.ctx, name)) continue;
				hasUpdate = true;
				fiber._checkImpl(name);
			}
			if (!hasUpdate) continue;
			fiber._refresh();
			fibers.push(fiber);
		}
		for (const name of names) {
			const self = Object.create(this.ctx);
			self[symbols.filter] = (target) => filter(target, name);
			this.ctx.events.emit(self, "internal/service", name, this._getImpl(name, false)?.value);
		}
		return fibers;
	}
	accessor(name, options) {
		return this.ctx.fiber.effect(() => {
			if (name in this.props) throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
			this.props[name] = {
				type: "accessor",
				...options
			};
			return () => delete this.props[name];
		}, `ctx.accessor(${JSON.stringify(name)})`);
	}
	mixin(source, mixins) {
		const self = this;
		return this.ctx.fiber.effect(function* () {
			const entries = Array.isArray(mixins) ? mixins.map((key) => [key, key]) : Object.entries(mixins);
			const getTarget = /* @__PURE__ */ __name((ctx, error) => {
				return ctx[source];
			}, "getTarget");
			for (const [key, value] of entries) yield self.accessor(value, {
				get(receiver, error) {
					const service = getTarget(this, error);
					if (isNullable(service)) return service;
					const mixin = receiver ? withProps(receiver, service) : service;
					const value2 = Reflect.get(service, key, mixin);
					if (typeof value2 !== "function") return value2;
					return value2.bind(mixin ?? service);
				},
				set(value2, receiver, error) {
					const service = getTarget(this, error);
					const mixin = receiver ? withProps(receiver, service) : service;
					return Reflect.set(service, key, value2, mixin);
				}
			});
		}, `ctx.mixin(${JSON.stringify(source)})`);
	}
	trace(value) {
		return getTraceable(this.ctx, value);
	}
	bind(callback) {
		return new Proxy(callback, {
			apply: /* @__PURE__ */ __name((target, thisArg, args) => {
				return Reflect.apply(target, this.trace(thisArg), args.map((arg) => this.trace(arg)));
			}, "apply"),
			construct: /* @__PURE__ */ __name((target, args, newTarget) => {
				return Reflect.construct(target, args.map((arg) => this.trace(arg)), newTarget);
			}, "construct")
		});
	}
};
function isApplicable(object) {
	return object && typeof object === "object" && typeof object.apply === "function";
}
__name(isApplicable, "isApplicable");
function Inject(name, config) {
	return function(value, decorator) {
		if (decorator.kind === "class") {
			if (!Object.hasOwn(value, "inject")) {
				defineProperty(value, "inject", Object.create(Object.getPrototypeOf(value).inject ?? null));
				defineProperty(value.inject, symbols.checkProto, true);
			}
			value.inject[name] = config;
		} else if (decorator.kind === "method") {
			const inject = (value[symbols.metadata] ??= {}).inject ??= /* @__PURE__ */ Object.create(null);
			inject[name] = config;
			decorator.addInitializer(function() {
				const property = this[symbols.tracker]?.property;
				(this[symbols.initHooks] ??= []).push(() => {
					this.ctx.inject(inject, (ctx) => {
						return value.call(property ? withProps(this, { [property]: ctx }) : this);
					});
				});
			});
		} else throw new Error("@Inject() can only be used on class or class methods");
	};
}
__name(Inject, "Inject");
((Inject2) => {
	function resolve(inject, result = /* @__PURE__ */ Object.create(null)) {
		if (!inject) return result;
		if (Array.isArray(inject)) for (const name of inject) result[name] = null;
		else if (Reflect.has(inject, symbols.checkProto)) {
			Object.assign(result, resolve(Object.getPrototypeOf(inject)));
			for (const name of Object.keys(inject)) result[name] = inject[name] ?? null;
		} else for (const name of Object.keys(inject)) result[name] = inject[name] ?? null;
		return result;
	}
	Inject2.resolve = resolve;
	__name(resolve, "resolve");
})(Inject || (Inject = {}));
var RegistryService = class {
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
	}
	ctx;
	static {
		__name(this, "RegistryService");
	}
	_counter = 0;
	_internal = /* @__PURE__ */ new Map();
	get counter() {
		return ++this._counter;
	}
	get size() {
		return this._internal.size;
	}
	resolve(plugin) {
		try {
			if (typeof plugin === "function") return plugin;
			if (isApplicable(plugin)) return plugin.apply;
		} catch {}
	}
	get(plugin) {
		const key = this.resolve(plugin);
		return key && this._internal.get(key);
	}
	has(plugin) {
		const key = this.resolve(plugin);
		return !!key && this._internal.has(key);
	}
	delete(plugin) {
		const key = this.resolve(plugin);
		const runtime = key && this._internal.get(key);
		if (!runtime) return;
		this._internal.delete(key);
		for (const fiber of runtime.fibers) fiber.dispose();
		return runtime;
	}
	keys() {
		return this._internal.keys();
	}
	values() {
		return this._internal.values();
	}
	entries() {
		return this._internal.entries();
	}
	forEach(callback) {
		return this._internal.forEach(callback);
	}
	inject(inject, callback) {
		return this.plugin({
			inject,
			apply: callback,
			name: callback.name
		});
	}
	plugin(plugin, config, getOuterStack = buildOuterStack()) {
		const callback = this.resolve(plugin);
		if (!callback) throw new Error("invalid plugin, expect function or object with an \"apply\" method, received " + typeof plugin);
		this.ctx.fiber.assertActive();
		let runtime = this._internal.get(callback);
		if (!runtime) {
			let name = plugin.name;
			if (name === "apply") name = void 0;
			runtime = {
				name,
				callback,
				fibers: new DisposableList(),
				Config: plugin.Config
			};
			this._internal.set(callback, runtime);
		}
		const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
		const wrapped = Object.create(fiber);
		wrapped.then = (onFulfilled, onRejected) => {
			return fiber.await().then(onFulfilled, onRejected);
		};
		return wrapped;
	}
};
var Context = class _Context {
	static {
		__name(this, "Context");
	}
	static effect = symbols.effect;
	static filter = symbols.filter;
	static isolate = symbols.isolate;
	static intercept = symbols.intercept;
	static is(value) {
		return !!value?.[_Context.is];
	}
	static {
		_Context.is[Symbol.toPrimitive] = () => /* @__PURE__ */ Symbol.for("cordis.is");
		_Context.prototype[_Context.is] = true;
	}
	constructor() {
		this[symbols.isolate] = /* @__PURE__ */ Object.create(null);
		this[symbols.intercept] = /* @__PURE__ */ Object.create(null);
		const self = new Proxy(this, ReflectService.handler);
		this.root = self;
		this.baseUrl = void 0;
		this.fiber = new Fiber(self, {}, /* @__PURE__ */ Object.create(null), null, () => []);
		this.reflect = new ReflectService(self);
		this.registry = new RegistryService(self);
		this.events = new EventsService(self);
		this.logger = new LoggerService(self);
		this.fiber._disposables.clear();
		return self;
	}
	[/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
		return `Context <${this.fiber.name}>`;
	}
	extend(meta = {}) {
		const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
		const self = Object.create(getTraceable(this, this));
		for (const prop of Reflect.ownKeys(meta)) Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
		if (!shadow) return self;
		return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
	}
	isolate(name, label) {
		const shadow = Object.create(this[symbols.isolate]);
		shadow[name] = label ?? Symbol(name);
		return this.extend({ [symbols.isolate]: shadow });
	}
	intercept(name, config) {
		const intercept = Object.create(this[symbols.intercept]);
		intercept[name] = config;
		return this.extend({ [symbols.intercept]: intercept });
	}
};
var Service = class _Service {
	constructor(ctx, name) {
		this.ctx = ctx;
		name ??= this.constructor["provide"];
		let self = this;
		const tracker = {
			associate: name,
			property: "ctx"
		};
		if (self[symbols.invoke]) self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
		self.ctx = ctx;
		self.name = name;
		defineProperty(self, symbols.tracker, tracker);
		self.ctx.reflect.provide(name, self, this[symbols.check]);
		return self;
	}
	ctx;
	static {
		__name(this, "Service");
	}
	static init = symbols.init;
	static check = symbols.check;
	static config = symbols.config;
	static invoke = symbols.invoke;
	static extend = symbols.extend;
	static tracker = symbols.tracker;
	static resolveConfig = symbols.resolveConfig;
	name;
	[symbols.filter](ctx) {
		return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
	}
	[symbols.extend](props) {
		let self;
		if (this[_Service.invoke]) self = createCallable(this.name, this, this[symbols.tracker]);
		else self = Object.create(this);
		return Object.assign(self, props);
	}
	[symbols.resolveConfig](base, head) {
		let intercept = this.ctx[Context.intercept];
		const configs = [];
		while (this.name in intercept) {
			if (Object.hasOwn(intercept, this.name)) configs.unshift(intercept[this.name]);
			intercept = Object.getPrototypeOf(intercept);
		}
		if (base) configs.unshift(base);
		if (head) configs.push(head);
		if (this["Config"]?.merge) return this["Config"].merge(...configs);
		else return Object.assign({}, ...configs);
	}
	static [Symbol.hasInstance](instance) {
		if (!instance) return false;
		let constructor = instance.constructor;
		while (constructor) {
			constructor = constructor.prototype?.constructor;
			if (constructor === this) return true;
			constructor &&= Object.getPrototypeOf(constructor);
		}
		return false;
	}
};
//#endregion
//#region ../../packages/protocol/src/common.ts
/**
* Whether `uri` is `base` or lies inside it, respecting segment boundaries.
*
* A bare `uri.startsWith(base)` is wrong for containment: `…/BBeBee-backup`
* starts with `…/BBeBee` without being inside it. That mistake in a capability
* check reads as "this file is in your own directory" for a sibling directory
* that is emphatically not, so this helper is the only correct way to ask.
*/
function uriContains(base, uri) {
	const root = base.endsWith("/") ? base.slice(0, -1) : base;
	return uri === root || uri.startsWith(`${root}/`);
}
/**
* The directory name for a plugin's private data.
*
* Sanitising alone is lossy — `plugin/x` and `plugin_x` both reduce to
* `plugin_x` — and two plugins sharing a data directory is both a correctness
* bug and, since the fs gate keys `own` on this path, a capability bug: each
* would be inside the other's "own" scope.
*
* So the readable part is kept for legibility and a short hash of the *exact*
* id is appended to make it injective. Unlike the database's namespace
* registry there is nothing to collide against at registration time, so the
* name has to carry the distinction itself.
*/
function pluginDirName(pluginId) {
	return `${pluginId.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 48)}-${shortHash(pluginId)}`;
}
/**
* A short, stable, non-cryptographic hash. FNV-1a over two lanes, 16 hex
* chars — enough to separate the handful of plugin ids on one device.
*/
function shortHash(value) {
	let a = 2166136261;
	let b = 1525692326;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		a = Math.imul((a ^ code) >>> 0, 16777619) >>> 0;
		b = Math.imul((b ^ code + 1) >>> 0, 16777619) >>> 0;
	}
	return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
/** Raised when a plugin attempts something its manifest did not declare. */
var CapabilityError = class extends Error {
	capability;
	name = "CapabilityError";
	constructor(capability, message) {
		super(message ?? `missing capability: ${capability}`);
		this.capability = capability;
	}
};
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
//#region ../../packages/protocol/src/manifest.ts
/** Whether a granted capability set permits an `fs` operation. */
function allowsFs(granted, mode, scope) {
	return granted.some((c) => {
		if (c === `fs:${mode}:all`) return true;
		if (c === `fs:${mode}:${scope}`) return true;
		if (mode === "read" && (c === `fs:write:${scope}` || c === "fs:write:all")) return true;
		return false;
	});
}
//#endregion
//#region ../../packages/core-paths-node/src/index.ts
/**
* `ctx.paths` for Node and Electron.
*
* Trivial as a service, but having it separate is what lets `ctx.fs` stay
* path-agnostic: plugins ask for a well-known directory and join onto it,
* and never learn what a path looks like on the host.
*
* In Electron this is fed by `app.getPath()` through the `resolve` option, so
* the renderer gets the OS's real answers rather than these fallbacks.
* See docs/04-core-services.md §10.
*/
/** Where an app's private data goes, per platform convention. */
function defaultDataRoot(appName) {
	const home = homedir();
	switch (process.platform) {
		case "darwin": return join(home, "Library", "Application Support", appName);
		case "win32": return join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), appName);
		default: return join(process.env["XDG_DATA_HOME"] ?? join(home, ".local", "share"), appName);
	}
}
function defaultCacheRoot(appName) {
	const home = homedir();
	switch (process.platform) {
		case "darwin": return join(home, "Library", "Caches", appName);
		case "win32": return join(process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"), appName, "Cache");
		default: return join(process.env["XDG_CACHE_HOME"] ?? join(home, ".cache"), appName);
	}
}
var toUri = (path) => pathToFileURL(path).href.replace(/\/$/, "");
var PathsNode = class extends Service {
	appData;
	cache;
	temp;
	logs;
	downloads;
	music;
	dataPath;
	constructor(ctx, config = {}) {
		super(ctx, "paths");
		const appName = config.appName ?? "BBeBee";
		const resolve = config.resolve ?? (() => void 0);
		const dataPath = config.root ?? resolve("userData") ?? defaultDataRoot(appName);
		const cachePath = config.root ? join(config.root, "cache") : resolve("cache") ?? defaultCacheRoot(appName);
		this.dataPath = dataPath;
		this.appData = toUri(dataPath);
		this.cache = toUri(cachePath);
		this.temp = toUri(config.root ? join(config.root, "tmp") : resolve("temp") ?? tmpdir());
		this.logs = toUri(resolve("logs") ?? join(dataPath, "logs"));
		this.downloads = toUri(config.root ? join(config.root, "downloads") : resolve("downloads") ?? join(homedir(), "Downloads"));
		const musicPath = config.root ? join(config.root, "music") : resolve("music") ?? join(homedir(), "Music");
		this.music = toUri(musicPath);
	}
	pluginData(pluginId) {
		return toUri(join(this.dataPath, "plugins", pluginDirName(pluginId)));
	}
	get(kind) {
		switch (kind) {
			case "data": return this.appData;
			case "cache": return this.cache;
			case "temp": return this.temp;
			case "logs": return this.logs;
			case "downloads": return this.downloads;
			case "music": return this.music;
			default: return;
		}
	}
};
//#endregion
//#region ../../packages/kernel/src/capability.ts
/** Drop anything that is not a string, so a malformed grant list cannot throw. */
function normalizeGrants(granted) {
	return granted.filter((c) => typeof c === "string");
}
/**
* Read the gate config a service was intercepted with.
*
* Returns `undefined` for an unmediated caller — the kernel itself, a core
* service calling another, or a test harness. Those are trusted.
*/
function capabilityConfigOf(config) {
	if (!config || typeof config !== "object") return void 0;
	const c = config;
	if (typeof c.pluginId !== "string" || !Array.isArray(c.granted)) return void 0;
	return {
		pluginId: c.pluginId,
		instanceId: typeof c.instanceId === "string" ? c.instanceId : c.pluginId,
		granted: normalizeGrants(c.granted)
	};
}
function assertFs(config, mode, scope) {
	const gate = capabilityConfigOf(config);
	if (!gate) return;
	if (!allowsFs(gate.granted, mode, scope)) throw new CapabilityError(`fs:${mode}:${scope}`, `${gate.pluginId} may not ${mode} ${scope} files`);
}
//#endregion
//#region ../../packages/kernel/src/migrations/runner.ts
var MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  namespace  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, version)
)`;
/**
* Records which namespace owns which table prefix.
*
* `nsPrefix` is lossy — it folds `-`, `.`, and `_` to `_`, so `plugin:a-b` and
* `plugin:a.b` both yield `plugin_a_b`. Two such plugins would silently share
* tables, so the mapping is registered and a collision is refused up front.
*/
var NAMESPACES_TABLE = `
CREATE TABLE IF NOT EXISTS schema_namespaces (
  prefix    TEXT PRIMARY KEY,
  namespace TEXT NOT NULL
)`;
/**
* Turn a namespace into a table prefix.
*
* `plugin:@BBeBee/plugin-scrobble` becomes `plugin_bbebee_plugin_scrobble`, so
* ownership is legible when reading the schema.
*
* ⚠️ Lossy by design (readability beats injectivity here). Uniqueness is
* enforced separately against `schema_namespaces` — see `assertPrefixOwner`.
*/
function nsPrefix(namespace) {
	const slug = namespace.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	if (!slug) throw new Error(`namespace ${JSON.stringify(namespace)} produces an empty prefix`);
	return slug;
}
/** Expand `{{ns}}` placeholders in a statement. */
function expandNs(sql, namespace) {
	return sql.replaceAll("{{ns}}", nsPrefix(namespace));
}
/** Escape a value for use in a `LIKE ... ESCAPE '\'` pattern. */
function escapeLike(value) {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
var MigrationError = class extends Error {
	namespace;
	version;
	cause;
	name = "MigrationError";
	constructor(namespace, version, cause) {
		super(`migration ${namespace}@${version} failed: ${String(cause)}`);
		this.namespace = namespace;
		this.version = version;
		this.cause = cause;
	}
};
var NamespaceCollisionError = class extends Error {
	namespace;
	owner;
	prefix;
	name = "NamespaceCollisionError";
	constructor(namespace, owner, prefix) {
		super(`namespace ${JSON.stringify(namespace)} maps to table prefix ${JSON.stringify(prefix)}, which is already owned by ${JSON.stringify(owner)}`);
		this.namespace = namespace;
		this.owner = owner;
		this.prefix = prefix;
	}
};
var MigrationRunner = class {
	db;
	constructor(db) {
		this.db = db;
	}
	async init() {
		await this.db.exec(MIGRATIONS_TABLE);
		await this.db.exec(NAMESPACES_TABLE);
	}
	async appliedVersions(namespace) {
		return (await this.db.query("SELECT version FROM schema_migrations WHERE namespace = ? ORDER BY version", [namespace])).map((r) => Number(r.version));
	}
	/** Claim the prefix for this namespace, or throw if another owns it. */
	async assertPrefixOwner(namespace) {
		const prefix = nsPrefix(namespace);
		const owner = (await this.db.query("SELECT namespace FROM schema_namespaces WHERE prefix = ?", [prefix]))[0]?.namespace;
		if (owner === void 0) await this.db.exec("INSERT INTO schema_namespaces (prefix, namespace) VALUES (?, ?)", [prefix, namespace]);
		else if (owner !== namespace) throw new NamespaceCollisionError(namespace, owner, prefix);
		return prefix;
	}
	/**
	* Apply every migration not yet recorded, in version order.
	*
	* Each migration's statements and its bookkeeping row commit **together**, so
	* an interruption leaves the database exactly at a version boundary.
	*/
	async apply(namespace, migrations) {
		await this.init();
		await this.assertPrefixOwner(namespace);
		const seen = /* @__PURE__ */ new Set();
		for (const m of migrations) {
			if (seen.has(m.version)) throw new Error(`namespace ${namespace} declares version ${m.version} more than once`);
			seen.add(m.version);
		}
		const applied = new Set(await this.appliedVersions(namespace));
		for (const v of applied) if (!seen.has(v)) throw new Error(`database has ${namespace}@${v} applied but this build declares only [${[...seen].sort((a, b) => a - b).join(", ")}]; refusing to run against a newer schema (downgrade unsupported)`);
		const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => !applied.has(m.version));
		for (const migration of pending) {
			const statements = (Array.isArray(migration.up) ? migration.up : [migration.up]).map((s) => expandNs(s, namespace));
			try {
				await this.db.transaction(async (tx) => {
					for (const sql of statements) await tx.exec(sql);
					await tx.exec("INSERT INTO schema_migrations (namespace, version, applied_at) VALUES (?, ?, ?)", [
						namespace,
						migration.version,
						Date.now()
					]);
				});
			} catch (cause) {
				throw new MigrationError(namespace, migration.version, cause);
			}
		}
		return pending.length;
	}
	/**
	* Drop every table belonging to a namespace, plus its bookkeeping rows.
	*
	* Called on uninstall when the user chooses "remove data". Defaulting to
	* *keep* is the safer choice, so this is never automatic.
	*/
	async dropNamespace(namespace) {
		await this.init();
		const prefix = nsPrefix(namespace);
		const tables = (await this.db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ESCAPE '\\'`, [`${escapeLike(prefix)}\\_%`])).map((r) => r.name).filter((name) => name.startsWith(`${prefix}_`));
		await this.db.transaction(async (tx) => {
			await tx.exec("PRAGMA defer_foreign_keys = ON");
			for (const name of tables) await tx.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, "\"\"")}"`);
			await tx.exec("DELETE FROM schema_migrations WHERE namespace = ?", [namespace]);
			await tx.exec("DELETE FROM schema_namespaces WHERE namespace = ?", [namespace]);
		});
		return tables;
	}
};
//#endregion
//#region ../../packages/kernel/src/migrations/core.ts
var CORE_MIGRATIONS = [{
	version: 1,
	up: [
		`CREATE TABLE providers (
        instance_id       TEXT PRIMARY KEY,
        plugin_id         TEXT NOT NULL,
        display_name      TEXT NOT NULL,
        enabled           INTEGER NOT NULL DEFAULT 1,
        capabilities_json TEXT,
        sort_order        INTEGER NOT NULL DEFAULT 0,
        created_at        INTEGER NOT NULL,
        last_seen_at      INTEGER
      )`,
		`CREATE TABLE accounts (
        instance_id    TEXT PRIMARY KEY REFERENCES providers(instance_id) ON DELETE CASCADE,
        remote_user_id TEXT,
        display_name   TEXT,
        status         TEXT NOT NULL,
        expires_at     INTEGER,
        updated_at     INTEGER NOT NULL
      )`,
		`CREATE TABLE cookie_jars (
        name       TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        iv         BLOB NOT NULL,
        key_ref    TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
		`CREATE TABLE artworks (
        id             TEXT PRIMARY KEY,
        source_url     TEXT,
        local_uri      TEXT,
        width          INTEGER,
        height         INTEGER,
        blurhash       TEXT,
        dominant_color TEXT,
        bytes          INTEGER,
        fetched_at     INTEGER
      )`,
		`CREATE INDEX idx_artworks_local ON artworks(local_uri) WHERE local_uri IS NOT NULL`,
		`CREATE TABLE artists (
        urn         TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL REFERENCES providers(instance_id) ON DELETE CASCADE,
        remote_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        sort_name   TEXT,
        artwork_id  TEXT REFERENCES artworks(id),
        bio         TEXT,
        fetched_at  INTEGER NOT NULL,
        raw_json    TEXT
      )`,
		`CREATE INDEX idx_artists_instance ON artists(instance_id)`,
		`CREATE INDEX idx_artists_sort ON artists(sort_name)`,
		`CREATE TABLE albums (
        urn          TEXT PRIMARY KEY,
        instance_id  TEXT NOT NULL REFERENCES providers(instance_id) ON DELETE CASCADE,
        remote_id    TEXT NOT NULL,
        title        TEXT NOT NULL,
        sort_title   TEXT,
        album_type   TEXT,
        release_date TEXT,
        year         INTEGER,
        track_count  INTEGER,
        disc_count   INTEGER,
        artwork_id   TEXT REFERENCES artworks(id),
        is_various   INTEGER NOT NULL DEFAULT 0,
        fetched_at   INTEGER NOT NULL,
        raw_json     TEXT
      )`,
		`CREATE INDEX idx_albums_instance ON albums(instance_id)`,
		`CREATE INDEX idx_albums_year ON albums(year)`,
		`CREATE TABLE tracks (
        urn               TEXT PRIMARY KEY,
        instance_id       TEXT NOT NULL REFERENCES providers(instance_id) ON DELETE CASCADE,
        remote_id         TEXT NOT NULL,
        title             TEXT NOT NULL,
        sort_title        TEXT,
        album_urn         TEXT REFERENCES albums(urn) ON DELETE SET NULL,
        track_no          INTEGER,
        disc_no           INTEGER,
        duration_ms       INTEGER,
        year              INTEGER,
        explicit          INTEGER NOT NULL DEFAULT 0,
        bpm               REAL,
        replay_gain_track REAL,
        replay_gain_album REAL,
        peak_track        REAL,
        available         INTEGER NOT NULL DEFAULT 1,
        qualities_json    TEXT,
        artwork_id        TEXT REFERENCES artworks(id),
        fetched_at        INTEGER NOT NULL,
        raw_json          TEXT
      )`,
		`CREATE INDEX idx_tracks_album ON tracks(album_urn, disc_no, track_no)`,
		`CREATE INDEX idx_tracks_instance ON tracks(instance_id)`,
		`CREATE INDEX idx_tracks_title ON tracks(sort_title)`,
		`CREATE TABLE track_artists (
        track_urn  TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
        artist_urn TEXT NOT NULL REFERENCES artists(urn) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'main',
        ordinal    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (track_urn, artist_urn, role)
      )`,
		`CREATE INDEX idx_track_artists_artist ON track_artists(artist_urn)`,
		`CREATE TABLE album_artists (
        album_urn  TEXT NOT NULL REFERENCES albums(urn) ON DELETE CASCADE,
        artist_urn TEXT NOT NULL REFERENCES artists(urn) ON DELETE CASCADE,
        ordinal    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (album_urn, artist_urn)
      )`,
		`CREATE TABLE genres (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
		`CREATE TABLE track_genres (
        track_urn TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
        genre_id  TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
        PRIMARY KEY (track_urn, genre_id)
      )`,
		`CREATE TABLE external_ids (
        urn       TEXT NOT NULL,
        namespace TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY (urn, namespace, value)
      )`,
		`CREATE INDEX idx_external_lookup ON external_ids(namespace, value)`,
		`CREATE TABLE track_links (
        urn_a      TEXT NOT NULL,
        urn_b      TEXT NOT NULL,
        confidence REAL NOT NULL,
        method     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (urn_a, urn_b),
        CHECK (urn_a < urn_b)
      )`,
		`CREATE INDEX idx_links_b ON track_links(urn_b)`,
		`CREATE TABLE media_bindings (
        id           TEXT PRIMARY KEY,
        track_urn    TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
        uri          TEXT NOT NULL,
        format       TEXT,
        codec        TEXT,
        bitrate_kbps INTEGER,
        sample_rate  INTEGER,
        channels     INTEGER,
        bit_depth    INTEGER,
        size_bytes   INTEGER,
        checksum     TEXT,
        origin       TEXT NOT NULL,
        quality      TEXT,
        verified_at  INTEGER,
        created_at   INTEGER NOT NULL
      )`,
		`CREATE INDEX idx_bindings_track ON media_bindings(track_urn)`,
		`CREATE UNIQUE INDEX idx_bindings_uri ON media_bindings(uri)`,
		`CREATE TABLE scan_roots (
        id            TEXT PRIMARY KEY,
        uri           TEXT NOT NULL UNIQUE,
        recursive     INTEGER NOT NULL DEFAULT 1,
        enabled       INTEGER NOT NULL DEFAULT 1,
        include_globs TEXT,
        exclude_globs TEXT,
        last_scan_at  INTEGER,
        last_error    TEXT
      )`,
		`CREATE TABLE scan_entries (
        uri        TEXT PRIMARY KEY,
        root_id    TEXT NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
        size       INTEGER NOT NULL,
        mtime      INTEGER NOT NULL,
        track_urn  TEXT REFERENCES tracks(urn) ON DELETE SET NULL,
        status     TEXT NOT NULL,
        error      TEXT,
        scanned_at INTEGER NOT NULL
      )`,
		`CREATE INDEX idx_scan_entries_root ON scan_entries(root_id, status)`,
		`CREATE TABLE playlists (
        urn              TEXT PRIMARY KEY,
        instance_id      TEXT REFERENCES providers(instance_id) ON DELETE CASCADE,
        remote_id        TEXT,
        name             TEXT NOT NULL,
        description      TEXT,
        artwork_id       TEXT REFERENCES artworks(id),
        owner            TEXT,
        is_public        INTEGER NOT NULL DEFAULT 0,
        is_smart         INTEGER NOT NULL DEFAULT 0,
        smart_query_json TEXT,
        track_count      INTEGER,
        duration_ms      INTEGER,
        revision         INTEGER NOT NULL DEFAULT 0,
        remote_revision  TEXT,
        sync_state       TEXT NOT NULL DEFAULT 'clean',
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      )`,
		`CREATE TABLE playlist_items (
        id           TEXT PRIMARY KEY,
        playlist_urn TEXT NOT NULL REFERENCES playlists(urn) ON DELETE CASCADE,
        position     TEXT NOT NULL,
        track_urn    TEXT NOT NULL,
        added_at     INTEGER NOT NULL,
        added_by     TEXT,
        note         TEXT
      )`,
		`CREATE INDEX idx_playlist_items ON playlist_items(playlist_urn, position)`,
		`CREATE TABLE library_items (
        urn         TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        added_at    INTEGER NOT NULL,
        pinned      INTEGER NOT NULL DEFAULT 0,
        sort_key    TEXT
      )`,
		`CREATE INDEX idx_library_kind ON library_items(kind, added_at DESC)`,
		`CREATE TABLE collections (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT REFERENCES collections(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        position   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
		`CREATE TABLE collection_items (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        urn           TEXT NOT NULL,
        position      TEXT NOT NULL,
        PRIMARY KEY (collection_id, urn)
      )`,
		`CREATE TABLE queue_items (
        id                  TEXT PRIMARY KEY,
        position            TEXT NOT NULL,
        track_urn           TEXT NOT NULL,
        source_context_json TEXT,
        added_by            TEXT NOT NULL,
        added_at            INTEGER NOT NULL
      )`,
		`CREATE INDEX idx_queue_position ON queue_items(position)`,
		`CREATE TABLE playback_state (
        id               INTEGER PRIMARY KEY CHECK (id = 1),
        current_item_id  TEXT REFERENCES queue_items(id) ON DELETE SET NULL,
        position_ms      INTEGER NOT NULL DEFAULT 0,
        repeat_mode      TEXT NOT NULL DEFAULT 'off',
        shuffle          INTEGER NOT NULL DEFAULT 0,
        shuffle_seed     INTEGER,
        volume           REAL NOT NULL DEFAULT 1.0,
        muted            INTEGER NOT NULL DEFAULT 0,
        output_device_id TEXT,
        device_id        TEXT NOT NULL,
        updated_at       INTEGER NOT NULL
      )`,
		`CREATE TABLE play_history (
        id             TEXT PRIMARY KEY,
        track_urn      TEXT NOT NULL,
        started_at     INTEGER NOT NULL,
        ended_at       INTEGER,
        ms_played      INTEGER NOT NULL DEFAULT 0,
        completed      INTEGER NOT NULL DEFAULT 0,
        skipped        INTEGER NOT NULL DEFAULT 0,
        source_json    TEXT,
        device_id      TEXT,
        scrobble_state TEXT NOT NULL DEFAULT 'none'
      )`,
		`CREATE INDEX idx_history_track ON play_history(track_urn, started_at DESC)`,
		`CREATE INDEX idx_history_time ON play_history(started_at DESC)`,
		`CREATE INDEX idx_history_scrobble ON play_history(scrobble_state) WHERE scrobble_state = 'pending'`,
		`CREATE TABLE track_stats (
        urn            TEXT PRIMARY KEY,
        play_count     INTEGER NOT NULL DEFAULT 0,
        skip_count     INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER,
        rating         INTEGER,
        loved          INTEGER NOT NULL DEFAULT 0
      )`,
		`CREATE TABLE download_policies (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        enabled       INTEGER NOT NULL DEFAULT 1,
        scope_json    TEXT NOT NULL,
        quality       TEXT NOT NULL,
        wifi_only     INTEGER NOT NULL DEFAULT 1,
        max_bytes     INTEGER,
        charging_only INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      )`,
		`CREATE TABLE download_tasks (
        id           TEXT PRIMARY KEY,
        track_urn    TEXT NOT NULL,
        target_uri   TEXT NOT NULL,
        state        TEXT NOT NULL,
        quality      TEXT,
        bytes_done   INTEGER NOT NULL DEFAULT 0,
        bytes_total  INTEGER,
        etag         TEXT,
        resume_token TEXT,
        priority     INTEGER NOT NULL DEFAULT 0,
        attempts     INTEGER NOT NULL DEFAULT 0,
        last_error   TEXT,
        binding_id   TEXT REFERENCES media_bindings(id) ON DELETE SET NULL,
        policy_id    TEXT REFERENCES download_policies(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        finished_at  INTEGER
      )`,
		`CREATE INDEX idx_downloads_state ON download_tasks(state, priority DESC, created_at)`,
		`CREATE UNIQUE INDEX idx_downloads_track ON download_tasks(track_urn) WHERE state != 'done'`,
		`CREATE TABLE effect_chains (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 0,
        scope      TEXT NOT NULL DEFAULT 'global',
        created_at INTEGER NOT NULL
      )`,
		`CREATE UNIQUE INDEX idx_chain_active ON effect_chains(scope) WHERE is_active = 1`,
		`CREATE TABLE effect_nodes (
        chain_id    TEXT NOT NULL REFERENCES effect_chains(id) ON DELETE CASCADE,
        effect_id   TEXT NOT NULL,
        ordinal     INTEGER NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        params_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (chain_id, effect_id)
      )`,
		`CREATE INDEX idx_effect_order ON effect_nodes(chain_id, ordinal)`,
		`CREATE TABLE presets (
        id          TEXT PRIMARY KEY,
        effect_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        params_json TEXT NOT NULL,
        builtin     INTEGER NOT NULL DEFAULT 0
      )`,
		`CREATE TABLE settings (
        key        TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'global',
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, scope)
      )`,
		`CREATE TABLE plugin_records (
        id           TEXT PRIMARY KEY,
        version      TEXT NOT NULL,
        source       TEXT NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        config_json  TEXT,
        install_uri  TEXT,
        integrity    TEXT,
        installed_at INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_error   TEXT,
        fail_count   INTEGER NOT NULL DEFAULT 0
      )`,
		`CREATE TABLE capability_grants (
        plugin_id  TEXT NOT NULL REFERENCES plugin_records(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        granted_by TEXT NOT NULL DEFAULT 'user',
        PRIMARY KEY (plugin_id, capability)
      )`,
		`CREATE TABLE lyrics (
        track_urn    TEXT NOT NULL,
        instance_id  TEXT NOT NULL,
        format       TEXT NOT NULL,
        content      TEXT NOT NULL,
        synced       INTEGER NOT NULL DEFAULT 0,
        offset_ms    INTEGER NOT NULL DEFAULT 0,
        language     TEXT NOT NULL DEFAULT '',
        is_preferred INTEGER NOT NULL DEFAULT 0,
        fetched_at   INTEGER NOT NULL,
        PRIMARY KEY (track_urn, instance_id, language)
      )`,
		`CREATE TABLE cache_entries (
        key            TEXT PRIMARY KEY,
        class          TEXT NOT NULL,
        uri            TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL,
        last_access_at INTEGER NOT NULL,
        expires_at     INTEGER,
        created_at     INTEGER NOT NULL
      )`,
		`CREATE INDEX idx_cache_evict ON cache_entries(class, last_access_at)`
	]
}, {
	version: 2,
	up: [
		`CREATE VIRTUAL TABLE tracks_fts USING fts5(
        title, artist_names, album_title,
        content='', contentless_delete=1,
        tokenize='unicode61 remove_diacritics 2'
      )`,
		`CREATE TABLE tracks_fts_map (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        urn   TEXT NOT NULL UNIQUE REFERENCES tracks(urn) ON DELETE CASCADE
      )`,
		`CREATE INDEX idx_tracks_fts_map_urn ON tracks_fts_map(urn)`
	]
}];
//#endregion
//#region ../../packages/core-fs-node/src/index.ts
/**
* `ctx.fs` for Node and Electron, over `node:fs/promises`.
*
* Runs in the Electron **main** process (or directly, in a Node host or test).
* Per ADR-3 the renderer reaches it through a preload IPC bridge; that proxy
* is a separate thin package implementing the same `FsService`, so this file
* stays the single home of the actual behaviour.
*
* See docs/04-core-services.md §1.
*/
var FsNode = class extends Service {
	static inject = ["paths"];
	canWatch = true;
	constructor(ctx) {
		super(ctx, "fs");
	}
	toPath(uri) {
		if (uri.startsWith("file://")) return fileURLToPath(uri);
		if (uri.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(uri)) return uri;
		throw new TypeError(`not a file uri: ${uri}`);
	}
	toUri(path) {
		return pathToFileURL(path).href.replace(/\/$/, "");
	}
	/**
	* Classify a location so the capability gate can rule on it.
	*
	* Two things this must get right, both of which were wrong before:
	*
	*  1. **Segment boundaries.** `uriContains`, never `startsWith` — otherwise
	*     `…/BBeBee-backup` counts as inside `…/BBeBee` and a plugin granted
	*     `fs:read:own` reads a sibling directory it has no business seeing.
	*  2. **`own` means *this plugin's* own.** Every plugin's data directory
	*     lives under `appData`, so classifying the whole of `appData` as `own`
	*     let any plugin with `fs:read:own` read every other plugin's files —
	*     and `store.json`, which holds every plugin's settings.
	*
	* Anything unrecognised is `all`, which no plugin is granted by default:
	* an unclassifiable path fails closed.
	*/
	scopeOf(uri, gate) {
		const paths = this.ctx.paths;
		if (uriContains(paths.temp, uri)) return "cache";
		if (uriContains(paths.cache, uri)) return "cache";
		if (uriContains(paths.downloads, uri)) return "downloads";
		if (uriContains(paths.logs, uri)) return "logs";
		if (paths.music && uriContains(paths.music, uri)) return "media";
		if (gate) {
			if (uriContains(paths.pluginData(gate.instanceId), uri)) return "own";
			if (uriContains(paths.appData, uri)) return "all";
		}
		if (uriContains(paths.appData, uri)) return "own";
		return "all";
	}
	check(uri, mode) {
		const config = this[Service.resolveConfig]();
		assertFs(config, mode, this.scopeOf(uri, capabilityConfigOf(config)));
	}
	async dir(kind) {
		const uri = this.ctx.paths.get(kind);
		if (!uri) return void 0;
		if (kind === "data" || kind === "cache" || kind === "temp" || kind === "logs") await fsp.mkdir(this.toPath(uri), { recursive: true });
		return uri;
	}
	join(base, ...segments) {
		return this.toUri(join(this.toPath(base), ...segments));
	}
	basename(uri) {
		return basename(this.toPath(uri));
	}
	extname(uri) {
		return extname(this.toPath(uri));
	}
	async exists(uri) {
		this.check(uri, "read");
		try {
			await fsp.access(this.toPath(uri));
			return true;
		} catch (error) {
			const code = error.code;
			if (code === "ENOENT" || code === "ENOTDIR") return false;
			throw error;
		}
	}
	async stat(uri) {
		this.check(uri, "read");
		const path = this.toPath(uri);
		const s = await fsp.stat(path);
		return {
			uri: this.toUri(path),
			name: basename(path),
			isDirectory: s.isDirectory(),
			size: s.size,
			mtime: Math.floor(s.mtimeMs)
		};
	}
	async list(uri) {
		this.check(uri, "read");
		const path = this.toPath(uri);
		const entries = await fsp.readdir(path, { withFileTypes: true });
		const out = [];
		for (const entry of entries) {
			const child = join(path, entry.name);
			try {
				const s = await fsp.stat(child);
				out.push({
					uri: this.toUri(child),
					name: entry.name,
					isDirectory: s.isDirectory(),
					size: s.size,
					mtime: Math.floor(s.mtimeMs)
				});
			} catch {}
		}
		return out;
	}
	async freeSpace(uri) {
		this.check(uri, "read");
		const s = await statfs(this.toPath(uri));
		return Number(s.bavail) * Number(s.bsize);
	}
	async mkdir(uri, opts) {
		this.check(uri, "write");
		await fsp.mkdir(this.toPath(uri), { recursive: opts?.recursive ?? false });
	}
	async remove(uri, opts) {
		this.check(uri, "write");
		const path = this.toPath(uri);
		if (opts?.recursive) {
			await fsp.rm(path, {
				recursive: true,
				force: true
			});
			return;
		}
		if ((await fsp.stat(path)).isDirectory()) await fsp.rmdir(path);
		else await fsp.unlink(path);
	}
	async move(from, to) {
		this.check(from, "write");
		this.check(to, "write");
		const fromPath = this.toPath(from);
		const toPath = this.toPath(to);
		try {
			await fsp.rename(fromPath, toPath);
		} catch (error) {
			if (error.code !== "EXDEV") throw error;
			await fsp.cp(fromPath, toPath, { recursive: true });
			await fsp.rm(fromPath, {
				recursive: true,
				force: true
			});
		}
	}
	async copy(from, to) {
		this.check(from, "read");
		this.check(to, "write");
		await fsp.cp(this.toPath(from), this.toPath(to), { recursive: true });
	}
	async readFile(uri, opts) {
		this.check(uri, "read");
		return (await fsp.readFile(this.toPath(uri), { signal: opts?.signal })).toString(opts?.encoding === "base64" ? "base64" : "utf8");
	}
	async readBytes(uri, opts) {
		this.check(uri, "read");
		const buf = await fsp.readFile(this.toPath(uri), { signal: opts?.signal });
		return new Uint8Array(buf);
	}
	async writeFile(uri, data, opts) {
		this.check(uri, "write");
		const path = this.toPath(uri);
		const payload = typeof data === "string" && opts?.encoding === "base64" ? Buffer.from(data, "base64") : typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
		await fsp.writeFile(path, payload, {
			flag: opts?.append ? "a" : "w",
			signal: opts?.signal
		});
	}
	createReadStream(uri, range) {
		this.check(uri, "read");
		const node = createReadStream(this.toPath(uri), range);
		return Readable.toWeb(node);
	}
	createWriteStream(uri, opts) {
		this.check(uri, "write");
		const node = createWriteStream(this.toPath(uri), { flags: opts?.append ? "a" : "w" });
		return Writable.toWeb(node);
	}
	async watch(uri, cb) {
		this.check(uri, "read");
		const path = this.toPath(uri);
		const controller = new AbortController();
		(async () => {
			try {
				const watcher = fsp.watch(path, {
					signal: controller.signal,
					recursive: false
				});
				for await (const event of watcher) {
					if (!event.filename) continue;
					const child = join(path, event.filename.toString());
					let type = "change";
					if (event.eventType === "rename") type = await fsp.access(child).then(() => "add").catch(() => "unlink");
					cb({
						type,
						uri: this.toUri(child)
					});
				}
			} catch (error) {
				if (error?.name !== "AbortError") this.ctx.logger.warn(`fs.watch failed for ${uri}: ${String(error)}`);
			}
		})();
		return () => controller.abort();
	}
	async pickDirectory() {}
	/** Identity on this platform — a `file://` uri is already playable. */
	async toPlayableUri(uri) {
		return uri;
	}
};
//#endregion
//#region ../../packages/core-db-node/src/index.ts
/**
* `ctx.db` for Node and Electron, over `node:sqlite`.
*
* `node:sqlite` ships with Node 22.12+, which Electron 44 bundles — so there
* is no native module to rebuild against Electron headers on every upgrade,
* which is the single most annoying recurring cost in Electron projects.
*
* See docs/04-core-services.md §5.
*/
var DbNode = class extends Service {
	static inject = ["fs", "paths"];
	db;
	config;
	/** Serialises writes; `node:sqlite` is synchronous but our API is not. */
	queue = Promise.resolve();
	depth = 0;
	closed = false;
	constructor(ctx, config = {}) {
		super(ctx, "db");
		this.config = config;
	}
	async [Service.init]() {
		const fileName = this.config.fileName ?? "BBeBee.db";
		let location = ":memory:";
		if (fileName !== ":memory:") {
			const dir = await this.ctx.fs.dir("data");
			if (!dir) throw new Error("db: no data directory available");
			location = fileURLToPath(this.ctx.fs.join(dir, fileName));
		}
		this.db = new DatabaseSync(location);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (!this.config.skipCoreMigrations) await new MigrationRunner(this).apply("core", CORE_MIGRATIONS);
		return () => this.run(() => {
			this.closed = true;
			this.db.close();
		});
	}
	/**
	* Serialise an operation behind everything already queued.
	*
	* **Never** bypasses, even while a transaction is open. An earlier version
	* short-circuited when `depth > 0` so the transaction callback's own writes
	* could proceed — but it could not tell the callback's writes from an
	* unrelated plugin's, so a concurrent `db.exec()` landed inside the open
	* transaction: it read the transaction's uncommitted rows, and its own
	* write vanished when that transaction rolled back, despite its promise
	* having already resolved successfully.
	*
	* The transaction callback now gets a narrow view (see `transaction`) that
	* talks to the driver directly, so it never re-enters this queue and the
	* bypass is not needed.
	*/
	run(fn) {
		const guarded = () => {
			if (this.closed) throw new Error("db: database is closed");
			return fn();
		};
		const next = this.queue.then(guarded, guarded);
		this.queue = next.catch(() => void 0);
		return next;
	}
	queryNow(sql, params) {
		return this.db.prepare(sql).all(...params);
	}
	getNow(sql, params) {
		return this.db.prepare(sql).get(...params) ?? void 0;
	}
	execNow(sql, params) {
		const result = this.db.prepare(sql).run(...params);
		return {
			changes: Number(result.changes),
			lastInsertRowid: Number(result.lastInsertRowid)
		};
	}
	async query(sql, params = []) {
		return this.run(() => this.queryNow(sql, params));
	}
	async get(sql, params = []) {
		return this.run(() => this.getNow(sql, params));
	}
	async exec(sql, params = []) {
		return this.run(() => this.execNow(sql, params));
	}
	/**
	* Run `fn` atomically.
	*
	* `BEGIN IMMEDIATE` takes the write lock up front rather than upgrading
	* mid-transaction, which is what turns a concurrent writer into an
	* immediate, retryable failure instead of a surprise deadlock.
	*
	* Nesting is expressed on the `tx` argument, not here: `tx.transaction()`
	* joins the transaction already open. A call on the shared service always
	* queues — see below.
	*/
	async transaction(fn) {
		const wasInFlight = this.depth > 0;
		return this.guardNested(this.run(async () => {
			this.db.exec("BEGIN IMMEDIATE");
			this.depth++;
			try {
				const result = await fn(this.txView());
				this.db.exec("COMMIT");
				return result;
			} catch (error) {
				try {
					this.db.exec("ROLLBACK");
				} catch {}
				throw error;
			} finally {
				this.depth--;
			}
		}), wasInFlight);
	}
	/**
	* Turn the one deadlock this design permits into a diagnosable error.
	*
	* Queuing is right for a bystander, but a callback that reaches for the
	* shared `ctx.db.transaction()` instead of its `tx` argument now queues
	* behind the very transaction it is running inside, and waits forever. That
	* is a programming error, and a silent hang is a miserable way to learn it.
	*/
	guardNested(work, wasInFlight) {
		const timeoutMs = this.config.transactionTimeoutMs ?? 3e4;
		if (!wasInFlight || timeoutMs <= 0) return work;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(/* @__PURE__ */ new Error(`db: a transaction has waited ${timeoutMs}ms behind another. If this call came from inside a transaction callback, use the \`tx\` argument rather than ctx.db — the shared service queues and will never run until the outer one finishes. If the outer transaction is genuinely this slow, raise \`transactionTimeoutMs\`.`));
			}, timeoutMs);
			work.then(resolve, reject).finally(() => clearTimeout(timer));
		});
	}
	/**
	* The object handed to a transaction callback.
	*
	* Deliberately *not* `this`: it talks to the driver directly, bypassing the
	* queue that `this` holds for the duration of the transaction. Handing out
	* the shared instance is what let unrelated concurrent calls join the open
	* transaction and lose their writes to its rollback.
	*/
	txView() {
		const view = {
			query: async (sql, params = []) => this.queryNow(sql, params),
			get: async (sql, params = []) => this.getNow(sql, params),
			exec: async (sql, params = []) => this.execNow(sql, params),
			transaction: (inner) => inner(view),
			defineSchema: (namespace, migrations) => new MigrationRunner(asMigrationDb(view)).apply(namespace, migrations).then(() => void 0)
		};
		return view;
	}
	async defineSchema(namespace, migrations) {
		await new MigrationRunner(this).apply(namespace, migrations);
	}
};
/**
* Adapt a `DbService` for `MigrationRunner`.
*
* A migration running inside a transaction view must NOT open a second
* transaction — it is already in one — so `transaction` passes straight
* through rather than issuing another BEGIN.
*/
function asMigrationDb(view) {
	return {
		exec: view.exec.bind(view),
		query: view.query.bind(view),
		transaction: (fn) => fn(view)
	};
}
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
//#region ../../packages/core-desktop-bridge/src/main.ts
/**
* The main-process host.
*
* Runs a headless Cordis context holding the real `core-*-node` services, and
* exposes their methods over IPC. Reusing those services rather than
* reimplementing the operations here is what keeps a single home for the
* behaviour — `main` stays a dispatcher.
*
* Imported only by `apps/desktop/main`, never by the renderer.
*/
/**
* Stand up the services and wire them to IPC.
*
* Every handler is a dispatch. The security boundary is the *service list*:
* only `fs`, `db` and `paths` are reachable, and only by their own methods.
*/
async function createHost(ipc, options = {}) {
	const ctx = new Context();
	await ctx.plugin(PathsNode, {
		appName: options.appName ?? "BBeBee",
		...options.resolvePath ? { resolve: options.resolvePath } : {}
	});
	await ctx.plugin(FsNode);
	await ctx.plugin(DbNode, { fileName: options.databaseFileName ?? "BBeBee.db" });
	const services = {
		fs: () => ctx.fs,
		db: () => ctx.db,
		paths: () => ctx.paths
	};
	ipc.handle(CH.call, async (_event, ...rest) => {
		const [service, method, args, token] = rest;
		const target = services[service]?.();
		if (!target) throw new Error(`bridge: unknown service "${service}"`);
		if (token) {
			const open = transactions.get(token);
			if (!open) throw new Error(`bridge: unknown transaction "${token}"`);
			const fn = open.tx[method];
			if (typeof fn !== "function") throw new Error(`bridge: db has no method "${method}"`);
			return fn.apply(open.tx, args);
		}
		if (service === "paths" && args.length === 0) {
			const value = target[method];
			if (typeof value !== "function") return value;
		}
		const fn = target[method];
		if (typeof fn !== "function") throw new Error(`bridge: ${service} has no method "${method}"`);
		return fn.apply(target, args);
	});
	let nextHandle = 1;
	const readers = /* @__PURE__ */ new Map();
	ipc.handle(CH.streamOpen, async (_event, ...rest) => {
		const [uri, range] = rest;
		const handle = nextHandle++;
		readers.set(handle, ctx.fs.createReadStream(uri, range).getReader());
		return handle;
	});
	ipc.handle(CH.streamPull, async (_event, ...rest) => {
		const [handle] = rest;
		const reader = readers.get(handle);
		if (!reader) throw new Error(`bridge: unknown stream ${handle}`);
		const { done, value } = await reader.read();
		if (done) {
			readers.delete(handle);
			return null;
		}
		return value;
	});
	ipc.handle(CH.streamClose, async (_event, ...rest) => {
		const [handle] = rest;
		await readers.get(handle)?.cancel().catch(() => void 0);
		readers.delete(handle);
	});
	const transactions = /* @__PURE__ */ new Map();
	ipc.handle(CH.txBegin, async () => {
		const token = `tx${nextHandle++}`;
		let started;
		const ready = new Promise((resolve) => {
			started = resolve;
		});
		ctx.db.transaction((tx) => new Promise((resolve, reject) => {
			transactions.set(token, {
				tx,
				finish: (commit) => commit ? resolve() : reject(/* @__PURE__ */ new Error("rollback"))
			});
			started();
		})).catch(() => void 0).finally(() => transactions.delete(token));
		await ready;
		return token;
	});
	ipc.handle(CH.txEnd, async (_event, ...rest) => {
		const [token, commit] = rest;
		const open = transactions.get(token);
		if (!open) throw new Error(`bridge: unknown transaction "${token}"`);
		open.finish(commit);
	});
	return {
		ctx,
		async dispose() {
			for (const channel of Object.values(CH)) ipc.removeHandler(channel);
			for (const reader of readers.values()) await reader.cancel().catch(() => void 0);
			readers.clear();
			for (const open of transactions.values()) open.finish(false);
			transactions.clear();
		}
	};
}
//#endregion
//#region main/index.ts
/**
* Electron main process — a thin native host.
*
* Per ADR-3 the Cordis kernel lives in the **renderer**; this process owns the
* window, the OS, and Node, and contains **no business logic**. It does not
* know what a track is. Every handler here is mechanical and has a direct
* counterpart in an Expo module on the mobile side.
*
* See docs/02-architecture.md §2.
*/
var here = dirname(fileURLToPath(import.meta.url));
function createWindow() {
	const window = new import_electron.BrowserWindow({
		width: 1180,
		height: 760,
		minWidth: 720,
		minHeight: 480,
		backgroundColor: "#0B0B0F",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			preload: join(here, "../preload/index.cjs")
		}
	});
	if (process.env["ELECTRON_RENDERER_URL"]) window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	else window.loadFile(join(here, "../renderer/index.html"));
	window.webContents.setWindowOpenHandler(({ url }) => {
		import_electron.shell.openExternal(url);
		return { action: "deny" };
	});
	return window;
}
/**
* The IPC surface.
*
* Deliberately tiny for M0: `paths` is the only thing the renderer cannot
* work out for itself, since `app.getPath()` is main-only. `fs` and `db` run
* in the renderer for now (see the note in `renderer/boot.ts`); moving them
* behind IPC is a swap of the core plugin, not a change to any feature.
*/
function registerHandlers() {
	import_electron.ipcMain.handle("paths:get", (_event, kind) => {
		try {
			return import_electron.app.getPath(kind);
		} catch {
			return;
		}
	});
	import_electron.ipcMain.handle("shell:openExternal", (_event, url) => import_electron.shell.openExternal(url));
	import_electron.ipcMain.handle("dialog:pickDirectory", async (event) => {
		const window = import_electron.BrowserWindow.fromWebContents(event.sender);
		const result = window ? await import_electron.dialog.showOpenDialog(window, { properties: ["openDirectory"] }) : await import_electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
		return result.canceled ? void 0 : result.filePaths[0];
	});
}
import_electron.app.whenReady().then(async () => {
	registerHandlers();
	await createHost(import_electron.ipcMain, {
		appName: "BBeBee",
		resolvePath: (kind) => {
			try {
				return import_electron.app.getPath(kind);
			} catch {
				return;
			}
		}
	});
	createWindow();
	import_electron.app.on("activate", () => {
		if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
import_electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") import_electron.app.quit();
});
//#endregion
export {};
