import {
    deriveGenerationFulfillment,
    type GenerationFulfillmentFacts,
    type GenerationFulfillmentProjection,
} from '@/application/generation/generation-fulfillment'

/** Read-only protocol boundary implemented by the composition root from existing durable authorities. */
export interface GenerationRunReadPort {
    readGenerationRunFacts(runId: string): Promise<GenerationFulfillmentFacts | null>
}

/** Protocol-neutral generation.getRun use case; the durable batch ID is the run ID. */
export async function getGenerationRun(
    port: GenerationRunReadPort,
    runId: string,
): Promise<GenerationFulfillmentProjection | null> {
    const facts = await port.readGenerationRunFacts(runId)
    return facts ? deriveGenerationFulfillment(facts) : null
}
