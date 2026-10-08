import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
    AppStreamer,
    EventAction,
    EventStatus,
    LogLevel,
    StreamEvent,
    StreamStatus,
    StreamType,
    VideoCodec,
} from '@nvidia/ov-web-rtc';
import type { ApplicationMessage, StatsEvent } from '@nvidia/ov-web-rtc';
import { AIAssistant } from './components/AIAssistant';
import { ApiKeyModal } from './components/ApiKeyModal';
import {
    evaluateAndDispatchPackage,
    type AiDispatchDecision,
    type DigitalTwinActions,
} from './services/geminiService';

type ConnectionState = 'connecting' | 'connected' | 'error';

interface ActivityLogItem {
    id: string;
    timestamp: string;
    text: string;
    type: 'spawn' | 'arrival' | 'reset' | 'speed' | 'system';
}

const DROP_PACKAGE_REQUEST = 'dropPackageRequest';
const DROP_PACKAGE_RESULT = 'dropPackageResult';
const SPAWN_CUBE_RESULT = 'spawnCubeResult';
const RESET_CONTAINER_REQUEST = 'resetContainerRequest';
const RESET_CONTAINER_RESULT = 'resetContainerResult';
const SET_SPEED_REQUEST = 'setConveyorSpeedRequest';
const SET_SPEED_RESULT = 'setConveyorSpeedResult';
const CONTAINER_COUNT_UPDATE = 'containerCountUpdate';

function getEventError(message: StreamEvent): string {
    return message.info instanceof Error ? message.info.message : String(message.info);
}

function formatTime(d = new Date()): string {
    return d.toTimeString().split(' ')[0];
}

export default function App() {
    const stream = useMemo(() => new AppStreamer(), []);
    const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoCycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [connectionMessage, setConnectionMessage] = useState('Connecting to Kit stream');
    const [streamFps, setStreamFps] = useState<number | null>(null);
    const [isStreamStalled, setIsStreamStalled] = useState(false);

    // Digital Twin Conveyor State
    const [containerCount, setContainerCount] = useState<number>(0);
    const [spawnedCount, setSpawnedCount] = useState<number>(0);
    const [conveyorSpeed, setConveyorSpeedState] = useState<number>(140);
    const [isDropping, setIsDropping] = useState<boolean>(false);
    const [autoCycle, setAutoCycle] = useState<boolean>(false);
    const [lastArrivalFlash, setLastArrivalFlash] = useState<boolean>(false);
    const [isUiVisible, setIsUiVisible] = useState<boolean>(true);

    // AI Copilot & Autonomous Decision State
    const [showAiPanel, setShowAiPanel] = useState<boolean>(true);
    const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
    const [isAiEvaluating, setIsAiEvaluating] = useState<boolean>(false);
    const [aiPilotActive, setAiPilotActive] = useState<boolean>(false);
    const [aiDecisionStatus, setAiDecisionStatus] = useState<AiDispatchDecision | null>(null);
    const aiPilotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isEvaluatingRef = useRef<boolean>(false);
    const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
        return (
            localStorage.getItem('gemini_api_key') ||
            (import.meta as any).env?.VITE_GEMINI_API_KEY ||
            ''
        );
    });

    const handleSaveApiKey = useCallback((newKey: string) => {
        setGeminiApiKey(newKey);
        localStorage.setItem('gemini_api_key', newKey);
    }, []);
    const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([
        {
            id: 'init',
            timestamp: formatTime(),
            text: 'Conveyor Digital Twin initialized. Ready for physics simulation.',
            type: 'system',
        },
    ]);

    const addLog = useCallback((text: string, type: ActivityLogItem['type'] = 'system') => {
        setActivityLog(prev => [
            {
                id: `${Date.now()}-${Math.random()}`,
                timestamp: formatTime(),
                text,
                type,
            },
            ...prev.slice(0, 49),
        ]);
    }, []);

    const addLogRef = useRef(addLog);
    addLogRef.current = addLog;

    useEffect(() => {
        let active = true;

        const onConnectResult = (message: StreamEvent) => {
            if (!active || message.action !== EventAction.START) {
                return;
            }
            if (message.status === EventStatus.SUCCESS) {
                setConnection('connected');
                setConnectionMessage('Connected to Kit (H.264 streaming)');
                addLogRef.current('Connected to Omniverse Kit stream', 'system');
            } else if (message.status === EventStatus.ERROR) {
                setConnection('error');
                setConnectionMessage(getEventError(message));
                addLogRef.current(`Connection error: ${getEventError(message)}`, 'system');
            }
        };

        const signalingServer =
            new URLSearchParams(window.location.search).get('server') ||
            window.location.hostname ||
            '127.0.0.1';

        void stream
            .connect({
                streamSource: StreamType.DIRECT,
                logLevel: LogLevel.INFO,
                streamConfig: {
                    videoElementId: 'remote-video',
                    audioElementId: 'remote-audio',
                    signalingServer,
                    signalingPort: 49221,
                    fps: 60,
                    width: 1280,
                    height: 720,
                    codec: VideoCodec.H264,
                    codecList: ['H264'],
                    maxReconnects: 10,
                    reconnectDelay: 2000,
                    connectivityTimeout: 10000,
                    onStart: onConnectResult,
                    onStop: () => {
                        if (active) {
                            setConnection('error');
                            setConnectionMessage('Kit stream disconnected');
                            addLogRef.current('Kit stream disconnected', 'system');
                        }
                    },
                    onStreamStatusChange: (status: StreamStatus) => {
                        if (!active) return;
                        if (status === StreamStatus.STREAMING) {
                            setConnection('connected');
                            setConnectionMessage('Connected to Kit (Streaming active)');
                        } else if (status === StreamStatus.STARTING) {
                            setConnection('connecting');
                            setConnectionMessage('Connecting to Kit stream…');
                        } else if (status === StreamStatus.STOPPED) {
                            setConnection('error');
                            setConnectionMessage('Stream stopped');
                        }
                    },
                    onStreamStats: (statsEvent: StatsEvent) => {
                        if (!active || !statsEvent?.data?.stats) return;
                        setStreamFps(statsEvent.data.stats.fps);
                    },
                    onCustomEvent: message => {
                        if (!active || !('event_type' in message)) {
                            return;
                        }

                        const eventType = message.event_type;
                        const payload = message.payload as Record<string, unknown>;

                        // 1. Spontaneous box arrival in container bin
                        if (eventType === CONTAINER_COUNT_UPDATE) {
                            if (typeof payload?.count === 'number') {
                                const newCount = payload.count;
                                setContainerCount(newCount);
                                if (payload.reset) {
                                    addLogRef.current('Container bin cleared (Count: 0)', 'reset');
                                } else {
                                    setLastArrivalFlash(true);
                                    setTimeout(() => setLastArrivalFlash(false), 800);
                                    const pathStr = typeof payload?.box_path === 'string' ? payload.box_path.split('/').pop() : 'Package';
                                    addLogRef.current(`📥 ${pathStr} delivered into container! (Total: ${newCount})`, 'arrival');
                                }
                            }
                            return;
                        }

                        // 2. Drop package result
                        if (eventType === DROP_PACKAGE_RESULT || eventType === SPAWN_CUBE_RESULT) {
                            if (responseTimeoutRef.current) {
                                clearTimeout(responseTimeoutRef.current);
                                responseTimeoutRef.current = null;
                            }
                            setIsDropping(false);
                            if (payload.result === 'success') {
                                setSpawnedCount(prev => prev + 1);
                                const path = typeof payload.path === 'string' ? payload.path.split('/').pop() : 'Box';
                                addLogRef.current(`📦 ${path} dropped onto conveyor intake`, 'spawn');
                            } else {
                                const err = typeof payload.error === 'string' ? payload.error : 'Failed to drop package';
                                addLogRef.current(`❌ ${err}`, 'system');
                            }
                            return;
                        }

                        // 3. Reset container result
                        if (eventType === RESET_CONTAINER_RESULT) {
                            setContainerCount(0);
                            addLogRef.current('Container bin cleared to 0', 'reset');
                            return;
                        }

                        // 4. Set conveyor speed result
                        if (eventType === SET_SPEED_RESULT) {
                            if (typeof payload.speed === 'number') {
                                addLogRef.current(`⚡ Conveyor surface speed set to ${payload.speed} mm/s`, 'speed');
                            }
                            return;
                        }
                    },
                },
            })
            .then(onConnectResult)
            .catch((error: unknown) => {
                if (active) {
                    setConnection('error');
                    setConnectionMessage(error instanceof Error ? error.message : String(error));
                }
            });

        return () => {
            active = false;
            if (responseTimeoutRef.current) {
                clearTimeout(responseTimeoutRef.current);
            }
            if (autoCycleIntervalRef.current) {
                clearInterval(autoCycleIntervalRef.current);
            }
            void stream.terminate().catch((error: unknown) => {
                console.error('Failed to terminate Kit stream:', error);
            });
        };
    }, [stream]);


    // Watchdog: detect if WebRTC decoded frames stall/freeze while connected
    useEffect(() => {
        if (connection !== 'connected') {
            setIsStreamStalled(false);
            return;
        }

        const video = document.getElementById('remote-video') as HTMLVideoElement | null;
        if (!video) return;

        let lastFrames = 0;
        let stallCount = 0;

        const interval = setInterval(() => {
            const quality = video.getVideoPlaybackQuality?.();
            const currentFrames =
                quality?.totalVideoFrames ??
                (video.currentTime > 0 ? Math.floor(video.currentTime * 60) : 0);

            if (currentFrames > 0 && currentFrames === lastFrames) {
                stallCount++;
                if (stallCount >= 4) {
                    setIsStreamStalled(true);
                }
            } else {
                stallCount = 0;
                setIsStreamStalled(false);
                lastFrames = currentFrames;
            }
        }, 500);

        return () => clearInterval(interval);
    }, [connection]);

    // Action: Drop package onto conveyor
    const dropPackage = useCallback(async () => {
        if (!stream || connection !== 'connected' || isDropping) {
            return;
        }

        setIsDropping(true);
        responseTimeoutRef.current = setTimeout(() => {
            setIsDropping(false);
            addLog('Drop command timed out waiting for Kit', 'system');
            responseTimeoutRef.current = null;
        }, 8000);

        const request: ApplicationMessage = {
            event_type: DROP_PACKAGE_REQUEST,
            payload: {},
        };

        try {
            const response = await stream.sendMessage(request);
            if (response.status === EventStatus.ERROR) {
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                setIsDropping(false);
                addLog(`Send error: ${getEventError(response)}`, 'system');
            }
        } catch (error: unknown) {
            if (responseTimeoutRef.current) {
                clearTimeout(responseTimeoutRef.current);
                responseTimeoutRef.current = null;
            }
            setIsDropping(false);
            addLog(`Drop error: ${error instanceof Error ? error.message : String(error)}`, 'system');
        }
    }, [stream, connection, isDropping, addLog]);

    // Action: Empty Container
    const resetContainer = useCallback(async () => {
        if (!stream || connection !== 'connected') return;

        const request: ApplicationMessage = {
            event_type: RESET_CONTAINER_REQUEST,
            payload: {},
        };

        try {
            await stream.sendMessage(request);
        } catch (error) {
            addLog(`Reset error: ${error instanceof Error ? error.message : String(error)}`, 'system');
        }
    }, [stream, connection, addLog]);

    // Action: Conveyor speed change
    const updateConveyorSpeed = useCallback(async (speed: number) => {
        setConveyorSpeedState(speed);
        if (!stream || connection !== 'connected') return;

        const request: ApplicationMessage = {
            event_type: SET_SPEED_REQUEST,
            payload: { speed },
        };

        try {
            await stream.sendMessage(request);
        } catch (error) {
            addLog(`Speed update error: ${error instanceof Error ? error.message : String(error)}`, 'system');
        }
    }, [stream, connection, addLog]);

    // Auto-cycle toggle
    useEffect(() => {
        if (autoCycle && connection === 'connected') {
            autoCycleIntervalRef.current = setInterval(() => {
                void dropPackage();
            }, 2500);
        } else {
            if (autoCycleIntervalRef.current) {
                clearInterval(autoCycleIntervalRef.current);
                autoCycleIntervalRef.current = null;
            }
        }
        return () => {
            if (autoCycleIntervalRef.current) {
                clearInterval(autoCycleIntervalRef.current);
                autoCycleIntervalRef.current = null;
            }
        };
    }, [autoCycle, connection, dropPackage]);

    const inTransitCount = Math.max(0, spawnedCount - containerCount);

    // Bundle actions for AI Copilot
    const digitalTwinActions: DigitalTwinActions = useMemo(
        () => ({
            dropPackage,
            updateConveyorSpeed,
            resetContainer,
            setAutoCycle,
            getTelemetry: () => ({
                containerCount,
                spawnedCount,
                inTransitCount,
                conveyorSpeed,
                connection,
                streamFps,
            }),
        }),
        [
            dropPackage,
            updateConveyorSpeed,
            resetContainer,
            setAutoCycle,
            containerCount,
            spawnedCount,
            inTransitCount,
            conveyorSpeed,
            connection,
            streamFps,
        ]
    );

    // Autonomous AI Dispatch Decision Handler
    const handleAiEvaluateAndDrop = useCallback(async () => {
        if (!geminiApiKey) {
            setIsApiKeyModalOpen(true);
            return;
        }
        if (connection !== 'connected' || isAiEvaluating || isDropping) {
            return;
        }

        setIsAiEvaluating(true);
        isEvaluatingRef.current = true;
        try {
            const decision = await evaluateAndDispatchPackage({
                apiKey: geminiApiKey,
                actions: digitalTwinActions,
            });
            setAiDecisionStatus(decision);
            if (decision.action === 'dropped') {
                addLog(`🤖 AI Decision: CLEAR → Box dispatched (${decision.reason.slice(0, 60)})`, 'spawn');
            } else {
                addLog(`🤖 AI Decision: HELD → ${decision.reason.slice(0, 60)}`, 'system');
            }
        } catch (err: any) {
            addLog(`🤖 AI Dispatch error: ${err.message || String(err)}`, 'system');
        } finally {
            setIsAiEvaluating(false);
            isEvaluatingRef.current = false;
        }
    }, [geminiApiKey, connection, isAiEvaluating, isDropping, digitalTwinActions, addLog]);

    // Continuous Autonomous AI Pilot Loop
    useEffect(() => {
        if (aiPilotActive && connection === 'connected' && geminiApiKey) {
            const initialTimer = setTimeout(() => {
                if (!isEvaluatingRef.current) {
                    void handleAiEvaluateAndDrop();
                }
            }, 1000);

            aiPilotIntervalRef.current = setInterval(() => {
                if (!isEvaluatingRef.current) {
                    void handleAiEvaluateAndDrop();
                }
            }, 4000);

            return () => {
                clearTimeout(initialTimer);
                if (aiPilotIntervalRef.current) {
                    clearInterval(aiPilotIntervalRef.current);
                    aiPilotIntervalRef.current = null;
                }
            };
        } else {
            if (aiPilotIntervalRef.current) {
                clearInterval(aiPilotIntervalRef.current);
                aiPilotIntervalRef.current = null;
            }
        }
    }, [aiPilotActive, connection, geminiApiKey, handleAiEvaluateAndDrop]);

    const toggleAiPilot = () => {
        if (!aiPilotActive && autoCycle) {
            setAutoCycle(false);
        }
        setAiPilotActive(prev => !prev);
    };

    const toggleAutoCycle = () => {
        if (!autoCycle && aiPilotActive) {
            setAiPilotActive(false);
        }
        setAutoCycle(prev => !prev);
    };

    return (
        <main className="dashboard-root">
            {/* Background Full-Screen Viewport */}
            <section className="viewport-container" aria-label="Conveyor Viewport">
                <div className="video-wrapper">
                    <video id="remote-video" autoPlay playsInline muted aria-label="Live Kit view" />
                    <audio id="remote-audio" autoPlay muted />

                    {connection !== 'connected' && (
                        <div className="viewport-overlay">
                            {connection === 'error' ? (
                                <>
                                    <div style={{ fontSize: '36px' }}>⚠️</div>
                                    <h3 className="overlay-title">Stream Disconnected</h3>
                                    <p className="overlay-desc">{connectionMessage}</p>
                                    <button
                                        className="primary-drop-button"
                                        style={{ width: 'auto', padding: '10px 24px', marginTop: '12px' }}
                                        onClick={() => window.location.reload()}
                                    >
                                        Reconnect Stream
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="overlay-spinner" />
                                    <h3 className="overlay-title">Connecting to Omniverse Kit</h3>
                                    <p className="overlay-desc">{connectionMessage}</p>
                                    <span className="overlay-sub">WebRTC Stream Port: 49221 • H.264 Video</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Toggle UI Button */}
            <button
                onClick={() => setIsUiVisible(!isUiVisible)}
                style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    zIndex: 9999,
                    background: 'rgba(0,0,0,0.5)',
                    color: 'white',
                    border: '1px solid rgba(255,255,255,0.2)',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backdropFilter: 'blur(4px)'
                }}
            >
                {isUiVisible ? 'Hide Controls' : 'Show Controls'}
            </button>

            {isUiVisible && (
                <>
                    {/* Top Left Floating Status Indicator */}
                    <div className="floating-status">
                        <div className="brand-badge">
                            <span className="badge-glow" />
                            <span className="badge-core" />
                        </div>
                        <div className="header-status-group">
                            <div className={`status-pill ${connection}`}>
                                <span className="status-dot" />
                                <span className="status-text">
                                    {connection === 'connected' ? 'LIVE WEBRTC' : connection.toUpperCase()}
                                </span>
                            </div>
                            {streamFps !== null && (
                                <div className="fps-pill">
                                    <span className="fps-num">{streamFps}</span>
                                    <span className="fps-label">FPS</span>
                                </div>
                            )}
                            {isStreamStalled && (
                                <div className="stalled-warning">⚠️ Stream Frozen</div>
                            )}
                        </div>
                    </div>

                    {/* Right Floating Glassmorphic Panel */}
                    <aside className="floating-right-panel">
                        {/* AI Copilot Section */}
                        <div className="panel-section ai-section">
                            <AIAssistant
                                actions={digitalTwinActions}
                                apiKey={geminiApiKey}
                                onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
                            />
                        </div>

                        <div className="panel-scroll-content">
                            {/* Live Container Counter Hero Card */}
                            <div className={`telemetry-hero-card ${lastArrivalFlash ? 'arrival-flash' : ''}`}>
                                <div className="card-top-row">
                                    <span className="card-label">📦 CONTAINER INVENTORY (DELIVERY BIN)</span>
                                    <span className="live-tag">
                                        <span className="pulse-dot" /> SENSOR ACTIVE
                                    </span>
                                </div>
                                <div className="count-display">
                                    <span className="count-value">{containerCount}</span>
                                    <span className="count-unit">BOXES IN BIN</span>
                                </div>

                                {/* Visual Container Bin Fill Level & Real-time Status */}
                                <div className="container-visual-tray">
                                    <div className="tray-header">
                                        <span className="tray-label">Bin Fill: {containerCount} / 20 Units</span>
                                        <span className="tray-status">
                                            {containerCount >= 20 ? '⚠️ BIN FULL' : containerCount > 0 ? '📥 RECEIVING' : '🟢 READY'}
                                        </span>
                                    </div>
                                    <div className="tray-progress-bar">
                                        <div
                                            className="tray-progress-fill"
                                            style={{ width: `${Math.min(100, Math.round((containerCount / 20) * 100))}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="count-sub-metrics">
                                    <div className="metric-col">
                                        <span className="metric-label">Dispatched</span>
                                        <span className="metric-val">{spawnedCount}</span>
                                    </div>
                                    <div className="metric-divider" />
                                    <div className="metric-col">
                                        <span className="metric-label">In Transit</span>
                                        <span className="metric-val active-transit">{inTransitCount}</span>
                                    </div>
                                    <div className="metric-divider" />
                                    <div className="metric-col">
                                        <span className="metric-label">Delivered</span>
                                        <span className="metric-val delivered-val">{containerCount}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Operational Commands */}
                            <div className="control-card">
                                <span className="card-section-title">LOGISTICS CONTROLS</span>
                                <div className="action-buttons-stack">
                                    <button
                                        className="primary-drop-button"
                                        type="button"
                                        onClick={() => void dropPackage()}
                                        disabled={connection !== 'connected' || isDropping}
                                        aria-busy={isDropping}
                                    >
                                        <span className="btn-icon">📦</span>
                                        <span className="btn-text">
                                            {isDropping ? 'DISPATCHING...' : 'DROP PACKAGE ON BELT'}
                                        </span>
                                    </button>

                                    {/* Autonomous AI Supervisor Decision Block */}
                                    <div className="ai-decision-card">
                                        <div className="ai-decision-header">
                                            <span className="ai-sub-badge">🤖 AUTONOMOUS DISPATCH</span>
                                            {aiDecisionStatus && (
                                                <span className={`ai-decision-pill ${aiDecisionStatus.action}`}>
                                                    {aiDecisionStatus.action === 'dropped' ? '✅ DISPATCHED' : '⏸️ HELD'}
                                                </span>
                                            )}
                                        </div>

                                        <div className="button-row">
                                            <button
                                                className="ai-evaluate-button"
                                                type="button"
                                                onClick={() => void handleAiEvaluateAndDrop()}
                                                disabled={connection !== 'connected' || isAiEvaluating || isDropping}
                                                title="AI inspects the live conveyor stream and decides whether to drop or hold"
                                            >
                                                <span className="btn-icon">👁️</span>
                                                <span className="btn-text">
                                                    {isAiEvaluating ? 'EVALUATING...' : 'AI EVALUATE & DROP'}
                                                </span>
                                            </button>

                                            <button
                                                className={`secondary-toggle-btn ai-pilot-btn ${aiPilotActive ? 'active' : ''}`}
                                                type="button"
                                                onClick={toggleAiPilot}
                                                disabled={connection !== 'connected'}
                                                title="Autonomous closed-loop dispatching based on real-time stream inspection"
                                            >
                                                <span>{aiPilotActive ? '⏹ STOP PILOT' : '✨ AI PILOT'}</span>
                                            </button>
                                        </div>

                                        {aiDecisionStatus && (
                                            <div className="ai-reason-text">
                                                <span className="reason-icon">
                                                    {aiDecisionStatus.action === 'dropped' ? '📦' : '🛑'}
                                                </span>
                                                <span>{aiDecisionStatus.reason}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="button-row">
                                        <button
                                            className={`secondary-toggle-btn ${autoCycle ? 'active' : ''}`}
                                            type="button"
                                            onClick={toggleAutoCycle}
                                            disabled={connection !== 'connected'}
                                            title="Fixed interval drop (every 2.5 seconds)"
                                        >
                                            <span>{autoCycle ? '⏹ STOP TIMER' : '▶ FIXED TIMER'}</span>
                                        </button>

                                        <button
                                            className="secondary-btn clear-btn"
                                            type="button"
                                            onClick={() => void resetContainer()}
                                            disabled={connection !== 'connected'}
                                            title="Clear all packages from container"
                                        >
                                            <span>🗑️ EMPTY BIN</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Conveyor Speed Slider & Presets */}
                                <div className="speed-controller">
                                    <div className="speed-header">
                                        <span className="speed-label">BELT SURFACE VELOCITY</span>
                                        <span className="speed-display">{conveyorSpeed} mm/s</span>
                                    </div>
                                    <input
                                        className="speed-slider"
                                        type="range"
                                        min={50}
                                        max={300}
                                        step={10}
                                        value={conveyorSpeed}
                                        onChange={e => void updateConveyorSpeed(Number(e.target.value))}
                                        disabled={connection !== 'connected'}
                                    />
                                    <div className="speed-presets">
                                        <button
                                            type="button"
                                            className={`preset-btn ${conveyorSpeed === 80 ? 'selected' : ''}`}
                                            onClick={() => void updateConveyorSpeed(80)}
                                            disabled={connection !== 'connected'}
                                        >
                                            80
                                        </button>
                                        <button
                                            type="button"
                                            className={`preset-btn ${conveyorSpeed === 140 ? 'selected' : ''}`}
                                            onClick={() => void updateConveyorSpeed(140)}
                                            disabled={connection !== 'connected'}
                                        >
                                            140
                                        </button>
                                        <button
                                            type="button"
                                            className={`preset-btn ${conveyorSpeed === 240 ? 'selected' : ''}`}
                                            onClick={() => void updateConveyorSpeed(240)}
                                            disabled={connection !== 'connected'}
                                        >
                                            240
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Real-time Bidirectional Activity Feed */}
                            <div className="feed-card">
                                <div className="feed-header">
                                    <span className="card-section-title">TWIN EVENT STREAM</span>
                                    <span className="feed-badge">{activityLog.length} EVENTS</span>
                                </div>
                                <div className="feed-list" tabIndex={0} aria-label="Event stream">
                                    {activityLog.map(item => (
                                        <div key={item.id} className={`feed-item feed-${item.type}`}>
                                            <span className="feed-time">{item.timestamp}</span>
                                            <span className="feed-content">{item.text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </aside>
                </>
            )}

            {/* API Key Configuration Modal */}
            <ApiKeyModal
                isOpen={isApiKeyModalOpen}
                onClose={() => setIsApiKeyModalOpen(false)}
                currentKey={geminiApiKey}
                onSaveKey={handleSaveApiKey}
            />
        </main>
    );
}
