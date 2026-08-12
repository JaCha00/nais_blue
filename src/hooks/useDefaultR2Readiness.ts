import { useEffect, useState } from 'react'

import {
    getDefaultR2Readiness,
    type DefaultR2Readiness,
} from '@/services/r2/readiness'

export type { DefaultR2Readiness } from '@/services/r2/readiness'

export function useDefaultR2Readiness(): DefaultR2Readiness {
    const [state, setState] = useState<DefaultR2Readiness>({ status: 'loading', profile: null })

    useEffect(() => {
        let active = true
        void getDefaultR2Readiness().then(nextState => {
            if (active) setState(nextState)
        }).catch(() => {
            if (active) setState({ status: 'unavailable', reason: 'profile', profile: null })
        })
        return () => { active = false }
    }, [])

    return state
}
