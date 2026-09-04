import { useEffect, useState } from 'react'

import {
    getDefaultR2Readiness,
    type DefaultR2Readiness,
} from '@/services/r2/readiness'
import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'

export type { DefaultR2Readiness } from '@/services/r2/readiness'

const unavailable: DefaultR2Readiness = { status: 'unavailable', reason: 'profile', profile: null }

export function r2ReadinessProfileId(profileId: string | null, enabled: boolean): string | null {
    return enabled ? profileId ?? DEFAULT_R2_PROFILE_ID : null
}

export function matchR2Readiness(profileId: string | null, state: DefaultR2Readiness) {
    const profile = state.profile?.id === profileId ? state.profile : null
    return { profile, ready: profile !== null && state.status === 'ready' }
}

export function useDefaultR2Readiness(
    profileId: string | null = DEFAULT_R2_PROFILE_ID,
    enabled = true,
): DefaultR2Readiness {
    const requestedProfileId = r2ReadinessProfileId(profileId, enabled)
    const [state, setState] = useState<DefaultR2Readiness>(enabled ? { status: 'loading', profile: null } : unavailable)

    useEffect(() => {
        if (requestedProfileId === null) {
            setState(unavailable)
            return
        }
        let active = true
        setState({ status: 'loading', profile: null })
        void getDefaultR2Readiness(requestedProfileId).then(nextState => {
            if (active) setState(nextState)
        }).catch(() => {
            if (active) setState(unavailable)
        })
        return () => { active = false }
    }, [requestedProfileId])

    return state
}
