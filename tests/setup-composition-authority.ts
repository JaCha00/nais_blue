import { beforeEach } from 'vitest'

import { setRuntimeCompositionAuthority } from '@/lib/composition-authority'

// Product startup is fail-closed. Existing workflow tests explicitly exercise
// their requested rollout modes after this test-only authority activation.
beforeEach(() => {
    setRuntimeCompositionAuthority('legacy')
    setRuntimeCompositionAuthority('v2')
})
