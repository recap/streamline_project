const pageCache = new Map();

function getCleanUrl(pageUrl) {
    const filename = pageUrl.split('/').pop().replace('.html', '');
    return `?page=${filename}`;
}

function getPageUrlFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    
    if (!page || page === 'index') {
        return null; // Main index page
    }
    
    const pageMap = {
        'settings': 'src/settings/settings.html',
        'profile_selector': 'src/profiles/profile_selector.html',
    };
    return pageMap[page] || null;
}

export function isSubPage() {
    return getPageUrlFromQuery() !== null;
}

export async function initRouter() {
    const pageUrl = getPageUrlFromQuery();
    
    if (pageUrl) {
        await loadPage(pageUrl);
    }
}

window.addEventListener('popstate', async (event) => {
    if (event.state && event.state.pageUrl) {
        await loadPage(event.state.pageUrl);
    }
});
async function fetchPage(url) {
    if (pageCache.has(url)) {
        return pageCache.get(url);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch page: ${response.statusText}`);
    }
    const text = await response.text();
    pageCache.set(url, text);
    return text;
}

export async function loadPage(pageUrl, containerSelector = '#scaled-content') {
    try {
        const pageHtml = await fetchPage(pageUrl);
        const parser = new DOMParser();
        const doc = parser.parseFromString(pageHtml, 'text/html');

        const newContent = doc.querySelector(containerSelector);
        const mainContainer = document.querySelector(containerSelector);

        if (newContent && mainContainer) {
            // Store references to any existing scripts that might be affected
            const existingScripts = Array.from(document.querySelectorAll('script[data-dynamic]'));

            // Clear existing dynamic scripts to avoid conflicts
            existingScripts.forEach(script => {
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            });

            mainContainer.innerHTML = newContent.innerHTML;

            // Execute scripts from the loaded page
            const scripts = doc.querySelectorAll('script');

            scripts.forEach(script => {
                if (script.src) {
                    // Handle external scripts
                    const newScript = document.createElement('script');

                    // Properly resolve the script URL relative to the page being loaded
                    // The script.src is relative to the HTML file location, not the current page
                    let resolvedSrc;
                    try {
                        // If the script URL is already absolute (starts with /), use it as-is
                        if (script.src.startsWith('/')) {
                            resolvedSrc = script.src;
                        } else {
                            // For relative paths, resolve relative to the page URL
                            resolvedSrc = new URL(script.src, new URL(pageUrl, window.location.origin)).href;

                            // If the path looks like it's going up from src/ to root, adjust accordingly
                            // For example, if pageUrl is /src/profiles/profile_selector.html and script.src is ../modules/profile_selector.js
                            // The resolved path should be /src/modules/profile_selector.js
                            if (pageUrl.includes('/src/') && script.src.startsWith('../')) {
                                const baseUrl = window.location.origin;
                                const pageDir = pageUrl.substring(0, pageUrl.lastIndexOf('/'));
                                resolvedSrc = new URL(script.src, new URL(pageDir, baseUrl)).href;
                            }
                        }
                    } catch (e) {
                        console.error(`Error resolving script URL: ${script.src} relative to ${pageUrl}`, e);
                        // Fallback to a relative path from the root
                        resolvedSrc = script.src.startsWith('/') ? script.src : `/${script.src}`;
                    }

                    newScript.src = resolvedSrc;
                    newScript.type = script.type || 'text/javascript';
                    newScript.setAttribute('data-dynamic', 'true');

                    // Copy other attributes
                    for (let attr of script.attributes) {
                        if (attr.name !== 'src' && attr.name !== 'type') {
                            newScript.setAttribute(attr.name, attr.value);
                        }
                    }

                    // Add error handling for external scripts
                    newScript.onload = () => {
                        console.log(`External script loaded: ${resolvedSrc}`);
                    };
                    newScript.onerror = (error) => {
                        console.error(`Error loading external script: ${resolvedSrc}`, error);
                    };

                    document.head.appendChild(newScript);
                } else {
                    // Handle inline scripts
                    const newScript = document.createElement('script');
                    newScript.textContent = script.textContent;
                    newScript.type = script.type || 'text/javascript';
                    newScript.setAttribute('data-dynamic', 'true');

                    // Copy other attributes
                    for (let attr of script.attributes) {
                        if (attr.name !== 'src' && attr.name !== 'type') {
                            newScript.setAttribute(attr.name, attr.value);
                        }
                    }

                    // For inline scripts, especially modules, we need to be careful about execution timing
                    if (script.type === 'module') {
                        // Module scripts need to be added to the DOM to execute
                        newScript.onload = () => {
                            console.log('Module script loaded');
                        };
                        newScript.onerror = (error) => {
                            console.error('Error loading module script', error);
                        };
                        document.head.appendChild(newScript);
                    } else {
                        // For regular inline scripts, execute immediately after DOM is updated
                        try {
                            document.head.appendChild(newScript);
                            console.log('Inline script executed');
                        } catch (error) {
                            console.error('Error executing inline script', error);
                        } finally {
                            // Clean up immediately after execution
                            setTimeout(() => {
                                if (newScript.parentNode) {
                                    newScript.parentNode.removeChild(newScript);
                                }
                            }, 0);
                        }
                    }
                }
            });

            // Initialize scaling after content is loaded
            try {
                if (window.initScaling) {
                    window.initScaling();
                } else {
                    // Import and initialize scaling if not already available
                    const { initScaling } = await import('./scaling.js');
                    initScaling();
                }

                const cleanUrl = getCleanUrl(pageUrl);
                const pageTitle = cleanUrl.split('/').pop() || 'Streamline';
                window.history.pushState({ pageUrl }, pageTitle, cleanUrl);
            } catch (e) {
                console.warn('Scaling module not available or failed to initialize:', e);
            }

            // After scripts are loaded, trigger a custom event to notify that content has been loaded
            // This allows dynamically loaded modules to initialize properly
            // Use setTimeout to ensure DOM is fully updated before initialization
            setTimeout(async () => {
                console.log('Router: About to initialize page. Page URL =', pageUrl);

                document.dispatchEvent(new CustomEvent('dynamic-content-loaded', {
                    detail: { pageUrl, containerSelector }
                }));

                // Dispatch an event to signal that dynamic content has been loaded
                // This can be listened to by modules that need to initialize after content is loaded

                console.log('Router: Checking for initialization. Page URL =', pageUrl);
                console.log('Contains profile_selector.html?', pageUrl.includes('profile_selector.html'));
                console.log('Ends with profile_selector.html?', pageUrl.endsWith('profile_selector.html'));

                // Check if the loaded page has a specific initialization function
                // For profile selector, try to import and call the initialization function
                if (pageUrl.includes('profile_selector.html') || pageUrl.endsWith('profile_selector.html')) {
                    console.log('Router: Initializing profile selector...');
                    try {
                        // Import the module and call its initialization function
                        // Using absolute path that works in browser environment
                        const { initializeProfileSelector } = await import('./profile_selector.js');
                        if (initializeProfileSelector) {
                            await initializeProfileSelector();
                            console.log('Router: Profile selector initialized successfully.');
                        }
                    } catch (e) {
                        console.error('Router: Error initializing profile selector:', e);
                    }
                } else if (pageUrl.includes('settings.html') || pageUrl.endsWith('settings.html')) {
                    console.log('Router: Initializing settings page...');
                    try {
                        // Import the settings module and call its initialization function
                        const { initializeSettings } = await import('../settings/settings.js?t=' + Date.now());
                        if (initializeSettings) {
                            await initializeSettings();
                            console.log('Router: Settings page initialized successfully.');
                        } else {
                            console.error('Router: initializeSettings not exported from settings.js');
                        }
                    } catch (e) {
                        console.error('Router: Error initializing settings page:', e);
                        // console.error('Router: Import error details:', e.message);
                    }

                    // Initialize scaling for the settings page
                    try {
                        const scalingModule = await import('./scaling.js');
                        if (scalingModule.initScaling) {
                            scalingModule.initScaling();
                        }
                    } catch (e) {
                        console.error('Router: Error initializing scaling for settings page:', e);
                    }
                } else {
                    console.log('Router: Page does not match profile selector pattern, attempting to reinitialize main page components.');

                    // For the main index page, we need to reinitialize UI components
                    try {
                        // Reinitialize theme toggle, translations, and other UI components
                        const i18nModule = await import('./i18n.js');
                        const uiModule = await import('./ui.js');
                        const scalingModule = await import('./scaling.js');
                        const historyModule = await import('./history.js');
                        const profileManagerModule = await import('./profileManager.js');
                        const shotDataModule = await import('./shotData.js');
                        const chartModule = await import('./chart.js'); // Import chart module
                        const { initWaterTankSocket } = await import('./waterTank.js');
                        const { showScaleInfo } = uiModule;

                        await i18nModule.initI18n(); // Reinitialize translations
                        uiModule.initUI({ onWeightClick: window.handleWeightClick || (() => {}) }); // Reinitialize UI components
                        scalingModule.initScaling(); // Reinitialize scaling

                        // Clear and reinitialize shot data table to prevent layout issues
                        shotDataModule.clearShotData();

                        await historyModule.initHistory(); // Reinitialize history
                        
                        // Initialize chart and ensure theme is applied
                        chartModule.initChart();
                        
                        initWaterTankSocket(); // Reinitialize water tank WebSocket
                        // Wait a bit to ensure DOM is fully updated before initializing profile manager
                        await new Promise(resolve => setTimeout(resolve, 50));
                        await profileManagerModule.init(); // Reinitialize profile manager
                        showScaleInfo(); // Make sure the scale info container is visible

                        // Reinitialize numpad modal after returning to main page
                        try {
                            const numpadModule = await import('./numpad-modal.js');
                            if (numpadModule.resetNumpadModal) {
                                numpadModule.resetNumpadModal();
                            }
                            if (numpadModule.initNumpadModal) {
                                numpadModule.initNumpadModal();
                                if (numpadModule.attachToNumericInputs) {
                                    numpadModule.attachToNumericInputs();
                                }
                                console.log('Router: Numpad modal reinitialized.');
                            }
                        } catch (e) {
                            console.error('Router: Error reinitializing numpad modal:', e);
                        }

                        // Import and call loadInitialData directly to ensure profile information is updated
                        // But make sure to wait for the profile manager to fully update the UI first
                        const appModule = await import('./app.js');
                        console.log('Router: appModule imported');

                        // Reinitialize mobile value inputs after returning to main page
                        if (appModule.initMobileValueInputs) {
                            appModule.initMobileValueInputs();
                            console.log('Router: Mobile value inputs reinitialized.');
                        }

                        // Force reattach click handlers to value elements (bypass shouldUseNumpad check)
                        const numpadModule = await import('./numpad-modal.js');
                        const valueElements = [
                            { id: 'dose-in-value', type: 'dose-in', format: (v) => `${v}g` },
                            { id: 'drink-out-value', type: 'drink-out', format: (v) => `${v}g` },
                            { id: 'temp-value', type: 'temperature', format: (v) => `${v}°c` },
                            { id: 'grind-value', type: 'grind', format: (v) => v },
                            { id: 'steam-duration-value', type: 'steam-duration', format: (v) => `${v}s` },
                            { id: 'steam-flow-value', type: 'steam-flow', format: (v) => v },
                            { id: 'flush-value', type: 'flush', format: (v) => `${v}s` },
                            { id: 'hot-water-vol-value', type: 'hot-water-vol', format: (v) => `${v}ml` },
                            { id: 'hot-water-temp-value', type: 'hot-water-temp', format: (v) => `${v}°c` }
                        ];

                        valueElements.forEach(({ id, type, format }) => {
                            const el = document.getElementById(id);
                            if (!el) return;

                            // Remove existing click listener by cloning (workaround for removing old handlers)
                            const newEl = el.cloneNode(true);
                            el.parentNode.replaceChild(newEl, el);

                            // Add fresh click handler
                            newEl.style.cursor = 'pointer';
                            newEl.style.touchAction = 'manipulation';
                            newEl.setAttribute('tabindex', '-1');

                            newEl.addEventListener('click', async (e) => {
                                e.preventDefault();
                                e.stopPropagation();

                                const currentValue = newEl.textContent.replace(/[^0-9.]/g, '') || '0';

                                const mockInput = {
                                    value: currentValue,
                                    setAttribute: () => {},
                                    dispatchEvent: () => {}
                                };

                                if (numpadModule.openModal) {
                                    numpadModule.openModal(mockInput, {
                                        previousValues: [],
                                        fieldType: type,
                                        onConfirm: (val) => {
                                            newEl.textContent = format(val);

                                            // Update app state
                                            if (type === 'dose-in') {
                                                window.app.ui.updateDoseValue('in', val);
                                            } else if (type === 'drink-out') {
                                                window.app.ui.updateDoseValue('out', val);
                                            } else if (type === 'grind') {
                                                window.app.ui.updateGrindValue(val);
                                            } else if (type === 'temperature') {
                                                window.app.ui.updateTemperatureDisplay(val);
                                            } else if (type === 'steam-duration') {
                                                window.app.ui.updateSteamDisplay({ targetSteamDuration: parseFloat(val) });
                                            } else if (type === 'steam-flow') {
                                                window.app.ui.updateSteamDisplay({ targetSteamFlow: parseFloat(val) });
                                            } else if (type === 'flush') {
                                                window.app.ui.updateFlushDisplay(parseFloat(val));
                                            } else if (type === 'hot-water-vol') {
                                                window.app.ui.updateHotWaterDisplay({ targetHotWaterVolume: parseFloat(val) });
                                            } else if (type === 'hot-water-temp') {
                                                window.app.ui.updateHotWaterDisplay({ targetHotWaterTemp: parseFloat(val) });
                                            }
                                        }
                                    });
                                }
                            });
                        });
                        console.log('Router: Click handlers force reattached.');

                        if (appModule.loadInitialData) {
                            // Add a sufficient delay to ensure DOM is fully updated and all UI components are ready
                            await new Promise(resolve => setTimeout(resolve, 200));
                            appModule.resetDataTimeout(); // Reset the data timeout to prevent false disconnection status
                            console.log('Router: About to call loadInitialData');
                            await appModule.loadInitialData(); // Reload initial data
                            console.log('Router: Initial data reloaded successfully.');
                            appModule.handleWeightClick();
                            appModule.handleScaleData(); // Update scale info immediately after loading data
                        } else {
                            // Fallback: try window.loadInitialData if direct import didn't work
                            if (window.loadInitialData) {
                                await window.loadInitialData();
                            }
                        }

                        // Add the profile name click handler for the main index page
                        const profileNameElement = document.getElementById('profile-name');
                        if (profileNameElement) {
                            // Remove any existing event listeners to prevent duplicates
                            const newProfileNameElement = profileNameElement.cloneNode(true);
                            profileNameElement.parentNode.replaceChild(newProfileNameElement, profileNameElement);

                            // Prevent virtual keyboard on mobile by removing focusability
                            newProfileNameElement.setAttribute('tabindex', '-1');
                            
                            // Add the click event listener to navigate to the profile selector
                            newProfileNameElement.onclick = () => {
                                loadPage('src/profiles/profile_selector.html');
                            };
                        }

                        // Re-add event listener for the settings button
                        const settingsBtn = document.getElementById('settings-btn');
                        if (settingsBtn) {
                            const newSettingsBtn = settingsBtn.cloneNode(true);
                            settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
                            newSettingsBtn.addEventListener('click', () => {
                                loadPage('src/settings/settings.html');
                            });
                        }

                        // Re-establish WebSocket connections that are needed for real-time data
                        try {
                            const apiModule = await import('./api.js');
                            const workflow = await apiModule.getWorkflow();
                            const doseData = workflow?.doseData;
                            const grinderData = workflow?.grinderData;
                            const profile = workflow?.profile;
                            const steamsettings = workflow?.steamSettings;
                            const hotwatersettings = workflow?.hotWaterData;
                            const rinseData = workflow?.rinseData;
                            if (hotwatersettings) {
                                        uiModule.updateHotWaterDisplay(hotwatersettings);
                                    }
                            if (steamsettings) {
                                        uiModule.updateSteamDisplay(steamsettings);
                                    }
                            if (profile) {
                                        uiModule.updateProfileName(profile.title || "Untitled Profile");
                                        console.log('Profile name updated to:', profile.title);
                                        if (profile.steps && profile.steps.length > 0) {
                                                        uiModule.updateTemperatureDisplay(profile.steps[0].temperature || 0);
                                                    }
                                    }
                            if (doseData) {
                                        uiModule.updateDoseInDisplay(doseData.doseIn);
                                        uiModule.updateDrinkOut(doseData.doseOut || 0);
                                        uiModule.updateDrinkRatio();
                                    }
                            if (grinderData) {
                                        uiModule.updateGrindDisplay(grinderData);
                                    }
                            if (rinseData) {
                                        uiModule.updateFlushDisplay(rinseData.duration);
                                    }
                            // Re-establish the main WebSocket connection
                            if (window.handleData && typeof apiModule.connectWebSocket === 'function') {
                                apiModule.connectWebSocket(window.handleData, () => {
                                    console.log('Main WebSocket reconnected. Resetting DE1 connection status.');
                                    if (window.isDe1Connected !== undefined) {
                                        window.isDe1Connected = false; // Reset DE1 connection status so handleData can detect reconnection
                                    }
                                });
                            }

                            // Re-establish scale WebSocket connection
                            if (window.handleScaleData && typeof apiModule.connectScaleWebSocket === 'function') {
                                apiModule.connectScaleWebSocket(
                                    window.handleScaleData,
                                    window.onScaleReconnect || (() => {}),
                                    window.onScaleDisconnect || (() => {})
                                );
                            }

                            // Re-establish shot settings WebSocket connection
                            if (window.handleShotSettingsData && typeof apiModule.connectShotSettingsWebSocket === 'function') {
                                apiModule.connectShotSettingsWebSocket(window.handleShotSettingsData);
                            }

                            // Re-establish time-to-ready WebSocket connection
                            if (window.handleTimeToReadyData && typeof apiModule.connectTimeToReadyWebSocket === 'function') {
                                apiModule.connectTimeToReadyWebSocket(window.handleTimeToReadyData);
                            }

                            console.log('WebSocket connections re-established.');
                        } catch (wsError) {
                            console.error('Error re-establishing WebSocket connections:', wsError);
                        }

                        console.log('Router: Main page components reinitialized.');
                    } catch (e) {
                        console.error('Router: Error reinitializing main page components:', e);
                    }
                }
            }, 100); // Small delay to ensure DOM is ready
        } else {
            console.error('Could not find the container or content to load.');
        }
    } catch (error) {
        console.error('Error loading page:', error);
    }
}