// Daily Gratitude Prompts
const GRATITUDE_PROMPTS = [
    "What small moment made you smile today?",
    "Who are three people you're grateful for and why?",
    "What's something you often take for granted?",
    "What personal strength are you grateful for?",
    "What made you laugh recently?",
    "What's a recent challenge that taught you something valuable?",
    "What's something in nature you appreciate?",
    "Who helped you today and how?",
    "What skill do you have that you're proud of?",
    "What's a simple pleasure you enjoyed today?",
    "What would you miss most if you had to leave home?",
    "What's something you learned recently that you're grateful for?",
    "Who in your life brings out the best in you?",
    "What moment today do you want to remember forever?",
    "What are you grateful for about your body?",
    "What's a hobby or passion that brings you joy?",
    "What act of kindness did you witness or experience?",
    "What opportunity are you grateful for?",
    "What's something that makes your home special?",
    "What would make today a good day?",
    "What quality do you appreciate in a friend?",
    "What's something you're proud of accomplishing?",
    "What brings you peace?",
    "What's something you're looking forward to?",
    "What's a memory that makes you happy?",
    "What's something you're learning that excites you?",
    "Who has believed in you when you doubted yourself?",
    "What's a random act of kindness you did today?",
    "What food or meal are you grateful for?",
    "What skill would you like to develop and why?"
];

// Get a prompt based on the day (same prompt all day)
function getDailyPrompt() {
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    const index = dayOfYear % GRATITUDE_PROMPTS.length;
    return GRATITUDE_PROMPTS[index];
}

// Get today's prompt index
function getTodayPromptIndex() {
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    return dayOfYear % GRATITUDE_PROMPTS.length;
}
