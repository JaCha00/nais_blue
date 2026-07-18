import { useAuthStore } from '@/stores/auth-store'

/**
 * Generation commands depend on at least one verified, enabled API credential.
 * Opening the local token dialog at the command boundary prevents silent
 * durable jobs that cannot be claimed, while an unlock still resumes queued
 * work through the app-level durable runtime's token subscription.
 */
export function ensureActiveGenerationCredential(): boolean {
    const auth = useAuthStore.getState()
    if (auth.getActiveTokens().length > 0) return true
    auth.requestTokenEntry()
    return false
}
