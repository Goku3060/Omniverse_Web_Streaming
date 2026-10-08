import React, { useState } from 'react';

interface ApiKeyModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentKey: string;
    onSaveKey: (key: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
    isOpen,
    onClose,
    currentKey,
    onSaveKey,
}) => {
    const [keyInput, setKeyInput] = useState(currentKey);
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [statusMessage, setStatusMessage] = useState('');

    if (!isOpen) return null;

    const handleTestKey = async () => {
        if (!keyInput.trim()) {
            setTestStatus('error');
            setStatusMessage('Please enter an API key first.');
            return;
        }

        setTestStatus('testing');
        setStatusMessage('Verifying API Key with Google AI...');

        try {
            // 1. Query model catalog for this key with a 5s timeout
            const catalogRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${keyInput.trim()}`,
                { signal: AbortSignal.timeout(5000) }
            );

            if (!catalogRes.ok) {
                const errText = await catalogRes.text();
                throw new Error(errText);
            }

            const data = await catalogRes.json();
            const models: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> =
                data.models || [];

            const valid = models.filter(m =>
                m.supportedGenerationMethods?.includes('generateContent')
            );

            if (valid.length === 0) {
                throw new Error('Key is valid, but no models supporting generateContent were found.');
            }

            // 1. Build prioritized candidate list (gemini-3.8-flash first, then flash models, then others)
            const flash = valid
                .filter(m => m.name.toLowerCase().includes('flash'))
                .map(m => m.name.replace(/^models\//, ''));
            const others = valid
                .filter(m => !m.name.toLowerCase().includes('flash'))
                .map(m => m.name.replace(/^models\//, ''));

            // Top candidates to test (limit to first 4 to keep verification fast)
            const candidateNames = Array.from(
                new Set(['gemini-3.8-flash', ...flash, ...others])
            ).slice(0, 5);

            // 2. Test candidates in order until an active model responds successfully
            let verifiedModel = '';
            let lastErrText = '';

            for (const modelName of candidateNames) {
                setStatusMessage(`Testing model: ${modelName}...`);
                try {
                    const testRes = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keyInput.trim()}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }],
                            }),
                            signal: AbortSignal.timeout(3500),
                        }
                    );

                    if (testRes.ok) {
                        verifiedModel = modelName;
                        break;
                    } else {
                        const err = await testRes.text();
                        lastErrText = err;
                        if (err.includes('API_KEY_INVALID') || testRes.status === 403) {
                            break;
                        }
                    }
                } catch (e: any) {
                    lastErrText = e.message || String(e);
                }
            }

            if (!verifiedModel) {
                throw new Error(lastErrText || 'Could not find an active model on your account');
            }

            localStorage.setItem('gemini_active_model', verifiedModel);
            setTestStatus('success');
            setStatusMessage(`Verified! Connected to: ${verifiedModel}`);
        } catch (err: any) {
            setTestStatus('error');
            setStatusMessage(`Failed: ${err.message || 'Invalid API Key'}`);
        }
    };

    const handleSave = () => {
        onSaveKey(keyInput.trim());
        onClose();
    };

    return (
        <div className="modal-backdrop">
            <div className="api-key-modal">
                <div className="modal-header">
                    <div className="modal-title-group">
                        <span className="modal-icon">✨</span>
                        <h2 className="modal-title">Gemini Flash AI Setup</h2>
                    </div>
                    <button type="button" className="modal-close-btn" onClick={onClose}>
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    <p className="modal-desc">
                        Connect Google Gemini Flash Free Tier to control your Omniverse Digital Twin with natural language, voice, and multimodal vision.
                    </p>

                    <div className="free-tier-callout">
                        <div className="callout-header">
                            <span className="callout-badge">100% FREE</span>
                            <strong>How to get a Free API Key (30 seconds):</strong>
                        </div>
                        <ol className="callout-steps">
                            <li>
                                Open{' '}
                                <a
                                    href="https://aistudio.google.com/app/apikey"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="callout-link"
                                >
                                    Google AI Studio (aistudio.google.com) ↗
                                </a>
                            </li>
                            <li>Sign in with your Google Account and click <strong>Create API Key</strong>.</li>
                            <li>Copy and paste it below. No credit card is required!</li>
                        </ol>
                    </div>

                    <div className="input-field-group">
                        <label className="input-label" htmlFor="gemini-key-input">
                            GEMINI API KEY
                        </label>
                        <input
                            id="gemini-key-input"
                            type="password"
                            className="modal-text-input"
                            placeholder="AIzaSy..."
                            value={keyInput}
                            onChange={e => setKeyInput(e.target.value)}
                        />
                    </div>

                    {testStatus !== 'idle' && (
                        <div className={`test-status-box ${testStatus}`}>
                            {testStatus === 'testing' && '⏳ '}
                            {testStatus === 'success' && '✅ '}
                            {testStatus === 'error' && '❌ '}
                            {statusMessage}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-secondary-btn"
                        onClick={handleTestKey}
                        disabled={testStatus === 'testing'}
                    >
                        Test Connection
                    </button>
                    <button
                        type="button"
                        className="modal-primary-btn"
                        onClick={handleSave}
                        disabled={!keyInput.trim()}
                    >
                        Save & Activate
                    </button>
                </div>
            </div>
        </div>
    );
};
