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
    }, [email, setCurrentUser]);

    return null;
}
