import { loadPage } from './router.js';
import { showToast } from './ui.js';

// ─── State ──────────────────────────────────────────────────────────────────

let editorState = {
    sourceProfileId: null,
    sourceProfileRecord: null,
    profile: null,
    activeTab: 0,
};

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
                btn.className = 'bg-[var(--mimoja-blue)] text-white rounded-[8px] px-[10px] py-[6px] text-[16px] font-semibold cursor-pointer transition-colors';
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
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `220px repeat(${numSteps}, minmax(380px, 1fr)) 180px`;
    container.style.gridTemplateRows = `repeat(${14}, 1fr)`;
    container.style.height = '100%';
    container.style.width = '100%';

    const R = { HEADER: 1, TEMP: 2, PUMP: 3, SENSOR: 4, TRANS: 5, TARGET: 6, LIMITER: 7, SECONDS: 8, WEIGHT: 9, VOLUME: 10, EXIT_TYPE: 11, EXIT_COND: 12, EXIT_VAL: 13, FOOTER: 14 };
    const TOTAL_ROWS = 14;

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
            tipWrapper.className = 'tooltip tooltip-right ml-[6px]';
            tipWrapper.setAttribute('data-tip', tip);
            tipWrapper.innerHTML = `<button type="button" class="w-[18px] h-[18px] rounded-full bg-gray-200 text-gray-500 text-[11px] font-bold flex items-center justify-center shrink-0 focus:outline-none" tabindex="-1" aria-label="Help">i</button>`;
            el.appendChild(tipWrapper);
        }
        return el;
    }

    mkLabel(R.HEADER,    '');
    mkLabel(R.TEMP,      'Temperature', 'Target temperature at the group head for this step (°C)');
    mkLabel(R.PUMP,      'Pump',        'Flow: targets a constant flow rate (ml/s). Pressure: targets a constant pressure (bar)');
    mkLabel(R.SENSOR,    'Sensor',      'Which thermometer drives temperature control. Coffee = group head; Water = boiler');
    mkLabel(R.TRANS,     'Transition',  'Fast: jumps immediately to the target value. Smooth: ramps gradually from the previous step\'s value');
    mkLabel(R.TARGET,    'Target',      'The pump target value — ml/s in Flow mode, bar in Pressure mode');
    mkLabel(R.LIMITER,   'Limiter',     'Safety cap on the opposing axis — max pressure (bar) in Flow mode, max flow rate (ml/s) in Pressure mode');
    mkLabel(R.SECONDS,   'Exit: Seconds',   'Maximum step duration. Machine advances to the next step when this time is reached');
    mkLabel(R.WEIGHT,    'Exit: Weight',    'Advance to next step when scale reads this weight (g). Set to 0 to disable');
    mkLabel(R.VOLUME,    'Exit: Volume',    'Advance to next step when dispensed volume reaches this value (ml). Set to 0 to disable');
    mkLabel(R.EXIT_TYPE, 'Exit: Type',      'Which sensor triggers the exit — Pressure (bar), Flow (ml/s), Weight (g), or Time (sec)');
    mkLabel(R.EXIT_COND, 'Exit: Condition', 'IS OVER fires when value exceeds the threshold; IS UNDER fires when it drops below');
    mkLabel(R.EXIT_VAL,  'Exit: Value',     'The threshold value for the exit condition. Unit matches the Exit Type selected');
    mkLabel(R.FOOTER,    '');

    // ── Step columns ──────────────────────────────────────────────────────────
    const stepCell = 'flex items-center justify-center px-[16px] py-[8px] border-r border-b border-[#e8e8e8]';

    steps.forEach((step, index) => {
        const col = index + 2;
        const isFlow = step.pump !== 'pressure';

        // Header: step number + name input
        const hCell = mkCell(R.HEADER, col, 'flex items-center justify-center gap-[10px] px-[16px] py-[10px] border-r border-b-2 border-[#e8e8e8] bg-white');
        const numSpan = document.createElement('span');
        numSpan.className = 'text-[20px] font-bold text-[var(--text-primary)] shrink-0';
        numSpan.textContent = `${index + 1}.`;
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = step.name || '';
        nameInput.className = 'text-[20px] font-bold text-[var(--text-primary)] bg-transparent border-b border-gray-300 outline-none focus:border-[var(--mimoja-blue)] w-[200px]';
        nameInput.addEventListener('change', () => { editorState.profile.steps[index].name = nameInput.value; });
        hCell.appendChild(numSpan);
        hCell.appendChild(nameInput);

        // Temperature
        const tCell = mkCell(R.TEMP, col, stepCell);
        tCell.appendChild(createSpinner(step.temperature || 93, 0.5, '\u00b0c', (val) => {
            editorState.profile.steps[index].temperature = val;
        }, { min: 0, max: 110 }));

        // Pump
        const pCell = mkCell(R.PUMP, col, stepCell);
        pCell.appendChild(createToggle(
            [{ label: 'FLOW', value: 'flow' }, { label: 'PRESSURE', value: 'pressure' }],
            step.pump || 'flow',
            (val) => { editorState.profile.steps[index].pump = val; renderStepCards(); }
        ));

        // Transition
        const trCell = mkCell(R.TRANS, col, stepCell);
        trCell.appendChild(createToggle(
            [{ label: 'FAST', value: 'fast' }, { label: 'SMOOTH', value: 'smooth' }],
            step.transition || 'fast',
            (val) => { editorState.profile.steps[index].transition = val; }
        ));

        // Sensor
        const sensorCell = mkCell(R.SENSOR, col, stepCell);
        sensorCell.appendChild(createToggle(
            [{ label: 'COFFEE', value: 'coffee' }, { label: 'WATER', value: 'water' }],
            step.sensor || 'coffee',
            (val) => { editorState.profile.steps[index].sensor = val; }
        ));

        // Target (flow rate or pressure)
        const targetCell = mkCell(R.TARGET, col, stepCell);
        if (isFlow) {
            targetCell.appendChild(createSpinner(step.flow || 0, 0.1, 'ml/s', (val) => {
                editorState.profile.steps[index].flow = val;
            }, { min: 0, max: 15 }));
        } else {
            targetCell.appendChild(createSpinner(step.pressure || 0, 0.1, 'bar', (val) => {
                editorState.profile.steps[index].pressure = val;
            }, { min: 0, max: 16 }));
        }

        // Limiter (unit flips with pump mode)
        const limCell = mkCell(R.LIMITER, col, stepCell);
        if (isFlow) {
            limCell.appendChild(createSpinner(step.limiter?.value ?? 0, 0.1, 'bar', (val) => {
                if (!editorState.profile.steps[index].limiter) editorState.profile.steps[index].limiter = { value: val, range: 0.6 };
                else editorState.profile.steps[index].limiter.value = val;
            }, { min: 0, max: 16 }));
        } else {
            limCell.appendChild(createSpinner(step.limiter?.value ?? 0, 0.1, 'ml/s', (val) => {
                if (!editorState.profile.steps[index].limiter) editorState.profile.steps[index].limiter = { value: val, range: 0.6 };
                else editorState.profile.steps[index].limiter.value = val;
            }, { min: 0, max: 15 }));
        }

        // Exit: Seconds
        const secCell = mkCell(R.SECONDS, col, stepCell);
        secCell.appendChild(createSpinner(step.seconds || 0, 1, 'sec', (val) => {
            editorState.profile.steps[index].seconds = val;
        }, { min: 0, max: 300 }));

        // Exit: Weight
        const wCell = mkCell(R.WEIGHT, col, stepCell);
        wCell.appendChild(createSpinner(step.weight || 0, 1, 'g', (val) => {
            editorState.profile.steps[index].weight = val;
        }, { min: 0, max: 500 }));

        // Exit: Volume
        const vCell = mkCell(R.VOLUME, col, stepCell);
        vCell.appendChild(createSpinner(step.volume || 0, 1, 'ml', (val) => {
            editorState.profile.steps[index].volume = val;
        }, { min: 0, max: 500 }));

        // Exit type
        const exitDef = step.exit || { type: 'pressure', condition: 'over', value: 0 };
        const exitTypeCell = mkCell(R.EXIT_TYPE, col, stepCell);
        exitTypeCell.appendChild(createToggle(
            [
                { label: 'PRESSURE', value: 'pressure' },
                { label: 'FLOW',     value: 'flow' },
                { label: 'WEIGHT',   value: 'weight' },
                { label: 'TIME',     value: 'time' },
            ],
            exitDef.type || 'pressure',
            (val) => {
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: val, condition: 'over', value: 0 };
                else editorState.profile.steps[index].exit.type = val;
                renderStepCards();
            }
        ));

        // Exit condition
        const condCell = mkCell(R.EXIT_COND, col, stepCell);
        condCell.appendChild(createToggle(
            [{ label: 'IS UNDER', value: 'under' }, { label: 'IS OVER', value: 'over' }],
            exitDef.condition || 'over',
            (val) => {
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: 'pressure', condition: val, value: 0 };
                else editorState.profile.steps[index].exit.condition = val;
            }
        ));

        // Exit value — unit and max adapt to exit type
        const EXIT_UNIT_MAP = { pressure: 'bar', flow: 'ml/s', weight: 'g', time: 'sec' };
        const EXIT_STEP_MAP = { pressure: 0.1, flow: 0.1, weight: 0.5, time: 1 };
        const EXIT_MAX_MAP  = { pressure: 16,  flow: 15,   weight: 500, time: 300 };
        const exitType = exitDef.type || 'pressure';
        const exitValCell = mkCell(R.EXIT_VAL, col, stepCell);
        exitValCell.appendChild(createSpinner(
            exitDef.value ?? 0,
            EXIT_STEP_MAP[exitType] ?? 0.1,
            EXIT_UNIT_MAP[exitType] ?? 'bar',
            (val) => {
                if (!editorState.profile.steps[index].exit) editorState.profile.steps[index].exit = { type: exitType, condition: 'over', value: val };
                else editorState.profile.steps[index].exit.value = val;
            },
            { min: 0, max: EXIT_MAX_MAP[exitType] ?? 16 }
        ));

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

    // ── Add Step column (spans all rows) ─────────────────────────────────────
    const addCell = document.createElement('div');
    addCell.style.gridRow = `1 / ${TOTAL_ROWS + 1}`;
    addCell.style.gridColumn = numSteps + 2;
    addCell.className = 'flex items-center justify-center';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'w-[120px] h-[120px] bg-[#ededed] rounded-[30px] flex items-center justify-center cursor-pointer hover:bg-gray-300 transition-colors';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-[var(--mimoja-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>';
    addBtn.setAttribute('aria-label', 'Add new step');
    addBtn.addEventListener('click', () => { editorState.profile.steps.push(deepCopy(DEFAULT_STEP)); renderStepCards(); });

    addCell.appendChild(addBtn);
    container.appendChild(addCell);
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

function describeStep(step, index) {
    const lines = [];
    const pump = step.pump === 'pressure' ? 'pressure' : 'flow';
    const transition = step.transition === 'smooth' ? 'smoothly' : 'quickly';

    // Temperature
    lines.push(`Set coffee temperature to <span class="font-semibold text-[#385a92]">${step.temperature ?? 93} °C</span>`);

    // Pump target
    if (pump === 'flow') {
        lines.push(`Pour ${transition} at a rate of <span class="font-semibold text-[#385a92]">${step.flow ?? 0} ml/s</span>`);
    } else {
        lines.push(`${transition === 'quickly' ? 'Pressurize' : 'Build pressure'} ${transition} to <span class="font-semibold text-[#385a92]">${step.pressure ?? 0} bar</span>`);
    }

    // Duration / volume limit
    const secVal = step.seconds ?? 0;
    const volVal = step.volume ?? 0;
    const wgtVal = step.weight ?? 0;
    const parts = [];
    if (secVal > 0) parts.push(`<span class="font-semibold text-[#385a92]">${secVal} sec</span>`);
    if (volVal > 0) parts.push(`<span class="font-semibold text-[#385a92]">${volVal} ml</span>`);
    if (wgtVal > 0) parts.push(`<span class="font-semibold text-[#385a92]">${wgtVal} g</span>`);
    if (parts.length) lines.push(`For a maximum of ${parts.join(' or ')}`);

    // Exit condition
    if (step.exit?.value !== undefined && step.exit.value !== 0) {
        const exitType = step.exit.type ?? 'pressure';
        const exitCond = step.exit.condition === 'under' ? 'under' : 'over';
        const exitUnit = exitType === 'flow' ? 'ml/s' : exitType === 'pressure' ? 'bar' : exitType === 'weight' ? 'g' : 'sec';
        lines.push(`Move on if ${exitType} is ${exitCond} <span class="font-semibold text-[#385a92]">${step.exit.value} ${exitUnit}</span>`);
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
            row.className = 'flex gap-[16px] items-start text-[#121212]';

            const nameEl = document.createElement('p');
            nameEl.className = 'font-semibold text-[20px] w-[160px] shrink-0 leading-[1.3]';
            nameEl.textContent = `${i + 1}: ${step.name || 'Step'}`;
            row.appendChild(nameEl);

            const bulletCol = document.createElement('ul');
            bulletCol.className = 'flex flex-col gap-[8px] list-disc list-inside text-[20px]';
            for (const line of describeStep(step, i)) {
                const li = document.createElement('li');
                li.innerHTML = line;
                bulletCol.appendChild(li);
            }
            row.appendChild(bulletCol);
            stepsList.appendChild(row);
        });
    }

    // ── Settings list ───────────────────────────────────────────────────────
    const settingsList = document.getElementById('review-settings-list');
    if (settingsList) {
        settingsList.innerHTML = '';
        const s = (label, val) => {
            const li = document.createElement('li');
            li.innerHTML = `${label} <span class="font-semibold text-[#385a92]">${val}</span>`;
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
            btn.className = 'editor-tab-btn font-bold px-[28px] h-[44px] rounded-[44px] transition-colors text-[20px] tracking-wide bg-[#385a92] text-white';
        } else {
            btn.className = 'editor-tab-btn font-bold px-[28px] h-[44px] rounded-[44px] transition-colors text-[20px] tracking-wide text-[#5f7ba8] bg-transparent';
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
    const editIcon = document.getElementById('editor-title-edit-icon');

    if (!display || !input) return;

    function startEditing() {
        display.classList.add('hidden');
        editIcon.classList.add('hidden');
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
        editIcon.classList.remove('hidden');
    }

    display.addEventListener('click', startEditing);
    if (editIcon) editIcon.addEventListener('click', startEditing);

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
