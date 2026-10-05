import { useEffect, useRef, useState, useMemo } from 'react';
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

type ConnectionState = 'connecting' | 'connected' | 'error';

const SPAWN_REQUEST = 'spawnCubeRequest';
const SPAWN_RESULT = 'spawnCubeResult';

function getEventError(message: StreamEvent): string {
    return message.info instanceof Error ? message.info.message : String(message.info);
}

export default function App() {
    const stream = useMemo(() => new AppStreamer(), []);
    const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [connectionMessage, setConnectionMessage] = useState('Connecting to Kit stream');
    const [isSpawning, setIsSpawning] = useState(false);
    const [commandMessage, setCommandMessage] = useState('Connect to Kit to send a command.');
    const [streamFps, setStreamFps] = useState<number | null>(null);
    const [isStreamStalled, setIsStreamStalled] = useState(false);

    useEffect(() => {
        let active = true;

        const onConnectResult = (message: StreamEvent) => {
            if (!active || message.action !== EventAction.START) {
                return;
            }
            if (message.status === EventStatus.SUCCESS) {
                setConnection('connected');
                setConnectionMessage('Connected to Kit (H.264 streaming)');
            }
            else if (message.status === EventStatus.ERROR) {
                setConnection('error');
                setConnectionMessage(getEventError(message));
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
                    width: 1920,
                    height: 1080,
                    fps: 60,
                    codec: VideoCodec.H264,
                    codecList: ['H264'],
                    maxReconnects: 5,
                    reconnectDelay: 2000,
                    connectivityTimeout: 5000,
                    onStart: onConnectResult,
                    onStop: () => {
                        if (active) {
                            setConnection('error');
                            setConnectionMessage('Kit stream disconnected');
                        }
                    },
                    onStreamStatusChange: (status: StreamStatus) => {
                        if (!active) return;
                        if (status === StreamStatus.STREAMING) {
                            setConnection('connected');
                            setConnectionMessage('Connected to Kit (Streaming active)');
                        }
                        else if (status === StreamStatus.STARTING) {
                            setConnection('connecting');
                            setConnectionMessage('Connecting to Kit stream…');
                        }
                        else if (status === StreamStatus.STOPPED) {
                            setConnection('error');
                            setConnectionMessage('Stream stopped');
                        }
                    },
                    onStreamStats: (statsEvent: StatsEvent) => {
                        if (!active || !statsEvent?.data?.stats) return;
                        setStreamFps(statsEvent.data.stats.fps);
                    },
                    onCustomEvent: message => {
                        if (
                            !active ||
                            !('event_type' in message) ||
                            message.event_type !== SPAWN_RESULT
                        ) {
                            return;
                        }

                        if (responseTimeoutRef.current) {
                            clearTimeout(responseTimeoutRef.current);
                            responseTimeoutRef.current = null;
                        }
                        setIsSpawning(false);

                        const result = message.payload.result;
                        if (result === 'success' && typeof message.payload.path === 'string') {
                            setCommandMessage(`Cube created at ${message.payload.path}`);
                        }
                        else {
                            setCommandMessage(
                                typeof message.payload.error === 'string'
                                    ? message.payload.error
                                    : 'Kit could not spawn the cube.'
                            );
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
            void stream.terminate().catch((error: unknown) => {
                console.error('Failed to terminate Kit stream:', error);
            });
        };
    }, []);

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
            }
            else {
                stallCount = 0;
                setIsStreamStalled(false);
                lastFrames = currentFrames;
            }
        }, 500);

        return () => clearInterval(interval);
    }, [connection]);

    const spawnCube = async () => {
        if (!stream || connection !== 'connected' || isSpawning) {
            return;
        }

        setIsSpawning(true);
        setCommandMessage('Sending cube command to Kit…');
        responseTimeoutRef.current = setTimeout(() => {
            setIsSpawning(false);
            setCommandMessage('Kit did not respond. Check the stream connection and try again.');
            responseTimeoutRef.current = null;
        }, 10000);

        const request: ApplicationMessage = {
            event_type: SPAWN_REQUEST,
            payload: {},
        };

        try {
            const response = await stream.sendMessage(request);
            if (response.status === EventStatus.ERROR) {
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                setIsSpawning(false);
                setCommandMessage(getEventError(response));
            }
        }
        catch (error: unknown) {
            if (responseTimeoutRef.current) {
                clearTimeout(responseTimeoutRef.current);
                responseTimeoutRef.current = null;
            }
            setIsSpawning(false);
            setCommandMessage(error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <main className="app-shell">
            <div className="action-rail">
                <button
                    className="spawn-button"
                    type="button"
                    onClick={() => void spawnCube()}
                    disabled={connection !== 'connected' || isSpawning}
                    aria-busy={isSpawning}
                >
                    Spawn Cube
                </button>
            </div>
            <section className="stream-panel" aria-label="Kit viewport">
                <div className="video-frame">
                    <video id="remote-video" autoPlay playsInline aria-label="Live Kit view" />
                </div>
                <audio id="remote-audio" autoPlay />
            </section>
            <div className="visually-hidden" aria-live="polite">
                <span>{connectionMessage}</span>
                <span>{commandMessage}</span>
            </div>
        </main>
    );
}
