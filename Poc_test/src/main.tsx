import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Polyfill crypto.randomUUID for non-HTTPS environments (e.g. testing on mobile over local IP)
if (!window.crypto) {
    (window as any).crypto = {};
}
if (!window.crypto.randomUUID) {
    window.crypto.randomUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        }) as `${string}-${string}-${string}-${string}-${string}`;
    };
}

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Missing React root element.');
}

createRoot(rootElement).render(<App />);
