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
    wrapper.className = 'flex items-center gap-[20px]';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'bg-[#ededed] rounded-[20px] w-[72px] h-[72px] flex items-center justify-center cursor-pointer select-none text-2xl font-bold text-[var(--text-primary)]';
    minusBtn.textContent = '\u2212';
    minusBtn.setAttribute('aria-label', 'Decrease');

    const display = document.createElement('span');
    display.className = 'font-bold text-[28px] text-center w-[120px] text-[var(--text-primary)]';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'bg-[#ededed] rounded-[20px] w-[72px] h-[72px] flex items-center justify-center cursor-pointer select-none text-2xl font-bold text-[var(--text-primary)]';
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
                btn.className = 'bg-[var(--mimoja-blue)] text-white rounded-[10px] px-4 py-2 text-[20px] font-semibold cursor-pointer transition-colors';
            } else {
                btn.className = 'bg-[#ededed] text-gray-600 rounded-[10px] px-4 py-2 text-[20px] font-semibold cursor-pointer transition-colors';
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

// ─── Step Card Builder ──────────────────────────────────────────────────────

function buildStepCard(step, index) {
    const card = document.createElement('div');
    card.className = 'flex-shrink-0 border-r border-base-300 p-[30px] overflow-y-auto';
    card.style.width = 'calc(100% / 4)';
    card.style.minWidth = 'calc(100% / 4)';
    card.dataset.stepIndex = index;

    // Step number + editable name
    const header = document.createElement('div');
    header.className = 'flex items-center gap-[12px] mb-[24px]';

    const stepNum = document.createElement('span');
    stepNum.className = 'text-[28px] font-bold text-[var(--text-primary)]';
    stepNum.textContent = `${index + 1}.`;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = step.name || '';
    nameInput.className = 'text-[28px] font-bold text-[var(--text-primary)] bg-transparent border-b border-gray-300 outline-none focus:border-[var(--mimoja-blue)] flex-1';
    nameInput.addEventListener('change', () => {
        editorState.profile.steps[index].name = nameInput.value;
    });

    header.appendChild(stepNum);
    header.appendChild(nameInput);
    card.appendChild(header);

    // Helper to add a labeled row
    function addRow(labelText, element) {
        const row = document.createElement('div');
        row.className = 'mb-[20px]';
        const label = document.createElement('div');
        label.className = 'text-[20px] text-gray-500 mb-[8px]';
        label.textContent = labelText;
        row.appendChild(label);
        row.appendChild(element);
        card.appendChild(row);
    }

    // Temperature spinner
    addRow('Temperature', createSpinner(step.temperature || 93, 0.5, '\u00b0c', (val) => {
        editorState.profile.steps[index].temperature = val;
    }, { min: 0, max: 110 }));

    // Pump toggle
    const pumpToggle = createToggle(
        [{ label: 'FLOW', value: 'flow' }, { label: 'PRESSURE', value: 'pressure' }],
        step.pump || 'flow',
        (val) => {
            editorState.profile.steps[index].pump = val;
            // Re-render this card to show/hide pump-specific fields
            renderStepCards();
        }
    );
    addRow('Pump', pumpToggle);

    // Transition toggle
    addRow('Transition', createToggle(
        [{ label: 'FAST', value: 'fast' }, { label: 'SMOOTH', value: 'smooth' }],
        step.transition || 'fast',
        (val) => { editorState.profile.steps[index].transition = val; }
    ));

    if (step.pump === 'flow') {
        // Flow rate
        addRow('Rate (ml/s)', createSpinner(step.flow || 0, 0.1, 'ml/s', (val) => {
            editorState.profile.steps[index].flow = val;
        }, { min: 0, max: 15 }));

        // Pressure limiter
        addRow('Limiter (pressure bar)', createSpinner(
            step.limiter ? step.limiter.value : 0, 0.1, 'bar', (val) => {
                if (!editorState.profile.steps[index].limiter) {
                    editorState.profile.steps[index].limiter = { value: val, range: 0.6 };
                } else {
                    editorState.profile.steps[index].limiter.value = val;
                }
            }, { min: 0, max: 16 }
        ));
    } else {
        // Pressure
        addRow('Pressure (bar)', createSpinner(step.pressure || 0, 0.1, 'bar', (val) => {
            editorState.profile.steps[index].pressure = val;
        }, { min: 0, max: 16 }));

        // Flow limiter
        addRow('Limiter (flow ml/s)', createSpinner(
            step.limiter ? step.limiter.value : 0, 0.1, 'ml/s', (val) => {
                if (!editorState.profile.steps[index].limiter) {
                    editorState.profile.steps[index].limiter = { value: val, range: 0.6 };
                } else {
                    editorState.profile.steps[index].limiter.value = val;
                }
            }, { min: 0, max: 15 }
        ));
    }

    // Exit conditions
    addRow('Exit after (seconds)', createSpinner(step.seconds || 0, 1, 'sec', (val) => {
        editorState.profile.steps[index].seconds = val;
    }, { min: 0, max: 300 }));

    addRow('Exit after (weight)', createSpinner(step.weight || 0, 1, 'g', (val) => {
        editorState.profile.steps[index].weight = val;
    }, { min: 0, max: 500 }));

    addRow('Exit after (volume)', createSpinner(step.volume || 0, 1, 'ml', (val) => {
        editorState.profile.steps[index].volume = val;
    }, { min: 0, max: 500 }));

    // Max pressure limiter exit condition (only if pump=flow)
    if (step.pump === 'flow' && step.exit) {
        addRow('Max pressure limiter condition', createToggle(
            [{ label: 'IS UNDER', value: 'under' }, { label: 'IS OVER', value: 'over' }],
            step.exit.condition || 'over',
            (val) => {
                if (!editorState.profile.steps[index].exit) {
                    editorState.profile.steps[index].exit = { type: 'pressure', condition: val, value: 9.0 };
                } else {
                    editorState.profile.steps[index].exit.condition = val;
                }
            }
        ));

        addRow('Max pressure limiter (bar)', createSpinner(
            step.exit.value || 0, 0.1, 'bar', (val) => {
                if (!editorState.profile.steps[index].exit) {
                    editorState.profile.steps[index].exit = { type: 'pressure', condition: 'over', value: val };
                } else {
                    editorState.profile.steps[index].exit.value = val;
                }
            }, { min: 0, max: 16 }
        ));
    }

    // Footer: delete + insert buttons
    const footer = document.createElement('div');
    footer.className = 'flex justify-between items-center mt-[24px] pt-[16px] border-t border-gray-200';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'w-[52px] h-[52px] flex items-center justify-center text-red-500 hover:bg-red-50 rounded-[12px] cursor-pointer';
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
    deleteBtn.setAttribute('aria-label', 'Delete step');
    deleteBtn.addEventListener('click', () => {
        editorState.profile.steps.splice(index, 1);
        renderStepCards();
    });

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'w-[52px] h-[52px] flex items-center justify-center text-[var(--mimoja-blue)] hover:bg-blue-50 rounded-[12px] cursor-pointer';
    insertBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>';
    insertBtn.setAttribute('aria-label', 'Insert step after');
    insertBtn.addEventListener('click', () => {
        editorState.profile.steps.splice(index + 1, 0, deepCopy(DEFAULT_STEP));
        renderStepCards();
    });

    footer.appendChild(deleteBtn);
    footer.appendChild(insertBtn);
    card.appendChild(footer);

    return card;
}

function buildAddStepCard() {
    const card = document.createElement('div');
    card.className = 'flex-shrink-0 flex items-center justify-center';
    card.style.width = 'calc(100% / 4)';
    card.style.minWidth = 'calc(100% / 4)';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'w-[120px] h-[120px] bg-[#ededed] rounded-[30px] flex items-center justify-center cursor-pointer hover:bg-gray-300 transition-colors';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-[var(--mimoja-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>';
    addBtn.setAttribute('aria-label', 'Add new step');
    addBtn.addEventListener('click', () => {
        editorState.profile.steps.push(deepCopy(DEFAULT_STEP));
        renderStepCards();
    });

    card.appendChild(addBtn);
    return card;
}

// ─── Render Functions ───────────────────────────────────────────────────────

function renderStepCards() {
    const container = document.getElementById('editor-steps-container');
    if (!container) return;
    container.innerHTML = '';

    const steps = editorState.profile.steps || [];
    steps.forEach((step, i) => {
        container.appendChild(buildStepCard(step, i));
    });
    container.appendChild(buildAddStepCard());
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
    addSettingsField('Volume Count Start', createSpinner(
        profile.target_volume_count_start || 0, 1, '', (val) => { editorState.profile.target_volume_count_start = val; }, { min: 0, max: 10 }
    ));

    // Author (text input)
    const authorInput = document.createElement('input');
    authorInput.type = 'text';
    authorInput.value = profile.author || '';
    authorInput.className = 'text-[24px] text-[var(--text-primary)] bg-white border border-gray-300 rounded-[12px] px-[16px] py-[12px] outline-none focus:border-[var(--mimoja-blue)] w-full';
    authorInput.addEventListener('change', () => { editorState.profile.author = authorInput.value; });
    addSettingsField('Author', authorInput);

    // Notes (textarea)
    const notesArea = document.createElement('textarea');
    notesArea.rows = 3;
    notesArea.value = profile.notes || '';
    notesArea.className = 'text-[22px] text-[var(--text-primary)] bg-white border border-gray-300 rounded-[12px] px-[16px] py-[12px] outline-none focus:border-[var(--mimoja-blue)] w-full resize-none';
    notesArea.addEventListener('change', () => { editorState.profile.notes = notesArea.value; });
    addSettingsField('Notes', notesArea);

    // Beverage Type (select)
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
            row.className = 'flex gap-[20px] items-start text-[#121212]';

            const nameEl = document.createElement('p');
            nameEl.className = 'font-semibold text-[32px] w-[260px] shrink-0 leading-[1.3]';
            nameEl.textContent = `${i + 1}: ${step.name || 'Step'}`;
            row.appendChild(nameEl);

            const bulletCol = document.createElement('ul');
            bulletCol.className = 'flex flex-col gap-[18px] list-disc list-inside text-[32px]';
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
            btn.className = 'editor-tab-btn font-bold px-[40px] h-[80px] rounded-[60px] transition-colors text-[24px] tracking-wide bg-[#385a92] text-white';
        } else {
            btn.className = 'editor-tab-btn font-bold px-[40px] h-[80px] rounded-[60px] transition-colors text-[24px] tracking-wide text-[#5f7ba8] bg-transparent';
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
