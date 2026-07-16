import { useEffect } from 'react'

import { getRuntimeDurableQueueCoordinator } from '@/services/queue/runtime'
import { useAuthStore } from '@/stores/auth-store'
import { useQueueStore } from '@/stores/queue-store'

/** App-level lifetime keeps durable claims alive while routes change. */
export function useDurableQueueRuntime(): void {
    const executionAuthority = useQueueStore(state => state.executionAuthority)
    const token = useAuthStore(state => state.token)
    const token2 = useAuthStore(state => state.token2)
    const slot1Enabled = useAuthStore(state => state.slot1Enabled)
    const slot2Enabled = useAuthStore(state => state.slot2Enabled)

    useEffect(() => {
        const coordinator = getRuntimeDurableQueueCoordinator()
        if (executionAuthority === 'durable') coordinator.start()
        else coordinator.stop()
        return () => coordinator.stop()
    }, [executionAuthority, token, token2, slot1Enabled, slot2Enabled])
}
