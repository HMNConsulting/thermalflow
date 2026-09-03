'use client';

import { useTaskStore } from '@/lib/store';
import { useEffect, useRef } from 'react';

export function UserInitializer({ email }: { email: string }) {
    const setCurrentUser = useTaskStore(state => state.setCurrentUser);
    const initialized = useRef(false);

    useEffect(() => {
        if (!initialized.current) {
            setCurrentUser(email);
            initialized.current = true;
        }

        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const selectId = params.get('select');
            if (selectId) {
                setTimeout(() => {
                    const store = useTaskStore.getState();
                    if (store.tasks[selectId]) {
                        store.selectTask(selectId);
                        window.history.replaceState({}, '', window.location.pathname);
                    }
                }, 150);
            }
        }
    }, [email, setCurrentUser]);

    return null;
}

