import {  getReaSettings, getDe1Settings, getDe1AdvancedSettings, setReaSettings, setDe1Settings, setDe1AdvancedSettings, setMachineState, reconnectDevice, connectScaleDevice, connectDeviceWebSocket, sendDeviceCommand, dimDisplay, restoreDisplay, currentMachineState, signalHeartbeat, MachineState, getDeviceWebSocket, initDeviceWebSocketWithCallback, saveScaleDeviceId, getScaleDeviceId, connectDisplayWebSocket, sendDisplayCommand, enableWakeLock, disableWakeLock, getPresenceSettings, setPresenceSettings, getPresenceSchedules, createPresenceSchedule, updatePresenceSchedule, deletePresenceSchedule, getAppInfo, getMachineInfo, getWorkflow, updateWorkflow } from '../modules/api.js';
import * as ui from '../modules/ui.js';
import { initScaling } from '../modules/scaling.js';
import { getSupportedLanguages, getCurrentLanguage, setLanguage } from '../modules/i18n.js';
import { loadPage } from '../modules/router.js'; // Singular and correctly formatted import
import { logger } from '../modules/logger.js';

// Enhanced cache for settings data with loading states
let settingsCache = {
    rea: null,
    de1: null,
    de1Advanced: null,
    workflow: null,
    reaLoading: false,
    de1Loading: false,
    de1AdvancedLoading: false,
    workflowLoading: false,
    reaError: null,
    de1Error: null,
    de1AdvancedError: null,
    workflowError: null,
    appInfo: null,
    appInfoLoading: false,
    appInfoError: null,
    machineInfo: null,
    machineInfoLoading: false,
    machineInfoError: null
};

let activeSettingsCategory = null; // New global variable to track the currently active category

// Live device state cache from WebSocket
let deviceStateCache = {
    devices: [],
    scanning: false,
    initialized: false
};

// Render generic loading state
function renderLoadingState(title) {
    return `
        <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden" role="status" aria-busy="true">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                <p class="leading-[1.2]">${title}</p>
            </div>
            <div class="text-[var(--text-primary)] p-4 text-[24px] text-center w-full">Loading settings...</div>
        </div>
    `;
}

function formatMachineExtra(extra) {
    if (!extra || typeof extra !== 'object') {
        return 'N/A';
    }

    const entries = Object.entries(extra);
    if (entries.length === 0) {
        return 'N/A';
    }

    return entries
        .map(([key, value]) => {
            const readableKey = key
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, (char) => char.toUpperCase());
            let readableValue;
            if (typeof value === 'boolean') {
                readableValue = value ? 'on' : 'off';
            } else {
                readableValue = String(value);
            }
            return `${readableKey} : ${readableValue}`;
        })
        .join(', ');
}

function formatBuildTimestamp(timestamp) {
    if (!timestamp) {
        return 'Unavailable';
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return timestamp;
    }

    return parsed.toLocaleString();
}

// Render generic error state
function renderErrorState(title, message) {
    return `
        <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden" role="alert">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                <p class="leading-[1.2]">${title}</p>
            </div>
            <div class="text-red-500 p-4 text-[24px] text-center w-full">Failed to load settings: ${message}</div>
            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold mx-auto mt-4" onclick="window.retryLoadSettings()">Retry</button>
        </div>
    `;
}

// Helper function to update the settings content area in the DOM
function updateSettingsContentArea(category) {
    const contentArea = document.getElementById('settings-content-area');
    if (contentArea) {
        contentArea.innerHTML = renderSettingsContent(category);
        if (category === 'appearance') {
            setTimeout(() => {
                ui.initThemeToggle();
            }, 100);
        }
    }
}

// Define the tree structure for settings navigation
const settingsTree = {
    'quickadjustments': {
        name: 'Quick Adjustments',
        subcategories: [
            { id: 'flowmultiplier', name: 'Flow Multiplier', settingsCategory: 'flowmultiplier' },
            { id: 'steam', name: 'Steam', settingsCategory: 'steam' },
            { id: 'hotwater', name: 'Hot Water', settingsCategory: 'hotwater' },
            { id: 'watertank', name: 'Water Tank', settingsCategory: 'watertank' },
            { id: 'flush', name: 'Flush', settingsCategory: 'flush' }
        ]
    },
    'bluetooth': {
        name: 'Bluetooth',
        subcategories: [
            { id: 'ble_machine', name: '1. Machine', settingsCategory: 'ble_machine' },
            { id: 'ble_scale', name: '2. Scale', settingsCategory: 'ble_scale' }
        ]
    },
    'calibration': {
        name: 'Calibration',
        subcategories: [
            { id: 'defaultloadsettings', name: 'Default load settings', settingsCategory: 'calib_defaultload' },
            { id: 'refillkit',           name: 'Refill Kit',            settingsCategory: 'calib_refillkit' },
            { id: 'voltage',             name: 'Voltage',               settingsCategory: 'calib_voltage' },
            { id: 'fan',                 name: 'Fan',                   settingsCategory: 'calib_fan' },
            { id: 'stopatweight',        name: 'Stop at weight',        settingsCategory: 'calib_stopatweight' },
            { id: 'slowstart',           name: 'Slow start',            settingsCategory: 'calib_slowstart' },
            { id: 'steam',               name: 'Steam',                 settingsCategory: 'calib_steam' }
        ]
    },
    'machine': {
        name: 'Machine',
        subcategories: [
            { id: 'fanthreshold', name: 'Fan Threshold', settingsCategory: 'fanthreshold' },
            { id: 'usbchargermode', name: 'USB Charger Mode', settingsCategory: 'usbchargermode' }
        ]
    },
    'maintenance': {
        name: 'Maintenance',
        subcategories: [
            { id: 'machinedescaling', name: 'Machine Descaling', settingsCategory: 'maint_descaling' },
            { id: 'transportmode',    name: 'Transport mode',    settingsCategory: 'maint_transport' }
        ]
    },
    'skin': {
        name: 'Skin',
        subcategories: [
            { id: 'skin1', name: 'Theme', settingsCategory: 'appearance' }
        ]
    },
    'language': {
        name: 'Language',
        subcategories: [
            { id: 'selectlanguage', name: 'Select Language', settingsCategory: 'language' },
        ]
    },
    'extensions': {
        name: 'Extensions',
        subcategories: [
            { id: 'extention1', name: 'Visualizer', settingsCategory: 'extensions' },
            { id: 'extention2', name: 'Extention 2', settingsCategory: 'extensions' }
        ]
    },
    'miscellaneous': {
        name: 'Miscellaneous',
        subcategories: [
            { id: 'reasettings', name: 'Rea settings', settingsCategory: 'rea' },
            { id: 'brightness', name: 'Brightness', settingsCategory: 'brightness' },
            { id: 'wakelock', name: 'Wake Lock', settingsCategory: 'wakelock' },
            { id: 'presence', name: 'Presence Detection', settingsCategory: 'presence' },
            { id: 'appversion', name: 'App Version', settingsCategory: 'misc' },
            { id: 'unitssettings', name: 'Units Settings', settingsCategory: 'language' },
            { id: 'fontsize', name: 'Font Size', settingsCategory: 'appearance' },
            { id: 'resolution', name: 'Resolution', settingsCategory: 'appearance' },
            { id: 'smartcharging', name: 'Smart Charging', settingsCategory: 'smartcharging' },
            { id: 'screensaver', name: 'Screen Saver', settingsCategory: 'misc' },
            { id: 'machineadvancedsettings', name: 'Machine Advanced Settings', settingsCategory: 'de1advanced' }
        ]
    },
    'updates': {
        name: 'Updates',
        subcategories: [
            { id: 'firmwareupdate', name: 'Firmware Update', settingsCategory: 'updates' },
            { id: 'appupdate', name: 'App Update', settingsCategory: 'updates' }
        ]
    },
    'usermanual': {
        name: 'User Manual',
        subcategories: [
            { id: 'onlinehelp', name: 'Online Help', settingsCategory: 'help' },
            { id: 'tutorials', name: 'Tutorials', settingsCategory: 'help' }
        ]
    }
};

// Cache for loading promise to prevent multiple simultaneous requests
let settingsLoadingPromise = null;

// Load all settings data
export async function loadSettings() {
    // If we're already loading, return the same promise
    if (settingsLoadingPromise) {
        return settingsLoadingPromise;
    }

    settingsLoadingPromise = _loadSettingsInternal();
    return settingsLoadingPromise;
}

// Internal function to actually load settings
async function _loadSettingsInternal() {
    try {
        // Fetch all settings in parallel
        const [reaSettings, de1Settings, de1AdvancedSettings, appInfoData, workflowData] = await Promise.all([
            getReaSettings(),
            getDe1Settings(),
            getDe1AdvancedSettings(),
            getAppInfo(),
            getWorkflow()
        ]);

        settingsCache.rea = reaSettings;
        settingsCache.de1 = de1Settings;
        settingsCache.de1Advanced = de1AdvancedSettings;
        settingsCache.appInfo = appInfoData;
        settingsCache.workflow = workflowData;

        return { reaSettings, de1Settings, de1AdvancedSettings, appInfoData, workflowData };
    } catch (error) {
        console.error('Error loading settings:', error);
        ui.showToast('Failed to load settings', 5000, 'error');
        return { reaSettings: null, de1Settings: null, de1AdvancedSettings: null, workflowData: null };
    } finally {
        // Clear the loading promise after completion
        settingsLoadingPromise = null;
    }
}

// Helper function to check if settings are loaded
function areSettingsLoaded() {
    return settingsCache.rea !== null &&
           settingsCache.de1 !== null &&
           settingsCache.de1Advanced !== null;
}

// Update REA settings
export async function updateReaSetting(key, value) {
    try {
        const payload = { [key]: value };
        await setReaSettings(payload);
        settingsCache.rea[key] = value;
        ui.showToast('REA setting updated successfully', 3000, 'success');
        if (activeSettingsCategory) { // Re-render the current view to reflect changes
            updateSettingsContentArea(activeSettingsCategory);
        }
    } catch (error) {
        console.error('Error updating REA setting:', error);
        ui.showToast(`Failed to update REA setting: ${error.message}`, 5000, 'error');
    }
}

// Update DE1 settings
export async function updateDe1Setting(key, value) {
    try {
        const payload = { [key]: value };
        await setDe1Settings(payload);
        settingsCache.de1[key] = value;
        ui.showToast('DE1 setting updated successfully', 3000, 'success');
        if (activeSettingsCategory) { // Re-render the current view to reflect changes
            updateSettingsContentArea(activeSettingsCategory);
        }
    } catch (error) {
        console.error('Error updating DE1 setting:', error);
        ui.showToast(`Failed to update DE1 setting: ${error.message}`, 5000, 'error');
    }
}

// Update DE1 advanced settings
export async function updateDe1AdvancedSetting(key, value) {
    try {
        const payload = { [key]: value };
        await setDe1AdvancedSettings(payload);
        settingsCache.de1Advanced[key] = value;
        ui.showToast('DE1 advanced setting updated successfully', 3000, 'success');
        if (activeSettingsCategory) { // Re-render the current view to reflect changes
            updateSettingsContentArea(activeSettingsCategory);
        }
    } catch (error) {
        console.error('Error updating DE1 advanced setting:', error);
        ui.showToast(`Failed to update DE1 advanced setting: ${error.message}`, 5000, 'error');
    }
}

// Update steam settings via workflow API
export async function updateSteamSetting(key, value) {
    try {
        const steamSettings = { ...(settingsCache.workflow?.steamSettings || {}) };
        steamSettings[key] = value;
        await updateWorkflow({ steamSettings });
        
        // Update local cache
        if (!settingsCache.workflow) {
            settingsCache.workflow = {};
        }
        settingsCache.workflow.steamSettings = steamSettings;
        
        ui.showToast('Steam setting updated successfully', 3000, 'success');
    } catch (error) {
        console.error('Error updating steam setting:', error);
        ui.showToast(`Failed to update steam setting: ${error.message}`, 5000, 'error');
    }
}

// Update hot water settings via workflow API
export async function updateHotWaterSetting(key, value) {
    try {
        const hotWaterData = { ...(settingsCache.workflow?.hotWaterData || {}) };
        hotWaterData[key] = value;
        await updateWorkflow({ hotWaterData });
        
        // Update local cache
        if (!settingsCache.workflow) {
            settingsCache.workflow = {};
        }
        settingsCache.workflow.hotWaterData = hotWaterData;
        
        ui.showToast('Hot water setting updated successfully', 3000, 'success');
    } catch (error) {
        console.error('Error updating hot water setting:', error);
        ui.showToast(`Failed to update hot water setting: ${error.message}`, 5000, 'error');
    }
}


// Render settings content based on selected category
export function renderSettingsContent(category) {
    // Determine loading state for the specific category
    let isLoading = false;
    let error = null;

    switch(category) {
        case 'rea':
        case 'quickadjustments':
        case 'flowmultiplier':
            isLoading = settingsCache.reaLoading;
            error = settingsCache.reaError;
            break;
        case 'de1':
        case 'fanthreshold':
        case 'usbchargermode':
        case 'watertank':
        case 'flush':
        case 'steam':
        case 'hotwater':
        case 'calib_fan':
            isLoading = settingsCache.de1Loading;
            error = settingsCache.de1Error;
            break;
        case 'de1advanced':
            isLoading = settingsCache.de1AdvancedLoading;
            error = settingsCache.de1AdvancedError;
            break;
        default:
            // For categories that don't require specific settings, check if any settings are loading
            isLoading = settingsCache.reaLoading || settingsCache.de1Loading || settingsCache.de1AdvancedLoading;
            break;
    }

    // Show loading state if the required settings are still loading
    if (isLoading) {
        return renderLoadingState(getCategoryTitle(category));
    }

    // Show error state if there was an error loading the required settings
    if (error && (
        category === 'rea' ||
        category === 'quickadjustments' ||
        category === 'flowmultiplier' ||
        category === 'de1' ||
        category === 'fanthreshold' ||
        category === 'usbchargermode' ||
        category === 'watertank' ||
        category === 'flush' ||
        category === 'steam' ||
        category === 'hotwater' ||
        category === 'de1advanced' ||
        category === 'calib_fan'
    )) {
        return renderErrorState(getCategoryTitle(category), error);
    }

    // Render actual content once settings are loaded
    switch(category) {
        case 'rea':
            return renderReaSettingsForm(settingsCache.rea);
        case 'quickadjustments':
        case 'flowmultiplier':
            return renderFlowMultiplierSettings(settingsCache.rea);
        case 'steam':
            return renderSteamSettings();
        case 'hotwater':
            return renderHotWaterSettings();
        case 'watertank':
            return renderWaterTankSettings();
        case 'flush':
            return renderFlushSettingsForm(settingsCache.de1);
     
        case 'ble_scale':
            return renderBluetoothScaleSettings(settingsCache.rea);
        case 'ble_machine':
            return renderBluetoothMachineSettings();
        case 'calib_fan':
            return renderCalibFanSettings(settingsCache.de1);
        case 'calib_defaultload':
            return renderCalibDefaultLoadSettings();
        case 'calib_refillkit':
            return renderCalibRefillKitSettings();
        case 'calib_voltage':
            return renderCalibVoltageSettings();
        case 'calib_stopatweight':
            return renderCalibStopAtWeightSettings();
        case 'calib_slowstart':
            return renderCalibSlowStartSettings();
        case 'calib_steam':
            return renderCalibSteamSettings();
        case 'maint_descaling':
            return renderMainDescalingSettings();
        case 'maint_transport':
            return renderMainTransportSettings();
        case 'skin':
        case 'appearance':
            return renderSkinSettings();
        case 'language':
        case 'selectlanguage':
            return renderLanguageSettings();
        case 'extensions':
        case 'extention1':
        case 'extention2':
            return renderExtensionsSettings();
        case 'misc':
        case 'miscellaneous':
        case 'reasettings':
        case 'screensaver':
            return renderScreenSaverSettings();
        case 'brightness':
            return renderBrightnessSettings();
        case 'wakelock':
            return renderWakeLockSettings();
        case 'presence':
            return renderPresenceSettings();
        case 'appversion':
            return renderAppVersionSettings();
        case 'unitssettings':
        case 'fontsize':
        case 'resolution':
        case 'machineadvancedsettings':
        case 'misc':
        case 'miscellaneous':
        case 'reasettings':
            return renderMiscellaneousSettings();
        case 'smartcharging':
            return renderSmartChargingSettings();
        case 'updates':
        case 'firmwareupdate':
        case 'appupdate':
            return renderUpdatesSettings();
        case 'usermanual':
        case 'onlinehelp':
        case 'tutorials':
        case 'help':
            console.log("rendering user manual ");
            return renderUserManualSettings();
        case 'de1':
        case 'fanthreshold':
            return renderFanThresholdSettings(settingsCache.de1);
        case 'usbchargermode':
            return renderUsbChargerModeSettings(settingsCache.de1);
        case 'de1advanced':
            return renderDe1AdvancedSettingsForm(settingsCache.de1Advanced);
        case 'hot water':
            return renderHotWaterSettings(settingsCache.de1);
        default:
            return renderGeneralSettings();
    }
}

// Render Flow Multiplier settings
export function renderFlowMultiplierSettings(settings) {
    if (!settings) {
        return `
            <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                    <p class="leading-[1.2]">Flow Multiplier Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load flow multiplier settings</div>
            </div>
        `;
    }

    return `
        <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                <p class="leading-[1.2]">Flow Multiplier Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="flex flex-col items-start relative w-full max-w-full">
                <div class="flex flex-col gap-[30px] items-start relative w-full max-w-full">
                    <div class="flex items-center justify-between relative w-full max-w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p id="weight-flow-multiplier-label" class="leading-[1.2]">Weight Flow Multiplier</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="weightFlowMultiplierInput" aria-labelledby="weight-flow-multiplier-label" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center max-w-[150px]"
                                   value="${settings.weightFlowMultiplier !== undefined ? settings.weightFlowMultiplier : 1.0}"
                                   step="0.1" min="0" max="5">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold max-w-[100px]"
                                    aria-label="Save weight flow multiplier setting"
                                    onclick="window.updateReaSetting('weightFlowMultiplier', parseFloat(document.getElementById('weightFlowMultiplierInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full max-w-full break-words">
                        Multiplier for projected weight calculation. Higher values stop shots earlier.
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="flex flex-col items-start relative w-full max-w-full">
                <div class="flex flex-col gap-[30px] items-start relative w-full max-w-full">
                    <div class="flex items-center justify-between relative w-full max-w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p id="volume-flow-multiplier-label" class="leading-[1.2]">Volume Flow Multiplier (s)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="volumeFlowMultiplierInput" aria-labelledby="volume-flow-multiplier-label" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center max-w-[150px]"
                                   value="${settings.volumeFlowMultiplier !== undefined ? settings.volumeFlowMultiplier : 0.3}"
                                   step="0.05" min="0" max="2">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold max-w-[100px]"
                                    onclick="window.updateReaSetting('volumeFlowMultiplier', parseFloat(document.getElementById('volumeFlowMultiplierInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full max-w-full break-words">
                        Look-ahead time in seconds for projected volume calculation. Accounts for system lag.
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render REA settings form matching design
export function renderReaSettingsForm(settings) {
    if (!settings) {
        return `
            <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                    <p class="leading-[1.2]">REA Application Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load REA settings</div>
            </div>
        `;
    }

    return `
        <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                <p class="leading-[1.2]">REA Application Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="flex flex-col items-start relative w-full max-w-full">
                <div class="flex flex-col gap-[30px] items-start relative w-full max-w-full">
                    <div class="flex flex-col items-start relative w-full max-w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px] mb-[20px]">
                            <p id="gateway-mode-label" class="leading-[1.2]">Gateway Mode</p>
                        </div>
                        <div class="flex items-center justify-between w-full max-w-[885px]" role="group" aria-labelledby="gateway-mode-label">
                            <button class="h-[120px] w-[295px] rounded-[10px] font-['Inter:Bold',sans-serif] font-bold text-[30px] flex items-center justify-center cursor-pointer transition-colors duration-200
                                ${settings.gatewayMode === 'disabled' ? 'bg-[var(--mimoja-blue)] text-white' : 'bg-[var(--box-color)] border border-[var(--profile-button-outline-color)] text-[#b6c3d7]'}"
                                aria-pressed="${settings.gatewayMode === 'disabled'}"
                                onclick="window.updateReaSetting('gatewayMode', 'disabled')">
                                Disabled
                            </button>
                            <button class="h-[120px] w-[295px] rounded-[10px] font-['Inter:Bold',sans-serif] font-bold text-[30px] flex items-center justify-center cursor-pointer transition-colors duration-200
                                ${settings.gatewayMode === 'tracking' ? 'bg-[var(--mimoja-blue)] text-white' : 'bg-[var(--box-color)] border border-[var(--profile-button-outline-color)] text-[#b6c3d7]'}"
                                aria-pressed="${settings.gatewayMode === 'tracking'}"
                                onclick="window.updateReaSetting('gatewayMode', 'tracking')">
                                Tracking
                            </button>
                            <button class="h-[120px] w-[295px] rounded-[10px] font-['Inter:Bold',sans-serif] font-bold text-[30px] flex items-center justify-center cursor-pointer transition-colors duration-200
                                ${settings.gatewayMode === 'full' ? 'bg-[var(--mimoja-blue)] text-white' : 'bg-[var(--box-color)] border border-[var(--profile-button-outline-color)] text-[#b6c3d7]'}"
                                aria-pressed="${settings.gatewayMode === 'full'}"
                                onclick="window.updateReaSetting('gatewayMode', 'full')">
                                Full
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full max-w-full break-words">
                        Controls how the gateway monitors and controls the espresso machine
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="flex flex-col items-start relative w-full max-w-full">
                <div class="flex flex-col gap-[30px] items-start relative w-full max-w-full">
                    <div class="flex items-center justify-between relative w-full max-w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p id="log-level-label" class="leading-[1.2]">Log Level</p>
                        </div>
                        <select id="logLevelSelect" aria-labelledby="log-level-label" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[250px] text-white text-[24px] p-2 max-w-[250px]"
                                onchange="window.updateReaSetting('logLevel', this.value)">
                            <option value="ALL" ${settings.logLevel === 'ALL' ? 'selected' : ''}>ALL</option>
                            <option value="FINEST" ${settings.logLevel === 'FINEST' ? 'selected' : ''}>FINEST</option>
                            <option value="FINER" ${settings.logLevel === 'FINER' ? 'selected' : ''}>FINER</option>
                            <option value="FINE" ${settings.logLevel === 'FINE' ? 'selected' : ''}>FINE</option>
                            <option value="CONFIG" ${settings.logLevel === 'CONFIG' ? 'selected' : ''}>CONFIG</option>
                            <option value="INFO" ${settings.logLevel === 'INFO' ? 'selected' : ''}>INFO</option>
                            <option value="WARNING" ${settings.logLevel === 'WARNING' ? 'selected' : ''}>WARNING</option>
                            <option value="SEVERE" ${settings.logLevel === 'SEVERE' ? 'selected' : ''}>SEVERE</option>
                            <option value="SHOUT" ${settings.logLevel === 'SHOUT' ? 'selected' : ''}>SHOUT</option>
                            <option value="OFF" ${settings.logLevel === 'OFF' ? 'selected' : ''}>OFF</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full max-w-full break-words">
                        Sets the verbosity of application logging output
                    </p>
                </div>
            </div>

        </div>
    `;
}

// Render Flush settings form
export function renderFlushSettingsForm(settings) {
    console.log("rendering flush settings form with settings: ", settings);
    if (!settings) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">Flush Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load flush settings</div>
            </div>
        `;
    }

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Flush Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-center relative w-full">
                <div class="border border-[#c9c9c9] border-solid content-stretch flex flex-col gap-[30px] items-center px-[60px] py-[30px] relative shrink-0 w-[590px]">
                    <div class="content-stretch flex items-center relative shrink-0">
                        <p id="flush-temp-label" class="font-['Inter:Regular',sans-serif] font-normal leading-[1.2] not-italic relative shrink-0 text-[var(--text-primary)] text-[30px]">
                            Flush Temperature
                        </p>
                    </div>
                    <div class="content-stretch flex gap-[20px] h-[72px] items-center justify-center relative shrink-0 w-full">
                        <button id="flush-temp-minus" aria-label="Decrease flush temperature" class="w-[72px] h-[72px] bg-[var(--button-grey)] rounded-[20px] flex items-center justify-center"
                                onclick="window.flashPlusMinusButton(this); window.adjustFlushTemp(-5);">
                            <svg aria-hidden="true" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10.416 25H39.5827" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <div class="text-center text-[var(--text-primary)] text-[24px] font-bold bg-transparent border-none flex items-center justify-center"
                             style="width: 130px;">
                            <input type="text" inputmode="numeric" pattern="[0-9]*" id="flushTempInput" aria-labelledby="flush-temp-label" class="text-center text-[var(--text-primary)] text-[24px] font-bold bg-transparent border-none w-full"
                                   value="${settings.flushTemp !== undefined ? settings.flushTemp : ''}"
                                   step="5" min="5" max="95"
                                   onchange="window.updateDe1Setting('flushTemp', parseFloat(this.value))">
                            <span class="ml-2" aria-hidden="true">°C</span>
                        </div>
                        <button id="flush-temp-plus" aria-label="Increase flush temperature" class="w-[72px] h-[72px] bg-[var(--button-grey)] rounded-[20px] flex items-center justify-center"
                                onclick="window.flashPlusMinusButton(this); window.adjustFlushTemp(5);">
                            <svg aria-hidden="true" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M24.9993 10.4165V39.5832M10.416 24.9998H39.5827" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full text-center">
                        Temperature for flush cycles
                    </p>
                </div>

                <div class="border border-[#c9c9c9] border-solid content-stretch flex flex-col gap-[30px] items-center px-[60px] py-[30px] relative shrink-0 w-[590px] mt-[30px]">
                    <div class="content-stretch flex items-center relative shrink-0">
                        <p id="flush-flow-label" class="font-['Inter:Regular',sans-serif] font-normal leading-[1.2] not-italic relative shrink-0 text-[var(--text-primary)] text-[30px]">
                            Flush Flow
                        </p>
                    </div>
                    <div class="content-stretch flex gap-[20px] h-[72px] items-center justify-center relative shrink-0 w-full">
                        <button id="flush-flow-minus" aria-label="Decrease flush flow" class="w-[72px] h-[72px] bg-[var(--button-grey)] rounded-[20px] flex items-center justify-center"
                                onclick="window.flashPlusMinusButton(this); window.adjustFlushFlow(-1);">
                            <svg aria-hidden="true" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10.416 25H39.5827" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <div class="text-center text-[var(--text-primary)] text-[24px] font-bold bg-transparent border-none flex items-center justify-center"
                             style="width: 130px;">
                            <input type="text" inputmode="numeric" pattern="[0-9]*" id="flushFlowInput" aria-labelledby="flush-flow-label" class="text-center text-[var(--text-primary)] text-[24px] font-bold bg-transparent border-none w-full"
                                   value="${settings.flushFlow !== undefined ? settings.flushFlow : ''}"
                                   step="1" min="1" max="8"
                                   onchange="window.updateDe1Setting('flushFlow', parseFloat(this.value))">
                            <span class="ml-2 text-nowrap" aria-hidden="true">ml/s</span>
                        </div>
                        <button id="flush-flow-plus" aria-label="Increase flush flow" class="w-[72px] h-[72px] bg-[var(--button-grey)] rounded-[20px] flex items-center justify-center"
                                onclick="window.flashPlusMinusButton(this); window.adjustFlushFlow(1);">
                            <svg aria-hidden="true" width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M24.9993 10.4165V39.5832M10.416 24.9998H39.5827" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full text-center">
                        Flow rate for flush cycles
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render Fan Threshold settings
export function renderFanThresholdSettings(settings) {
    if (!settings) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">Fan Threshold Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load DE1 settings</div>
            </div>
        `;
    }

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Fan Threshold Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p id="fan-threshold-label" class="leading-[1.2]">Fan Threshold (°C)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="fanThresholdInput" aria-labelledby="fan-threshold-label" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${settings.fan !== undefined ? settings.fan : ''}"
                                   step="1" min="0" max="100">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    aria-label="Save fan threshold setting"
                                    onclick="window.updateDe1Setting('fan', parseInt(document.getElementById('fanThresholdInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Temperature threshold at which the fan turns on
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render USB Charger Mode settings
export function renderUsbChargerModeSettings(settings) {
    if (!settings) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">USB Charger Mode Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load DE1 settings</div>
            </div>
        `;
    }

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">USB Charger Mode Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p id="usb-charger-mode-label" class="leading-[1.2]">USB Charger Mode</p>
                        </div>
                        <select id="usbChargerModeSelect" aria-labelledby="usb-charger-mode-label" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2"
                                onchange="window.updateDe1Setting('usb', this.value)">
                            <option value="enable" ${settings.usb ? 'selected' : ''}>Enabled</option>
                            <option value="disable" ${!settings.usb ? 'selected' : ''}>Disabled</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Controls whether the USB port provides power for charging devices
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render DE1 Advanced settings form
export function renderDe1AdvancedSettingsForm(settings) {
    if (!settings) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">Machine Advanced Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load DE1 advanced settings</div>
            </div>
        `;
    }

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Machine Advanced Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Heater Phase 1 Flow (ml/s)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="heaterPh1FlowInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${settings.heaterPh1Flow !== undefined ? settings.heaterPh1Flow : ''}"
                                   step="0.1" min="0" max="10">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateDe1AdvancedSetting('heaterPh1Flow', parseFloat(document.getElementById('heaterPh1FlowInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Flow rate during heater phase 1
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Heater Phase 2 Flow (ml/s)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="heaterPh2FlowInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${settings.heaterPh2Flow !== undefined ? settings.heaterPh2Flow : ''}"
                                   step="0.1" min="0" max="10">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateDe1AdvancedSetting('heaterPh2Flow', parseFloat(document.getElementById('heaterPh2FlowInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Flow rate during heater phase 2
                    </p>
                </div>
            </div>
        </div>
    `;
}


// Render user manual settings
export function renderUserManualSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">User Manual</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Online Help</p>
                        </div>
                        <a href="https://decentespresso.com/support/submit" target="_blank" class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold flex items-center justify-center">
                            Visit
                        </a>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Get support and submit tickets for assistance
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Tutorials</p>
                        </div>
                        <a href="https://decentespresso.com/doc/quickstart/" target="_blank" class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold flex items-center justify-center">
                            View
                        </a>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Learn how to get started with your espresso machine
                    </p>
                </div>
            </div>
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Start writing your own skin.</p>
                        </div>
                        <a href="https://github.com/tadelv/reaprime/blob/main/doc/Skins.md#skinsmd" target="_blank" class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold flex items-center justify-center">
                            View
                        </a>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Learn how to use streamline-bridge to create custom skins and more.
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render Screen Saver settings
export function renderScreenSaverSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Screen Saver</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Screen Saver</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2">
                            <option>Enabled</option>
                            <option>Disabled</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Enable or disable screen saver functionality
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render Brightness settings
export function renderBrightnessSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[80px] items-start relative w-full px-[60px] py-[80px]">
            <div class="content-stretch flex items-center justify-between relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px]">
                    <p class="leading-[1.2]">Screen Brightness</p>
                </div>
                
            </div>

            <div class="content-stretch flex flex-col gap-[40px] items-start relative w-full">
                <div class="h-[41.92px] relative w-full">
                    <div class="flex items-center justify-between w-full">
                        <input type="range" id="brightness-slider" min="0" max="100" value="75" class="brightness-slider flex-grow" onchange="handleBrightnessChange(this.value)">
                    </div>
                </div>
                <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[32px] w-full">
                    Adjust screen brightness level
                </p>
            </div>
        </div>
    `;
}

// Render Wake Lock settings
export function renderWakeLockSettings() {
    const wakeLockEnabled = localStorage.getItem('wakeLockEnabled') === 'true';

    return `
        <div class="space-y-6 px-[60px] py-[80px]">
            <div>
                <h2 class="text-[28px] font-bold text-[var(--text-primary)] mb-4">Wake Lock Settings</h2>
                <p class="text-[var(--text-primary)] text-[20px] mb-6 opacity-75">
                    Control screen wake-lock to prevent the display from sleeping during operation.
                </p>
            </div>

            <div class="bg-[var(--wakelock-card-bg)] rounded-lg p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <label class="text-[24px] font-semibold text-[var(--wakelock-card-text)]">Enable Wake Lock</label>
                        <p class="text-[18px] text-[var(--wakelock-card-text)] opacity-75 mt-1">
                            Keep the screen on while the app is active
                        </p>
                    </div>
                    <input type="checkbox"
                           id="wake-lock-toggle"
                           class="toggle toggle-lg toggle-primary"
                           ${wakeLockEnabled ? 'checked' : ''}
                           onchange="handleWakeLockToggle(this.checked)">
                </div>
            </div>

            <div class="text-[18px] text-[var(--text-primary)] opacity-75 mt-4">
                <p><strong>Note:</strong> Wake-lock automatically releases when the WebSocket disconnects.</p>
            </div>
        </div>
    `;
}

// Render Presence Detection settings (async — populates container after fetch)
export function renderPresenceSettings() {
    // Return a loading placeholder synchronously, then populate async
    loadPresenceSettingsAsync();
    return `
        <div id="presence-settings-container">
            <div class="flex items-center justify-center p-8">
                <span class="loading loading-spinner loading-lg"></span>
                <span class="ml-4 text-[20px] text-[var(--text-secondary)]">Loading presence settings...</span>
            </div>
        </div>
    `;
}

// Helper function to format days of week
function formatDaysOfWeek(days) {
    if (!days || days.length === 0) return 'Every day';
    // ISO 8601: 1=Monday, 7=Sunday
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map(d => dayNames[d - 1]).join(', ');
}

function formatKeepAwakeDuration(minutes) {
    if (!minutes || minutes < 1) return '';
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
    if (hrs > 0) return `${hrs} hr`;
    return `${mins} min`;
}

// Async loader for presence settings content
async function loadPresenceSettingsAsync() {
    // Small delay to ensure the placeholder DOM is rendered first
    await new Promise(resolve => setTimeout(resolve, 50));

    const container = document.getElementById('presence-settings-container');
    if (!container) return;

    try {
        const settings = await getPresenceSettings();
        const schedules = settings.schedules || [];
        const schedulesHtml = schedules.map(schedule => {
            const keepAwakeLabel = schedule.keepAwakeFor ? formatKeepAwakeDuration(schedule.keepAwakeFor) : '';
            return `
            <div class="bg-[var(--presence-card-alt-bg)] rounded-lg p-4 flex items-center justify-between" data-schedule-id="${schedule.id}">
                <div class="flex-grow">
                    <div class="text-[22px] font-semibold text-[var(--presence-card-text)]">
                        ${schedule.time} - ${formatDaysOfWeek(schedule.daysOfWeek)}
                        ${keepAwakeLabel ? `<span class="text-[18px] opacity-75 ml-2">(${keepAwakeLabel})</span>` : ''}
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <input type="checkbox"
                           class="toggle toggle-md toggle-primary"
                           ${schedule.enabled ? 'checked' : ''}
                           onchange="handleScheduleToggle('${schedule.id}', this.checked)">
                    <button class="btn btn-sm btn-error" onclick="handleDeleteSchedule('${schedule.id}')">
                        Delete
                    </button>
                </div>
            </div>
        `}).join('');

        container.innerHTML = `
            <div class="space-y-6 px-[60px] py-[80px]">
                <div>
                    <h2 class="text-[28px] font-bold text-[var(--text-primary)] mb-4">Presence Detection</h2>
                    <p class="text-[var(--text-primary)] text-[20px] mb-6 opacity-75">
                        Automatically manage machine sleep/wake based on user presence and schedules.
                    </p>
                </div>

                <div class="bg-[var(--presence-card-bg)] rounded-lg p-6">
                    <div class="flex items-center justify-between mb-6">
                        <div>
                            <label class="text-[24px] font-semibold text-[var(--presence-card-text)]">Enable Presence Detection</label>
                            <p class="text-[18px] text-[var(--presence-card-text)] opacity-75 mt-1">
                                Track user presence to automatically sleep the machine
                            </p>
                        </div>
                        <input type="checkbox"
                               id="presence-enabled-toggle"
                               class="toggle toggle-lg toggle-primary"
                               ${settings.userPresenceEnabled ? 'checked' : ''}
                               onchange="handlePresenceToggle(this.checked)">
                    </div>

                    <div class="mt-6">
                        <label class="text-[22px] font-semibold text-[var(--presence-card-text)] block mb-3">
                            Sleep Timeout (minutes)
                        </label>
                        <input type="number"
                               id="sleep-timeout-input"
                               class="input input-bordered w-full max-w-xs text-[20px] bg-[var(--presence-input-bg)] text-[var(--presence-input-text)] border-[var(--presence-input-border)]"
                               value="${settings.sleepTimeoutMinutes || 30}"
                               min="1"
                               max="120"
                               oninput="this.value = Math.max(1, Math.min(120, this.value))"
                               onchange="handleSleepTimeoutChange(this.value)">
                        <p class="text-[18px] text-[var(--presence-card-text)] opacity-75 mt-2">
                            Minutes of inactivity before auto-sleep
                        </p>
                    </div>
                </div>

                <div class="bg-[var(--presence-card-bg)] rounded-lg p-6">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="text-[24px] font-semibold text-[var(--presence-card-text)]">Wake Schedules</h3>
                        <button class="btn btn-primary" onclick="handleAddSchedule()">
                            Add Schedule
                        </button>
                    </div>

                    <div class="space-y-3">
                        ${schedules.length > 0 ? schedulesHtml : '<p class="text-[var(--presence-card-text)] opacity-75 text-[18px]">No schedules configured</p>'}
                    </div>
                </div>

                <dialog id="add-schedule-modal" class="modal">
                    <div class="modal-box bg-[var(--presence-card-bg)] max-w-2xl">
                        <h3 class="font-bold text-[24px] text-[var(--presence-card-text)] mb-4">Add Schedule</h3>

                        <div class="space-y-4">
                            <div>
                                <label class="text-[20px] text-[var(--presence-card-text)] block mb-2">Wake Time</label>
                                <input type="time" id="schedule-time-input" class="input input-bordered w-full text-[20px] bg-[var(--presence-input-bg)] text-[var(--presence-input-text)] border-[var(--presence-input-border)]">
                            </div>

                            <div>
                                <label class="text-[20px] text-[var(--presence-card-text)] block mb-2">Days of Week</label>
                                <div class="flex gap-2 flex-wrap">
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="1" class="checkbox checkbox-primary mr-1"> Mon</label>
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="2" class="checkbox checkbox-primary mr-1"> Tue</label>
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="3" class="checkbox checkbox-primary mr-1"> Wed</label>
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="4" class="checkbox checkbox-primary mr-1"> Thu</label>
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="5" class="checkbox checkbox-primary mr-1"> Fri</label>
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="6" class="checkbox checkbox-primary mr-1"> Sat</label>
                                    <label class="cursor-pointer text-[var(--presence-card-text)]"><input type="checkbox" value="7" class="checkbox checkbox-primary mr-1"> Sun</label>
                                </div>
                            </div>

                            <div>
                                <label class="text-[20px] text-[var(--presence-card-text)] block mb-2">Keep Awake For</label>
                                <div class="flex items-center gap-3">
                                    <div class="flex items-center gap-2">
                                        <input type="number" id="keep-awake-hours-input" class="input input-bordered w-20 text-[20px] bg-[var(--presence-input-bg)] text-[var(--presence-input-text)] border-[var(--presence-input-border)]"
                                               min="0" max="12" placeholder="0" value="0"
                                               oninput="this.value = Math.max(0, Math.min(12, this.value)); if (this.value == 12) { document.getElementById('keep-awake-mins-input').value = 0; } if (this.value > 12) { ui.showToast('Maximum 12 hours', 3000, 'error'); }">
                                        <span class="text-[var(--presence-card-text)]">hr</span>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <input type="number" id="keep-awake-mins-input" class="input input-bordered w-20 text-[20px] bg-[var(--presence-input-bg)] text-[var(--presence-input-text)] border-[var(--presence-input-border)]"
                                               min="0" max="59" placeholder="0" value="0"
                                               oninput="this.value = Math.max(0, Math.min(59, this.value))">
                                        <span class="text-[var(--presence-card-text)]">min</span>
                                    </div>
                                </div>
                                <p class="text-[18px] text-[var(--presence-card-text)] opacity-75 mt-1">
                                    Duration to keep machine awake after schedule fires. Max 12 hours.
                                </p>
                            </div>
                        </div>

                        <div class="modal-action">
                            <button class="btn" onclick="document.getElementById('add-schedule-modal').close()">Cancel</button>
                            <button class="btn btn-primary" onclick="handleSaveSchedule()">Save</button>
                        </div>
                    </div>
                </dialog>
            </div>
        `;
    } catch (error) {
        console.error('Error rendering presence settings:', error);
        container.innerHTML = `<div class="text-error text-[20px]">Failed to load presence settings</div>`;
    }
}

// Render App Version settings
export function renderAppVersionSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">App Version</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">App Version</p>
                        </div>
                        <div class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold flex items-center justify-center">
                            1.0.0
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Current application version
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render miscellaneous settings (legacy - for backward compatibility)
export function renderMiscellaneousSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Miscellaneous Settings</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Screen Saver</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2">
                            <option>Enabled</option>
                            <option>Disabled</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Enable or disable screen saver functionality
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Brightness</p>
                        </div>
                        <input type="range" id="brightness-slider" min="0" max="100" value="75" class="brightness-slider w-[200px]" onchange="handleBrightnessChange(this.value)">
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Adjust screen brightness level
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">App Version</p>
                        </div>
                        <div class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold flex items-center justify-center">
                            1.0.0
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Current application version
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Units Settings</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2">
                            <option>Metric</option>
                            <option>Imperial</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Select measurement units for the application
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Font Size</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2">
                            <option>Small</option>
                            <option>Medium</option>
                            <option>Large</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Adjust the font size for better readability
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Resolution</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2">
                            <option>1920x1200</option>
                            <option>1280x800</option>
                            <option>1024x768</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Set the display resolution
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Smart Charging</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2">
                            <option>Enabled</option>
                            <option>Disabled</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Enable smart charging for connected devices
                    </p>
                </div>
            </div>
        </div>
    `;
}


// Helper: convert minutes-since-midnight to HH:MM string
function minutesToTimeString(minutes) {
    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

// Helper: convert HH:MM string to minutes-since-midnight
function timeStringToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

// Render Smart Charging settings
export function renderSmartChargingSettings() {
    const reaSettings = settingsCache.rea;
    if (!reaSettings) {
        return renderLoadingState('Smart Charging');
    }

    const chargingMode = reaSettings.chargingMode || 'disabled';
    const nightModeEnabled = reaSettings.nightModeEnabled || false;
    const sleepTime = reaSettings.nightModeSleepTime ?? 1320;
    const morningTime = reaSettings.nightModeMorningTime ?? 420;
    const chargingState = reaSettings.chargingState;

    const modeOptions = [
        { value: 'disabled', label: 'Disabled' },
        { value: 'longevity', label: 'Longevity (80%)' },
        { value: 'balanced', label: 'Balanced (90%)' },
        { value: 'highAvailability', label: 'High Availability' }
    ].map(({ value, label }) =>
        `<option value="${value}" ${chargingMode === value ? 'selected' : ''}>${label}</option>`
    ).join('');

    const phaseLabels = {
        inactive: 'Inactive',
        normal: 'Normal',
        hovering: 'Hovering',
        chargingToMax: 'Charging to Max',
        sleeping: 'Sleeping'
    };

    const nightModeSection = chargingMode !== 'disabled' ? `
        <!-- Divider -->
        <div class="h-0 relative w-full">
            <hr class="border-t border-[#c9c9c9] w-full" />
        </div>

        <div class="content-stretch flex flex-col items-start relative w-full">
            <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                <div class="content-stretch flex items-center justify-between relative w-full">
                    <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                        <p class="leading-[1.2]">Night Mode</p>
                    </div>
                    <input type="checkbox"
                           id="night-mode-toggle"
                           class="toggle toggle-lg toggle-primary"
                           ${nightModeEnabled ? 'checked' : ''}
                           onchange="handleNightModeToggle(this.checked)">
                </div>
                <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                    Charge conservatively overnight between a sleep time and a morning time
                </p>
            </div>
        </div>

        ${nightModeEnabled ? `
        <!-- Divider -->
        <div class="h-0 relative w-full">
            <hr class="border-t border-[#c9c9c9] w-full" />
        </div>

        <div class="content-stretch flex flex-col items-start relative w-full">
            <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                <div class="content-stretch flex items-center justify-between relative w-full">
                    <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                        <p class="leading-[1.2]">Sleep Time</p>
                    </div>
                    <input type="time"
                           id="night-mode-sleep-time"
                           class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] p-2 text-center"
                           value="${minutesToTimeString(sleepTime)}"
                           onchange="handleNightModeTimeChange('sleep', this.value)">
                </div>
                <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                    Time to start night charging mode (e.g. 22:00)
                </p>
            </div>
        </div>

        <!-- Divider -->
        <div class="h-0 relative w-full">
            <hr class="border-t border-[#c9c9c9] w-full" />
        </div>

        <div class="content-stretch flex flex-col items-start relative w-full">
            <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                <div class="content-stretch flex items-center justify-between relative w-full">
                    <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                        <p class="leading-[1.2]">Morning Time</p>
                    </div>
                    <input type="time"
                           id="night-mode-morning-time"
                           class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] p-2 text-center"
                           value="${minutesToTimeString(morningTime)}"
                           onchange="handleNightModeTimeChange('morning', this.value)">
                </div>
                <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                    Time to end night charging mode (e.g. 07:00)
                </p>
            </div>
        </div>
        ` : ''}
    ` : '';

    const statusSection = chargingState ? `
        <!-- Divider -->
        <div class="h-0 relative w-full">
            <hr class="border-t border-[#c9c9c9] w-full" />
        </div>

        <div class="content-stretch flex flex-col items-start relative w-full">
            <div class="content-stretch flex flex-col gap-[20px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                    <p class="leading-[1.2]">Charging Status</p>
                </div>
                <div class="grid grid-cols-2 gap-x-8 gap-y-4 w-full text-[22px] text-[var(--text-primary)]">
                    <span class="font-semibold">Battery</span>
                    <span>${chargingState.batteryPercent ?? '--'}%${chargingState.isEmergency ? ' (emergency)' : ''}</span>
                    <span class="font-semibold">Phase</span>
                    <span>${phaseLabels[chargingState.currentPhase] || chargingState.currentPhase || '--'}</span>
                    <span class="font-semibold">USB Charger</span>
                    <span>${chargingState.usbChargerOn ? 'On' : 'Off'}</span>
                </div>
            </div>
        </div>
    ` : '';

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Smart Charging</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Charging Mode</p>
                        </div>
                        <select id="charging-mode-select"
                                class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[250px] text-white text-[24px] p-2"
                                onchange="handleSmartChargingModeChange(this.value)">
                            ${modeOptions}
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Disabled turns off smart charging. Longevity caps at 80%, Balanced at 90%, High Availability charges to full when needed.
                    </p>
                </div>
            </div>

            ${nightModeSection}
            ${statusSection}
        </div>
    `;
}


// Render Steam settings
export function renderSteamSettings() {
    if (!settingsCache.de1 && !settingsCache.workflow) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">Steam Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load settings</div>
            </div>
        `;
    }

    const steamSettings = settingsCache.workflow?.steamSettings || {};
    const targetTemp = steamSettings.targetTemperature || 150;
    const duration = steamSettings.duration || 60;
    const flow = steamSettings.flow || 0.9;

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Steam Settings</p>
            </div>

            <!-- Steam Temperature -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Target Temperature (°C)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="steamTempInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${targetTemp}" step="1" min="130" max="170">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateSteamSetting('targetTemperature', parseInt(document.getElementById('steamTempInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Steam temperature setting (130-170°C)
                    </p>
                </div>
            </div>

            <!-- Steam Duration -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Duration (seconds)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="steamDurationInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${duration}" step="5" min="10" max="120">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateSteamSetting('duration', parseInt(document.getElementById('steamDurationInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Steam duration in seconds
                    </p>
                </div>
            </div>

            <!-- Steam Flow -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Flow</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="steamFlowInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${flow.toFixed(1)}" step="0.1" min="0.1" max="2.5">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateSteamSetting('flow', parseFloat(document.getElementById('steamFlowInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Steam flow rate (0.1 - 2.5)
                    </p>
                </div>
            </div>

            <!-- Steam Purge Mode (from DE1 settings) -->
            ${settingsCache.de1 ? `
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Steam Purge Mode</p>
                        </div>
                        <select class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2"
                                onchange="window.updateDe1Setting('steamPurgeMode', this.value)">
                            <option value="0" ${settingsCache.de1.steamPurgeMode === 0 ? 'selected' : ''}>Normal</option>
                            <option value="1" ${settingsCache.de1.steamPurgeMode === 1 ? 'selected' : ''}>Two Tap Stop</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Set the steam purge mode for the machine
                    </p>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

// Render Hot Water settings
export function renderHotWaterSettings() {
    if (!settingsCache.de1 && !settingsCache.workflow) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">Hot Water Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load settings</div>
            </div>
        `;
    }

    const hotWaterData = settingsCache.workflow?.hotWaterData || {};
    const targetTemp = hotWaterData.targetTemperature || 75;
    const volume = hotWaterData.volume || 50;
    const duration = hotWaterData.duration || 30;
    const flow = hotWaterData.flow || 2.5;

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Hot Water Settings</p>
            </div>

            <!-- Hot Water Temperature -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Target Temperature (°C)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="hotWaterTempInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${targetTemp}" step="1" min="50" max="95">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateHotWaterSetting('targetTemperature', parseInt(document.getElementById('hotWaterTempInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Hot water temperature (50-95°C)
                    </p>
                </div>
            </div>

            <!-- Hot Water Volume -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Volume (ml)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="hotWaterVolumeInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${volume}" step="10" min="10" max="500">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateHotWaterSetting('volume', parseInt(document.getElementById('hotWaterVolumeInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Hot water volume in ml
                    </p>
                </div>
            </div>

            <!-- Hot Water Duration -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Duration (seconds)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="hotWaterDurationInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${duration}" step="5" min="5" max="120">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateHotWaterSetting('duration', parseInt(document.getElementById('hotWaterDurationInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Hot water duration in seconds
                    </p>
                </div>
            </div>

            <!-- Hot Water Flow (from workflow) -->
            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Flow (ml/s)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="hotWaterFlowInput" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${flow.toFixed(1)}" step="0.1" min="0.1" max="8">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold"
                                    onclick="window.updateHotWaterSetting('flow', parseFloat(document.getElementById('hotWaterFlowInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Flow rate for hot water (0.1 - 8.0 ml/s)
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render Water Tank settings
export function renderWaterTankSettings() {
    if (!settingsCache.de1) {
        return `
            <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                    <p class="leading-[1.2]">Water Tank Settings</p>
                </div>
                <div class="text-red-500 p-4 text-[24px]">Failed to load DE1 settings</div>
            </div>
        `;
    }

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Water Tank Settings</p>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-center relative w-full">
                <div class="border border-[#c9c9c9] border-solid content-stretch flex flex-col gap-[30px] items-center px-[60px] py-[30px] relative shrink-0 w-[590px]">
                    <div class="content-stretch flex items-center relative shrink-0">
                        <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.2] not-italic relative shrink-0 text-[var(--text-primary)] text-[30px]">
                            Tank Temperature
                        </p>
                    </div>
                    <div class="content-stretch flex gap-[20px] h-[72px] items-center justify-center relative shrink-0 w-full">
                        <button id="tank-temp-minus" class="w-[72px] h-[72px] bg-[var(--button-grey)] rounded-[20px] flex items-center justify-center"
                                onclick="window.flashPlusMinusButton(this); window.adjustTankTemp(-1);">
                            <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10.416 25H39.5827" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <div class="text-center text-[var(--text-primary)] text-[24px] font-bold bg-transparent border-none flex items-center justify-center"
                             style="width: 130px;">
                            <input type="text" inputmode="numeric" pattern="[0-9]*" id="tankTempInput" class="text-center text-[var(--text-primary)] text-[24px] font-bold bg-transparent border-none w-full"
                                   value="${settingsCache.de1.tankTemp !== undefined ? settingsCache.de1.tankTemp : 25}"
                                   step="1" min="10" max="40"
                                   onchange="window.updateDe1Setting('tankTemp', parseInt(this.value))">
                            <span class="ml-2 text-nowrap">°C</span>
                        </div>
                        <button id="tank-temp-plus" class="w-[72px] h-[72px] bg-[var(--button-grey)] rounded-[20px] flex items-center justify-center"
                                onclick="window.flashPlusMinusButton(this); window.adjustTankTemp(1);">
                            <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M24.9993 10.4165V39.5832M10.416 24.9998H39.5827" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full text-center">
                        Set the water tank temperature (10-40°C)
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render quick adjustments settings
export function renderQuickAdjustmentsSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Quick Adjustments</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Flow Multiplier</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center" value="1.0" step="0.1">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Adjust the flow multiplier for shot timing
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Steam</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center" value="120" step="1">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Set steam temperature
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Water</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center" value="80" step="1">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Set water temperature
                    </p>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Limit</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center" value="30" step="1">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[100px] text-white text-[24px] font-bold">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Set brewing time limit
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render calibration settings with additional subcategories
export function renderCalibFanSettings(settings) {
    const fanValue = settings?.fan !== undefined ? settings.fan : '';
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Fan Threshold Settings</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p id="calib-fan-label" class="leading-[1.2]">Fan Threshold (°C)</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" id="calibFanInput" aria-labelledby="calib-fan-label"
                                   class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center"
                                   value="${fanValue}" step="1" min="0" max="100">
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold"
                                    aria-label="Save fan threshold"
                                    onclick="window.updateDe1Setting('fan', parseInt(document.getElementById('calibFanInput').value))">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Temperature threshold at which the fan turns on
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderCalibDefaultLoadSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Default Load Settings</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Default Load Settings</p>
                        </div>
                        <button disabled class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold cursor-not-allowed">
                            Reset
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderCalibRefillKitSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Refill Kit</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Refill Kit</p>
                        </div>
                        <button disabled class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold cursor-not-allowed">
                            Calibrate
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderCalibVoltageSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Voltage</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Voltage</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" disabled class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center cursor-not-allowed" value="120" step="0.1">
                            <button disabled class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold cursor-not-allowed">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderCalibStopAtWeightSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Stop at Weight</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Stop at Weight</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" disabled class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center cursor-not-allowed" value="36" step="0.1">
                            <button disabled class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold cursor-not-allowed">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderCalibSlowStartSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Slow Start</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Slow Start</p>
                        </div>
                        <select disabled class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2 cursor-not-allowed">
                            <option>Enabled</option>
                            <option>Disabled</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderCalibSteamSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Steam Calibration</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Steam Calibration</p>
                        </div>
                        <div class="flex items-center gap-4">
                            <input type="number" disabled class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[10px] w-[150px] text-white text-[24px] p-2 text-center cursor-not-allowed" value="120" step="1">
                            <button disabled class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold cursor-not-allowed">
                                Save
                            </button>
                        </div>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderMainDescalingSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Machine Descaling</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Machine Descaling</p>
                        </div>
                        <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold"
                                onclick="window.startDescaling()">
                            Start
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Run a descaling cycle to remove mineral buildup
                    </p>
                </div>
            </div>
        </div>
    `;
}

export function renderMainTransportSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Transport Mode</p>
            </div>

            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>

            <div class="content-stretch flex flex-col items-start relative w-full opacity-50">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Transport Mode</p>
                        </div>
                        <select disabled class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[200px] text-white text-[24px] p-2 cursor-not-allowed">
                            <option>Disabled</option>
                            <option>Enabled</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-secondary)] text-[24px] w-full">
                        Not supported by current firmware API
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render skin settings
export function renderSkinSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Skin Settings</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Theme</p>
                        </div>
                        <input type="checkbox" id="theme-toggle" class="toggle toggle-lg toggle-primary">
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Toggle between light and dark themes
                    </p>
                </div>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Skin 1</p>
                        </div>
                        <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold">
                            Apply
                        </button>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Apply the first skin/theme
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Render language settings with additional subcategories
export function renderLanguageSettings() {
    setTimeout(() => {
        const switcher = document.getElementById('language-switcher');
        if (!switcher) return;

        const supported = getSupportedLanguages();
        const current = getCurrentLanguage();

        switcher.innerHTML = '';
        supported.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang;
            try {
                option.textContent = new Intl.DisplayNames([lang], { type: 'language' }).of(lang);
            } catch {
                option.textContent = lang;
            }
            if (lang === current) {
                option.selected = true;
            }
            switcher.appendChild(option);
        });

        switcher.addEventListener('change', (event) => {
            setLanguage(event.target.value);
        });
    }, 0);

    return `
        <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px] text-center w-full">
                <p class="leading-[1.2]">Language Settings</p>
            </div>
            <div class="h-0 relative w-full"><hr class="border-t border-[#c9c9c9] w-full" /></div>
            <div class="flex flex-col items-start relative w-full max-w-full">
                <div class="flex flex-col gap-[30px] items-start relative w-full max-w-full">
                    <div class="flex items-center justify-between relative w-full max-w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Display Language</p>
                        </div>
                        <select id="language-switcher" class="bg-[#385a92] border-2 border-[#385a92] border-solid h-[62.88px] rounded-[2617.374px] w-[250px] text-white text-[24px] p-2 max-w-[250px]">
                            <option>Loading...</option>
                        </select>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full max-w-full break-words">
                        Choose the language for the application interface.
                    </p>
                </div>
            </div>


    `;
}

// Render extensions settings
export function renderExtensionsSettings() {
    // Return the HTML template
    const template = `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Extensions Settings</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full">
                <div class="content-stretch flex flex-col gap-[30px] items-start relative w-full">
                    <div class="content-stretch flex items-center justify-between relative w-full">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Visualizer</p>
                             <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full">
                        Upload shots to visualizer.coffee
                    </p>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="visualizer-enabled" class="sr-only peer">
                            <div class="w-[100px] h-[50px] bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[5px] after:start-[5px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[40px] after:w-[40px] after:transition-all peer-checked:bg-[#385a92]"></div>
                        </label>
                    </div>

                    <div class="justify-between grid-cols-4 mt-2 w-full">
                        <div id="visualizer-form-container" class="w-full mt-6">
                            <div class="grid grid-cols-4">
                                <div class="col-span-3 flex flex-col gap-6">
                                    <div class="flex flex-col gap-2">
                                        <label for="visualizer-username" class="text-[var(--text-primary)] text-[24px]">Username:</label>
                                        <input type="text" id="visualizer-username" class="w-full max-w-[500px] p-3 rounded-lg border border-[var(--border-color)] bg-[var(--profile-button-background-color)] text-[var(--text-primary)] text-[24px] focus:outline-none focus:ring-2 focus:ring-[var(--mimoja-blue)]" placeholder="Enter your Visualizer username">
                                    </div>
                                    <div class="flex flex-col gap-2">
                                        <label for="visualizer-password" class="text-[var(--text-primary)] text-[24px]">Password:</label>
                                        <input type="password" id="visualizer-password" class="w-full max-w-[500px] p-3 rounded-lg border border-[var(--border-color)] bg-[var(--profile-button-background-color)] text-[var(--text-primary)] text-[24px] focus:outline-none focus:ring-2 focus:ring-[var(--mimoja-blue)]" placeholder="Enter your Visualizer password">
                                    </div>
                                    <div class="flex items-center gap-4">
                                        <label for="visualizer-auto-upload" class="text-[var(--text-primary)] text-[24px]">Auto-upload shots to Visualizer</label>
                                        <input type="checkbox" id="visualizer-auto-upload" class="w-8 h-8">
                                    </div>
                                    <div class="flex items-center gap-4">
                                        <label for="visualizer-min-duration" class="text-[var(--text-primary)] text-[24px]">Minimum Shot Duration (seconds):</label>
                                        <input type="number" id="visualizer-min-duration" class="w-24 p-3 rounded-lg border border-[var(--border-color)] bg-[var(--profile-button-background-color)] text-[var(--text-primary)] text-[24px] focus:outline-none focus:ring-2 focus:ring-[var(--mimoja-blue)]" min="1" value="5">
                                    </div>
                                </div>
                                <div class="col-span-1 col-end-5 flex justify-end">
                                    <button id="save-visualizer-credentials" class=" w-[150px] h-[50px] pt-3 pb-[15px] border border-solid border-[var(--mimoja-blue)] text-[var(--profile-button-text-color)] rounded-[22.5px]">
                                        Save Credentials
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>

                   

                    
                </div>
            </div>

            
        </div>
    `;

    // After returning the template, set up the event listeners
    setTimeout(setupVisualizerEventListeners, 0);

    return template;
}

// Function to set up event listeners for the Visualizer settings
function setupVisualizerEventListeners() {
    const saveButton = document.getElementById('save-visualizer-credentials');
    const usernameInput = document.getElementById('visualizer-username');
    const passwordInput = document.getElementById('visualizer-password');
    const autoUploadCheckbox = document.getElementById('visualizer-auto-upload');
    const minDurationInput = document.getElementById('visualizer-min-duration');
    const statusDiv = document.getElementById('visualizer-status');
    const formContainer = document.getElementById('visualizer-form-container');
    const enabledToggle = document.getElementById('visualizer-enabled');

    if (!saveButton) {
        console.warn('Save button for Visualizer credentials not found');
        return;
    }

    // Load existing settings when the form loads
    loadVisualizerSettings();

    // Initially hide the form if auto-upload is disabled
    if (autoUploadCheckbox && formContainer) {
        if (!autoUploadCheckbox.checked) {
            formContainer.style.display = 'none';
        }
    }

    // Sync the enabled toggle with auto-upload checkbox
    if (enabledToggle && autoUploadCheckbox) {
        enabledToggle.checked = autoUploadCheckbox.checked;
        
        enabledToggle.addEventListener('change', async function() {
            const isEnabled = this.checked;
            
            // Sync with auto-upload checkbox
            autoUploadCheckbox.checked = isEnabled;
            
            // Toggle form visibility
            formContainer.style.display = isEnabled ? 'block' : 'none';
            
            // Save the AutoUpload state to plugin
            try {
                const { setPluginSettings } = await import('../modules/api.js');
                const pluginId = 'visualizer.reaplugin';
                
                await setPluginSettings(pluginId, { AutoUpload: isEnabled });
                localStorage.setItem('visualizerAutoUpload', isEnabled.toString());
                ui.showToast(`Visualizer ${isEnabled ? 'enabled' : 'disabled'}`, 1500, 'success');
            } catch (error) {
                console.error('Failed to save Visualizer state:', error);
                ui.showToast('Failed to update Visualizer state', 2000, 'error');
            }
        });
    }

    // Auto-upload checkbox also controls form visibility and syncs with toggle
    if (autoUploadCheckbox) {
        autoUploadCheckbox.addEventListener('change', async function() {
            const isAutoUpload = this.checked;
            
            // Sync with enabled toggle
            if (enabledToggle) {
                enabledToggle.checked = isAutoUpload;
            }
            
            // Toggle form visibility
            if (formContainer) {
                formContainer.style.display = isAutoUpload ? 'block' : 'none';
            }
            
            // Save the AutoUpload state to plugin
            try {
                const { setPluginSettings } = await import('../modules/api.js');
                const pluginId = 'visualizer.reaplugin';
                
                await setPluginSettings(pluginId, { AutoUpload: isAutoUpload });
                localStorage.setItem('visualizerAutoUpload', isAutoUpload.toString());
            } catch (error) {
                console.error('Failed to save Visualizer auto-upload state:', error);
            }
        });
    }

    // Add click handler for the save button
    saveButton.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value; // Don't trim password as spaces might be valid

        if (!username || !password) {
            ui.showToast('Please enter both username and password', 1500, 'error');
            return;
        }

        try {
            // Import verifyVisualizerCredentials from api.js
            const { verifyVisualizerCredentials } = await import('../modules/api.js');

            const isValid = await verifyVisualizerCredentials(username, password);

            if (!isValid) {
                ui.showToast('Visualizer log-in failed, check credentials', 900, 'error');
                return; // Stop here if credentials are bad
            }

            ui.showToast('Visualizer log-in success', 900, 'success');

            // If credentials are valid, proceed to save to plugin
            const autoUpload = autoUploadCheckbox.checked;
            const minDuration = parseInt(minDurationInput.value, 10) || 5;

            // 1. Save UI-only settings to localStorage
            localStorage.setItem('visualizerAutoUpload', autoUpload.toString());

            // 2. Prepare and save plugin settings - use correct field names expected by visualizer plugin manifest
            const { setPluginSettings } = await import('../modules/api.js');
            const pluginId = 'visualizer.reaplugin';

            const settingsPayload = {
                Username: username,
                Password: password,
                AutoUpload: autoUpload,
                LengthThreshold: minDuration
            };

            try {
                await setPluginSettings(pluginId, settingsPayload);
                ui.showToast('Visualizer settings saved successfully', 3000, 'success');
            } catch (error) {
                console.error('Failed to save visualizer plugin settings:', error);
                ui.showToast(`Failed to save to REA plugin: ${error.message}`, 3000, 'error');
            }
        } catch (error) {
            console.error('Error during credential validation:', error);
            ui.showToast(`Error validating credentials: ${error.message}`, 3000, 'error');
        }
    });
}

// Function to load existing Visualizer settings
async function loadVisualizerSettings() {
    try {
        const { getPluginSettings } = await import('../modules/api.js');
        const pluginId = 'visualizer.reaplugin';

        const savedSettings = await getPluginSettings(pluginId);

        const usernameInput = document.getElementById('visualizer-username');
        const passwordInput = document.getElementById('visualizer-password');
        const autoUploadCheckbox = document.getElementById('visualizer-auto-upload');
        const minDurationInput = document.getElementById('visualizer-min-duration');
        const formContainer = document.getElementById('visualizer-form-container');
        const enabledToggle = document.getElementById('visualizer-enabled');

        if (savedSettings && savedSettings.Username) {
            usernameInput.value = savedSettings.Username;
        } else {
            usernameInput.value = '';
        }

        // Always clear the password field for security
        passwordInput.value = '';

        const autoUploadValue = typeof savedSettings.AutoUpload !== 'undefined' ? savedSettings.AutoUpload : true;
        autoUploadCheckbox.checked = !!autoUploadValue;

        // Sync toggle with auto-upload
        if (enabledToggle) {
            enabledToggle.checked = !!autoUploadValue;
        }

        // Visualizer plugin uses 'Length' not 'LengthThreshold'
        if (typeof savedSettings.Length !== 'undefined') {
            minDurationInput.value = parseInt(savedSettings.Length, 10) || 5;
        }

        // Set form visibility based on the autoUpload state
        if (formContainer) {
            formContainer.style.display = autoUploadValue ? 'block' : 'none';
        }
    } catch (error) {
        console.error('Failed to load Visualizer settings:', error);
        ui.showToast('Could not load Visualizer plugin settings', 3000, 'error');
    }
}

// Render updates settings
export function renderUpdatesSettings() {
    const appInfo = settingsCache.appInfo;
    const infoAvailable = !!appInfo;
    const appInfoDetails = infoAvailable ? `
                <div class="grid gap-4 sm:grid-cols-2">
                    <div class="rounded-[10px] border border-[#c9c9c9] p-4 bg-[var(--box-color)]">
                        <p class="text-[20px] font-['Inter:Bold',sans-serif] font-bold text-[#385a92]">Version</p>
                        <p class="text-[24px] font-['Inter:Regular',sans-serif]">${appInfo.version} (${appInfo.buildNumber})</p>
                        <p class="text-[16px] text-[var(--text-secondary)]">Full: ${appInfo.fullVersion}</p>
                        <p class="text-[16px] text-[var(--text-secondary)]">${formatBuildTimestamp(appInfo.buildTime)}</p>
                    </div>
                    <div class="rounded-[10px] border border-[#c9c9c9] p-4 bg-[var(--box-color)]">
                        <p class="text-[20px] font-['Inter:Bold',sans-serif] font-bold text-[#385a92]">Source</p>
                        <p class="text-[24px] font-['Inter:Regular',sans-serif]">${appInfo.branch}</p>
                        <p class="text-[16px] text-[var(--text-secondary)]">Commit: ${appInfo.commitShort}</p>
                        <p class="text-[16px] text-[var(--text-secondary)]">App Store: ${appInfo.appStore ? 'Yes' : 'No'}</p>
                    </div>
                </div>
            ` : `
                <div class="rounded-[10px] border border-[#c9c9c9] p-4 bg-[var(--box-color)]">
                    <p class="text-[20px] font-['Inter:Bold',sans-serif] font-bold text-[#385a92]">Update info</p>
                    <p class="text-[24px] font-['Inter:Regular',sans-serif]">Fetching build metadata...</p>
                </div>
            `;

    const machineInfo = settingsCache.machineInfo;
    const machineExtra = formatMachineExtra(machineInfo?.extra);
    const machineDetails = machineInfo ? `
                <div class="rounded-[10px] border border-[#c9c9c9] p-4 bg-[var(--box-color)]">
                    <p class="text-[20px] font-['Inter:Bold',sans-serif] font-bold text-[#385a92]">Machine</p>
                    <p class="text-[24px] font-['Inter:Regular',sans-serif]">${machineInfo.model}</p>
                    <p class="text-[16px] text-[var(--text-secondary)]">Version: ${machineInfo.version}</p>
                    <p class="text-[16px] text-[var(--text-secondary)]">Serial: ${machineInfo.serialNumber}</p>
                    <p class="text-[16px] text-[var(--text-secondary)]">GHC: ${machineInfo.GHC ? 'Enabled' : 'Disabled'}</p>
                    <p class="text-[16px] text-[var(--text-secondary)] break-words">${machineExtra}</p>
                </div>
            ` : `
                <div class="rounded-[10px] border border-[#c9c9c9] p-4 bg-[var(--box-color)]">
                    <p class="text-[20px] font-['Inter:Bold',sans-serif] font-bold text-[#385a92]">Machine Info</p>
                    <p class="text-[24px] font-['Inter:Regular',sans-serif]">Fetching machine info...</p>
                </div>
            `;

    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">Updates Settings</p>
            </div>

            <div class="content-stretch flex flex-col items-start relative w-full space-y-10">
                <div class="flex flex-col gap-[30px] w-full">
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center justify-between">
                            <div class="font-['Inter:Bold',sans-serif] font-bold text-[#385a92] text-[30px]">Firmware Update</div>
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold">Check</button>
                        </div>
                        <p class="text-[24px] text-[var(--text-primary)]">Check for firmware updates</p>
                    </div>

                    <div class="flex flex-col gap-3">
                        <div class="flex items-center justify-between">
                            <div class="font-['Inter:Bold',sans-serif] font-bold text-[#385a92] text-[30px]">App Update</div>
                            <button class="bg-[#385a92] h-[62.88px] rounded-[10px] w-[200px] text-white text-[24px] font-bold">Check</button>
                        </div>
                        <p class="text-[24px] text-[var(--text-primary)]">Check for application updates</p>
                    </div>
                </div>

                <div class="w-full flex flex-col gap-4">
                    <div class="flex flex-col gap-4">
                        <p class="font-['Inter:Bold',sans-serif] font-bold text-[#385a92] text-[30px]">Build Information</p>
                        ${appInfoDetails}
                    </div>
                    <div class="flex flex-col gap-4">
                        <p class="font-['Inter:Bold',sans-serif] font-bold text-[#385a92] text-[30px]">Machine Details</p>
                        ${machineDetails}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Render general settings
export function renderGeneralSettings() {
    return `
        <div class="content-stretch flex flex-col gap-[60px] items-start relative w-full">
            <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] min-w-full not-italic relative text-[var(--text-primary)] text-[36px] text-center w-[min-content]">
                <p class="leading-[1.2]">General Settings</p>
            </div>

            <div class="text-[24px] text-[var(--text-primary)] p-4">
                Select a category from the navigation panel to view and edit settings.
            </div>
        </div>
    `;
}

// Render subcategories for a selected main category
export function renderSubcategories(mainCategoryKey) {
    const category = settingsTree[mainCategoryKey];
    if (!category || !category.subcategories || category.subcategories.length === 0) {
        return `<div class="p-4 text-center text-gray-500">No sub-categories.</div>`;
    }

    let subcategoryItems = '';
    category.subcategories.forEach((subcat) => {
        subcategoryItems += `
            <li>
                <button class="settings-subnav-btn w-full text-left px-4 py-3 rounded-lg text-[20px] text-[#959595] hover:text-white hover:bg-[#2c4a7a] flex items-center"
                        data-category="${subcat.settingsCategory}">
                    <span>${subcat.name}</span>
                </button>
            </li>
        `;
    });

    return `<ul class="space-y-1">${subcategoryItems}</ul>`;
}


function initResizableSubNav() {
    const separator = document.getElementById('sub-categories-separator');
    const mainCategoriesPanel = document.getElementById('main-categories-panel');
    const subCategoriesPanel = document.getElementById('sub-categories-panel');

    if (!separator || !mainCategoriesPanel || !subCategoriesPanel) {
        console.warn('Resizable sub-navigation elements not found.');
        return;
    }

    let isDragging = false;

    separator.addEventListener('mousedown', (e) => {
        isDragging = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const startX = e.clientX;
        const startMainWidth = mainCategoriesPanel.offsetWidth;
        const startSubWidth = subCategoriesPanel.offsetWidth;

        function doDrag(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const newMainWidth = startMainWidth + dx;
            const newSubWidth = startSubWidth - dx;

            if (newMainWidth > 150 && newSubWidth > 150) {
                mainCategoriesPanel.style.width = `${newMainWidth}px`;
                subCategoriesPanel.style.width = `${newSubWidth}px`;
            }
        }

        function stopDrag() {
            isDragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
        }

        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    });
}


// Cache for loading promises to prevent multiple simultaneous requests
let settingsLoadingPromises = {};

// Preload all settings in the background
export async function preloadSettings() {
    // If we're already preloading, return the existing promise
    if (settingsLoadingPromises.preload) {
        return settingsLoadingPromises.preload;
    }

    settingsLoadingPromises.preload = _preloadSettingsInternal();
    return settingsLoadingPromises.preload;
}

// Internal function to preload all settings
async function _preloadSettingsInternal() {
    try {
        // Set loading flags
        settingsCache.reaLoading = true;
        settingsCache.de1Loading = true;
        settingsCache.de1AdvancedLoading = true;
        settingsCache.appInfoLoading = true;

        // Reset error flags
        settingsCache.reaError = null;
        settingsCache.de1Error = null;
        settingsCache.de1AdvancedError = null;
        settingsCache.appInfoError = null;

        // Fetch all settings in parallel using Promise.allSettled to handle individual failures
        // Fetch all settings in parallel using Promise.allSettled to handle individual failures
        const [reaSettingsResult, de1SettingsResult, de1AdvancedSettingsResult, appInfoResult, machineInfoResult] = await Promise.allSettled([
            getReaSettings(),
            getDe1Settings(),
            getDe1AdvancedSettings(),
            getAppInfo(),
            getMachineInfo()
        ]);

        // Process results and handle errors appropriately
        let reaSettings = null;
        let de1Settings = null;
        let de1AdvancedSettings = null;
        let appInfo = null;
        let machineInfo = null;

        // Handle REA settings result
        if (reaSettingsResult.status === 'fulfilled') {
            reaSettings = reaSettingsResult.value;
        } else {
            console.error('Error loading REA settings:', reaSettingsResult.reason);
            settingsCache.reaError = reaSettingsResult.reason.message;

            // Check if this is a 500 error and redirect if needed
            if (reaSettingsResult.reason.status === 500) {
                console.log('REA settings API returned 500 error, redirecting to home page');
                setTimeout(() => {
                    ui.showToast('Unable to load settings. Check if De1 is connected. Returned to home page.', 5000, 'error');
                }, 1000);

                loadPage('index.html');
                return { reaSettings: null, de1Settings: null, de1AdvancedSettings: null, appInfo: null, machineInfo: null };
            }
        }

        // Handle DE1 settings result
        if (de1SettingsResult.status === 'fulfilled') {
            de1Settings = de1SettingsResult.value;
        } else {
            console.error('Error loading DE1 settings:', de1SettingsResult.reason);
            settingsCache.de1Error = de1SettingsResult.reason.message;

            // Check if this is a 500 error and redirect if needed
            if (de1SettingsResult.reason.status === 500) {
                console.log('DE1 settings API returned 500 error, redirecting to home page');
                setTimeout(() => {
                    ui.showToast('Unable to load settings. Check if De1 is connected. Returned to home page.', 5000, 'error');
                }, 1000);
                loadPage('index.html');

                return { reaSettings: null, de1Settings: null, de1AdvancedSettings: null, appInfo: null, machineInfo: null };
            }
        }

        // Handle DE1 advanced settings result
        if (de1AdvancedSettingsResult.status === 'fulfilled') {
            de1AdvancedSettings = de1AdvancedSettingsResult.value;
        } else {
            console.error('Error loading DE1 advanced settings:', de1AdvancedSettingsResult.reason);
            settingsCache.de1AdvancedError = de1AdvancedSettingsResult.reason.message;

            // Check if this is a 500 error and redirect if needed
            if (de1AdvancedSettingsResult.reason.status === 500) {
                console.log('DE1 advanced settings API returned 500 error, redirecting to home page');
                setTimeout(() => {
                    ui.showToast('Unable to load settings. Check if De1 is connected. Returned to home page.', 5000, 'error');
                }, 1000);
                loadPage('index.html');
                return { reaSettings: null, de1Settings: null, de1AdvancedSettings: null, appInfo: null, machineInfo: null };
            }
        }

        // Handle App Info result
        if (appInfoResult.status === 'fulfilled') {
            appInfo = appInfoResult.value;
        } else {
            console.error('Error loading app info:', appInfoResult.reason);
            settingsCache.appInfoError = appInfoResult.reason?.message || 'Failed to load update information';
        }

        // Handle Machine Info result
        if (machineInfoResult.status === 'fulfilled') {
            machineInfo = machineInfoResult.value;
        } else {
            console.error('Error loading machine info:', machineInfoResult.reason);
            settingsCache.machineInfoError = machineInfoResult.reason?.message || 'Failed to load machine details';
        }

        // Update cache with results
        settingsCache.rea = reaSettings;
        settingsCache.de1 = de1Settings;
        settingsCache.de1Advanced = de1AdvancedSettings;
        settingsCache.appInfo = appInfo;
        settingsCache.machineInfo = machineInfo;

        // Update loading flags
        settingsCache.reaLoading = false;
        settingsCache.de1Loading = false;
        settingsCache.de1AdvancedLoading = false;
        settingsCache.appInfoLoading = false;
        settingsCache.machineInfoLoading = false;

        return { reaSettings, de1Settings, de1AdvancedSettings, appInfo, machineInfo };
    } catch (error) {
        console.error('Error during settings preload:', error);
        ui.showToast('Failed to preload settings', 5000, 'error');

        // Ensure loading flags are reset even in case of error
        settingsCache.reaLoading = false;
        settingsCache.de1Loading = false;
        settingsCache.de1AdvancedLoading = false;

        return { reaSettings: null, de1Settings: null, de1AdvancedSettings: null };
    } finally {
        // Clear the preload promise after completion
        delete settingsLoadingPromises.preload;
    }
}


// Helper function to get title for a category
function getCategoryTitle(category) {
    switch(category) {
        case 'rea': return 'REA Application Settings';
        case 'quickadjustments': return 'Quick Adjustments';
        case 'flowmultiplier': return 'Flow Multiplier Settings';
        case 'steam': return 'Steam Settings';
        case 'hotwater': return 'Hot Water Settings';
        case 'watertank': return 'Water Tank Settings';
        case 'flush': return 'Flush Settings';
        case 'de1': return 'DE1 Settings';
        case 'fanthreshold': return 'Fan Threshold Settings';
        case 'usbchargermode': return 'USB Charger Mode Settings';
        case 'de1advanced': return 'Machine Advanced Settings';
        default: return 'Settings';
    }
}

// Initialize the settings page
export async function initializeSettings() {
    // Preload all settings in the background before initializing the UI
    await preloadSettings();

    // Initialize WebSocket for live device state updates
    initDeviceWebSocket();

    // Initialize WebSocket for live display state updates
    initDisplayWebSocket();

    // Set up event listeners
    const cancelBtn = document.getElementById('cancel-settings-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            // Navigate back to main page using router
            loadPage('index.html');
        });
    }

    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            ui.showToast('Saving all settings...', 3000, 'info');
            const visualizerAutoUpload = document.getElementById('visualizer-auto-upload');
            if (visualizerAutoUpload) {
                localStorage.setItem('visualizerAutoUpload', visualizerAutoUpload.checked.toString());
            }
            // Implementation would save all modified settings
            loadPage('index.html');
        });
    }

    initResizableSubNav();

    // Set up main category navigation
    document.querySelectorAll('.settings-nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Handle active state for main categories
            document.querySelectorAll('.settings-nav-btn').forEach(b => {
                b.classList.remove('text-white', 'bg-[#2c4a7a]');
                b.classList.add('text-[#959595]'); // Explicitly re-add default color
            });
            this.classList.remove('text-[#959595]'); // Explicitly remove default color
            this.classList.add('text-white', 'bg-[#2c4a7a]');

            const mainCategoryKey = this.id.replace(/-btn$/, '').replace(/-/g, '');

            // Render subcategories
            const subCategoriesPanel = document.getElementById('sub-categories-panel');
            if (subCategoriesPanel) {
                subCategoriesPanel.innerHTML = renderSubcategories(mainCategoryKey);

                // Add event listeners to the new subcategory buttons
                subCategoriesPanel.querySelectorAll('.settings-subnav-btn').forEach(subBtn => {
                    subBtn.addEventListener('click', function(e) {
                        e.preventDefault(); // Prevent any default behavior that might cause page reload
                        e.stopPropagation(); // Stop event from bubbling up

                        // Handle active state for subcategories
                        subCategoriesPanel.querySelectorAll('.settings-subnav-btn').forEach(sb => {
                             sb.classList.remove('bg-[#d7dee9]', 'text-[var(--mimoja-blue)]');
                             sb.classList.add('text-[#959595]');
                        });
                        this.classList.remove('text-[#959595]');
                        this.classList.add('bg-[#d7dee9]', 'text-[var(--mimoja-blue)]');

                        const settingsCategory = this.dataset.category;
                        activeSettingsCategory = settingsCategory; // Set the active category
                        updateSettingsContentArea(settingsCategory); // Use the new helper function
                    });
                });
            }

            // After rendering subcategories, attempt to click the first one if it exists
            const firstSubCategoryBtn = subCategoriesPanel?.querySelector('.settings-subnav-btn');
            if (firstSubCategoryBtn) {
                firstSubCategoryBtn.click();
            } else {
                // If no subcategories, clear the content area and set activeSettingsCategory to null
                const contentArea = document.getElementById('settings-content-area');
                if (contentArea) {
                    contentArea.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center p-8">
                        <p class="text-[var(--text-primary)] text-[28px]">Select a sub-category from the menu</p>
                    </div>`;
                    activeSettingsCategory = null;
                }
            }
        });
    });

    // Initial load of settings content: Simulate a click on the first main category button
    const firstMainCategoryBtn = document.querySelector('.settings-nav-btn');
    if (firstMainCategoryBtn) {
        firstMainCategoryBtn.click();
    } else {
        // Fallback if no main category buttons are found
        const contentArea = document.getElementById('settings-content-area');
        if (contentArea) {
             contentArea.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center p-8">
                 <p class="text-[var(--text-primary)] text-[28px]">No settings categories found.</p>
             </div>`;
             activeSettingsCategory = null;
        }
    }

    // Set up search functionality
    setupSettingsSearch();

    // Apply translations to the settings page
    setLanguage(getCurrentLanguage());

    // Expose update functions to global scope for inline event handlers
    window.updateReaSetting = updateReaSetting;
    window.updateDe1Setting = updateDe1Setting;
    window.updateDe1AdvancedSetting = updateDe1AdvancedSetting;

    window.startDescaling = async function() {
        if (!confirm('Start descaling cycle? The machine will run the descaling program. Make sure the descaling solution is prepared.')) return;
        try {
            await setMachineState('descaling');
            ui.showToast('Descaling cycle started', 3000, 'success');
        } catch (error) {
            logger.error('Error starting descaling:', error);
            ui.showToast(`Failed to start descaling: ${error.message}`, 5000, 'error');
        }
    };
    window.updateSteamSetting = updateSteamSetting;
    window.updateHotWaterSetting = updateHotWaterSetting;
    window.flashPlusMinusButton = ui.flashPlusMinusButton;
    window.retryLoadSettings = () => {
        // Function to retry loading settings when user clicks retry button
        loadSettings();
    };

    // Expose flush adjustment functions to global scope
    window.adjustFlushTemp = function(change) {
        const input = document.getElementById('flushTempInput');
        if (input) {
            let newValue = parseFloat(input.value) + change;
            // Ensure value stays within bounds (5 to 95 degrees)
            newValue = Math.max(5, Math.min(95, newValue));
            input.value = newValue.toFixed(1);
            // Trigger the onchange event to update the setting
            input.dispatchEvent(new Event('change'));
        }
    };

    window.adjustFlushFlow = function(change) {
        const input = document.getElementById('flushFlowInput');
        if (input) {
            let newValue = parseFloat(input.value) + change;
            // Ensure value stays within bounds (1 to 8 ml/s)
            newValue = Math.max(1, Math.min(8, newValue));
            input.value = newValue.toFixed(1);
            // Trigger the onchange event to update the setting
            input.dispatchEvent(new Event('change'));
        }
    };

    window.adjustHotWaterFlow = function(change) {
        const input = document.getElementById('hotWaterFlowInput');
        if (input) {
            let newValue = parseFloat(input.value) + change;
            // Ensure value stays within bounds (0 to 10 ml/s)
            newValue = Math.max(0, Math.min(10, newValue));
            input.value = newValue.toFixed(1);
            // Trigger the onchange event to update the setting
            input.dispatchEvent(new Event('change'));
        }
    };

    window.adjustTankTemp = function(change) {
        const input = document.getElementById('tankTempInput');
        if (input) {
            let newValue = parseInt(input.value, 10) + change;
            // Ensure value stays within bounds (10 to 40°C)
            newValue = Math.max(10, Math.min(40, newValue));
            input.value = newValue;
            // Trigger the onchange event to update the setting
            input.dispatchEvent(new Event('change'));
        }
    };

    ui.initResizablePanels('separator');
}

// Set up search functionality for settings
function setupSettingsSearch() {
    const searchInput = document.getElementById('settings-search');
    if (!searchInput) {
        console.warn('Settings search input not found');
        return;
    }

    // Store original navigation structure
    const originalMainCategories = {};
    Object.keys(settingsTree).forEach(key => {
        originalMainCategories[key] = { ...settingsTree[key] };
    });

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();

        if (searchTerm === '') {
            // If search is empty, restore original navigation
            restoreOriginalNavigation();
            return;
        }

        // Filter categories based on search term
        const filteredCategories = {};
        
        Object.entries(settingsTree).forEach(([key, category]) => {
            // Check if main category name matches
            const mainCategoryMatches = category.name.toLowerCase().includes(searchTerm);
            
            // Filter subcategories that match
            const matchingSubcategories = category.subcategories.filter(subcat => 
                subcat.name.toLowerCase().includes(searchTerm) || 
                subcat.id.toLowerCase().includes(searchTerm)
            );

            // Include the category if either main name matches or any subcategory matches
            if (mainCategoryMatches || matchingSubcategories.length > 0) {
                filteredCategories[key] = {
                    name: category.name,
                    subcategories: matchingSubcategories.length > 0 ? matchingSubcategories : category.subcategories
                };
            }
        });

        // Update the navigation with filtered results
        updateNavigationWithResults(filteredCategories, searchTerm);
    });
}

// Restore original navigation when search is cleared
function restoreOriginalNavigation() {
    const mainCategoriesPanel = document.getElementById('main-categories-panel');
    if (!mainCategoriesPanel) return;

    // Clear and rebuild the main categories panel
    const navUl = mainCategoriesPanel.querySelector('nav ul');
    if (navUl) {
        navUl.innerHTML = '';
        
        Object.entries(settingsTree).forEach(([key, category]) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.id = `${key}-btn`;
            btn.className = 'settings-nav-btn w-full text-left px-4 py-3 rounded-lg text-[24px] text-[#959595] hover:text-white hover:bg-[#2c4a7a] flex items-center';
            btn.innerHTML = `<span>${category.name}</span>`;
            
            navUl.appendChild(li);
            li.appendChild(btn);
        });
    }

    // Reattach event listeners to the restored buttons
    document.querySelectorAll('.settings-nav-btn').forEach(btn => {
        // Remove any existing listeners to avoid duplicates
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', function() {
            // Handle active state for main categories
            document.querySelectorAll('.settings-nav-btn').forEach(b => {
                b.classList.remove('text-white', 'bg-[#2c4a7a]');
                b.classList.add('text-[#959595]'); // Explicitly re-add default color
            });
            this.classList.remove('text-[#959595]'); // Explicitly remove default color
            this.classList.add('text-white', 'bg-[#2c4a7a]');

            const mainCategoryKey = this.id.replace(/-btn$/, '').replace(/-/g, '');

            // Render subcategories
            const subCategoriesPanel = document.getElementById('sub-categories-panel');
            if (subCategoriesPanel) {
                subCategoriesPanel.innerHTML = renderSubcategories(mainCategoryKey);

                // Add event listeners to the new subcategory buttons
                subCategoriesPanel.querySelectorAll('.settings-subnav-btn').forEach(subBtn => {
                    subBtn.addEventListener('click', function(e) {
                        e.preventDefault(); // Prevent any default behavior that might cause page reload
                        e.stopPropagation(); // Stop event from bubbling up

                        // Handle active state for subcategories
                        subCategoriesPanel.querySelectorAll('.settings-subnav-btn').forEach(sb => {
                             sb.classList.remove('bg-[#d7dee9]', 'text-[var(--mimoja-blue)]');
                             sb.classList.add('text-[#959595]');
                        });
                        this.classList.remove('text-[#959595]');
                        this.classList.add('bg-[#d7dee9]', 'text-[var(--mimoja-blue)]');

                        const settingsCategory = this.dataset.category;
                        activeSettingsCategory = settingsCategory; // Set the active category
                        updateSettingsContentArea(settingsCategory); // Use the new helper function
                    });
                });
            }

            // After rendering subcategories, attempt to click the first one if it exists
            const firstSubCategoryBtn = subCategoriesPanel?.querySelector('.settings-subnav-btn');
            if (firstSubCategoryBtn) {
                firstSubCategoryBtn.click();
            } else {
                // If no subcategories, clear the content area and set activeSettingsCategory to null
                const contentArea = document.getElementById('settings-content-area');
                if (contentArea) {
                    contentArea.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center p-8">
                        <p class="text-[var(--text-primary)] text-[28px]">Select a sub-category from the menu</p>
                    </div>`;
                    activeSettingsCategory = null;
                }
            }
        });
    });

    // Clear the subcategories panel when restoring original navigation
    const subCategoriesPanel = document.getElementById('sub-categories-panel');
    if (subCategoriesPanel) {
        subCategoriesPanel.innerHTML = '';
    }
}

// Update navigation with search results
function updateNavigationWithResults(filteredCategories, searchTerm) {
    const mainCategoriesPanel = document.getElementById('main-categories-panel');
    if (!mainCategoriesPanel) return;

    // Clear and rebuild the main categories panel with filtered results
    const navUl = mainCategoriesPanel.querySelector('nav ul');
    if (navUl) {
        navUl.innerHTML = '';
        
        Object.entries(filteredCategories).forEach(([key, category]) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.id = `${key}-btn`;
            btn.className = 'settings-nav-btn w-full text-left px-4 py-3 rounded-lg text-[24px] text-[#959595] hover:text-white hover:bg-[#2c4a7a] flex items-center';
            
            // Highlight matching text in the category name
            const highlightedName = highlightMatch(category.name, searchTerm);
            btn.innerHTML = `<span>${highlightedName}</span>`;
            
            navUl.appendChild(li);
            li.appendChild(btn);
        });
    }

    // Attach event listeners to the filtered buttons
    document.querySelectorAll('.settings-nav-btn').forEach(btn => {
        // Remove any existing listeners to avoid duplicates
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', function() {
            // Handle active state for main categories
            document.querySelectorAll('.settings-nav-btn').forEach(b => {
                b.classList.remove('text-white', 'bg-[#2c4a7a]');
                b.classList.add('text-[#959595]'); // Explicitly re-add default color
            });
            this.classList.remove('text-[#959595]'); // Explicitly remove default color
            this.classList.add('text-white', 'bg-[#2c4a7a]');

            const mainCategoryKey = this.id.replace(/-btn$/, '').replace(/-/g, '');

            // Render matching subcategories
            const subCategoriesPanel = document.getElementById('sub-categories-panel');
            if (subCategoriesPanel) {
                subCategoriesPanel.innerHTML = renderFilteredSubcategories(mainCategoryKey, searchTerm);

                // Add event listeners to the new subcategory buttons
                subCategoriesPanel.querySelectorAll('.settings-subnav-btn').forEach(subBtn => {
                    subBtn.addEventListener('click', function(e) {
                        e.preventDefault(); // Prevent any default behavior that might cause page reload
                        e.stopPropagation(); // Stop event from bubbling up

                        // Handle active state for subcategories
                        subCategoriesPanel.querySelectorAll('.settings-subnav-btn').forEach(sb => {
                             sb.classList.remove('bg-[#d7dee9]', 'text-[var(--mimoja-blue)]');
                             sb.classList.add('text-[#959595]');
                        });
                        this.classList.remove('text-[#959595]');
                        this.classList.add('bg-[#d7dee9]', 'text-[var(--mimoja-blue)]');

                        const settingsCategory = this.dataset.category;
                        activeSettingsCategory = settingsCategory; // Set the active category
                        updateSettingsContentArea(settingsCategory); // Use the new helper function
                    });
                });
            }

            // After rendering subcategories, attempt to click the first one if it exists
            const firstSubCategoryBtn = subCategoriesPanel?.querySelector('.settings-subnav-btn');
            if (firstSubCategoryBtn) {
                firstSubCategoryBtn.click();
            } else {
                // If no subcategories, clear the content area and set activeSettingsCategory to null
                const contentArea = document.getElementById('settings-content-area');
                if (contentArea) {
                    contentArea.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center p-8">
                        <p class="text-[var(--text-primary)] text-[28px]">Select a sub-category from the menu</p>
                    </div>`;
                    activeSettingsCategory = null;
                }
            }
        });
    });
}

// Render filtered subcategories based on search term
function renderFilteredSubcategories(mainCategoryKey, searchTerm) {
    const category = settingsTree[mainCategoryKey];
    if (!category || !category.subcategories || category.subcategories.length === 0) {
        return `<div class="p-4 text-center text-gray-500">No sub-categories.</div>`;
    }

    // Filter subcategories that match the search term
    const matchingSubcategories = category.subcategories.filter(subcat => 
        subcat.name.toLowerCase().includes(searchTerm) || 
        subcat.id.toLowerCase().includes(searchTerm)
    );

    if (matchingSubcategories.length === 0) {
        return `<div class="p-4 text-center text-gray-500">No matching subcategories.</div>`;
    }

    let subcategoryItems = '';
    matchingSubcategories.forEach((subcat) => {
        // Highlight matching text in the subcategory name
        const highlightedName = highlightMatch(subcat.name, searchTerm);
        
        subcategoryItems += `
            <li>
                <button class="settings-subnav-btn w-full text-left px-4 py-3 rounded-lg text-[20px] text-[#959595] hover:text-white hover:bg-[#2c4a7a] flex items-center"
                        data-category="${subcat.settingsCategory}">
                    <span>${highlightedName}</span>
                </button>
            </li>
        `;
    });

    return `<ul class="space-y-1">${subcategoryItems}</ul>`;
}

// Highlight matching text within a string
function highlightMatch(text, searchTerm) {
    if (!searchTerm) return text;

    const regex = new RegExp(`(${searchTerm})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-300 text-black">$1</mark>');
}

/**
 * Initialize WebSocket connection for live device state updates
 * Should be called once when the settings page loads
 */
export function initDeviceWebSocket() {
    if (deviceStateCache.initialized) {
        logger.info('Device WebSocket already initialized');
        return;
    }

    connectDeviceWebSocket(
        // onData callback - update cache and re-render device lists in real-time
        (data) => {
            logger.debug('Device WebSocket data received:', data);
            deviceStateCache.devices = data.devices || [];
            deviceStateCache.scanning = data.scanning || false;
            deviceStateCache.initialized = true;

            // Always re-render device lists when new data arrives
            // This ensures live updates whenever device state changes
            renderDeviceListFromCache();
        },
        // onReconnect callback
        () => {
            logger.info('Device WebSocket reconnected');
            // Re-render to show updated connection states
            renderDeviceListFromCache();
        },
        // onDisconnect callback
        () => {
            logger.warn('Device WebSocket disconnected');
        }
    );

    deviceStateCache.initialized = true;
    logger.info('Device WebSocket initialized');
}

/**
 * Initialize display WebSocket connection
 */
export function initDisplayWebSocket() {
    connectDisplayWebSocket((data) => {
        logger.debug('Display state received:', data);

        // Update brightness slider if it exists
        const brightnessSlider = document.querySelector('input[type="range"][onchange*="handleBrightnessChange"]');
        if (brightnessSlider && data.brightness !== undefined) {
            brightnessSlider.value = data.brightness;
            previousBrightnessState = data.brightness;
        }

        // Update wake-lock toggle if it exists
        const wakeLockToggle = document.getElementById('wake-lock-toggle');
        if (wakeLockToggle && data.wakeLockEnabled !== undefined) {
            wakeLockToggle.checked = data.wakeLockEnabled;
            localStorage.setItem('wakeLockEnabled', data.wakeLockEnabled.toString());
        }
    });

    logger.info('Display WebSocket initialized');
}

/**
 * Render device lists from WebSocket cache
 */
function renderDeviceListFromCache() {
    const machines = deviceStateCache.devices.filter(device =>
        device.type === 'machine' ||
        (device.name && (device.name.toLowerCase().includes('de1') ||
                        device.name.toLowerCase().includes('espresso')))
    );

    const scales = deviceStateCache.devices.filter(device =>
        device.type === 'scale' ||
        (device.name && (device.name.toLowerCase().includes('scale') ||
                        device.name.toLowerCase().includes('weight')))
    );

    renderDeviceList('bluetooth-machine-devices-container', machines, 'Machine');
    renderDeviceList('bluetooth-scale-devices-container', scales, 'Scale');
}

// Bluetooth Functions

// Function to scan for available devices and populate the dropdowns
window.scanAndConnectEspresso = async function() {
    try {
        ui.showToast('Scanning for espresso machines...', 2000, 'info');

        // Use WebSocket to trigger scan
        sendDeviceCommand({ command: 'scan', connect: false });
        ui.showToast('Scanning started, results will appear shortly', 3000, 'info');

    } catch (error) {
        console.error('Error scanning for espresso machines:', error);
        ui.showToast(`Error scanning for devices: ${error.message}`, 5000, 'error');
    }
};

// Function to scan for scales and connect
window.scanAndConnectScale = async function() {
    try {
        ui.showToast('Scanning for weighing scales...', 2000, 'info');

        // Use WebSocket to trigger scan
        sendDeviceCommand({ command: 'scan', connect: false });
        ui.showToast('Scanning started, results will appear shortly', 3000, 'info');

    } catch (error) {
        console.error('Error scanning for scales:', error);
        ui.showToast(`Error scanning for devices: ${error.message}`, 5000, 'error');
    }
};

let previousBrightnessState = null;

window.handleBrightnessChange = async function(value) {
    try {
        const brightnessValue = parseInt(value);
        const slider = document.getElementById('brightness-slider');

        // Update slider visual fill
        if (slider) {
            const percentage = (brightnessValue / 100) * 100;
            slider.style.background = `linear-gradient(to right, #385a92 0%, #385a92 ${percentage}%, #e8e8e8 ${percentage}%, #e8e8e8 100%)`;
        }

        sendDisplayCommand({
            command: 'setBrightness',
            brightness: brightnessValue
        });
        previousBrightnessState = brightnessValue;
    } catch (error) {
        console.error('Error adjusting brightness:', error);
    }
};

window.handleBrightnessAutoToggle = async function(isEnabled) {
    try {
        const slider = document.getElementById('brightness-slider');
        if (slider) {
            slider.disabled = isEnabled;
            slider.style.opacity = isEnabled ? '0.5' : '1';
            slider.style.cursor = isEnabled ? 'not-allowed' : 'pointer';
        }

        if (isEnabled) {
            logger.info('Auto brightness enabled');
            // You can add logic here to request auto brightness from the display WebSocket
        } else {
            logger.info('Auto brightness disabled');
        }
    } catch (error) {
        console.error('Error toggling auto brightness:', error);
    }
};

// Wake Lock handlers
window.handleWakeLockToggle = async function(enabled) {
    try {
        if (enabled) {
            await enableWakeLock();
            localStorage.setItem('wakeLockEnabled', 'true');
            ui.showToast('Wake lock enabled', 3000, 'success');
        } else {
            await disableWakeLock();
            localStorage.setItem('wakeLockEnabled', 'false');
            ui.showToast('Wake lock disabled', 3000, 'success');
        }
    } catch (error) {
        console.error('Error toggling wake lock:', error);
        ui.showToast('Failed to toggle wake lock', 5000, 'error');
    }
};

// Presence Detection handlers
window.handlePresenceToggle = async function(enabled) {
    try {
        await setPresenceSettings({ userPresenceEnabled: enabled });
        ui.showToast(`Presence detection ${enabled ? 'enabled' : 'disabled'}`, 3000, 'success');
    } catch (error) {
        console.error('Error toggling presence detection:', error);
        ui.showToast('Failed to update presence detection', 5000, 'error');
    }
};

window.handleSleepTimeoutChange = async function(minutes) {
    try {
        const value = parseInt(minutes, 10);
        if (value < 1 || value > 120) {
            ui.showToast('Sleep timeout must be between 1 and 120 minutes', 5000, 'error');
            return;
        }
        await setPresenceSettings({ sleepTimeoutMinutes: value });
        ui.showToast('Sleep timeout updated', 3000, 'success');
    } catch (error) {
        console.error('Error updating sleep timeout:', error);
        ui.showToast('Failed to update sleep timeout', 5000, 'error');
    }
};

window.handleAddSchedule = function() {
    document.getElementById('add-schedule-modal').showModal();
};

window.handleSaveSchedule = async function() {
    try {
        const timeInput = document.getElementById('schedule-time-input').value;
        if (!timeInput) {
            ui.showToast('Please select a time', 3000, 'error');
            return;
        }

        const checkboxes = document.querySelectorAll('#add-schedule-modal input[type="checkbox"]:checked');
        const daysOfWeek = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

        const hours = parseInt(document.getElementById('keep-awake-hours-input').value, 10) || 0;
        const mins = parseInt(document.getElementById('keep-awake-mins-input').value, 10) || 0;

        if (hours > 12) {
            ui.showToast('Keep awake duration cannot exceed 12 hours (720 minutes)', 5000, 'error');
            return;
        }

        const keepAwakeFor = (hours * 60) + mins;

        const schedule = {
            time: timeInput,
            daysOfWeek: daysOfWeek,
            enabled: true
        };

        if (keepAwakeFor >= 1 && keepAwakeFor <= 720) {
            schedule.keepAwakeFor = keepAwakeFor;
        }

        await createPresenceSchedule(schedule);
        ui.showToast('Schedule created', 3000, 'success');

        // Clear form inputs
        document.getElementById('schedule-time-input').value = '';
        document.getElementById('keep-awake-hours-input').value = '0';
        document.getElementById('keep-awake-mins-input').value = '0';
        document.querySelectorAll('#add-schedule-modal input[type="checkbox"]').forEach(cb => cb.checked = false);

        document.getElementById('add-schedule-modal').close();
        updateSettingsContentArea('presence');
    } catch (error) {
        console.error('Error creating schedule:', error);
        ui.showToast('Failed to create schedule', 5000, 'error');
    }
};

window.handleScheduleToggle = async function(scheduleId, enabled) {
    try {
        await updatePresenceSchedule(scheduleId, { enabled });
        ui.showToast(`Schedule ${enabled ? 'enabled' : 'disabled'}`, 3000, 'success');
        // No need to reload entire view - the toggle state is already updated in the DOM
    } catch (error) {
        console.error('Error toggling schedule:', error);
        ui.showToast('Failed to update schedule', 5000, 'error');
        // On error, revert the toggle in the UI
        const toggle = document.querySelector(`input[onchange*="${scheduleId}"]`);
        if (toggle) toggle.checked = !enabled;
    }
};

window.handleDeleteSchedule = async function(scheduleId) {
    if (!confirm('Are you sure you want to delete this schedule?')) return;

    try {
        await deletePresenceSchedule(scheduleId);
        ui.showToast('Schedule deleted', 3000, 'success');
        updateSettingsContentArea('presence');
    } catch (error) {
        console.error('Error deleting schedule:', error);
        ui.showToast('Failed to delete schedule', 5000, 'error');
    }
};

window.handleMachineStateChange = async function(newState) {
    try {
        if (newState === MachineState.SLEEPING) {
            await dimDisplay();
        } else if (newState === MachineState.IDLE) {
            await restoreDisplay();
        }
    } catch (error) {
        console.error('Error auto-adjusting display based on machine state:', error);
    }
};

// Function to connect to a specific device
async function connectToDevice(deviceId) {
    if (!deviceId) {
        ui.showToast('Please select a device first', 3000, 'error');
        return false;
    }

    try {
        ui.showToast('Connecting to device...', 2000, 'info');

        // Attempt to connect to the device using the imported function
        await reconnectDevice(deviceId);

        ui.showToast('Successfully connected to device', 3000, 'success');

        // Update UI to reflect connection status
        updateConnectionStatus(deviceId, true);

        return true;
    } catch (error) {
        console.error('Error connecting to device:', error);
        ui.showToast(`Failed to connect: ${error.message}`, 5000, 'error');
        return false;
    }
}

// Function to update UI with connection status
function updateConnectionStatus(deviceId, isConnected) {
    // In a real implementation, we would update the UI to show connection status
    // For now, we'll just log the status
    console.log(`Device ${deviceId} connection status: ${isConnected ? 'Connected' : 'Disconnected'}`);
}

// Function to start auto-connect functionality
window.startAutoConnect = async function() {
    try {
        const deviceWs = getDeviceWebSocket();
        if (!deviceWs || deviceWs.readyState !== WebSocket.OPEN) {
            initDeviceWebSocketWithCallback(
                () => {
                    sendDeviceCommand({ command: 'scan', connect: true });
                    logger.info('Auto-connect initiated via WebSocket');
                    ui.showToast('Auto-connect started, nearby devices will be connected automatically', 4000, 'info');
                },
                (data) => {
                    if (data.devices) {
                        const connectedDevice = data.devices.find(d => d.state === 'connected');
                        if (connectedDevice) {
                            logger.info(`Auto-connected to device: ${connectedDevice.name} (${connectedDevice.id})`);
                            ui.showToast(`Auto-connected to ${connectedDevice.name}`, 3000, 'success');
                            renderAllDevices();
                        }
                    }
                },
                () => {},
                () => {}
            );
        } else {
            sendDeviceCommand({ command: 'scan', connect: true });
            logger.info('Auto-connect initiated via WebSocket');
            ui.showToast('Auto-connect started, nearby devices will be connected automatically', 4000, 'info');
        }
        
        // Update the toggle button state
        const autoConnectToggle = document.getElementById('auto-connect-toggle');
        if (autoConnectToggle) {
            autoConnectToggle.checked = true;
        }
    } catch (error) {
        console.error('Error starting auto-connect:', error);
        ui.showToast(`Auto-connect failed: ${error.message}`, 5000, 'error');
    }
};

// Function to stop auto-connect functionality
window.stopAutoConnect = async function() {
    try {
        // Update the toggle button state
        const autoConnectToggle = document.getElementById('auto-connect-toggle');
        if (autoConnectToggle) {
            autoConnectToggle.checked = false;
        }
        ui.showToast('Auto-connect disabled', 3000, 'info');
    } catch (error) {
        console.error('Error stopping auto-connect:', error);
        ui.showToast(`Error disabling auto-connect: ${error.message}`, 5000, 'error');
    }
};

// Function to toggle auto-connect functionality
window.toggleAutoConnect = async function(toggleType) {
    // Determine which toggle element to check based on the type
    let toggleId;
    let isMachine = false;
    
    if (toggleType === 'machine') {
        toggleId = 'auto-connect-machine-toggle';
        isMachine = true;
    } else if (toggleType === 'scale') {
        toggleId = 'auto-connect-scale-toggle';
    } else {
        toggleId = 'auto-connect-toggle';  // fallback for renderAllDevices
    }
    
    const autoConnectToggle = document.getElementById(toggleId);
    if (autoConnectToggle) {
        if (autoConnectToggle.checked) {
            if (isMachine) {
                // TODO: Implement startAutoConnectForMachines()
                ui.showToast('Machine auto-connect not yet implemented', 3000, 'info');
            } else {
                await window.startAutoConnect();
            }
        } else {
            await window.stopAutoConnect(toggleType);
        }
    }
};



// Render Bluetooth Machine settings
export function renderBluetoothMachineSettings() {
    // Render devices from WebSocket cache on initial render
    setTimeout(() => {
        renderDeviceListFromCache();
    }, 0);

    return `
        <div class="content-stretch justify-evenly gap-[60px] items-start relative w-full">
            <div class="flex justify-between items-center w-full">
                <p class="font-['Inter:Semi_Bold',sans-serif] justify-evenly leading-[0] w-[1124px] not-italic relative text-[var(--text-primary)] text-[36px] text-center">Espresso Machine</p>
                <button id="scan-machine-btn"
                        class="border-[var(--mimoja-blue)] text-[var(--mimoja-blue)] h-[62px] rounded-[67.5px] border w-[139px] text-[24px]"
                        onclick="window.scanForMachines()">
                    Scan
                </button>
            </div>

            <div id="bluetooth-machine-devices-container">
                <!-- Machine devices will be populated dynamically via WebSocket -->
            </div>

            <!-- Auto-connect toggle for machines -->
            <div class="mt-6 p-4 bg-[var(--box-color)] rounded-[10px]">
                <div class="flex items-center justify-between">
                    <p class="text-[20px] text-[var(--text-secondary)]">Automatically connect to nearby machine.</p>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="auto-connect-machine-toggle" class="sr-only peer" onclick="window.toggleAutoConnect('machine')">
                        <div class="w-11 h-6 bg-[var(--text-secondary)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#385a92]"></div>
                    </label>
                </div>
            </div>
        </div>
    `;
}

// Render Bluetooth Scale settings
export function renderBluetoothScaleSettings(settings) {
    // Render devices from WebSocket cache on initial render
    setTimeout(() => {
        renderDeviceListFromCache();
    }, 0);

    const scalePowerMode = settings?.scalePowerMode ?? 'disabled';

    return `
        <div class="flex flex-col gap-[60px] items-start relative w-full max-w-full overflow-x-hidden">

            <!-- Header -->
            <div class="flex justify-between items-center w-full">
                <div class="flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold justify-center leading-[0] not-italic relative text-[var(--text-primary)] text-[36px]">
                    <p class="leading-[1.2]">Scale</p>
                </div>
                <button id="scan-scale-btn"
                        class="border-[var(--mimoja-blue)] text-[var(--mimoja-blue)] h-[62px] rounded-[67.5px] border w-[139px] text-[24px] transition-colors duration-200 hover:bg-[var(--mimoja-blue)] hover:text-white"
                        onclick="window.scanForScales()">
                    Scan
                </button>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <!-- Connected Device -->
            <div class="flex flex-col gap-[20px] items-start relative w-full">
                <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                    <p class="leading-[1.2]">Connected Device</p>
                </div>
                <div id="bluetooth-scale-devices-container" class="w-full">
                    <!-- Scale devices will be populated dynamically via WebSocket -->
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <!-- Auto-Connect -->
            <div class="flex flex-col gap-[30px] items-start relative w-full">
                <div class="flex items-center justify-between w-full">
                    <div class="flex flex-col gap-[8px]">
                        <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                            <p class="leading-[1.2]">Auto Connect</p>
                        </div>
                        <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px]">
                            Automatically connect to nearby scales.
                        </p>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
                        <input type="checkbox" id="auto-connect-scale-toggle" class="toggle toggle-info sr-only peer border border-blue-600 bg-white" onclick="window.toggleAutoConnect('scale')">
                        <div class="w-11 h-6 bg-[var(--box-color)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-blue-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#385a92]"></div>
                    </label>
                </div>
            </div>

            <!-- Divider -->
            <div class="h-0 relative w-full">
                <hr class="border-t border-[#c9c9c9] w-full" />
            </div>

            <!-- Scale Power Mode -->
            <div class="flex flex-col gap-[30px] items-start relative w-full">
                <div class="flex flex-col gap-[8px] items-start relative w-full">
                    <div class="flex flex-col font-['Inter:Bold',sans-serif] font-bold justify-center leading-[0] not-italic relative text-[#385a92] text-[30px]">
                        <p id="scale-power-management-label" class="leading-[1.2]">Scale Power Mode</p>
                    </div>
                    <p class="font-['Inter:Regular',sans-serif] font-normal leading-[1.4] not-italic relative text-[var(--text-primary)] text-[24px] w-full max-w-full break-words">
                        Controls scale behaviour when machine sleeps.
                    </p>
                </div>
                <div class="flex items-center " role="group" aria-labelledby="scale-power-management-label">
                    <button class="h-[120px] w-[295px] rounded-[10px] font-['Inter:Bold',sans-serif] font-bold text-[30px] flex items-center justify-center cursor-pointer transition-colors duration-200
                        ${scalePowerMode === 'disabled' ? 'bg-[var(--mimoja-blue)] text-white' : 'bg-[var(--box-color)] border border-[var(--profile-button-outline-color)] text-[#b6c3d7]'}"
                        aria-pressed="${scalePowerMode === 'disabled'}"
                        onclick="window.updateReaSetting('scalePowerMode', 'disabled')">
                        Disabled
                    </button>
                    <button class="h-[120px] w-[295px] rounded-[10px] font-['Inter:Bold',sans-serif] font-bold text-[30px] flex items-center justify-center cursor-pointer transition-colors duration-200
                        ${scalePowerMode === 'displayOff' ? 'bg-[var(--mimoja-blue)] text-white' : 'bg-[var(--box-color)] border border-[var(--profile-button-outline-color)] text-[#b6c3d7]'}"
                        aria-pressed="${scalePowerMode === 'displayOff'}"
                        onclick="window.updateReaSetting('scalePowerMode', 'displayOff')">
                        Display Off
                    </button>
                    <button class="h-[120px] w-[295px] rounded-[10px] font-['Inter:Bold',sans-serif] font-bold text-[30px] flex items-center justify-center cursor-pointer transition-colors duration-200
                        ${scalePowerMode === 'disconnect' ? 'bg-[var(--mimoja-blue)] text-white' : 'bg-[var(--box-color)] border border-[var(--profile-button-outline-color)] text-[#b6c3d7]'}"
                        aria-pressed="${scalePowerMode === 'disconnect'}"
                        onclick="window.updateReaSetting('scalePowerMode', 'disconnect')">
                        Disconnect
                    </button>
                </div>
            </div>

        </div>
    `;
}

// Function to render all available devices with individual connection controls
async function renderAllDevices() {
    try {
     

        // Get all available devices
        // const devices = await getDevices();
            const devices = await scanForDevices();
        // Separate devices into machines and scales
        const machines = devices.filter(device => 
            device.name && (device.name.toLowerCase().includes('decent') || 
                           device.name.toLowerCase().includes('espresso') || 
                           device.type === 'espresso')
        );
        
        const scales = devices.filter(device => 
            device.name && (device.name.toLowerCase().includes('scale') || 
                           device.name.toLowerCase().includes('weight') || 
                           device.type === 'scale')
        );

        // Render devices in their respective containers
        renderDeviceList('bluetooth-machine-devices-container', machines, 'Machine');
        renderDeviceList('bluetooth-scale-devices-container', scales, 'Scale');
        
        // Also render to the general container if we're on the main bluetooth page
        const generalContainer = document.getElementById('bluetooth-devices-container');
        if (generalContainer) {
            if (machines.length > 0 || scales.length > 0) {
                let allDevicesHTML = '';
                if (machines.length > 0) {
                    allDevicesHTML += '<div class="mb-8">';
                    allDevicesHTML += '<h3 class="text-[30px] text-[var(--text-primary)] mb-4">Espresso Machines</h3>';
                    allDevicesHTML += renderSingleDeviceList(machines);
                    allDevicesHTML += '</div>';
                }
                
                if (scales.length > 0) {
                    allDevicesHTML += '<div class="mb-8">';
                    allDevicesHTML += '<h3 class="text-[30px] text-[var(--text-primary)] mb-4">Weighing Scales</h3>';
                    allDevicesHTML += renderSingleDeviceList(scales);
                    allDevicesHTML += '</div>';
                }
                
                generalContainer.innerHTML = allDevicesHTML;
            } else {
                generalContainer.innerHTML = '<p class="text-[24px] text-[var(--text-primary)]">No Bluetooth devices found. Make sure your devices are powered on and in pairing mode.</p>';
            }
        }

        // statusDiv.innerHTML = `<p>Found ${devices.length} device(s). ${machines.length} machine(s), ${scales.length} scale(s).</p>`;
    } catch (error) {
        console.error('Error scanning for devices:', error);
  
    }
}

// Helper function to render a list of devices of a specific type
function renderDeviceList(containerId, devices, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (devices.length > 0) {
        container.innerHTML = renderSingleDeviceList(devices);
    } else {
        container.innerHTML = `<p class="text-[24px] text-[var(--text-primary)]">No ${type.toLowerCase()} devices found. Make sure your ${type.toLowerCase()} is powered on and in pairing mode.</p>`;
    }
}

// Helper function to render a single list of devices with connection controls
function renderSingleDeviceList(devices) {
    // Null/empty check - return empty string if no devices
    if (!devices || !Array.isArray(devices) || devices.length === 0) {
        return '';
    }

    let deviceItems = '';

    devices.forEach(device => {
        // Skip devices without required properties
        if (!device || !device.name) {
            return;
        }

        // Use the device's state property to determine connection status
        const isConnected = device.state === 'connected';
        const statusClass = isConnected ? 'text-green-500' : 'text-red-500';
        const statusText = isConnected ? 'Connected' : 'Disconnected';
        const buttonText = isConnected ? 'Disconnect' : 'Connect';
        const buttonAction = isConnected ? 'disconnect' : 'connect';
        const buttonClass = isConnected ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600';

        deviceItems += `
            <div class="flex items-center justify-between bg-[var(--profile-button-background-color)] rounded-[10px]  mb-3 shadow-sm">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center">
                        <div class="w-3 h-3 rounded-full mr-3 ${isConnected ? 'bg-green-500' : 'bg-red-500'}"></div>
                        <p class="text-[24px] text-[var(--text-primary)] truncate">${device.name}</p>
                    </div>
                    <p class="text-[18px] text-[var(--text-secondary)] break-all">ID: ${device.id || 'N/A'}</p>
                    <p class="text-[18px] ${statusClass} capitalize">Status: ${device.state || 'unknown'}</p>
                    <p class="text-[18px] text-[var(--text-secondary)] capitalize">Type: ${device.type || 'unknown'}</p>
                </div>
                <div class="flex gap-3 ml-4">
                    <button class="bg-[#385a92] hover:bg-[#2c4a7a] h-[60px] rounded-[67.5px] w-[120px] text-white text-[18px] transition-colors duration-200 font-['Inter:Semi_Bold',sans-serif] justify-self-end"
                            onclick="window.handleDeviceConnection('${device.id}', '${buttonAction}')">
                        ${buttonText}
                    </button>
                </div>
            </div>
        `;
    });

    // Add the auto-connect toggle at the bottom of the device list

    return deviceItems;
}




// Function to handle connecting or disconnecting a device
window.handleDeviceConnection = async function(deviceId, action) {
    if (action === 'connect') {
        try {
            await sendDeviceCommand({ command: 'connect', deviceId });
            ui.showToast(`Connected to device ${deviceId}`, 3000, 'success');
            // Device list will update automatically via WebSocket onData callback
        } catch (error) {
            console.error('Error connecting to device:', error);
            ui.showToast(`Failed to connect: ${error.message}`, 5000, 'error');
        }
    } else if (action === 'disconnect') {
        try {
            await sendDeviceCommand({ command: 'disconnect', deviceId });
            ui.showToast(`Disconnected from device ${deviceId}`, 3000, 'info');
            // Device list will update automatically via WebSocket onData callback
        } catch (error) {
            console.error('Error disconnecting from device:', error);
            ui.showToast(`Failed to disconnect: ${error.message}`, 5000, 'error');
        }
    }
};


// Function to scan for machines specifically
window.scanForMachines = async function() {
    try {
        ui.showToast('Scanning for machines...', 2500, 'info');

        // Use WebSocket to trigger scan - results will appear via deviceStateCache
        sendDeviceCommand({ command: 'scan' });
        ui.showToast('Scanning started, results will appear shortly', 3000, 'info');
    } catch (error) {
        console.error('Error scanning for machines:', error);
        ui.showToast(`Error scanning for machines: ${error.message}`, 5000, 'error');
    }
};

// Function to scan for scales specifically
window.scanForScales = async function() {
    try {
        ui.showToast('Scanning for scales...', 2000, 'info');

        // Use WebSocket to trigger scan - results will appear via deviceStateCache
        sendDeviceCommand({ command: 'scan' });
        ui.showToast('Scanning started, results will appear shortly', 3000, 'info');
    } catch (error) {
        console.error('Error scanning for scales:', error);
        ui.showToast(`Error scanning for scales: ${error.message}`, 5000, 'error');
    }
};

// Smart Charging handlers
window.handleSmartChargingModeChange = async function(mode) {
    await updateReaSetting('chargingMode', mode);
};

window.handleNightModeToggle = async function(enabled) {
    await updateReaSetting('nightModeEnabled', enabled);
};

window.handleNightModeTimeChange = async function(type, timeStr) {
    const minutes = timeStringToMinutes(timeStr);
    if (type === 'sleep') {
        await updateReaSetting('nightModeSleepTime', minutes);
    } else {
        await updateReaSetting('nightModeMorningTime', minutes);
    }
};

// Initialize Bluetooth settings when the page loads
document.addEventListener('DOMContentLoaded', function() {
    // Set up a global function to refresh the device list
    window.refreshBluetoothDevices = renderAllDevices;
});

// Call the render function when the module functions are accessed
setTimeout(() => {
    if (document.getElementById('bluetooth-devices-container') ||
        document.getElementById('bluetooth-machine-devices-container') ||
        document.getElementById('bluetooth-scale-devices-container')) {
        renderAllDevices();
    }
}, 100);