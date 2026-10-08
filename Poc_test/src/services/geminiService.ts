// Gemini Flash AI Integration Service for Omniverse Digital Twin

export interface DigitalTwinTelemetry {
    containerCount: number;
    spawnedCount: number;
    inTransitCount: number;
    conveyorSpeed: number;
    connection: 'connecting' | 'connected' | 'error';
    streamFps: number | null;
}

export interface DigitalTwinActions {
    dropPackage: () => Promise<void>;
    updateConveyorSpeed: (speed: number) => Promise<void>;
    resetContainer: () => Promise<void>;
    setAutoCycle: (enabled: boolean | ((prev: boolean) => boolean)) => void;
    getTelemetry: () => DigitalTwinTelemetry;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'model' | 'system';
    text: string;
    timestamp: string;
    imageUrl?: string;
    toolCalls?: {
        name: string;
        args: Record<string, unknown>;
        result?: string;
    }[];
}

// Function declarations for Gemini function calling
export const GEMINI_TOOLS = [
    {
        function_declarations: [
            {
                name: 'drop_package',
                description: 'Drop or dispatch a new package onto the Omniverse conveyor belt intake.',
                parameters: {
                    type: 'OBJECT',
                    properties: {},
                },
            },
            {
                name: 'set_conveyor_speed',
                description: 'Set the conveyor belt surface velocity in mm/s (recommended range 50 to 300 mm/s).',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        speed: {
                            type: 'NUMBER',
                            description: 'Surface speed in mm/s (e.g. 80 for slow, 140 for nominal, 240 for fast).',
                        },
                    },
                    required: ['speed'],
                },
            },
            {
                name: 'empty_container',
                description: 'Reset or empty all accumulated packages from the collection container bin.',
                parameters: {
                    type: 'OBJECT',
                    properties: {},
                },
            },
            {
                name: 'toggle_auto_cycle',
                description: 'Start or stop automatic continuous package drop cycle.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        enabled: {
                            type: 'BOOLEAN',
                            description: 'True to activate auto-cycle, false to stop it.',
                        },
                    },
                    required: ['enabled'],
                },
            },
            {
                name: 'get_telemetry',
                description: 'Get current real-time telemetry from the Omniverse digital twin (speed, box count, transit status, FPS).',
                parameters: {
                    type: 'OBJECT',
                    properties: {},
                },
            },
        ],
    },
];

/**
 * Capture current frame from the WebRTC video element as a base64 JPEG
 */
export function captureVideoFrame(videoElementId = 'remote-video'): { base64: string; dataUrl: string } | null {
    const video = document.getElementById(videoElementId) as HTMLVideoElement | null;
    if (!video || !video.videoWidth || !video.videoHeight) {
        return null;
    }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

        return { base64, dataUrl };
    } catch (err) {
        console.warn('Failed to capture video snapshot:', err);
        return null;
    }
}

/**
 * Execute chat with Gemini Flash, supporting tool-calling and multimodal vision
 */
export async function sendToGeminiFlash({
    prompt,
    apiKey,
    imageSnapshot,
    history,
    actions,
}: {
    prompt: string;
    apiKey: string;
    imageSnapshot?: string | null;
    history: ChatMessage[];
    actions: DigitalTwinActions;
}): Promise<{
    reply: string;
    toolInvocations: { name: string; args: Record<string, unknown>; result: string }[];
}> {
    if (!apiKey.trim()) {
        throw new Error('Gemini API key is required. Please add your free key in the AI Copilot settings.');
    }

    const telemetry = actions.getTelemetry();
    const systemPrompt = `You are the AI Industrial Copilot for an Omniverse Digital Twin Conveyor & Sorting Cell.
You have real-time control over this physics simulation via tool calling:
- drop_package: Spawns a package onto the belt intake.
- set_conveyor_speed: Adjusts conveyor belt surface speed in mm/s (nominal is 140, fast is 240, slow is 80).
- empty_container: Empties the container collection bin.
- toggle_auto_cycle: Starts or stops recurring package drops.
- get_telemetry: Reads active container inventory and conveyor speed.

Current Live Simulation Telemetry:
- Status: ${telemetry.connection}
- Current Belt Speed: ${telemetry.conveyorSpeed} mm/s
- Container Inventory (Delivered): ${telemetry.containerCount} boxes
- Total Dispatched: ${telemetry.spawnedCount} boxes
- Currently In Transit: ${telemetry.inTransitCount} boxes
- Stream Performance: ${telemetry.streamFps ?? 'N/A'} FPS

When the user asks you to perform an action (e.g. drop box, change speed, clear bin, check status), call the matching tool!
- If asked to evaluate or decide whether to drop a package: visually inspect the conveyor intake area in the image. If clear, call drop_package. If another package is still in the drop zone or there is a jam, do NOT call drop_package and explain why dispatch is held.
If a live image of the 3D viewport is provided, analyze the conveyor belt, package positions, container fill level, and report visual insights.
Keep your spoken/written explanations concise, professional, and industrial-focused.`;

    // Dynamically resolve active models supported by the user's API key
    const resolvedModels = await getCandidateModels(apiKey);
    let lastError: Error | null = null;

    for (const model of resolvedModels) {
        try {
            const turnResult = await runGeminiTurn(model, apiKey, prompt, imageSnapshot, history, actions, systemPrompt);
            localStorage.setItem('gemini_active_model', model);
            return turnResult;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`Model ${model} failed, attempting next if available:`, err);
            // If invalid API key (400 / 403), don't retry other models
            if (lastError.message.includes('API_KEY_INVALID') || lastError.message.includes('403')) {
                throw lastError;
            }
        }
    }

    throw lastError || new Error('Failed to communicate with Gemini Flash.');
}

let cachedCandidateModels: string[] | null = null;

async function getCandidateModels(apiKey: string): Promise<string[]> {
    const saved = localStorage.getItem('gemini_active_model');
    if (saved) {
        return [saved, 'gemini-3.8-flash'];
    }

    if (cachedCandidateModels && cachedCandidateModels.length > 0) {
        return cachedCandidateModels;
    }

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`
        );

        if (res.ok) {
            const data = await res.json();
            const models: Array<{ name: string; supportedGenerationMethods?: string[] }> = data.models || [];

            // Filter models that support generateContent
            const valid = models.filter(m =>
                m.supportedGenerationMethods?.includes('generateContent')
            );

            // Separate flash models and others
            const flash = valid
                .filter(m => m.name.toLowerCase().includes('flash'))
                .map(m => m.name.replace(/^models\//, ''));

            const others = valid
                .filter(m => !m.name.toLowerCase().includes('flash'))
                .map(m => m.name.replace(/^models\//, ''));

            const candidateList = Array.from(
                new Set(['gemini-3.8-flash', ...flash, ...others])
            );
            if (candidateList.length > 0) {
                cachedCandidateModels = candidateList;
                return candidateList;
            }
        }
    } catch (e) {
        console.warn('Could not query model catalog via API key:', e);
    }

    // Default fallbacks if listing fails
    return ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-flash'];
}

async function runGeminiTurn(
    model: string,
    apiKey: string,
    prompt: string,
    imageSnapshot: string | null | undefined,
    history: ChatMessage[],
    actions: DigitalTwinActions,
    systemPrompt: string
): Promise<{
    reply: string;
    toolInvocations: { name: string; args: Record<string, unknown>; result: string }[];
}> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

    // Build contents payload
    const contents: Array<{
        role: 'user' | 'model';
        parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
    }> = [];

    // Recent message context (last 6 messages)
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'model') {
            contents.push({
                role: msg.role,
                parts: [{ text: msg.text }],
            });
        }
    }

    // Current turn parts
    const currentParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
    if (imageSnapshot) {
        currentParts.push({
            inline_data: {
                mime_type: 'image/jpeg',
                data: imageSnapshot,
            },
        });
    }
    currentParts.push({ text: prompt });

    contents.push({
        role: 'user',
        parts: currentParts,
    });

    const requestBody: Record<string, unknown> = {
        contents,
        system_instruction: {
            parts: [{ text: systemPrompt }],
        },
        tools: GEMINI_TOOLS,
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 600,
        },
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content) {
        throw new Error('No response generated by Gemini.');
    }

    const parts = candidate.content.parts || [];
    const toolInvocations: { name: string; args: Record<string, unknown>; result: string }[] = [];
    let textResponse = '';

    for (const part of parts) {
        if (part.text) {
            textResponse += part.text;
        }

        if (part.functionCall) {
            const { name, args } = part.functionCall;
            let resultDesc = 'Executed successfully';

            try {
                if (name === 'drop_package') {
                    await actions.dropPackage();
                    resultDesc = 'Dispatched package onto conveyor';
                } else if (name === 'set_conveyor_speed') {
                    const speed = Number(args?.speed) || 140;
                    await actions.updateConveyorSpeed(speed);
                    resultDesc = `Conveyor speed set to ${speed} mm/s`;
                } else if (name === 'empty_container') {
                    await actions.resetContainer();
                    resultDesc = 'Container bin cleared to 0';
                } else if (name === 'toggle_auto_cycle') {
                    const enabled = Boolean(args?.enabled);
                    actions.setAutoCycle(enabled);
                    resultDesc = enabled ? 'Auto-cycle enabled' : 'Auto-cycle stopped';
                } else if (name === 'get_telemetry') {
                    const t = actions.getTelemetry();
                    resultDesc = `Telemetry: ${t.containerCount} delivered, ${t.conveyorSpeed} mm/s, ${t.streamFps ?? 60} FPS`;
                }
            } catch (callErr) {
                resultDesc = `Error: ${callErr instanceof Error ? callErr.message : String(callErr)}`;
            }

            toolInvocations.push({
                name,
                args: (args as Record<string, unknown>) || {},
                result: resultDesc,
            });
        }
    }

    // If tools were called but no explanatory text was returned, generate a clean summary
    if (!textResponse.trim() && toolInvocations.length > 0) {
        textResponse = toolInvocations.map(t => `✅ ${t.result}`).join('\n');
    }

    return {
        reply: textResponse.trim() || 'Command completed.',
        toolInvocations,
    };
}

export interface AiDispatchDecision {
    action: 'dropped' | 'held';
    reason: string;
    model: string;
}

/**
 * Autonomous AI Decision Engine:
 * Visually evaluates live stream camera frame and telemetry to decide whether to drop or hold.
 */
export async function evaluateAndDispatchPackage({
    apiKey,
    actions,
}: {
    apiKey: string;
    actions: DigitalTwinActions;
}): Promise<AiDispatchDecision> {
    if (!apiKey.trim()) {
        throw new Error('Gemini API key is required for AI evaluation.');
    }

    const snapshot = captureVideoFrame('remote-video');
    const telemetry = actions.getTelemetry();

    const decisionPrompt = `You are the Autonomous Dispatch Controller for this Omniverse conveyor system.
Inspect the live camera frame of the conveyor line and make a SAFETY & FLOW decision: Should a package be dropped right now?

LIVE TELEMETRY:
- Belt Velocity: ${telemetry.conveyorSpeed} mm/s
- Packages in Transit: ${telemetry.inTransitCount}
- Delivered to Container: ${telemetry.containerCount}

CRITERIA:
1. SAFE TO DROP: If the conveyor intake area (the start of the belt under the drop point) is clear of obstacles/previous boxes, and there is no severe traffic jam on the belt, call the "drop_package" tool and state why it was safe.
2. HOLD DISPATCH: If another box is still right under the intake chute, or if packages are jammed, or if the container is overloaded (> 20 boxes), DO NOT call the drop_package tool. State clearly why dispatch is held (e.g. "Holding: Previous box is still in the intake clearance zone").

Analyze the image now and execute your decision!`;

    const result = await sendToGeminiFlash({
        prompt: decisionPrompt,
        apiKey,
        imageSnapshot: snapshot?.base64,
        history: [],
        actions,
    });

    const dropped = result.toolInvocations.some(t => t.name === 'drop_package');
    const modelUsed = localStorage.getItem('gemini_active_model') || 'gemini-3.8-flash';

    return {
        action: dropped ? 'dropped' : 'held',
        reason: result.reply,
        model: modelUsed,
    };
}
