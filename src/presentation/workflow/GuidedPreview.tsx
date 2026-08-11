import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router'

import { GuidedCredentialGate } from './GuidedCredentialGate'
import { GuidedHome } from './GuidedHome'
import { GuidedShell } from './GuidedShell'
import { GuidedSingleImage } from './GuidedSingleImage'
import { GuidedTaskRouter } from './GuidedTaskRouter'
import { GuidedWorkflowHub } from './GuidedWorkflowHub'

const GuidedBatchImages = lazy(() => import('./GuidedBatchImages').then(module => ({ default: module.GuidedBatchImages })))

export default function GuidedPreview() {
    return (
        <GuidedShell>
            <GuidedCredentialGate>
                <Routes>
                    <Route index element={<GuidedHome />} />
                    <Route path="guide/:workflowId" element={<GuidedWorkflowHub />} />
                    <Route path="task/:workflowId/:optionId" element={<GuidedTaskRouter />} />
                    <Route path="work/:draftId/:nodeId" element={<GuidedSingleImage />} />
                    <Route path="batch/:draftId/:nodeId" element={<GuidedBatchImages />} />
                    <Route path="*" element={<Navigate to="/guided-preview" replace />} />
                </Routes>
            </GuidedCredentialGate>
        </GuidedShell>
    )
}
