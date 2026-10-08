import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    sendToGeminiFlash,
    captureVideoFrame,
    type ChatMessage,
    type DigitalTwinActions,
} from '../services/geminiService';

interface AIAssistantProps {
    actions: DigitalTwinActions;
    onOpenApiKeyModal: () => void;
    apiKey: string;
}

export const AIAssistant: React.FC<AIAssistantProps> = ({
    actions,
    onOpenApiKeyModal,
    apiKey,
}) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
    const [stagedSnapshot, setStagedSnapshot] = useState<{ base64: string; dataUrl: string } | null>(null);

    const chatEndRef = useRef<HTMLDivElement | null>(null);
    const recognitionRef = useRef<any>(null);

    // Auto-scroll chat to bottom
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    // Speech synthesis helper
    const speakText = useCallback((text: string) => {
        if (!voiceOutputEnabled || !('speechSynthesis' in window)) return;
        try {
            window.speechSynthesis.cancel();
            // Strip emojis and markdown formatting for cleaner speech
            const cleanText = text.replace(/[*#_`]/g, '').replace(/[^\x00-\x7F]/g, '');
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.rate = 1.05;
            utterance.pitch = 1.0;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn('Speech synthesis failed:', e);
        }
    }, [voiceOutputEnabled]);

    // Initialize speech recognition
    useEffect(() => {
        const SpeechRecognition =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (!SpeechRecognition) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            if (transcript) {
                setInputText(transcript);
                setIsListening(false);
                void handleSend(transcript);
            }
        };

        recognition.onerror = (event: any) => {
            console.warn('Speech recognition error:', event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
    }, []);

    const toggleListening = () => {
        if (!recognitionRef.current) {
            alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
            return;
        }

        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        } else {
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (err) {
                console.warn('Recognition start error:', err);
                setIsListening(false);
            }
        }
    };

    // Capture snapshot from WebRTC video
    const handleCaptureSnapshot = () => {
        const snap = captureVideoFrame('remote-video');
        if (!snap) {
            alert('Could not capture stream frame. Ensure the video stream is active and connected.');
            return;
        }
        setStagedSnapshot(snap);
    };

    // Send prompt to Gemini Flash
    const handleSend = async (customPrompt?: string) => {
        const textToSend = (customPrompt || inputText).trim();
        if (!textToSend && !stagedSnapshot) return;

        if (!apiKey) {
            onOpenApiKeyModal();
            return;
        }

        const userMsgId = `user-${Date.now()}`;
        const newMsg: ChatMessage = {
            id: userMsgId,
            role: 'user',
            text: textToSend || 'Please inspect this live simulation view.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            imageUrl: stagedSnapshot?.dataUrl,
        };

        const activeSnapshot = stagedSnapshot?.base64;
        setMessages(prev => [...prev, newMsg]);
        setInputText('');
        setStagedSnapshot(null);
        setIsLoading(true);

        try {
            const result = await sendToGeminiFlash({
                prompt: newMsg.text,
                apiKey,
                imageSnapshot: activeSnapshot,
                history: messages,
                actions,
            });

            const modelMsg: ChatMessage = {
                id: `model-${Date.now()}`,
                role: 'model',
                text: result.reply,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                toolCalls: result.toolInvocations.map(t => ({
                    name: t.name,
                    args: t.args,
                    result: t.result,
                })),
            };

            setMessages(prev => [...prev, modelMsg]);
            speakText(result.reply);
        } catch (err: any) {
            const errMsg: ChatMessage = {
                id: `err-${Date.now()}`,
                role: 'system',
                text: `⚠️ Gemini Error: ${err.message || String(err)}`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errMsg]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleQuickAction = (promptText: string, inspect = false) => {
        if (inspect) {
            const snap = captureVideoFrame('remote-video');
            if (snap) {
                setStagedSnapshot(snap);
            }
        }
        void handleSend(promptText);
    };

    return (
        <div className="ai-assistant-card" style={{ background: 'rgba(10, 15, 25, 0.4)', border: 'none', boxShadow: 'none' }}>
            {/* Header */}
            <div className="ai-header" style={{ background: 'transparent', borderBottom: 'none', padding: '16px 20px 10px' }}>
                <div className="ai-title-row">
                    <div className="ai-status-indicator">
                        <span style={{ fontSize: '14px', color: '#94a3b8', marginRight: '6px' }}>✨</span>
                        <span className="ai-title" style={{ fontSize: '14px', letterSpacing: '0.3px' }}>AI Assistant</span>
                    </div>
                </div>

                <div className="ai-controls-row">
                    <button
                        type="button"
                        className="ai-icon-btn"
                        onClick={onOpenApiKeyModal}
                        title="Configure Gemini API Key"
                        style={{ background: 'transparent', border: 'none', color: '#64748b' }}
                    >
                        ⚙️
                    </button>
                </div>
            </div>

            {/* Chat Messages Log (Only shows if there are messages) */}
            {messages.length > 0 && (
                <div className="ai-chat-body" style={{ maxHeight: '250px' }}>
                    {messages.map(msg => (
                        <div key={msg.id} className={`ai-message ${msg.role}`}>
                            <div className="ai-msg-header">
                                <span className="ai-msg-role">
                                    {msg.role === 'user' ? '👤 YOU' : msg.role === 'model' ? '✨ GEMINI' : '⚙️ SYSTEM'}
                                </span>
                            </div>

                            {msg.imageUrl && (
                                <div className="ai-msg-image-wrap">
                                    <img src={msg.imageUrl} alt="Viewport Snapshot" className="ai-msg-thumb" />
                                </div>
                            )}

                            <div className="ai-msg-content">{msg.text}</div>

                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                                <div className="ai-tool-executions">
                                    {msg.toolCalls.map((tc, idx) => (
                                        <div key={idx} className="ai-tool-pill">
                                            <span className="tool-name">⚡ {tc.name}()</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {isLoading && (
                        <div className="ai-message model loading">
                            <div className="ai-typing-indicator">
                                <span />
                                <span />
                                <span />
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
            )}

            {/* Input Bar */}
            <div style={{ padding: '0 20px 20px' }}>
                <form
                    className="ai-input-form"
                    style={{ background: 'rgba(0, 0, 0, 0.5)', borderRadius: '12px', padding: '6px 12px', border: '1px solid rgba(255, 255, 255, 0.1)', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}
                    onSubmit={e => {
                        e.preventDefault();
                        void handleSend();
                    }}
                >
                    <input
                        type="text"
                        className="ai-text-input"
                        style={{ background: 'transparent', border: 'none', boxShadow: 'none', fontSize: '13px', padding: '0 4px', height: '32px' }}
                        placeholder="Ask the AI assistant..."
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        disabled={isLoading}
                    />

                    <button
                        type="submit"
                        className="ai-send-btn"
                        style={{ background: 'transparent', border: 'none', padding: '0 8px', color: '#64748b', fontSize: '16px', height: 'auto', boxShadow: 'none' }}
                        disabled={isLoading || (!inputText.trim() && !stagedSnapshot)}
                    >
                        ➤
                    </button>
                </form>
            </div>
        </div>
    );
};
