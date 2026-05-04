import { loadPage } from './router.js';
import { showToast } from './ui.js';

// ─── State ──────────────────────────────────────────────────────────────────

let editorState = {
    sourceProfileId: null,
    sourceProfileRecord: null,
    profile: null,
    activeTab: 0,
};

// Which step indices have their temp ± buttons expanded
let expandedTempSteps = new Set();

// Which step indices have their pump target ± buttons expanded
let expandedPumpSteps = new Set();

// Which step indices have their limiter ± buttons expanded
let expandedLimSteps = new Set();

// Which max field is expanded per step index: Map<stepIndex, 'seconds'|'volume'|'weight'|null>
let expandedMaxSteps = new Map();

// Which step indices have their exit value ± buttons expanded
let expandedExitSteps = new Set();

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_STEP = {
    name: 'New Step',
    pump: 'flow',
    transition: 'fast',
    flow: 6.0,
    pressure: 6.0,
    temperature: 93,
    sensor: 'coffee',
    seconds: 30,
    weight: 0,
    volume: 0,
    exit: { type: 'pressure', condition: 'over', value: 9.0 },
    limiter: { value: 9.0, range: 0.6 },
};

const TAB_COUNT = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function clamp(value, min, max) {
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
}

function roundTo(value, step) {
    const decimals = step < 1 ? String(step).split('.')[1].length : 0;
    return parseFloat(value.toFixed(decimals));
}

// ─── Spinner Factory ────────────────────────────────────────────────────────

function createSpinner(initialValue, step, unit, onChange, opts = {}) {
    const { min, max } = opts;
    let value = typeof initialValue === 'number' ? initialValue : parseFloat(initialValue) || 0;
    let debounceTimer = null;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center gap-[10px]';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
    minusBtn.textContent = '\u2212';
    minusBtn.setAttribute('aria-label', 'Decrease');

    const display = document.createElement('span');
    display.className = 'font-bold text-[20px] text-center w-[90px] text-[var(--text-primary)]';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
    plusBtn.textContent = '+';
    plusBtn.setAttribute('aria-label', 'Increase');

    function updateDisplay() {
        const formatted = roundTo(value, step);
        display.textContent = unit ? `${formatted} ${unit}` : `${formatted}`;
    }

    function debouncedOnChange() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            onChange(value);
        }, 300);
    }

    minusBtn.addEventListener('click', () => {
        value = roundTo(clamp(value - step, min, max), step);
        updateDisplay();
        debouncedOnChange();
    });

    plusBtn.addEventListener('click', () => {
        value = roundTo(clamp(value + step, min, max), step);
        updateDisplay();
        debouncedOnChange();
    });

    updateDisplay();

    wrapper.appendChild(minusBtn);
    wrapper.appendChild(display);
    wrapper.appendChild(plusBtn);

    // Expose a way to get or set the current value externally
    wrapper._getValue = () => value;
    wrapper._setValue = (v) => { value = v; updateDisplay(); };

    return wrapper;
}

// ─── Toggle Button Group ────────────────────────────────────────────────────

function createToggle(options, activeValue, onChange) {
    // options: [{label, value}, ...]
    const wrapper = document.createElement('div');
    wrapper.className = 'flex gap-[8px]';

    let currentValue = activeValue;
    const buttons = [];

    function render() {
        buttons.forEach(({ btn, value }) => {
            if (value === currentValue) {
                btn.className = 'bg-[#button-primary-bg] text-white rounded-[8px] px-[10px] py-[6px] text-[16px] font-semibold cursor-pointer transition-colors';
            } else {
                btn.className = 'bg-[#ededed] text-gray-600 rounded-[8px] px-[10px] py-[6px] text-[16px] font-semibold cursor-pointer transition-colors';
            }
        });
    }

    options.forEach(({ label, value }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        buttons.push({ btn, value });

        btn.addEventListener('click', () => {
            currentValue = value;
            render();
            onChange(value);
        });

        wrapper.appendChild(btn);
    });

    render();
    return wrapper;
}

// ─── Render Functions ───────────────────────────────────────────────────────

function renderStepCards() {
    const container = document.getElementById('editor-steps-container');
    if (!container) return;
    container.innerHTML = '';

    const steps = editorState.profile.steps || [];
    const numSteps = steps.length;

    // CSS grid: label col + step cols (4 visible at once, extras scroll) + add-step col
    // 380px per step = (1920 - 220 label - 180 add) / 4; minmax keeps 4 visible, min enforces scroll beyond 4
    const R = { HEADER: 1, TEMP: 2, PUMP: 3, EXIT: 4, FOOTER: 5 };
    const TOTAL_ROWS = 5;

    container.style.display = 'grid';
    container.style.gridTemplateColumns = `220px repeat(${numSteps}, minmax(300px, 1fr))`;
    //repeat(${TOTAL_ROWS}, 1fr) 60px 1fr 1fr 1fr 60px
    container.style.gridTemplateRows = `60px 1fr 1fr 1fr 60px`;
    container.style.height = '100%';
    container.style.width = '100%';

    // Helper: create a grid cell, append to container
    function mkCell(row, col, className) {
        const el = document.createElement('div');
        el.style.gridRow = row;
        el.style.gridColumn = col;
        el.className = className;
        container.appendChild(el);
        return el;
    }

    // ── Label column (sticky left) ────────────────────────────────────────────
    const labelBase = 'flex items-center px-[20px] py-[8px] border-r-2 border-b border-[#e8e8e8] bg-[var(--box-color)]';

    function mkLabel(row, text, tip = '') {
        const el = mkCell(row, 1, labelBase);
        el.style.position = 'sticky';
        el.style.left = '0';
        el.style.zIndex = '2';
        if (text) {
            const span = document.createElement('span');
            span.className = 'text-[17px] font-semibold text-gray-500 leading-tight';
            span.textContent = text;
            el.appendChild(span);
        }
        if (tip) {
            const tipWrapper = document.createElement('div');
            tipWrapper.className = 'tooltip tooltip-right ml-[6px] before:text-[18px]';
            tipWrapper.setAttribute('data-tip', tip);
            tipWrapper.innerHTML = `<button type="button" class="w-[18px] h-[18px] rounded-full bg-gray-200 text-gray-500 text-[12px] font-bold flex items-center justify-center shrink-0 focus:outline-none" tabindex="-1" aria-label="Help">i</button>`;
            el.appendChild(tipWrapper);
        }
        return el;
    }

    mkLabel(R.HEADER,  '');
    mkLabel(R.TEMP,    'Temp',   'Tap value to adjust °C. Tap sensor to toggle Coffee/Water');
    mkLabel(R.PUMP,    'Pump',   'Line 1: transition + flow/pressure target. Line 2: limiter cap. Tap blue values to adjust, tap unit to toggle Flow/Pressure');
    mkLabel(R.EXIT,    'Exit',   'Line 1: exit trigger — tap type to cycle, tap over/under to toggle, tap value to adjust. Line 2: max duration, volume, weight');
    mkLabel(R.FOOTER,  '');

    // ── Step columns ──────────────────────────────────────────────────────────
    const stepCell = 'flex items-center justify-start px-[16px] py-[8px] border-r border-b border-[#e8e8e8]';

    steps.forEach((step, index) => {
        const col = index + 2;
        const isFlow = step.pump !== 'pressure';

        // Header: step number + name input
        const hCell = mkCell(R.HEADER, col, 'flex items-center justify-start px-[16px] py-[10px] border-r border-b-2 border-[#e8e8e8] bg-white');
        const nameWrapper = document.createElement('div');
        nameWrapper.className = 'flex items-center gap-[6px]';
        const numSpan = document.createElement('span');
        numSpan.className = 'text-[24px] font-bold text-gray-400 shrink-0 select-none';
        numSpan.textContent = `${index + 1}.`;
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = step.name || '';
        nameInput.className = 'text-[24px] font-bold text-[var(--text-primary)] bg-transparent outline-none';
        const syncSize = () => { nameInput.size = Math.max(4, nameInput.value.length + 1); };
        syncSize();
        nameInput.addEventListener('input', syncSize);
        nameInput.addEventListener('change', () => { editorState.profile.steps[index].name = nameInput.value; });
        nameWrapper.appendChild(numSpan);
        nameWrapper.appendChild(nameInput);
        hCell.appendChild(nameWrapper);

        // Temp + Sensor combined row
        {
            const tCell = mkCell(R.TEMP, col, 'flex flex-col justify-center items-start px-[16px] py-[8px] border-r border-b border-[#e8e8e8] gap-[8px]');
            const isExpanded = expandedTempSteps.has(index);

            let tempValue = step.temperature || 93;

            // Sensor toggle button
            let sensorValue = step.sensor || 'coffee';
            const sensorBtn = document.createElement('button');
            sensorBtn.type = 'button';
            sensorBtn.className = 'bg-[var(--preset-value-color-disabled)] text-[var(--text-primary)] rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';
            sensorBtn.textContent = sensorValue === 'coffee' ? 'Coffee' : 'Water';
            sensorBtn.addEventListener('click', () => {
                sensorValue = sensorValue === 'coffee' ? 'water' : 'coffee';
                sensorBtn.textContent = sensorValue === 'coffee' ? 'Coffee' : 'Water';
                editorState.profile.steps[index].sensor = sensorValue;
            });

            const tempDisplay = document.createElement('span');
            tempDisplay.className = 'bg-[var(--button-primary-bg)] text-white rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';
            tempDisplay.textContent = `${tempValue}\u00b0C`;

            // Display line: [sensorBtn] [tempDisplay] — always visible
            const tempDisplayLine = document.createElement('div');
            tempDisplayLine.className = 'flex items-center gap-[8px]';
            tempDisplayLine.appendChild(sensorBtn);
            tempDisplayLine.appendChild(tempDisplay);

            // Edit row: [minusBtn] [plusBtn] — hidden by default
            const minusBtn = document.createElement('button');
            minusBtn.type = 'button';
            minusBtn.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            minusBtn.textContent = '\u2212';

            const plusBtn = document.createElement('button');
            plusBtn.type = 'button';
            plusBtn.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            plusBtn.textContent = '+';

            const tempEditRow = document.createElement('div');
            tempEditRow.className = 'flex items-center gap-[8px]';
            tempEditRow.style.display = isExpanded ? 'flex' : 'none';
            tempEditRow.appendChild(minusBtn);
            tempEditRow.appendChild(plusBtn);

            tempDisplay.addEventListener('click', () => {
                if (expandedTempSteps.has(index)) {
                    expandedTempSteps.delete(index);
                    tempDisplayLine.appendChild(tempDisplay);
                    tempEditRow.style.display = 'none';
                    sensorBtn.style.opacity = '';
                } else {
                    expandedTempSteps.add(index);
                    tempEditRow.insertBefore(tempDisplay, plusBtn);
                    tempEditRow.style.display = 'flex';
                    sensorBtn.style.opacity = '0.3';
                }
            });

            minusBtn.addEventListener('click', () => {
                tempValue = roundTo(clamp(tempValue - 0.5, 0, 110), 0.5);
                tempDisplay.textContent = `${tempValue}\u00b0C`;
                editorState.profile.steps[index].temperature = tempValue;
            });

            plusBtn.addEventListener('click', () => {
                tempValue = roundTo(clamp(tempValue + 0.5, 0, 110), 0.5);
                tempDisplay.textContent = `${tempValue}\u00b0C`;
                editorState.profile.steps[index].temperature = tempValue;
            });

            // Apply initial expanded state (move tempDisplay into edit row)
            if (isExpanded) {
                sensorBtn.style.opacity = '0.3';
                tempEditRow.insertBefore(tempDisplay, plusBtn);
            }

            tCell.appendChild(tempDisplayLine);
            tCell.appendChild(tempEditRow);
        }

        // Pump + Limit combined row — two lines
        {
            const pCell = mkCell(R.PUMP, col, 'flex flex-col justify-center px-[16px] py-[4px] gap-[6px] border-r border-b border-[#e8e8e8]');

            // ── Line 1: pump ─────────────────────────────────────────────────
            const pumpLine = document.createElement('div');
            pumpLine.className = 'flex flex-col gap-[4px]';

            const targetUnit = isFlow ? 'mL/s' : 'bar';
            const targetMax  = isFlow ? 15 : 16;
            const tStep      = 0.1;
            const isPumpExp  = expandedPumpSteps.has(index);

            let targetValue = isFlow ? (step.flow || 0) : (step.pressure || 0);
            let transValue  = step.transition || 'fast';

            const transBtn = document.createElement('button');
            transBtn.type = 'button';
            transBtn.className = 'bg-[var(--preset-value-color-disabled)] text-[var(--text-primary)] rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';
            transBtn.textContent = transValue === 'fast' ? 'Quick' : 'Smooth';

            const rampText = document.createElement('span');
            rampText.className = 'font-bold text-[20px] text-[var(--text-primary)] select-none';
            rampText.textContent = 'ramp to';

            const targetDisplay = document.createElement('span');
            targetDisplay.className = 'font-bold text-[20px] text-white px-[8px] py-[2px] cursor-pointer select-none';
            targetDisplay.textContent = `${roundTo(targetValue, tStep)}`;

            const unitBtn = document.createElement('button');
            unitBtn.type = 'button';
            unitBtn.className = 'text-white px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none bg-transparent';
            unitBtn.textContent = targetUnit;

            const targetWrapper = document.createElement('div');
            targetWrapper.className = 'flex items-center bg-[var(--button-primary-bg)] rounded-[8px]';
            const wrapDivider = document.createElement('span');
            wrapDivider.className = 'w-[1px] h-[18px] bg-white opacity-40 shrink-0 self-center';
            targetWrapper.appendChild(targetDisplay);
            targetWrapper.appendChild(wrapDivider);
            targetWrapper.appendChild(unitBtn);

            // Display line: [transBtn] [rampText] [targetWrapper] — always visible
            const pumpDisplayLine = document.createElement('div');
            pumpDisplayLine.className = 'flex items-center gap-[8px]';
            pumpDisplayLine.appendChild(transBtn);
            pumpDisplayLine.appendChild(rampText);
            pumpDisplayLine.appendChild(targetWrapper);

            // Edit row: [targetMinus] [targetPlus] — hidden by default
            const targetMinus = document.createElement('button');
            targetMinus.type = 'button';
            targetMinus.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            targetMinus.textContent = '\u2212';

            const targetPlus = document.createElement('button');
            targetPlus.type = 'button';
            targetPlus.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            targetPlus.textContent = '+';

            const pumpEditRow = document.createElement('div');
            pumpEditRow.className = 'flex items-center gap-[8px]';
            pumpEditRow.style.display = isPumpExp ? 'flex' : 'none';
            pumpEditRow.appendChild(targetMinus);
            pumpEditRow.appendChild(targetPlus);

            transBtn.addEventListener('click', () => {
                transValue = transValue === 'fast' ? 'smooth' : 'fast';
                transBtn.textContent = transValue === 'fast' ? 'Quick' : 'Smooth';
                editorState.profile.steps[index].transition = transValue;
            });

            targetDisplay.addEventListener('click', () => {
                if (expandedPumpSteps.has(index)) {
                    expandedPumpSteps.delete(index);
                    pumpDisplayLine.appendChild(targetWrapper);
                    pumpEditRow.style.display = 'none';
                    transBtn.style.opacity = '';
                } else {
                    expandedPumpSteps.add(index);
                    pumpEditRow.insertBefore(targetWrapper, targetPlus);
                    pumpEditRow.style.display = 'flex';
                    transBtn.style.opacity = '0.3';
                }
            });

            unitBtn.addEventListener('click', () => {
                editorState.profile.steps[index].pump = isFlow ? 'pressure' : 'flow';
                renderStepCards();
            });

            targetMinus.addEventListener('click', () => {
                targetValue = roundTo(clamp(targetValue - tStep, 0, targetMax), tStep);
                targetDisplay.textContent = `${targetValue}`;
                if (isFlow) editorState.profile.steps[index].flow = targetValue;
                else editorState.profile.steps[index].pressure = targetValue;
            });

            targetPlus.addEventListener('click', () => {
                targetValue = roundTo(clamp(targetValue + tStep, 0, targetMax), tStep);
                targetDisplay.textContent = `${targetValue}`;
                if (isFlow) editorState.profile.steps[index].flow = targetValue;
                else editorState.profile.steps[index].pressure = targetValue;
            });

            if (isPumpExp) {
                transBtn.style.opacity = '0.3';
                pumpEditRow.insertBefore(targetWrapper, targetPlus);
            }

            pumpLine.appendChild(pumpDisplayLine);
            pumpLine.appendChild(pumpEditRow);

            // ── Line 2: limiter ───────────────────────────────────────────────
            const limLine = document.createElement('div');
            limLine.className = 'flex flex-col gap-[4px]';

            const limUnit = isFlow ? 'bar' : 'mL/s';
            const limMax  = isFlow ? 16 : 15;
            const lStep   = 0.1;
            const isLimExp = expandedLimSteps.has(index);

            let limValue = step.limiter?.value ?? 0;

            const withText = document.createElement('span');
            withText.className = 'font-bold text-[20px] text-[var(--text-primary)] select-none';
            withText.textContent = 'With';

            const limDisplay = document.createElement('span');
            limDisplay.className = 'font-bold text-[20px] text-[var(--mimoja-blue-v2)] cursor-pointer select-none';
            limDisplay.textContent = `${roundTo(limValue, lStep)}`;

            const limUnitText = document.createElement('span');
            limUnitText.className = 'font-bold text-[20px] text-[var(--text-primary)] select-none';
            limUnitText.textContent = `${limUnit} limit`;

            // Display line: [withText] [limDisplay] [limUnitText] — always visible
            const limDisplayLine = document.createElement('div');
            limDisplayLine.className = 'flex items-center gap-[8px]';
            limDisplayLine.appendChild(withText);
            limDisplayLine.appendChild(limDisplay);
            limDisplayLine.appendChild(limUnitText);

            // Edit row: [limMinus] [limPlus] — hidden by default
            const limMinus = document.createElement('button');
            limMinus.type = 'button';
            limMinus.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            limMinus.textContent = '\u2212';

            const limPlus = document.createElement('button');
            limPlus.type = 'button';
            limPlus.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            limPlus.textContent = '+';

            const limEditRow = document.createElement('div');
            limEditRow.className = 'flex items-center gap-[8px]';
            limEditRow.style.display = isLimExp ? 'flex' : 'none';
            limEditRow.appendChild(limMinus);
            limEditRow.appendChild(limPlus);

            limDisplay.addEventListener('click', () => {
                if (expandedLimSteps.has(index)) {
                    expandedLimSteps.delete(index);
                    limDisplayLine.insertBefore(limDisplay, limUnitText);
                    limEditRow.style.display = 'none';
                    withText.style.opacity = '';
                    limUnitText.style.opacity = '';
                } else {
                    expandedLimSteps.add(index);
                    limEditRow.insertBefore(limDisplay, limPlus);
                    limEditRow.style.display = 'flex';
                    withText.style.opacity = '0.3';
                    limUnitText.style.opacity = '0.3';
                }
            });

            limMinus.addEventListener('click', () => {
                limValue = roundTo(clamp(limValue - lStep, 0, limMax), lStep);
                limDisplay.textContent = `${limValue}`;
                if (!editorState.profile.steps[index].limiter) editorState.profile.steps[index].limiter = { value: limValue, range: 0.6 };
                else editorState.profile.steps[index].limiter.value = limValue;
            });

            limPlus.addEventListener('click', () => {
                limValue = roundTo(clamp(limValue + lStep, 0, limMax), lStep);
                limDisplay.textContent = `${limValue}`;
                if (!editorState.profile.steps[index].limiter) editorState.profile.steps[index].limiter = { value: limValue, range: 0.6 };
                else editorState.profile.steps[index].limiter.value = limValue;
            });

            if (isLimExp) {
                withText.style.opacity = '0.3';
                limUnitText.style.opacity = '0.3';
                limEditRow.insertBefore(limDisplay, limPlus);
            }

            limLine.appendChild(limDisplayLine);
            limLine.appendChild(limEditRow);

            pCell.appendChild(pumpLine);
            pCell.appendChild(limLine);
        }

        // Exit + Max combined row — two lines
        {
            const exitCell = mkCell(R.EXIT, col, 'flex flex-col justify-center px-[16px] py-[4px] gap-[6px] border-r border-b border-[#e8e8e8]');

            // ── Line 1: exit condition ────────────────────────────────────────
            const exitLine = document.createElement('div');
            exitLine.className = 'flex flex-col gap-[4px]';

            const EXIT_TYPES   = ['pressure', 'flow', 'weight', 'time', 'off'];
            const EXIT_UNIT_MAP = { pressure: 'bar', flow: 'mL/s', weight: 'g', time: 'sec' };
            const EXIT_STEP_MAP = { pressure: 0.1, flow: 0.1, weight: 0.5, time: 1 };
            const EXIT_MAX_MAP  = { pressure: 16,  flow: 15,  weight: 500, time: 300 };

            const exitDef  = step.exit || { type: 'pressure', condition: 'over', value: 0 };
            let exitType   = exitDef.type || 'pressure';
            let exitCond   = exitDef.condition || 'over';
            let exitValue  = exitDef.value ?? 0;

            const btnBase = 'bg-[var(--button-primary-bg)] text-white rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';
            const btnGray = 'bg-gray-400 text-white rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';
            const btnGrayFlash = 'bg-[var(--preset-value-color-disabled)] text-[var(--text-primary)] rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';

            const typeBtn = document.createElement('button');
            typeBtn.type = 'button';
            typeBtn.className = btnGrayFlash;
            typeBtn.textContent = exitType.charAt(0).toUpperCase() + exitType.slice(1);

            const condBtn = document.createElement('button');
            condBtn.type = 'button';
            condBtn.className = btnGrayFlash;
            condBtn.textContent = exitCond.charAt(0).toUpperCase() + exitCond.slice(1);

            const isExitExpanded = expandedExitSteps.has(index);

            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'bg-[var(--button-primary-bg)] text-white rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none whitespace-nowrap';
            valueDisplay.textContent = exitType !== 'off' ? `${exitValue} ${EXIT_UNIT_MAP[exitType]}` : '';

            // Display line: [typeBtn] [condBtn] [valueDisplay] — always visible
            const exitDisplayLine = document.createElement('div');
            exitDisplayLine.className = 'flex items-center gap-[8px]';
            exitDisplayLine.appendChild(typeBtn);
            exitDisplayLine.appendChild(condBtn);
            exitDisplayLine.appendChild(valueDisplay);

            // Edit row: [exitMinus] [exitPlus] — hidden by default
            const exitMinus = document.createElement('button');
            exitMinus.type = 'button';
            exitMinus.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            exitMinus.textContent = '\u2212';

            const exitPlus = document.createElement('button');
            exitPlus.type = 'button';
            exitPlus.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
            exitPlus.textContent = '+';

            const exitEditRow = document.createElement('div');
            exitEditRow.className = 'flex items-center gap-[8px]';
            exitEditRow.style.display = isExitExpanded ? 'flex' : 'none';
            exitEditRow.appendChild(exitMinus);
            exitEditRow.appendChild(exitPlus);

            function applyExitOffState() {
                const isOff = exitType === 'off';
                typeBtn.className = isOff ? btnGray : btnGrayFlash;
                condBtn.style.display      = isOff ? 'none' : '';
                valueDisplay.style.display = isOff ? 'none' : '';
                if (isOff) {
                    // Move valueDisplay back to displayLine and collapse
                    if (!exitDisplayLine.contains(valueDisplay)) {
                        exitDisplayLine.appendChild(valueDisplay);
                    }
                    exitEditRow.style.display = 'none';
                    expandedExitSteps.delete(index);
                    typeBtn.style.opacity = '';
                    condBtn.style.opacity = '';
                } else {
                    exitEditRow.style.display = expandedExitSteps.has(index) ? 'flex' : 'none';
                }
            }
            applyExitOffState();

            typeBtn.addEventListener('click', () => {
                exitType = EXIT_TYPES[(EXIT_TYPES.indexOf(exitType) + 1) % EXIT_TYPES.length];
                typeBtn.textContent = exitType.charAt(0).toUpperCase() + exitType.slice(1);
                if (exitType !== 'off') valueDisplay.textContent = `${exitValue} ${EXIT_UNIT_MAP[exitType]}`;
                applyExitOffState();
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: exitType, condition: exitCond, value: exitValue };
                else editorState.profile.steps[index].exit.type = exitType;
            });

            condBtn.addEventListener('click', () => {
                exitCond = exitCond === 'over' ? 'under' : 'over';
                condBtn.textContent = exitCond.charAt(0).toUpperCase() + exitCond.slice(1);
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: exitType, condition: exitCond, value: exitValue };
                else editorState.profile.steps[index].exit.condition = exitCond;
            });

            valueDisplay.addEventListener('click', () => {
                if (expandedExitSteps.has(index)) {
                    expandedExitSteps.delete(index);
                    exitDisplayLine.appendChild(valueDisplay);
                    exitEditRow.style.display = 'none';
                    typeBtn.style.opacity = '';
                    condBtn.style.opacity = '';
                } else {
                    expandedExitSteps.add(index);
                    exitEditRow.insertBefore(valueDisplay, exitPlus);
                    exitEditRow.style.display = 'flex';
                    typeBtn.style.opacity = '0.3';
                    condBtn.style.opacity = '0.3';
                }
            });

            exitMinus.addEventListener('click', () => {
                exitValue = roundTo(clamp(exitValue - EXIT_STEP_MAP[exitType], 0, EXIT_MAX_MAP[exitType]), EXIT_STEP_MAP[exitType]);
                valueDisplay.textContent = `${exitValue} ${EXIT_UNIT_MAP[exitType]}`;
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: exitType, condition: exitCond, value: exitValue };
                else editorState.profile.steps[index].exit.value = exitValue;
            });

            exitPlus.addEventListener('click', () => {
                exitValue = roundTo(clamp(exitValue + EXIT_STEP_MAP[exitType], 0, EXIT_MAX_MAP[exitType]), EXIT_STEP_MAP[exitType]);
                valueDisplay.textContent = `${exitValue} ${EXIT_UNIT_MAP[exitType]}`;
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: exitType, condition: exitCond, value: exitValue };
                else editorState.profile.steps[index].exit.value = exitValue;
            });

            if (isExitExpanded) {
                typeBtn.style.opacity = '0.3';
                condBtn.style.opacity = '0.3';
                exitEditRow.insertBefore(valueDisplay, exitPlus);
            }

            exitLine.appendChild(exitDisplayLine);
            exitLine.appendChild(exitEditRow);

            // ── Line 2: max values ────────────────────────────────────────────
            const maxLine = document.createElement('div');
            maxLine.className = 'flex items-center gap-[8px]';

            const MAX_FIELDS = [
                { key: 'weight',  unit: 'g',   fStep: 1, fMax: 500 },
                { key: 'seconds', unit: 'sec', fStep: 1, fMax: 300 },
                { key: 'volume',  unit: 'ml',  fStep: 1, fMax: 500 },
            ];

            const fieldRefs = [];

            const blueDisplayClass = 'bg-[var(--button-primary-bg)] text-white rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';
            const grayDisplayClass = 'bg-[var(--preset-value-color-disabled)] text-[var(--text-primary)] rounded-[8px] px-[8px] py-[2px] text-[20px] font-semibold cursor-pointer select-none';

            const maxPlaceholder = document.createElement('span');
            maxPlaceholder.className = grayDisplayClass;
            maxPlaceholder.textContent = 'Max';
            maxLine.appendChild(maxPlaceholder);

            function updateMaxSectionVisibility() {
                const activeKey = expandedMaxSteps.get(index) ?? null;
                const nonZeroCount = fieldRefs.filter(r => r.getValue() > 0).length;
                const allZero = nonZeroCount === 0;

                maxPlaceholder.style.display = (allZero && activeKey === null) ? '' : 'none';

                fieldRefs.forEach(ref => {
                    const show = activeKey !== null || ref.getValue() > 0;
                    ref.section.style.display = show ? '' : 'none';

                    if (activeKey === ref.key) {
                        if (!ref.sectionEditRow.contains(ref.display)) {
                            ref.sectionEditRow.insertBefore(ref.display, ref.plusBtn);
                        }
                        ref.sectionEditRow.style.display = 'flex';
                    } else {
                        if (!ref.sectionDisplayLine.contains(ref.display)) {
                            ref.sectionDisplayLine.appendChild(ref.display);
                        }
                        ref.sectionEditRow.style.display = 'none';
                    }

                    const isBlue = nonZeroCount === 1 ? ref.getValue() > 0 : ref.key === 'weight';
                    ref.display.className = isBlue ? blueDisplayClass : grayDisplayClass;
                });
            }

            maxPlaceholder.addEventListener('click', () => {
                expandedMaxSteps.set(index, 'weight');
                updateMaxSectionVisibility();
                fieldRefs.forEach(ref => {
                    ref.section.style.opacity = ref.key !== 'weight' ? '0.3' : '';
                });
            });

            MAX_FIELDS.forEach(({ key, unit, fStep, fMax }) => {
                const section = document.createElement('div');
                section.className = 'flex flex-col gap-[4px]';

                const isThisExpanded = (expandedMaxSteps.get(index) ?? null) === key;
                let fieldValue = step[key] || 0;

                const display = document.createElement('span');
                display.className = grayDisplayClass;
                display.textContent = `${fieldValue} ${unit}`;

                // Display line: [display] only
                const sectionDisplayLine = document.createElement('div');
                sectionDisplayLine.className = 'flex items-center';
                sectionDisplayLine.appendChild(display);

                // Edit row: [minusBtn] [plusBtn] — hidden by default
                const minusBtn = document.createElement('button');
                minusBtn.type = 'button';
                minusBtn.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
                minusBtn.textContent = '\u2212';

                const plusBtn = document.createElement('button');
                plusBtn.type = 'button';
                plusBtn.className = 'bg-[#ededed] rounded-[12px] w-[48px] h-[48px] flex items-center justify-center cursor-pointer select-none text-xl font-bold text-[var(--text-primary)]';
                plusBtn.textContent = '+';

                const sectionEditRow = document.createElement('div');
                sectionEditRow.className = 'flex items-center gap-[8px]';
                sectionEditRow.style.display = isThisExpanded ? 'flex' : 'none';
                sectionEditRow.appendChild(minusBtn);
                sectionEditRow.appendChild(plusBtn);

                fieldRefs.push({ key, minusBtn, plusBtn, display, section, sectionDisplayLine, sectionEditRow, getValue: () => fieldValue });

                display.addEventListener('click', () => {
                    const current = expandedMaxSteps.get(index) ?? null;
                    fieldRefs.forEach(ref => {
                        ref.section.style.display = '';
                        ref.section.style.opacity = '';
                    });
                    if (current === key) {
                        expandedMaxSteps.delete(index);
                        updateMaxSectionVisibility();
                    } else {
                        expandedMaxSteps.set(index, key);
                        fieldRefs.forEach(ref => {
                            if (ref.key !== key) ref.section.style.opacity = '0.3';
                        });
                        updateMaxSectionVisibility();
                    }
                });

                minusBtn.addEventListener('click', () => {
                    fieldValue = roundTo(clamp(fieldValue - fStep, 0, fMax), fStep);
                    display.textContent = `${fieldValue} ${unit}`;
                    editorState.profile.steps[index][key] = fieldValue;
                    updateMaxSectionVisibility();
                });

                plusBtn.addEventListener('click', () => {
                    fieldValue = roundTo(clamp(fieldValue + fStep, 0, fMax), fStep);
                    display.textContent = `${fieldValue} ${unit}`;
                    editorState.profile.steps[index][key] = fieldValue;
                    updateMaxSectionVisibility();
                });

                section.appendChild(sectionDisplayLine);
                section.appendChild(sectionEditRow);
                maxLine.appendChild(section);
            });

            const initialMax = expandedMaxSteps.get(index) ?? null;
            if (initialMax) {
                fieldRefs.forEach(ref => {
                    if (ref.key !== initialMax) ref.section.style.opacity = '0.3';
                });
            }
            updateMaxSectionVisibility();

            exitCell.appendChild(exitLine);
            exitCell.appendChild(maxLine);
        }

        // Footer: delete + insert
        const fCell = mkCell(R.FOOTER, col, 'flex justify-center items-center gap-[40px] px-[16px] py-[8px] border-r border-[#e8e8e8]');

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'w-[40px] h-[40px] flex items-center justify-center text-red-500 hover:bg-red-50 rounded-[10px] cursor-pointer';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
        deleteBtn.setAttribute('aria-label', 'Delete step');
        deleteBtn.addEventListener('click', () => { editorState.profile.steps.splice(index, 1); renderStepCards(); });

        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.className = 'w-[40px] h-[40px] flex items-center justify-center text-[var(--mimoja-blue)] hover:bg-blue-50 rounded-[10px] cursor-pointer';
        insertBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>';
        insertBtn.setAttribute('aria-label', 'Insert step after');
        insertBtn.addEventListener('click', () => { editorState.profile.steps.splice(index + 1, 0, deepCopy(DEFAULT_STEP)); renderStepCards(); });

        fCell.appendChild(deleteBtn);
        fCell.appendChild(insertBtn);
    });

}

function renderSettingsTab() {
    const container = document.getElementById('editor-settings-container');
    if (!container) return;
    container.innerHTML = '';

    const profile = editorState.profile;

    function addSettingsField(labelText, element) {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-[12px]';
        const label = document.createElement('div');
        label.className = 'text-[24px] font-semibold text-[var(--text-primary)]';
        label.textContent = labelText;
        wrapper.appendChild(label);
        wrapper.appendChild(element);
        container.appendChild(wrapper);
        return wrapper;
    }

    // Target Weight
    addSettingsField('Target Weight (g)', createSpinner(
        profile.target_weight || 0, 0.1, 'g', (val) => { editorState.profile.target_weight = val; }, { min: 0, max: 500 }
    ));

    // Target Volume
    addSettingsField('Target Volume (ml)', createSpinner(
        profile.target_volume || 0, 1, 'ml', (val) => { editorState.profile.target_volume = val; }, { min: 0, max: 500 }
    ));

    // Tank Temperature
    addSettingsField('Tank Temperature (\u00b0c)', createSpinner(
        profile.tank_temperature || 0, 1, '\u00b0c', (val) => { editorState.profile.tank_temperature = val; }, { min: 0, max: 110 }
    ));

    // Volume Count Start
    addSettingsField('Volume Count Start at Step', createSpinner(
        profile.target_volume_count_start || 0, 1, '', (val) => { editorState.profile.target_volume_count_start = val; }, { min: 0, max: 10 }
    ));

    // Author (text input) — col 1
    const authorInput = document.createElement('input');
    authorInput.type = 'text';
    authorInput.value = profile.author || '';
    authorInput.className = 'text-[24px] text-[var(--text-primary)] bg-white border border-gray-300 rounded-[12px] px-[16px] py-[12px] outline-none focus:border-[var(--mimoja-blue)] w-full';
    authorInput.addEventListener('change', () => { editorState.profile.author = authorInput.value; });
    addSettingsField('Author', authorInput);

    // Beverage Type (select) — col 2, same row as Author
    const select = document.createElement('select');
    select.className = 'text-[24px] text-[var(--text-primary)] bg-white border border-gray-300 rounded-[12px] px-[16px] py-[12px] outline-none focus:border-[var(--mimoja-blue)] w-full';
    ['espresso', 'manual', 'cleaning'].forEach((type) => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        if (profile.beverage_type === type) opt.selected = true;
        select.appendChild(opt);
    });
    select.addEventListener('change', () => { editorState.profile.beverage_type = select.value; });
    addSettingsField('Beverage Type', select);

    // Notes (textarea) — spans both columns, grows to fill remaining space
    const notesArea = document.createElement('textarea');
    notesArea.value = profile.notes || '';
    notesArea.className = 'text-[22px] text-[var(--text-primary)] bg-white border border-gray-300 rounded-[12px] px-[16px] py-[12px] outline-none focus:border-[var(--mimoja-blue)] w-full resize-none min-h-[200px]';
    notesArea.style.flex = '1';
    notesArea.addEventListener('change', () => { editorState.profile.notes = notesArea.value; });
    const notesWrapper = addSettingsField('Notes', notesArea);
    notesWrapper.className = 'flex flex-col gap-[12px] col-span-2';
}

// ─── Review Tab ─────────────────────────────────────────────────────────────

function describeStep(step, _index) {
    const b = (text) => `<span class="review-value font-semibold text-[var(--button-primary-bg)] cursor-pointer">${text}</span>`;
    const lines = [];
    const isFlow = step.pump !== 'pressure';
    const transition = step.transition === 'smooth' ? 'smoothly' : 'quickly';
    const sensor = step.sensor === 'water' ? 'Water' : 'Coffee';

    // Temperature
    lines.push(`Set ${b(sensor)} temperature to ${b(`${step.temperature ?? 93} °C`)}`);

    // Pump target
    if (isFlow) {
        lines.push(`Pour ${b(transition)} at a rate of ${b(`${step.flow ?? 0} ml/s`)}`);
    } else {
        lines.push(`${transition === 'quickly' ? 'Pressurize' : 'Build pressure'} ${b(transition)} to ${b(`${step.pressure ?? 0} bar`)}`);
    }

    // Duration / volume limit
    const secVal = step.seconds ?? 0;
    const volVal = step.volume ?? 0;
    const wgtVal = step.weight ?? 0;
    const parts = [];
    if (wgtVal > 0) parts.push(b(`${wgtVal} g`));
    if (secVal > 0) parts.push(b(`${secVal} sec`));
    if (volVal > 0) parts.push(b(`${volVal} ml`));
    if (parts.length) lines.push(`For a maximum of ${parts.join(' or ')}`);

    // Exit condition
    if (step.exit?.value !== undefined && step.exit.value !== 0 && step.exit.type !== 'off') {
        const exitType = step.exit.type ?? 'pressure';
        const exitCond = step.exit.condition === 'under' ? 'under' : 'over';
        const exitUnit = exitType === 'flow' ? 'ml/s' : exitType === 'pressure' ? 'bar' : exitType === 'weight' ? 'g' : 'sec';
        lines.push(`Move on if ${b(exitType)} is ${b(exitCond)} ${b(`${step.exit.value} ${exitUnit}`)}`);
    }

    return lines;
}

function renderReviewTab() {
    const profile = editorState.profile;
    if (!profile) return;

    // ── Steps list ──────────────────────────────────────────────────────────
    const stepsList = document.getElementById('review-steps-list');
    if (stepsList) {
        stepsList.innerHTML = '';
        (profile.steps || []).forEach((step, i) => {
            const row = document.createElement('div');
            row.className = 'flex gap-[12px] items-start text-[#121212]';

            const nameEl = document.createElement('p');
            nameEl.className = 'font-semibold text-[20px] w-[160px] shrink-0 leading-[1.3]';
            nameEl.textContent = `${i + 1}: ${step.name || 'Step'}`;
            row.appendChild(nameEl);

            const bulletCol = document.createElement('ul');
            bulletCol.className = 'flex flex-col gap-[3px] list-disc list-inside text-[20px]';
            for (const line of describeStep(step, i)) {
                const li = document.createElement('li');
                li.innerHTML = line;
                bulletCol.appendChild(li);
            }
            row.appendChild(bulletCol);
            stepsList.appendChild(row);
        });
        stepsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('review-value')) setActiveTab(0);
        });
    }

    // ── Settings list ───────────────────────────────────────────────────────
    const settingsList = document.getElementById('review-settings-list');
    if (settingsList) {
        settingsList.innerHTML = '';
        const s = (label, val) => {
            const li = document.createElement('li');
            li.innerHTML = `${label} <span class="font-semibold text-[var(--button-primary-bg)]">${val}</span>`;
            settingsList.appendChild(li);
        };
        if (profile.tank_temperature != null) s('Preheat water tank at', `${profile.tank_temperature} °C`);
        if (profile.target_volume_count_start != null) s('Track water volume after step', profile.target_volume_count_start);
        if (profile.target_weight != null && profile.target_weight > 0) s('Stop at weight', `${profile.target_weight} g`);
        if (profile.target_volume != null && profile.target_volume > 0) s('Stop at volume', `${profile.target_volume} ml`);
        if (profile.beverage_type) s('Beverage type', profile.beverage_type);
    }

    // ── Graph preview ───────────────────────────────────────────────────────
    const graphDiv = document.getElementById('review-graph');
    if (!graphDiv || typeof Plotly === 'undefined') return;

    // Build step-target traces + step boundary markers
    const pressureX = [], pressureY = [], flowX = [], flowY = [], tempX = [], tempY = [];
    const stepShapes = [];
    let t = 0;
    for (const step of (profile.steps || [])) {
        const dur = (step.seconds && step.seconds > 0) ? step.seconds : 10;
        const startT = t;
        const endT = t + dur;

        // Step boundary vertical line (skip t=0)
        if (startT > 0) {
            stepShapes.push({
                type: 'line',
                x0: startT, x1: startT,
                y0: 0, y1: 1, yref: 'paper',
                line: { color: '#7c7c7c', width: 2, dash: 'longdash' },
            });
        }

        if (step.pump === 'pressure') {
            pressureX.push(startT, endT);
            pressureY.push(step.pressure ?? 0, step.pressure ?? 0);
            flowX.push(startT, endT);
            flowY.push(0, 0);
        } else {
            flowX.push(startT, endT);
            flowY.push(step.flow ?? 0, step.flow ?? 0);
            pressureX.push(startT, endT);
            pressureY.push(0, 0);
        }
        const tempScaled = ((step.temperature ?? 0) / 100) * 10;
        tempX.push(startT, endT);
        tempY.push(tempScaled, tempScaled);
        t = endT;
    }

    const traces = [
        { x: pressureX, y: pressureY, name: 'Pressure', mode: 'lines', line: { color: '#17c29a' }, hoverinfo: 'name' },
        { x: flowX,     y: flowY,     name: 'Flow',     mode: 'lines', line: { color: '#0358cf' }, hoverinfo: 'name' },
        { x: tempX,     y: tempY,     name: '°C',       mode: 'lines', line: { color: '#ff97a1' }, hoverinfo: 'name' },
    ];

    const layout = {
        plot_bgcolor: 'white',
        paper_bgcolor: 'white',
        font: { color: '#E0E0E0', size: 16 },
        autosize: true,
        margin: { l: 50, r: 50, t: 20, b: 40, pad: 0 },
        showlegend: false,
        shapes: stepShapes,
        xaxis: { gridcolor: '#E0E0E0', linecolor: '#E0E0E0', tickcolor: '#E0E0E0', fixedrange: true },
        yaxis: { gridcolor: '#E0E0E0', linecolor: '#E0E0E0', tickcolor: '#E0E0E0', range: [0, 10], dtick: 1, fixedrange: true },
    };

    Plotly.react(graphDiv, traces, layout, { responsive: true, displayModeBar: false });
}

// ─── Tab Management ─────────────────────────────────────────────────────────

function setActiveTab(tabIndex) {
    editorState.activeTab = tabIndex;

    // Update tab buttons
    document.querySelectorAll('.editor-tab-btn').forEach((btn) => {
        const idx = parseInt(btn.dataset.tab, 10);
        if (idx === tabIndex) {
            btn.className = 'editor-tab-btn font-bold px-[28px] h-[44px] rounded-[44px] transition-colors text-[20px] tracking-wide bg-[var(--button-primary-bg)] text-white';
        } else {
            btn.className = 'editor-tab-btn font-bold px-[28px] h-[44px] rounded-[44px] transition-colors text-[20px] tracking-wide text-[var(--button-primary-bg)] bg-transparent';
        }
    });

    // Show/hide panels
    for (let i = 0; i < TAB_COUNT; i++) {
        const panel = document.getElementById(`editor-tab-panel-${i}`);
        if (panel) {
            panel.classList.toggle('hidden', i !== tabIndex);
        }
    }

    if (tabIndex === 2) renderReviewTab();
}

// ─── Title Editing ──────────────────────────────────────────────────────────

function initTitleEditing() {
    const display = document.getElementById('editor-title-display');
    const input = document.getElementById('editor-title-input');

    if (!display || !input) return;

    function startEditing() {
        display.classList.add('hidden');
        input.classList.remove('hidden');
        input.value = editorState.profile.title || '';
        input.focus();
        input.select();
    }

    function stopEditing() {
        const val = input.value.trim();
        if (val) {
            editorState.profile.title = val;
            display.textContent = val;
        }
        input.classList.add('hidden');
        display.classList.remove('hidden');
    }

    display.addEventListener('click', startEditing);

    input.addEventListener('blur', stopEditing);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = editorState.profile.title || ''; input.blur(); }
    });
}

// ─── Save / Cancel ──────────────────────────────────────────────────────────

async function saveProfile() {
    if (!editorState.profile.title?.trim()) {
        showToast('Profile needs a name', 3000, 'error');
        return;
    }
    if (!editorState.profile.steps?.length) {
        showToast('Add at least one step', 3000, 'error');
        return;
    }

    try {
        const { setKVValue } = await import('./api.js');
        const { availableProfiles } = await import('./profileManager.js');

        // Auto-suffix title if name already taken
        const existingTitles = new Set(
            Object.values(availableProfiles).map(r => r.profile?.title).filter(Boolean)
        );
        let finalTitle = editorState.profile.title.trim();
        if (existingTitles.has(finalTitle)) {
            let n = 2;
            while (existingTitles.has(`${finalTitle} (${n})`)) n++;
            finalTitle = `${finalTitle} (${n})`;
            editorState.profile.title = finalTitle;
            // Update UI title display
            const titleDisplay = document.getElementById('editor-title-display');
            if (titleDisplay) titleDisplay.textContent = finalTitle;
        }

        // Ensure required Kletsky v2 top-level fields are present
        editorState.profile.version = editorState.profile.version || '2';
        editorState.profile.type = editorState.profile.type || 'advanced';
        editorState.profile.legacy_profile_type = editorState.profile.legacy_profile_type || 'settings_2c';
        editorState.profile.lang = editorState.profile.lang || 'en';
        if (editorState.profile.hidden === undefined) editorState.profile.hidden = '0';
        if (editorState.profile.reference_file === undefined) editorState.profile.reference_file = '';
        if (editorState.profile.changes_since_last_espresso === undefined) editorState.profile.changes_since_last_espresso = '';

        const kvKey = crypto.randomUUID();
        const now = new Date().toISOString();

        // Build a ProfileRecord-compatible object
        const kvRecord = {
            id: `kv:${kvKey}`,
            profile: editorState.profile,
            isDefault: false,
            isFavorite: false,
            visibility: 'visible',
            parentId: editorState.sourceProfileId,
            createdAt: now,
            updatedAt: now,
            _kvKey: kvKey,
        };

        await setKVValue('streamline', kvKey, kvRecord);

        // Inject into live cache so selector shows it immediately without reload.
        availableProfiles[kvRecord.id] = kvRecord;

        showToast('Profile saved!', 2000, 'success');
        setTimeout(() => { loadPage('src/profiles/profile_selector.html'); }, 1000);
    } catch (err) {
        console.error('Profile save failed:', err);
        showToast(`Save failed: ${err.message}`, 4000, 'error');
    }
}

function cancelEditor() {
    loadPage('src/profiles/profile_selector.html');
}


// ─── Init ───────────────────────────────────────────────────────────────────

export async function initializeProfileEditor() {
    console.log('[ProfileEditor] initializeProfileEditor called');
    console.log('[ProfileEditor] window.__pendingEditProfile=', window.__pendingEditProfile);
    console.log('[ProfileEditor] typeof window.__pendingEditProfile=', typeof window.__pendingEditProfile);

    // 1. Read pending profile from window global (set by profile_selector.js)
    const profileRecord = window.__pendingEditProfile;
    if (!profileRecord) {
        console.warn('[ProfileEditor] No profile data on window.__pendingEditProfile — aborting.');
        showToast('No profile data found. Returning to selector.', 3000, 'error');
        setTimeout(() => { loadPage('src/profiles/profile_selector.html'); }, 1000);
        return;
    }
    console.log('[ProfileEditor] Got profile:', profileRecord?.profile?.title);
    window.__pendingEditProfile = null;

    // 2. Deep copy
    editorState.sourceProfileRecord = profileRecord;
    editorState.sourceProfileId = profileRecord.id;
    editorState.profile = deepCopy(profileRecord.profile);
    editorState.activeTab = 0;
    expandedTempSteps.clear();
    expandedPumpSteps.clear();
    expandedLimSteps.clear();
    expandedMaxSteps.clear();
    expandedExitSteps.clear();

    // 3. Populate title
    const titleDisplay = document.getElementById('editor-title-display');
    if (titleDisplay) titleDisplay.textContent = editorState.profile.title || 'Untitled Profile';

    // 4. Render tabs
    setActiveTab(0);
    renderStepCards();
    renderSettingsTab();

    // 5. Wire event listeners
    initTitleEditing();

    // Tab buttons
    document.querySelectorAll('.editor-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            setActiveTab(parseInt(btn.dataset.tab, 10));
        });
    });

    // Save / Cancel
    const saveBtn = document.getElementById('editor-save-btn');
    const cancelBtn = document.getElementById('editor-cancel-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveProfile);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelEditor);

    console.log('Profile Editor: Initialization complete.');
}
