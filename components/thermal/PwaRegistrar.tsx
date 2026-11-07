'use client';

import { useEffect } from 'react';

export function PwaRegistrar() {
    useEffect(() => {
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/sw.js', { scope: '/' })
                .catch((err) => {
                    console.warn('Service worker registration failed:', err);
                });
        }
    }, []);

    return null;
}
