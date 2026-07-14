import type { DiagnosticContext } from '@/domain/diagnostics/types'
import { addDiagnosticBreadcrumb, createDiagnosticEvent } from './error-registry'

export interface OperationMonitorOptions {
    now?: () => number
    slowThresholdMs?: number
    stalledThresholdMs?: number
    hardTimeoutMs?: number
    onObservation?: (event: ReturnType<typeof createDiagnosticEvent>) => void
    autoCheck?: boolean
    pollIntervalMs?: number
    /** Reserved for a future adaptive policy; this phase always uses fixed thresholds. */
    adaptiveThresholdExtension?: never
}

export interface MonitoredOperationOptions extends DiagnosticContext {
    operation: string
    stage: string
}

export interface OperationObservation {
    operationId: string
    stage: string
    startedAt: number
    lastProgressAt: number
    elapsedMs: number
    slow: boolean
    stalled: boolean
    timeout: boolean
    completed: boolean
}

const DEFAULT_SLOW_THRESHOLD_MS = 10_000
const DEFAULT_STALLED_THRESHOLD_MS = 30_000
const DEFAULT_HARD_TIMEOUT_MS = 120_000

export class OperationMonitor {
    private readonly now: () => number
    private readonly slowThresholdMs: number
    private readonly stalledThresholdMs: number
    private readonly hardTimeoutMs: number
    private readonly onObservation?: (event: ReturnType<typeof createDiagnosticEvent>) => void
    private readonly autoCheck: boolean
    private readonly pollIntervalMs: number
    private nextId = 0

    constructor(options: OperationMonitorOptions = {}) {
        this.now = options.now ?? Date.now
        this.slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS
        this.stalledThresholdMs = options.stalledThresholdMs ?? DEFAULT_STALLED_THRESHOLD_MS
        this.hardTimeoutMs = options.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS
        this.onObservation = options.onObservation
        this.autoCheck = options.autoCheck ?? false
        this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    }

    start(options: MonitoredOperationOptions): MonitoredOperation {
        const startedAt = this.now()
        const operation = new MonitoredOperation(
            `operation-${++this.nextId}`,
            options,
            startedAt,
            this.now,
            this.slowThresholdMs,
            this.stalledThresholdMs,
            this.hardTimeoutMs,
            this.onObservation,
            this.autoCheck ? this.pollIntervalMs : undefined,
        )
        addDiagnosticBreadcrumb(options.operation, options.stage, 'started')
        return operation
    }
}

export class MonitoredOperation {
    private stageValue: string
    private lastProgressValue: number
    private completedValue = false
    private emittedSlow = false
    private emittedStalled = false
    private emittedTimeout = false
    private readonly timer: ReturnType<typeof setInterval> | undefined

    constructor(
        readonly id: string,
        private readonly options: MonitoredOperationOptions,
        readonly startedAt: number,
        private readonly now: () => number,
        private readonly slowThresholdMs: number,
        private readonly stalledThresholdMs: number,
        private readonly hardTimeoutMs: number,
        private readonly emit?: (event: ReturnType<typeof createDiagnosticEvent>) => void,
        pollIntervalMs?: number,
    ) {
        this.stageValue = options.stage
        this.lastProgressValue = startedAt
        this.timer = pollIntervalMs === undefined ? undefined : setInterval(() => this.check(), pollIntervalMs)
    }

    stageStart(stage: string): void {
        this.stageValue = stage
        this.heartbeat('stage-start')
    }

    stageFinish(stage = this.stageValue): void {
        this.stageValue = stage
        this.heartbeat('stage-finish')
    }

    heartbeat(message = 'progress'): void {
        this.lastProgressValue = this.now()
        addDiagnosticBreadcrumb(this.options.operation, this.stageValue, message)
    }

    finish(): void {
        this.completedValue = true
        this.heartbeat('finished')
        if (this.timer !== undefined) clearInterval(this.timer)
    }

    check(): OperationObservation {
        const now = this.now()
        const elapsedMs = Math.max(0, now - this.startedAt)
        const stalled = !this.completedValue && now - this.lastProgressValue >= this.stalledThresholdMs
        const observation: OperationObservation = {
            operationId: this.id,
            stage: this.stageValue,
            startedAt: this.startedAt,
            lastProgressAt: this.lastProgressValue,
            elapsedMs,
            slow: !this.completedValue && elapsedMs >= this.slowThresholdMs,
            stalled,
            timeout: !this.completedValue && elapsedMs >= this.hardTimeoutMs,
            completed: this.completedValue,
        }
        this.emitTransitions(observation)
        return observation
    }

    private emitTransitions(observation: OperationObservation): void {
        if (observation.slow && !this.emittedSlow) {
            this.emittedSlow = true
            this.emit?.(createDiagnosticEvent({
                ...this.options,
                stage: observation.stage,
                category: 'stalled',
                severity: 'warning',
                code: 'OPERATION_SLOW',
                userSummary: '작업이 평소보다 오래 걸리고 있습니다.',
                recommendedAction: '계속 진행 중인지 확인하세요.',
                startedAt: new Date(observation.startedAt),
                lastProgressAt: new Date(observation.lastProgressAt),
                elapsedMs: observation.elapsedMs,
            }))
        }
        if (observation.stalled && !this.emittedStalled) {
            this.emittedStalled = true
            this.emit?.(createDiagnosticEvent({
                ...this.options,
                stage: observation.stage,
                category: 'stalled',
                severity: 'warning',
                code: 'OPERATION_STALLED',
                userSummary: '작업 진행 상황이 멈춘 것으로 보입니다.',
                recommendedAction: '잠시 기다리거나 다시 시도하세요.',
                startedAt: new Date(observation.startedAt),
                lastProgressAt: new Date(observation.lastProgressAt),
                elapsedMs: observation.elapsedMs,
                stalled: true,
            }))
        }
        if (observation.timeout && !this.emittedTimeout) {
            this.emittedTimeout = true
            this.emit?.(createDiagnosticEvent({
                ...this.options,
                stage: observation.stage,
                category: 'timeout',
                severity: 'error',
                code: 'OPERATION_TIMEOUT',
                userSummary: '작업 시간이 제한을 초과했습니다.',
                recommendedAction: '연결을 확인한 뒤 다시 시도하세요.',
                startedAt: new Date(observation.startedAt),
                lastProgressAt: new Date(observation.lastProgressAt),
                elapsedMs: observation.elapsedMs,
                timeout: true,
            }))
        }
    }
}
