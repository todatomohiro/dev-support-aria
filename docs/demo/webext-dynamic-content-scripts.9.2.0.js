(function () {
    'use strict';

    const patternValidationRegex = /^(https?|wss?|file|ftp|\*):\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^file:\/\/\/.*$|^resource:\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^about:/;
    const isFirefox = typeof navigator === 'object' && navigator.userAgent.includes('Firefox/');
    const allStarsRegex = isFirefox
        ? /^(https?|wss?):[/][/][^/]+([/].*)?$/
        : /^https?:[/][/][^/]+([/].*)?$/;
    const allUrlsRegex = /^(https?|file|ftp):[/]+/;
    function getRawPatternRegex(matchPattern) {
        if (!patternValidationRegex.test(matchPattern)) {
            throw new Error(matchPattern + ' is an invalid pattern, it must match ' + String(patternValidationRegex));
        }
        let [, protocol, host, pathname] = matchPattern.split(/(^[^:]+:[/][/])([^/]+)?/);
        protocol = protocol
            .replace('*', isFirefox ? '(https?|wss?)' : 'https?')
            .replace(/[/]/g, '[/]');
        host = (host !== null && host !== void 0 ? host : '')
            .replace(/^[*][.]/, '([^/]+.)*')
            .replace(/^[*]$/, '[^/]+')
            .replace(/[.]/g, '[.]')
            .replace(/[*]$/g, '[^.]+');
        pathname = pathname
            .replace(/[/]/g, '[/]')
            .replace(/[.]/g, '[.]')
            .replace(/[*]/g, '.*');
        return '^' + protocol + host + '(' + pathname + ')?$';
    }
    function patternToRegex(...matchPatterns) {
        if (matchPatterns.length === 0) {
            return /$./;
        }
        if (matchPatterns.includes('<all_urls>')) {
            return allUrlsRegex;
        }
        if (matchPatterns.includes('*://*/*')) {
            return allStarsRegex;
        }
        return new RegExp(matchPatterns.map(x => getRawPatternRegex(x)).join('|'));
    }

    function getManifestPermissionsSync() {
        return _getManifestPermissionsSync(chrome.runtime.getManifest());
    }
    function _getManifestPermissionsSync(manifest) {
        var _a, _b, _c;
        const manifestPermissions = {
            origins: [],
            permissions: [],
        };
        const list = new Set([
            ...((_a = manifest.permissions) !== null && _a !== void 0 ? _a : []),
            ...((_b = manifest.content_scripts) !== null && _b !== void 0 ? _b : []).flatMap(config => { var _a; return (_a = config.matches) !== null && _a !== void 0 ? _a : []; }),
        ]);
        if (manifest.devtools_page
            && !((_c = manifest.optional_permissions) === null || _c === void 0 ? void 0 : _c.includes('devtools'))) {
            list.add('devtools');
        }
        for (const permission of list) {
            if (permission.includes('://')) {
                manifestPermissions.origins.push(permission);
            }
            else {
                manifestPermissions.permissions.push(permission);
            }
        }
        return manifestPermissions;
    }
    const hostRegex = /:[/][/][*.]*([^/]+)/;
    function parseDomain(origin) {
        return origin.split(hostRegex)[1];
    }
    async function getAdditionalPermissions(options) {
        return new Promise(resolve => {
            chrome.permissions.getAll(currentPermissions => {
                const manifestPermissions = getManifestPermissionsSync();
                resolve(_getAdditionalPermissions(manifestPermissions, currentPermissions, options));
            });
        });
    }
    function _getAdditionalPermissions(manifestPermissions, currentPermissions, { strictOrigins = true } = {}) {
        var _a, _b;
        const additionalPermissions = {
            origins: [],
            permissions: [],
        };
        for (const origin of (_a = currentPermissions.origins) !== null && _a !== void 0 ? _a : []) {
            if (manifestPermissions.origins.includes(origin)) {
                continue;
            }
            if (!strictOrigins) {
                const domain = parseDomain(origin);
                const isDomainInManifest = manifestPermissions.origins
                    .some(manifestOrigin => parseDomain(manifestOrigin) === domain);
                if (isDomainInManifest) {
                    continue;
                }
            }
            additionalPermissions.origins.push(origin);
        }
        for (const permission of (_b = currentPermissions.permissions) !== null && _b !== void 0 ? _b : []) {
            if (!manifestPermissions.permissions.includes(permission)) {
                additionalPermissions.permissions.push(permission);
            }
        }
        return additionalPermissions;
    }

    function NestedProxy$1(target) {
    	return new Proxy(target, {
    		get(target, prop) {
    			if (typeof target[prop] !== 'function') {
    				return new NestedProxy$1(target[prop]);
    			}
    			return (...arguments_) =>
    				new Promise((resolve, reject) => {
    					target[prop](...arguments_, result => {
    						if (chrome.runtime.lastError) {
    							reject(new Error(chrome.runtime.lastError.message));
    						} else {
    							resolve(result);
    						}
    					});
    				});
    		},
    	});
    }
    const chromeP$1 = globalThis.chrome && new NestedProxy$1(globalThis.chrome);

    const gotScripting$1 = Boolean(globalThis.chrome?.scripting);
    function castAllFramesTarget(target) {
        if (typeof target === 'object') {
            return { ...target, allFrames: false };
        }
        return {
            tabId: target,
            frameId: undefined,
            allFrames: true,
        };
    }
    function castArray(possibleArray) {
        if (Array.isArray(possibleArray)) {
            return possibleArray;
        }
        return [possibleArray];
    }
    function arrayOrUndefined$1(value) {
        return typeof value === 'undefined' ? undefined : [value];
    }
    async function insertCSS$1({ tabId, frameId, files, allFrames, matchAboutBlank, runAt, }, { ignoreTargetErrors } = {}) {
        const everyInsertion = Promise.all(files.map(async (content) => {
            if (typeof content === 'string') {
                content = { file: content };
            }
            if (gotScripting$1) {
                return chrome.scripting.insertCSS({
                    target: {
                        tabId,
                        frameIds: arrayOrUndefined$1(frameId),
                        allFrames,
                    },
                    files: 'file' in content ? [content.file] : undefined,
                    css: 'code' in content ? content.code : undefined,
                });
            }
            return chromeP$1.tabs.insertCSS(tabId, {
                ...content,
                matchAboutBlank,
                allFrames,
                frameId,
                runAt: runAt ?? 'document_start',
            });
        }));
        if (ignoreTargetErrors) {
            await catchTargetInjectionErrors(everyInsertion);
        }
        else {
            await everyInsertion;
        }
    }
    function assertNoCode(files) {
        if (files.some(content => 'code' in content)) {
            throw new Error('chrome.scripting does not support injecting strings of `code`');
        }
    }
    async function executeScript$1({ tabId, frameId, files, allFrames, matchAboutBlank, runAt, }, { ignoreTargetErrors } = {}) {
        let lastInjection;
        const normalizedFiles = files.map(file => typeof file === 'string' ? { file } : file);
        if (gotScripting$1) {
            assertNoCode(normalizedFiles);
            const injection = chrome.scripting.executeScript({
                target: {
                    tabId,
                    frameIds: arrayOrUndefined$1(frameId),
                    allFrames,
                },
                files: normalizedFiles.map(({ file }) => file),
            });
            if (ignoreTargetErrors) {
                void catchTargetInjectionErrors(injection);
            }
            return;
        }
        for (const content of normalizedFiles) {
            if ('code' in content) {
                await lastInjection;
            }
            lastInjection = chromeP$1.tabs.executeScript(tabId, {
                ...content,
                matchAboutBlank,
                allFrames,
                frameId,
                runAt,
            });
            if (ignoreTargetErrors) {
                void catchTargetInjectionErrors(lastInjection);
            }
        }
    }
    async function getTabsByUrl(matches, excludeMatches) {
        if (matches.length === 0) {
            return [];
        }
        const exclude = excludeMatches ? patternToRegex(...excludeMatches) : undefined;
        const tabs = await chromeP$1.tabs.query({ url: matches });
        return tabs
            .filter(tab => tab.id && tab.url && (exclude ? !exclude.test(tab.url) : true))
            .map(tab => tab.id);
    }
    async function injectContentScript(where, scripts, options = {}) {
        const targets = castArray(where);
        await Promise.all(targets.map(async (target) => injectContentScriptInSpecificTarget(castAllFramesTarget(target), scripts, options)));
    }
    async function injectContentScriptInSpecificTarget({ frameId, tabId, allFrames }, scripts, options = {}) {
        const injections = castArray(scripts).flatMap(script => [
            insertCSS$1({
                tabId,
                frameId,
                allFrames,
                files: script.css ?? [],
                matchAboutBlank: script.matchAboutBlank ?? script.match_about_blank,
                runAt: script.runAt ?? script.run_at,
            }, options),
            executeScript$1({
                tabId,
                frameId,
                allFrames,
                files: script.js ?? [],
                matchAboutBlank: script.matchAboutBlank ?? script.match_about_blank,
                runAt: script.runAt ?? script.run_at,
            }, options),
        ]);
        await Promise.all(injections);
    }
    const targetErrors = /^No frame with id \d+ in tab \d+.$|^No tab with id: \d+.$|^The tab was closed.$|^The frame was removed.$/;
    async function catchTargetInjectionErrors(promise) {
        try {
            await promise;
        }
        catch (error) {
            if (!targetErrors.test(error?.message)) {
                throw error;
            }
        }
    }

    async function injectToExistingTabs(origins, scripts) {
        const excludeMatches = scripts.flatMap(script => script.matches ?? []);
        return injectContentScript(await getTabsByUrl(origins, excludeMatches), scripts, { ignoreTargetErrors: true });
    }

    function NestedProxy(target) {
    	return new Proxy(target, {
    		get(target, prop) {
    			if (typeof target[prop] !== 'function') {
    				return new NestedProxy(target[prop]);
    			}
    			return (...arguments_) =>
    				new Promise((resolve, reject) => {
    					target[prop](...arguments_, result => {
    						if (chrome.runtime.lastError) {
    							reject(new Error(chrome.runtime.lastError.message));
    						} else {
    							resolve(result);
    						}
    					});
    				});
    		}
    	});
    }
    const chromeP = globalThis.chrome && new NestedProxy(globalThis.chrome);

    const gotScripting = typeof chrome === 'object' && 'scripting' in chrome;
    function castTarget(target) {
        return typeof target === 'object' ? target : {
            tabId: target,
            frameId: 0,
        };
    }
    async function executeFunction(target, function_, ...args) {
        const { frameId, tabId } = castTarget(target);
        if (gotScripting) {
            const [injection] = await chrome.scripting.executeScript({
                target: {
                    tabId,
                    frameIds: [frameId],
                },
                func: function_,
                args,
            });
            return injection?.result;
        }
        const [result] = await chromeP.tabs.executeScript(tabId, {
            code: `(${function_.toString()})(...${JSON.stringify(args)})`,
            frameId,
        });
        return result;
    }
    function arrayOrUndefined(value) {
        return typeof value === 'undefined' ? undefined : [value];
    }
    async function insertCSS({ tabId, frameId, files, allFrames, matchAboutBlank, runAt, }) {
        await Promise.all(files.map(async (content) => {
            if (typeof content === 'string') {
                content = { file: content };
            }
            if (gotScripting) {
                return chrome.scripting.insertCSS({
                    target: {
                        tabId,
                        frameIds: arrayOrUndefined(frameId),
                        allFrames,
                    },
                    files: 'file' in content ? [content.file] : undefined,
                    css: 'code' in content ? content.code : undefined,
                });
            }
            return chromeP.tabs.insertCSS(tabId, {
                ...content,
                matchAboutBlank,
                allFrames,
                frameId,
                runAt: runAt ?? 'document_start',
            });
        }));
    }
    async function executeScript({ tabId, frameId, files, allFrames, matchAboutBlank, runAt, }) {
        let lastInjection;
        for (let content of files) {
            if (typeof content === 'string') {
                content = { file: content };
            }
            if (gotScripting) {
                if ('code' in content) {
                    throw new Error('chrome.scripting does not support injecting strings of `code`');
                }
                void chrome.scripting.executeScript({
                    target: {
                        tabId,
                        frameIds: arrayOrUndefined(frameId),
                        allFrames,
                    },
                    files: [content.file],
                });
            }
            else {
                if ('code' in content) {
                    await lastInjection;
                }
                lastInjection = chromeP.tabs.executeScript(tabId, {
                    ...content,
                    matchAboutBlank,
                    allFrames,
                    frameId,
                    runAt,
                });
            }
        }
    }

    const gotNavigation = typeof chrome === 'object' && 'webNavigation' in chrome;
    async function isOriginPermitted(url) {
        return chromeP.permissions.contains({
            origins: [new URL(url).origin + '/*'],
        });
    }
    async function wasPreviouslyLoaded(target, assets) {
        const loadCheck = (key) => {
            const wasLoaded = document[key];
            document[key] = true;
            return wasLoaded;
        };
        return executeFunction(target, loadCheck, JSON.stringify(assets));
    }
    async function registerContentScript$1(contentScriptOptions, callback) {
        const { js = [], css = [], matchAboutBlank, matches, excludeMatches, runAt, } = contentScriptOptions;
        let { allFrames } = contentScriptOptions;
        if (gotNavigation) {
            allFrames = false;
        }
        else if (allFrames) {
            console.warn('`allFrames: true` requires the `webNavigation` permission to work correctly: https://github.com/fregante/content-scripts-register-polyfill#permissions');
        }
        const matchesRegex = patternToRegex(...matches);
        const excludeMatchesRegex = patternToRegex(...excludeMatches !== null && excludeMatches !== void 0 ? excludeMatches : []);
        const inject = async (url, tabId, frameId = 0) => {
            if (!matchesRegex.test(url)
                || excludeMatchesRegex.test(url)
                || !await isOriginPermitted(url)
                || await wasPreviouslyLoaded({ tabId, frameId }, { js, css })
            ) {
                return;
            }
            insertCSS({
                tabId,
                frameId,
                files: css,
                matchAboutBlank,
                runAt,
            });
            await executeScript({
                tabId,
                frameId,
                files: js,
                matchAboutBlank,
                runAt,
            });
        };
        const tabListener = async (tabId, { status }, { url }) => {
            if (status && url) {
                void inject(url, tabId);
            }
        };
        const navListener = async ({ tabId, frameId, url, }) => {
            void inject(url, tabId, frameId);
        };
        if (gotNavigation) {
            chrome.webNavigation.onCommitted.addListener(navListener);
        }
        else {
            chrome.tabs.onUpdated.addListener(tabListener);
        }
        const registeredContentScript = {
            async unregister() {
                if (gotNavigation) {
                    chrome.webNavigation.onCommitted.removeListener(navListener);
                }
                else {
                    chrome.tabs.onUpdated.removeListener(tabListener);
                }
            },
        };
        if (typeof callback === 'function') {
            callback(registeredContentScript);
        }
        return registeredContentScript;
    }

    const chromeRegister = globalThis.chrome?.scripting?.registerContentScripts;
    const firefoxRegister = globalThis.browser?.contentScripts?.register;
    async function registerContentScript(contentScript) {
        if (chromeRegister) {
            const id = 'webext-dynamic-content-script-' + JSON.stringify(contentScript);
            try {
                await chromeRegister([{
                        id,
                        ...contentScript,
                    }]);
            }
            catch (error) {
                if (!error?.message.startsWith('Duplicate script ID')) {
                    throw error;
                }
            }
            return {
                unregister: async () => chrome.scripting.unregisterContentScripts([id]),
            };
        }
        const firefoxContentScript = {
            ...contentScript,
            js: contentScript.js?.map(file => ({ file })),
            css: contentScript.css?.map(file => ({ file })),
        };
        if (firefoxRegister) {
            return firefoxRegister(firefoxContentScript);
        }
        return registerContentScript$1(firefoxContentScript);
    }

    const registeredScripts = new Map();
    function makePathRelative(file) {
        return new URL(file, location.origin).pathname;
    }
    async function registerOnOrigins({ origins: newOrigins, }) {
        const manifest = chrome.runtime.getManifest().content_scripts;
        if (!manifest) {
            throw new Error('webext-dynamic-content-scripts tried to register scripts on the new host permissions, but no content scripts were found in the manifest.');
        }
        for (const origin of newOrigins || []) {
            for (const config of manifest) {
                const registeredScript = registerContentScript({
                    js: config.js?.map(file => makePathRelative(file)),
                    css: config.css?.map(file => makePathRelative(file)),
                    allFrames: config.all_frames,
                    matches: [origin],
                    excludeMatches: config.matches,
                    runAt: config.run_at,
                });
                registeredScripts.set(origin, registeredScript);
            }
        }
        // void injectToExistingTabs(newOrigins || [], manifest);
    }
    function handleNewPermissions(permissions) {
        if (permissions.origins && permissions.origins.length > 0) {
            void registerOnOrigins(permissions);
        }
    }
    async function handledDroppedPermissions({ origins }) {
        if (!origins || origins.length === 0) {
            return;
        }
        for (const [origin, scriptPromise] of registeredScripts) {
            if (origins.includes(origin)) {
                const script = await scriptPromise;
                void script.unregister();
            }
        }
    }
    async function init() {
        chrome.permissions.onRemoved.addListener(handledDroppedPermissions);
        chrome.permissions.onAdded.addListener(handleNewPermissions);
        await registerOnOrigins(await getAdditionalPermissions({
            strictOrigins: false,
        }));
    }

    void init();

}());
