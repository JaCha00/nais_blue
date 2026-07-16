import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { indexedDBStorage } from '@/lib/indexed-db'

export type QueueExecutionAuthority = 'durable' | 'legacy'
export type QueueEnqueueWorkflow = 'main' | 'scene'

type PendingEnqueueOperationIds = Record<QueueEnqueueWorkflow, string | null>

function newEnqueueOperationId(): string {
    return globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

interface QueueUiState {
    /** Rollback flag only. It never deletes durable jobs or legacy queueCount. */
    executionAuthority: QueueExecutionAuthority
    selectedBatchId: string | null
    pendingEnqueueOperationIds: PendingEnqueueOperationIds
    setExecutionAuthority: (authority: QueueExecutionAuthority) => void
    setSelectedBatchId: (batchId: string | null) => void
    beginEnqueueOperation: (workflow: QueueEnqueueWorkflow) => string
    completeEnqueueOperation: (workflow: QueueEnqueueWorkflow, operationId: string) => void
}

export const useQueueStore = create<QueueUiState>()(persist(
    set => ({
        executionAuthority: 'durable',
        selectedBatchId: null,
        pendingEnqueueOperationIds: { main: null, scene: null },
        setExecutionAuthority: executionAuthority => set({ executionAuthority }),
        setSelectedBatchId: selectedBatchId => set({ selectedBatchId }),
        beginEnqueueOperation: workflow => {
            let selected = ''
            set(state => {
                selected = state.pendingEnqueueOperationIds[workflow] ?? newEnqueueOperationId()
                return {
                    pendingEnqueueOperationIds: {
                        ...state.pendingEnqueueOperationIds,
                        [workflow]: selected,
                    },
                }
            })
            return selected
        },
        completeEnqueueOperation: (workflow, operationId) => set(state => (
            state.pendingEnqueueOperationIds[workflow] !== operationId
                ? state
                : {
                    pendingEnqueueOperationIds: {
                        ...state.pendingEnqueueOperationIds,
                        [workflow]: null,
                    },
                }
        )),
    }),
    {
        name: 'nais2-queue-ui',
        version: 1,
        storage: createJSONStorage(() => indexedDBStorage),
        partialize: state => ({
            executionAuthority: state.executionAuthority,
            selectedBatchId: state.selectedBatchId,
            pendingEnqueueOperationIds: state.pendingEnqueueOperationIds,
        }),
    },
))
