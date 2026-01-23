// Entry Templates System
const TEMPLATES = {
    'three-things': {
        name: '3 Things I\'m Grateful For',
        text: `1. 
2. 
3. `
    },
    'challenge-gratitude': {
        name: 'Gratitude from a Challenge',
        text: `Challenge I faced:

What I'm grateful for despite this:

How this made me stronger:`
    },
    'people': {
        name: 'People I\'m Grateful For',
        text: `Person: 
Why I'm grateful: 

Person: 
Why I'm grateful: 

Person: 
Why I'm grateful: `
    },
    'moments': {
        name: 'Favorite Moments',
        text: `Moment 1: 

Moment 2: 

Moment 3: `
    },
    'health': {
        name: 'Health & Wellness',
        text: `Physical health I'm grateful for:

Mental/emotional wellness I appreciate:

People who support my health:

Habits I'm grateful for:`
    },
    'reflection': {
        name: 'Daily Reflection',
        text: `Today's highlight:

Someone who made me smile:

Something small I appreciate:

Tomorrow I'm excited about:`
    }
};

/**
 * Initialize template selector with all available templates
 * Called from app.js after DOM is ready
 */
function initTemplateSelector() {
    const templateSelector = document.getElementById('template-selector');
    const insertTemplateBtn = document.getElementById('insert-template-btn');

    if (!templateSelector || !insertTemplateBtn) return;

    insertTemplateBtn.onclick = () => {
        const selectedTemplate = templateSelector.value;
        if (!selectedTemplate || !TEMPLATES[selectedTemplate]) return;

        const templateText = TEMPLATES[selectedTemplate].text;
        const gratitudeInput = document.getElementById('gratitude-input');
        if (!gratitudeInput) return;

        const currentText = gratitudeInput.value.trim();

        if (currentText) {
            // If there's existing text, ask if user wants to replace it
            if (!confirm('Replace existing text with template?')) {
                return;
            }
        }

        gratitudeInput.value = templateText;
        gratitudeInput.focus();
        // Reset selector
        templateSelector.value = '';
    };
}

/**
 * Toggle visibility of template controls based on user preference
 * @param {boolean} enabled - Whether templates should be visible
 */
function applyTemplateVisibility(enabled) {
    const controls = document.getElementById('template-controls');
    if (!controls) return;
    controls.style.display = enabled ? '' : 'none';
}
